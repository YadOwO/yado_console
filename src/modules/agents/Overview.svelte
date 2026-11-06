<script lang="ts">
  /**
   * Agent 总览：机器状态、今天的汇总、待办提醒、各流程实例（可新建、修改、暂停、立即运行、删除）、
   * 最近运行与全局设置。
   *
   * 页面可见时每 10 秒从 hub 刷新一次；表单打开时只刷新数据，不冲掉正在编辑的内容。
   * hub 上的数据是 Mac 最近一次上传时的状态（有新动态时约 2～7 秒内，否则一小时一次），「立即同步」让 Mac 马上传一次。
   */
  import { onMount } from 'svelte';

  import { refreshAdminStatus } from '../../lib/admin-status.svelte';
  import { formatFullTime, formatTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import {
    EXPLORE_FLOW,
    getOverview,
    IMPLEMENT_FLOW,
    SERIES_FLOWS,
    listRuns,
    runStatusClass,
    runStatusLabel,
    shortSha,
    type IInstance,
    type IMachine,
    type IOverview,
    type IRunListItem,
  } from './api';
  import AgentTabs from './AgentTabs.svelte';
  import { commandState, performCommand } from './command.svelte';
  import InstanceForm from './InstanceForm.svelte';
  import RunItems from './RunItems.svelte';
  import SettingsForm from './SettingsForm.svelte';

  /** 自动刷新间隔 */
  const REFRESH_INTERVAL_MS = 10_000;

  let overview = $state<IOverview | null>(null);
  let recentRuns = $state<IRunListItem[]>([]);
  let isLoading = $state(true);
  let errorText = $state<string | null>(null);
  /** 正在修改的实例 ID */
  let editingId = $state<string | null>(null);
  let isCreating = $state(false);

  const machines = $derived(overview?.machines ?? []);
  const today = $derived(overview?.today ?? null);
  const runCount = $derived(Object.values(today?.runs ?? {}).reduce((sum, count) => sum + count, 0));

  /** 加载总览与最近运行；isSilent 时不显示加载中 */
  async function load(isSilent = false): Promise<void> {
    if (!isSilent) {
      isLoading = true;
    }
    try {
      // 依次请求：两个都很轻，没必要并发
      overview = await getOverview();
      recentRuns = (await listRuns({ limit: 8 })).runs;
      errorText = null;
    } catch (error) {
      errorText = errorMessage(error);
    } finally {
      isLoading = false;
    }
  }

  /** 指令成功后刷新页面与侧栏角标 */
  async function afterCommand(): Promise<void> {
    await load(true);
    refreshAdminStatus().catch(() => undefined);
  }

  /** 流程类型的中文名 */
  function flowTitle(instance: IInstance): string {
    return machines.find((item) => item.id === instance.machineId)?.flows.find((flow) => flow.type === instance.flowType)?.title ?? instance.flowType;
  }

  /** 发一条针对实例的指令，成功后刷新 */
  async function act(instance: IInstance, input: Parameters<typeof performCommand>[1], label: string): Promise<void> {
    if (await performCommand(instance.machineId, input, `${label} ${instance.repo}`)) {
      await afterCommand();
    }
  }

  /** 机器状态：是否在线、数据是几点的 */
  function machineText(machine: IMachine): string {
    return `${machine.isOnline ? '在线' : '离线'} · 数据更新于 ${formatTime(machine.lastSeenAt)}`;
  }

  /** 让 Mac 马上把最新状态传上来 */
  async function syncNow(machine: IMachine): Promise<void> {
    if (await performCommand(machine.id, { type: 'sync.now', payload: {} }, '立即同步')) {
      await afterCommand();
    }
  }

  /** 删除实例，先确认 */
  function remove(instance: IInstance): void {
    const where = SERIES_FLOWS.has(instance.flowType) ? instance.repo : `${instance.repo}（${instance.branch}）`;
    if (confirm(`删除 ${where} 的${flowTitle(instance)}？运行记录会保留，不修清单会清空。`)) {
      void act(instance, { type: 'instance.delete', payload: { id: instance.id } }, '删除');
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
      <p class="page-sub">Mac 上的自动 review、修复、清理与产品探索</p>
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

    {#if today !== null}
      <div class="stats" aria-label="今天">
        <div class="stats-head"><h2>今天</h2></div>
        <div class="stats-grid">
          <div><strong>{runCount}</strong><span>今天运行</span></div>
          <div><strong class="tone-resolved">{today.findings.fixed}</strong><span>修复</span></div>
          <div><strong class="tone-muted">{today.findings.wontfix}</strong><span>不修</span></div>
          <div><strong class="tone-pending">{today.findings.escalated}</strong><span>交给你</span></div>
          <div><strong>{today.pushed}</strong><span>推送</span></div>
          <div><strong class="tone-muted">{today.noChangeChecks}</strong><span>没新提交</span></div>
        </div>
      </div>
    {/if}

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

    <div class="section-header">
      <div class="section-title">
        <h2>流程实例</h2>
        <span class="section-count">{overview.instances.length}</span>
      </div>
      <button
        class="btn"
        type="button"
        onclick={() => {
          isCreating = true;
          editingId = null;
        }}
        disabled={isCreating || machines.length === 0}>新建</button
      >
    </div>
    {#if isCreating}
      <InstanceForm
        instance={null}
        {machines}
        onClose={() => (isCreating = false)}
        onSaved={() => {
          isCreating = false;
          void afterCommand();
        }}
      />
    {/if}
    {#if overview.instances.length === 0 && !isCreating}
      <p class="empty">还没有实例。点「新建」选一个仓库开始。</p>
    {:else}
      <ul class="instances">
        {#each overview.instances as instance (`${instance.machineId}/${instance.id}`)}
          <li
            class="instance"
            class:paused={!instance.isEnabled}
            class:live={instance.isEnabled && !instance.isDryRun}
            class:dry={instance.isEnabled && instance.isDryRun}
          >
            <div class="instance-head">
              <span class="repo">{instance.repo}</span>
              {#if !SERIES_FLOWS.has(instance.flowType)}<span class="tag">{instance.branch}</span>{/if}
              <span class="tag">{flowTitle(instance)}</span>
              <span class="instance-state">
                {#if !instance.isEnabled}<span class="status status-neutral">已暂停</span>{/if}
                {#if instance.flowType === IMPLEMENT_FLOW}
                  <span class="status status-resolved">推新分支</span>
                {:else if instance.flowType === EXPLORE_FLOW}
                  <span class="status status-info">只出想法</span>
                {:else}
                  <span class="status {instance.isDryRun ? 'status-info' : 'status-resolved'}">{instance.isDryRun ? '演练' : '推送'}</span>
                {/if}
              </span>
            </div>
            <p class="instance-meta muted">
              {instance.scheduleText}
              {#if instance.isEnabled && instance.nextRunAt !== null}
                · 下次 <time datetime={instance.nextRunAt} title={formatFullTime(instance.nextRunAt)}>{formatTime(instance.nextRunAt)}</time>
              {/if}
              {#if instance.flowType === EXPLORE_FLOW}
                {#if instance.ideaLimit !== null}· 每个产品最多 {instance.ideaLimit} 条想法{/if}
                {#if instance.isWebEnabled === true}· 可以上网{/if}
              {:else if instance.flowType !== IMPLEMENT_FLOW}· 最多 {instance.maxRounds} 轮{/if}
              <!-- 代码清理没有「review 到哪」，cursor 恒为 null -->
              {#if instance.cursor !== null && instance.flowType !== 'cleanup'}
                · review 到 <span class="mono">{shortSha(instance.cursor)}</span>
              {/if}
            </p>
            {#if instance.lastRun !== null}
              <a
                class="last-run"
                href="/agents/runs/{instance.machineId}/{instance.lastRun.id}"
                title={instance.lastRun.reason ?? instance.lastRun.summary ?? undefined}
              >
                <span class={runStatusClass(instance.lastRun.status)}>{runStatusLabel(instance.lastRun.status)}</span>
                <span class="muted last-time">{formatTime(instance.lastRun.queuedAt)}</span>
                <span class="last-summary">{instance.lastRun.reason ?? instance.lastRun.summary ?? ''}</span>
              </a>
            {/if}
            <div class="actions">
              <!-- 一次实现每次都要带上需求，只能在 Mac 上用 agentctl implement 提 -->
              {#if instance.flowType !== IMPLEMENT_FLOW}
                <button
                  class="btn"
                  type="button"
                  disabled={commandState.isBusy}
                  onclick={() => void act(instance, { type: 'instance.run', payload: { id: instance.id } }, '立即运行')}
                >
                  立即运行
                </button>
              {/if}
              <button
                class="btn"
                type="button"
                disabled={commandState.isBusy}
                onclick={() =>
                  void act(
                    instance,
                    { type: 'instance.update', payload: { id: instance.id, isEnabled: !instance.isEnabled } },
                    instance.isEnabled ? '暂停' : '恢复',
                  )}
              >
                {instance.isEnabled ? '暂停' : '恢复'}
              </button>
              <button
                class="btn"
                type="button"
                onclick={() => {
                  editingId = editingId === instance.id ? null : instance.id;
                  isCreating = false;
                }}
              >
                {editingId === instance.id ? '收起' : '设置'}
              </button>
              <button class="btn danger" type="button" disabled={commandState.isBusy} onclick={() => remove(instance)}>删除</button>
            </div>
            {#if editingId === instance.id}
              <InstanceForm
                {instance}
                {machines}
                onClose={() => (editingId = null)}
                onSaved={() => {
                  editingId = null;
                  void afterCommand();
                }}
              />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if recentRuns.length > 0}
      <div class="section-header">
        <h2>最近运行</h2>
        <a class="link" href="/agents/runs">全部 →</a>
      </div>
      <RunItems runs={recentRuns} />
    {/if}

    {#each machines as machine (machine.id)}
      {#if machine.settings !== null}
        <details class="settings">
          <summary>全局设置{machines.length > 1 ? `（${machine.id}）` : ''}</summary>
          <SettingsForm {machine} settings={machine.settings} onSaved={() => void afterCommand()} />
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

  .section-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
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

  .section-count {
    padding: 0 8px;
    border-radius: 999px;
    background: var(--chip-bg);
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
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

  .stats {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }

  .stats-head {
    padding: 12px 16px 0;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    padding: 6px 0 12px;
  }

  .stats-grid div {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 4px;
  }

  .stats-grid div + div {
    border-left: 1px solid var(--line);
  }

  .stats-grid strong {
    font-size: 22px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 1.3;
  }

  .stats-grid span {
    color: var(--muted);
    font-size: 12px;
  }

  .tone-resolved {
    color: var(--resolved);
  }

  .tone-pending {
    color: var(--pending);
  }

  .tone-muted {
    color: var(--muted);
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

  .instances {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .instance {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px 12px 20px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .instance:hover {
    border-color: var(--line-strong);
    box-shadow: var(--shadow-md);
  }

  /* 左侧色条：绿=推送、蓝=演练、灰=暂停，扫一眼就知道实例现在怎么跑 */
  .instance::before {
    position: absolute;
    top: 14px;
    bottom: 14px;
    left: 0;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: transparent;
    content: '';
  }

  .instance.live::before {
    background: var(--resolved);
  }

  .instance.dry::before {
    background: var(--info);
  }

  .instance.paused::before {
    background: var(--line-strong);
  }

  .instance-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .repo {
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .instance-state {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-left: auto;
  }

  .instance-meta {
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .instance-meta time,
  .instance-meta .mono {
    white-space: nowrap;
  }

  .last-run {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--surface-sunken);
  }

  .last-time {
    font-size: 12px;
    white-space: nowrap;
  }

  .last-summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .last-run:hover .last-summary {
    text-decoration: underline;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  .actions .btn {
    height: 30px;
    padding: 0 10px;
    font-size: 13px;
  }

  .btn.danger {
    color: var(--danger);
  }

  .btn.danger:hover:not(:disabled) {
    border-color: var(--danger);
  }

  .link {
    color: var(--muted);
    font-size: 13px;
    text-decoration: underline;
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

    .stats-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .stats-grid div:nth-child(4) {
      border-left: 0;
    }

    .stats-grid div:nth-child(n + 4) {
      border-top: 1px solid var(--line);
    }

    .instance-state {
      margin-left: 0;
    }

    .actions {
      justify-content: flex-start;
    }

    /* 手机上给上次运行的结论两行位置，不挤在一行截断 */
    .last-run {
      flex-wrap: wrap;
    }

    .last-summary {
      display: -webkit-box;
      flex-basis: 100%;
      overflow: hidden;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
  }
</style>
