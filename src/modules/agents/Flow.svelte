<script lang="ts">
  /**
   * 一个流程的页面：这类流程的说明、模式与整体暂停、它的实例（一个一行，仓库流程可以在这里新建）、最近运行。从总览的流程卡进来。
   * 产品探索的想法与产品偏好在顶部标签的「想法」里，这里只留一个入口。
   *
   * 总览数据是各页面共用的一份，进来先显示上次取到的；页面可见时每 10 秒刷新一次，最近运行跟着刷新。
   * 表单打开时只刷新数据，不冲掉正在编辑的内容。
   */
  import { onMount } from 'svelte';

  import { adminStatus, refreshBadges } from '../../lib/admin-status.svelte';
  import { errorMessage } from '../../lib/http';
  import { EXPLORE_FLOW, flowBadge, flowTitle, IMPLEMENT_FLOW, listRuns, SERIES_FLOWS, type IRunListItem } from './api';
  import { commandState, performCommand } from './command.svelte';
  import CommandToast from './CommandToast.svelte';
  import InstanceForm from './InstanceForm.svelte';
  import InstanceRow from './InstanceRow.svelte';
  import { overviewState, refreshOverview, watchOverview } from './overview-store.svelte';
  import RunItems from './RunItems.svelte';

  let { flowType }: { flowType: string } = $props();

  const overview = $derived(overviewState.value);
  const isLoading = $derived(overviewState.isLoading);
  /** 这个流程的最近运行；还没取到时为 null，先不显示「还没有运行」 */
  let runs = $state.raw<IRunListItem[] | null>(null);
  /** 最近运行没取到的原因；总览没取到的原因在 overviewState 里 */
  let runsError = $state<string | null>(null);
  const errorText = $derived(overviewState.errorText ?? runsError);
  let isCreating = $state(false);
  /** 产品探索还没处理的想法数 */
  const ideaCount = $derived(adminStatus.value?.agentIdeaCount ?? 0);

  const machines = $derived(overview?.machines ?? []);
  /** 报了这种流程的机器 */
  const flowMachines = $derived(machines.filter((machine) => machine.flows.some((flow) => flow.type === flowType)));
  const flow = $derived(flowMachines[0]?.flows.find((item) => item.type === flowType) ?? null);
  const isPaused = $derived(flowMachines.some((machine) => machine.flows.some((item) => item.type === flowType && item.isPaused)));
  const canTogglePaused = $derived(flowMachines.some((machine) => machine.settings !== null));
  const instances = $derived((overview?.instances ?? []).filter((item) => item.flowType === flowType));
  const isSeries = $derived(SERIES_FLOWS.has(flowType));
  const title = $derived(flowTitle(machines, flowType));
  /** 模式标记：整个流程都一样，写在标题旁边 */
  const badge = $derived(flowBadge(flowType));

  /** 加载这个流程的最近运行 */
  async function loadRuns(): Promise<void> {
    try {
      // 旧版 hub 不认 flow 参数会返回全部运行，这里再按流程过滤一次
      runs = (await listRuns({ flow: flowType, limit: 8 })).runs.filter((run) => run.flowType === flowType);
      runsError = null;
    } catch (error) {
      runsError = errorMessage(error);
    }
  }

  /** 手动刷新，或指令成功后刷新总览与最近运行；isSilent 时不显示加载中 */
  async function load(isSilent = false): Promise<void> {
    await Promise.all([refreshOverview({ isSilent, isFresh: true }), loadRuns()]);
  }

  /** 指令成功后刷新页面与侧栏角标 */
  async function afterCommand(): Promise<void> {
    await load(true);
    refreshBadges();
  }

  /** 暂停或恢复整个流程：所有报了它的机器一起改 */
  async function togglePaused(): Promise<void> {
    const next = !isPaused;
    for (const machine of flowMachines) {
      if (machine.settings === null) {
        continue;
      }
      const paused = machine.settings.pausedFlows;
      const pausedFlows = next ? [...new Set([...paused, flowType])] : paused.filter((item) => item !== flowType);
      const label = `${next ? '暂停' : '恢复'}${title}${flowMachines.length > 1 ? `（${machine.id}）` : ''}`;
      if (!(await performCommand(machine.id, { type: 'settings.update', payload: { pausedFlows } }, label))) {
        break;
      }
    }
    await afterCommand();
  }

  onMount(() => {
    // 最近运行和总览同时取；总览第一次刷新完不用再取一遍，之后每次刷新跟着取
    void loadRuns();
    let isFirstRefresh = true;
    return watchOverview(() => {
      if (!isFirstRefresh) {
        void loadRuns();
      }
      isFirstRefresh = false;
    });
  });
