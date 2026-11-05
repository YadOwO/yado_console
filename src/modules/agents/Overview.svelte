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
    getOverview,
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
    if (confirm(`删除 ${instance.repo}（${instance.branch}）的${flowTitle(instance)}？运行记录会保留，不修清单会清空。`)) {
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
    <h1>Agent</h1>
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
        <span class="machine-name">{machine.id}</span>
        <span class="muted" title={formatFullTime(machine.lastSeenAt)}>{machineText(machine)}</span>
        {#if machine.health !== null}
          <span class="muted">运行中 {machine.health.activeRuns} · 排队 {machine.health.queuedRuns}</span>
          {#if machine.health.status !== 'ok'}<span class="danger">{machine.health.detail}</span>{/if}
        {/if}
        <button class="btn sync" type="button" disabled={commandState.isBusy} onclick={() => void syncNow(machine)}>立即同步</button>
      </div>
    {/each}

    {#if today !== null}
      <div class="stats" aria-label="今天">
        <div><strong>{runCount}</strong><span>今天运行</span></div>
        <div><strong>{today.findings.fixed}</strong><span>修复</span></div>
        <div><strong>{today.findings.wontfix}</strong><span>不修</span></div>
        <div><strong>{today.findings.escalated}</strong><span>交给你</span></div>
        <div><strong>{today.pushed}</strong><span>推送</span></div>
        <div><strong>{today.noChangeChecks}</strong><span>没新提交</span></div>
      </div>
    {/if}

    {#if overview.inbox.length > 0}
      <a class="inbox-banner" href="/agents/inbox">有 {overview.inbox.length} 条待办等你决定 →</a>
    {/if}

    <div class="section-header">
      <h2>流程实例</h2>
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
          <li class="instance">
            <div class="instance-head">
              <span class="repo">{instance.repo}</span>
              <span class="tag">{instance.branch}</span>
              <span class="tag">{flowTitle(instance)}</span>
              {#if !instance.isEnabled}<span class="status status-neutral">已暂停</span>{/if}
              <span class="status {instance.isDryRun ? 'status-neutral' : 'status-resolved'}">{instance.isDryRun ? '演练' : '推送'}</span>
            </div>
            <p class="muted">
              {instance.scheduleText}
              {#if instance.isEnabled && instance.nextRunAt !== null}
                · 下次 <time datetime={instance.nextRunAt} title={formatFullTime(instance.nextRunAt)}>{formatTime(instance.nextRunAt)}</time>
              {/if}
              · 最多 {instance.maxRounds} 轮
              <!-- 代码清理没有「review 到哪」，cursor 恒为 null -->
              {#if instance.cursor !== null && instance.flowType !== 'cleanup'}
                · review 到 <span class="mono">{shortSha(instance.cursor)}</span>
              {/if}
            </p>
            {#if instance.lastRun !== null}
              <a class="last-run" href="/agents/runs/{instance.machineId}/{instance.lastRun.id}">
                <span class={runStatusClass(instance.lastRun.status)}>{runStatusLabel(instance.lastRun.status)}</span>
                <span class="muted">{formatTime(instance.lastRun.queuedAt)}</span>
                <span class="last-summary">{instance.lastRun.reason ?? instance.lastRun.summary ?? ''}</span>
              </a>
            {/if}
            <div class="actions">
              <button
                class="btn"
                type="button"
                disabled={commandState.isBusy}
                onclick={() => void act(instance, { type: 'instance.run', payload: { id: instance.id } }, '立即运行')}
              >
                立即运行
              </button>
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
        <a class="link" href="/agents/runs">全部</a>
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
    max-width: 960px;
    padding: 24px 24px 80px;
  }

  .page-header,
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h1 {
    font-size: 20px;
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
    gap: 8px;
  }

  .machine-name {
    font-weight: 500;
  }

  .machine .sync {
    margin-left: auto;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }

  .dot.online {
    background: var(--resolved);
  }

  .danger {
    color: var(--danger);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .stats div {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 4px;
  }

  .stats div + div {
    border-left: 1px solid var(--line);
  }

  .stats strong {
    font-size: 20px;
    font-weight: 600;
  }

  .stats span {
    color: var(--muted);
    font-size: 12px;
  }

  .inbox-banner {
    padding: 10px 16px;
    border-radius: var(--radius);
    background: var(--pending-bg);
    color: var(--pending);
    font-weight: 500;
  }

  .instances {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .instance {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .instance-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .repo {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .last-run {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .last-summary {
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
    gap: 8px;
    margin-top: 4px;
  }

  .btn.danger {
    color: var(--danger);
  }

  .link {
    color: var(--muted);
    text-decoration: underline;
  }

  .settings {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .settings summary {
    padding: 12px 16px;
    cursor: pointer;
    font-weight: 500;
  }

  @media (max-width: 720px) {
    .page {
      padding: 16px 16px 80px;
    }

    .stats {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .stats div:nth-child(4) {
      border-left: 0;
    }

    .stats div:nth-child(n + 4) {
      border-top: 1px solid var(--line);
    }
  }
</style>
