<script lang="ts">
  /**
   * Agent 总览：机器状态、待办提醒、各流程一张卡（实例数、下次运行、上次运行；点进去看实例、运行和流程自己的东西）、全局设置。
   *
   * 页面可见时每 10 秒从 hub 刷新一次。hub 上的数据是 Mac 最近一次上传时的状态（有新动态时约 2～7 秒内，否则一小时一次），
   * 「立即同步」让 Mac 马上传一次。
   */
  import { onMount } from 'svelte';

  import { adminStatus } from '../../lib/admin-status.svelte';
  import { formatFullTime, formatTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import {
    EXPLORE_FLOW,
    getOverview,
    IMPLEMENT_FLOW,
    instanceLabel,
    runStatusClass,
    runStatusLabel,
    SERIES_FLOWS,
    type IFlow,
    type IInstance,
    type IMachine,
    type IOverview,
  } from './api';
  import AgentTabs from './AgentTabs.svelte';
  import { commandState, performCommand } from './command.svelte';
  import SettingsForm from './SettingsForm.svelte';

  /** 自动刷新间隔 */
  const REFRESH_INTERVAL_MS = 10_000;

  /** 一张流程卡 */
  interface IFlowCard {
    flow: IFlow;
    instances: IInstance[];
    /** 启用中的实例里最早的下次运行 */
    nextRunAt: string | null;
    /** 全部实例里最近的一次运行 */
    last: { instance: IInstance; run: NonNullable<IInstance['lastRun']> } | null;
    /** 卡头的模式标记：推送 / 推新分支 / 只出想法 */
    badge: { label: string; tone: string };
  }

  let overview = $state<IOverview | null>(null);
  let isLoading = $state(true);
  let errorText = $state<string | null>(null);

  const machines = $derived(overview?.machines ?? []);
  /** 产品探索还没处理的想法数 */
  const ideaCount = $derived(adminStatus.value?.agentIdeaCount ?? 0);
  const cards = $derived(overview === null ? [] : buildCards(overview));

  /** 卡头的模式标记：review、代码清理复审通过就推到开发分支 */
  function badgeOf(flow: IFlow): IFlowCard['badge'] {
    if (flow.type === IMPLEMENT_FLOW) {
      return { label: '推新分支', tone: 'resolved' };
    }
    if (flow.type === EXPLORE_FLOW) {
      return { label: '只出想法', tone: 'info' };
    }
    return { label: '推送', tone: 'resolved' };
  }

  /** 按机器报上来的流程类型（保持 agentd 的顺序）汇总各自的实例 */
  function buildCards(data: IOverview): IFlowCard[] {
    const flows = new Map<string, IFlow>();
    for (const machine of data.machines) {
      for (const flow of machine.flows) {
        const known = flows.get(flow.type);
        if (known === undefined) {
          flows.set(flow.type, flow);
        } else if (flow.isPaused && !known.isPaused) {
          flows.set(flow.type, { ...known, isPaused: true });
        }
      }
    }
    return [...flows.values()].map((flow) => {
      const instances = data.instances.filter((item) => item.flowType === flow.type);
      const nextRuns = instances.flatMap((item) => (item.isEnabled && item.nextRunAt !== null ? [item.nextRunAt] : [])).sort();
      let last: IFlowCard['last'] = null;
      for (const instance of instances) {
        if (instance.lastRun !== null && (last === null || instance.lastRun.queuedAt > last.run.queuedAt)) {
          last = { instance, run: instance.lastRun };
        }
      }
      return { flow, instances, nextRunAt: nextRuns[0] ?? null, last, badge: badgeOf(flow) };
    });
  }

  /** 暂停了的实例数 */
  function pausedCount(card: IFlowCard): number {
    return card.instances.filter((item) => !item.isEnabled).length;
  }

  /** 加载总览；isSilent 时不显示加载中 */
  async function load(isSilent = false): Promise<void> {
    if (!isSilent) {
      isLoading = true;
    }
    try {
      overview = await getOverview();
      errorText = null;
    } catch (error) {
      errorText = errorMessage(error);
    } finally {
      isLoading = false;
    }
  }

  /** 机器状态：是否在线、数据是几点的 */
  function machineText(machine: IMachine): string {
    return `${machine.isOnline ? '在线' : '离线'} · 数据更新于 ${formatTime(machine.lastSeenAt)}`;
  }

  /** 让 Mac 马上把最新状态传上来 */
  async function syncNow(machine: IMachine): Promise<void> {
    if (await performCommand(machine.id, { type: 'sync.now', payload: {} }, '立即同步')) {
      await load(true);
    }
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load(true);
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  });
</script>