</script>

<section class="page">
  <a class="back muted" href="/agents">← 总览</a>

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if overview === null}
    {#if isLoading}<p class="empty">加载中…</p>{/if}
  {:else if flow === null && instances.length === 0}
    <p class="empty">没有「{title}」这种流程，或者 Mac 还没同步过来。</p>
  {:else}
    <header class="page-header wraps">
      <div class="page-title">
        <div class="inline-row title-row">
          <h1>{title}</h1>
          {#if isPaused}<span class="status status-neutral">已暂停</span>{/if}
          <span class="status status-{badge.tone}">{badge.label}</span>
        </div>
        {#if flow !== null}<p class="page-sub">{flow.description}</p>{/if}
      </div>
      <div class="head-actions">
        <button class="btn" type="button" onclick={() => void load()} disabled={isLoading}>刷新</button>
        {#if canTogglePaused}
          <button class="btn" type="button" disabled={commandState.isBusy} onclick={() => void togglePaused()}>
            {isPaused ? '恢复整个流程' : '暂停整个流程'}
          </button>
        {/if}
      </div>
    </header>

    {#if isSeries}
      {#if instances.length === 0}
        <p class="empty">
          还没有实例。挂本机的系列文件夹，在 Mac 上用 <span class="mono">agentctl instance add {flowType} &lt;文件夹&gt;</span> 建。
        </p>
      {:else}
        <ul class="list">
          {#each instances as instance (`${instance.machineId}/${instance.id}`)}
            <li><InstanceRow {instance} {machines} onChanged={() => void afterCommand()} /></li>
          {/each}
        </ul>
      {/if}
      {#if flowType === IMPLEMENT_FLOW}
        <p class="hint">
          在系列文件夹里任何一个仓库的对话里输入 <span class="mono">/yado-implement 想法</span>，聊清楚说「开工」，运行就会出现在下面。
          页面上只能看结果和取消。
        </p>
      {/if}
    {:else}
      <div class="section-header">
        <div class="section-title">
          <h2>仓库</h2>
          <span class="pill">{instances.length}</span>
        </div>
        <button class="btn" type="button" onclick={() => (isCreating = true)} disabled={isCreating || flowMachines.length === 0}>新建</button>
      </div>
      {#if isCreating}
        <InstanceForm
          instance={null}
          machines={flowMachines}
          fixedFlowType={flowType}
          onClose={() => (isCreating = false)}
          onSaved={() => {
            isCreating = false;
            void afterCommand();
          }}
        />
      {/if}
      {#if instances.length === 0 && !isCreating}
        <p class="empty">还没有仓库。点「新建」选一个仓库开始。</p>
      {:else if instances.length > 0}
        <ul class="list">
          {#each instances as instance (`${instance.machineId}/${instance.id}`)}
            <li><InstanceRow {instance} {machines} onChanged={() => void afterCommand()} /></li>
          {/each}
        </ul>
      {/if}
    {/if}

    {#if flowType === EXPLORE_FLOW}
      <a class="hint" href="/agents/ideas">
        {ideaCount > 0 ? `${ideaCount} 条想法等你看` : '没有待看的想法'}，想法和产品偏好在「想法」里 →
      </a>
    {/if}

    <div class="section-header">
      <h2>{flowType === IMPLEMENT_FLOW ? '运行' : '最近运行'}</h2>
      <a class="link" href="/agents/runs?flow={flowType}">全部 →</a>
    </div>
    {#if runs !== null && runs.length === 0}
      <p class="empty">还没有运行</p>
    {:else if runs !== null}
      <RunItems {runs} isCompact />
    {/if}
  {/if}
</section>

<CommandToast />

<style>
  .page-title {
    gap: 4px;
    min-width: 0;
  }

  .title-row {
    gap: 10px;
  }

  .page-sub {
    overflow-wrap: anywhere;
  }

  .head-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .hint {
    display: block;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--surface-sunken);
    color: var(--muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .link {
    color: var(--muted);
    font-size: 13px;
  }
</style>