<section class="page">
  <header class="page-header">
    <div class="page-title">
      <h1>Agent</h1>
      <p class="page-sub">Mac 上的自动 review、清理、产品探索与一次实现</p>
    </div>
    <button class="btn" type="button" onclick={() => void load()} disabled={isLoading}>刷新</button>
  </header>
  <AgentTabs active="overview" />

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if overview === null}
    {#if isLoading}<p class="empty">加载中…</p>{/if}
  {:else}
    {#if machines.length === 0}
      <p class="empty">还没有 Mac 同步过来。在 Mac 上运行 <span class="mono">agentctl hub setup</span>，按提示配置 hub。</p>
    {/if}
    {#each machines as machine (machine.id)}
      <div class="machine">
        <span class="dot" class:online={machine.isOnline}></span>
        <div class="machine-text">
          <span class="machine-name">{machine.id}</span>
          <span class="muted machine-meta" title={formatFullTime(machine.lastSeenAt)}>{machineText(machine)}</span>
        </div>
        {#if machine.health !== null}
          <span class="machine-health">运行中 {machine.health.activeRuns} · 排队 {machine.health.queuedRuns}</span>
        {/if}
        <button class="btn sync" type="button" disabled={commandState.isBusy} onclick={() => void syncNow(machine)}>立即同步</button>
        {#if machine.health !== null && machine.health.status !== 'ok'}
          <p class="machine-error">{machine.health.detail}</p>
        {/if}
      </div>
    {/each}

    {#if overview.inbox.length > 0}
      <a class="inbox-banner" href="/agents/inbox">
        <span class="inbox-count">{overview.inbox.length}</span>
        <span class="inbox-text">
          <span class="inbox-title">条待办等你决定</span>
          <span class="inbox-sub">主审交给你的问题，和需要你看一下的运行</span>
        </span>
        <span class="inbox-arrow" aria-hidden="true">→</span>
      </a>
    {/if}

    {#if cards.length > 0}
      <div class="section-header">
        <h2>流程</h2>
      </div>
      <div class="flows">
        {#each cards as card (card.flow.type)}
          <a class="flow" class:paused={card.flow.isPaused} href="/agents/flows/{card.flow.type}">
            <div class="flow-head">
              <h2>{card.flow.title}</h2>
              {#if card.flow.isPaused}<span class="status status-neutral">已暂停</span>{/if}
              <span class="status status-{card.badge.tone}">{card.badge.label}</span>
              <span class="arrow" aria-hidden="true">→</span>
            </div>
            <p class="flow-desc">{card.flow.description}</p>
            <div class="flow-facts">
              {#if card.flow.type === IMPLEMENT_FLOW}
                <span>只手动：在 Mac 上用 <span class="mono">/yado-implement</span> 提需求</span>
              {:else}
                {#if card.flow.type === EXPLORE_FLOW}
                  {#if ideaCount > 0}
                    <span class="attention">{ideaCount} 条想法等你看</span>
                  {:else if card.instances.length > 0}
                    <span class="muted">没有待看的想法</span>
                  {/if}
                {:else if card.instances.length > 0}
                  <span><b>{card.instances.length}</b> 个仓库{pausedCount(card) > 0 ? `，${pausedCount(card)} 个暂停` : ''}</span>
                {/if}
                {#if card.instances.length === 0}
                  <span class="muted">{SERIES_FLOWS.has(card.flow.type) ? '还没有实例' : '还没有仓库'}</span>
                {:else if card.nextRunAt !== null}
                  <span>下次 <b><time datetime={card.nextRunAt} title={formatFullTime(card.nextRunAt)}>{formatTime(card.nextRunAt)}</time></b></span>
                {/if}
              {/if}
            </div>
            {#if card.last !== null}
              <div class="flow-last" title={card.last.run.reason ?? card.last.run.summary ?? undefined}>
                <span class={runStatusClass(card.last.run.status)}>{runStatusLabel(card.last.run.status)}</span>
                <span class="muted last-time">
                  {#if !SERIES_FLOWS.has(card.flow.type)}{instanceLabel(card.last.instance)} · {/if}{formatTime(card.last.run.queuedAt)}
                </span>
                <span class="flow-summary">{card.last.run.reason ?? card.last.run.summary ?? ''}</span>
              </div>
            {/if}
          </a>
        {/each}
      </div>
    {/if}

    {#each machines as machine (machine.id)}
      {#if machine.settings !== null}
        <details class="settings">
          <summary>全局设置{machines.length > 1 ? `（${machine.id}）` : ''}</summary>
          <SettingsForm {machine} settings={machine.settings} onSaved={() => void load(true)} />
        </details>
      {/if}
    {/each}
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 24px 80px;
  }

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .page-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .page-sub {
    color: var(--muted);
    font-size: 13px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 4px;
  }

  h1 {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
  }

  .machine {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    padding: 12px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }

  .machine-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .machine-name {
    font-weight: 600;
  }

  .machine-meta {
    font-size: 12px;
  }

  .machine-health {
    color: var(--muted);
    font-size: 12px;
  }

  .machine .sync {
    margin-left: auto;
  }

  .machine-error {
    flex-basis: 100%;
    color: var(--danger);
    font-size: 13px;
  }

  .dot {
    flex-shrink: 0;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--muted);
    box-shadow: 0 0 0 3px var(--line);
  }

  .dot.online {
    background: var(--resolved);
    box-shadow: 0 0 0 3px var(--resolved-bg);
  }

  .inbox-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: var(--radius-lg);
    background: var(--pending-bg);
    color: var(--pending);
  }

  .inbox-count {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    min-width: 28px;
    height: 28px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--pending);
    color: var(--on-pending);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .inbox-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .inbox-title {
    font-weight: 600;
  }

  .inbox-sub {
    color: var(--muted);
    font-size: 12px;
  }

  .inbox-arrow {
    margin-left: auto;
    font-size: 16px;
    transition: transform 0.15s;
  }

  .inbox-banner:hover .inbox-arrow {
    transform: translateX(3px);
  }

  /* 流程卡：两列，手机上一列 */
  .flows {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .flow {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .flow:hover {
    border-color: var(--line-strong);
    box-shadow: var(--shadow-md);
  }

  .flow.paused {
    opacity: 0.7;
  }

  .flow-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .flow-head h2 {
    font-size: 16px;
  }

  .arrow {
    margin-left: auto;
    color: var(--muted);
    transition: transform 0.15s;
  }

  .flow:hover .arrow {
    transform: translateX(3px);
  }

  /* 说明最多两行，长的截掉 */
  .flow-desc {
    display: -webkit-box;
    overflow: hidden;
    color: var(--muted);
    font-size: 13px;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .flow-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 13px;
  }

  .flow-facts b {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .attention {
    color: var(--pending);
    font-weight: 500;
  }

  .flow-last {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin-top: auto;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    font-size: 13px;
  }

  .last-time {
    flex-shrink: 0;
    font-size: 12px;
    white-space: nowrap;
  }

  .flow-summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .settings {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }

  .settings summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    cursor: pointer;
    font-weight: 500;
    list-style: none;
  }

  .settings summary::-webkit-details-marker {
    display: none;
  }

  .settings summary::after {
    color: var(--muted);
    content: '›';
    transform: rotate(90deg);
    transition: transform 0.15s;
  }

  .settings[open] summary::after {
    transform: rotate(-90deg);
  }

  @media (max-width: 720px) {
    .page {
      padding: 16px 16px 80px;
    }

    .flows {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
