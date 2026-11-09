<script lang="ts">
  /**
   * 一个流程的页面：这类流程的说明与整体暂停、它的实例（仓库流程可以在这里新建）、流程自己的东西
   * （产品探索的想法与产品偏好）、最近运行。从总览的流程卡进来。
   *
   * 页面可见时每 10 秒刷新一次；表单打开时只刷新数据，不冲掉正在编辑的内容。
   */
  import { onMount } from 'svelte';

  import { refreshAdminStatus } from '../../lib/admin-status.svelte';
  import { errorMessage } from '../../lib/http';
  import {
    EXPLORE_FLOW,
    flowTitle,
    getOverview,
    IMPLEMENT_FLOW,
    instanceLabel,
    listRuns,
    SERIES_FLOWS,
    type IOverview,
    type IRunListItem,
  } from './api';
  import { commandState, performCommand } from './command.svelte';
  import CommandToast from './CommandToast.svelte';
  import IdeaList from './IdeaList.svelte';
  import InstanceCard from './InstanceCard.svelte';
  import InstanceForm from './InstanceForm.svelte';
  import Preferences from './Preferences.svelte';
  import RunItems from './RunItems.svelte';

  let { flowType }: { flowType: string } = $props();

  /** 自动刷新间隔 */
  const REFRESH_INTERVAL_MS = 10_000;

  let overview = $state<IOverview | null>(null);
  let runs = $state<IRunListItem[]>([]);
  let isLoading = $state(true);
  let errorText = $state<string | null>(null);
  let isCreating = $state(false);

  const machines = $derived(overview?.machines ?? []);
  /** 报了这种流程的机器 */
  const flowMachines = $derived(machines.filter((machine) => machine.flows.some((flow) => flow.type === flowType)));
  const flow = $derived(flowMachines[0]?.flows.find((item) => item.type === flowType) ?? null);
  const isPaused = $derived(flowMachines.some((machine) => machine.flows.some((item) => item.type === flowType && item.isPaused)));
  const canTogglePaused = $derived(flowMachines.some((machine) => machine.settings !== null));
  const instances = $derived((overview?.instances ?? []).filter((item) => item.flowType === flowType));
  const isSeries = $derived(SERIES_FLOWS.has(flowType));
  const title = $derived(flowTitle(machines, flowType));
  /** 产品探索：实例设置里排的产品先后，产品偏好跟着这个排 */
  const productOrder = $derived(instances.flatMap((item) => item.products ?? []).map((item) => item.name));
  /** 运行列表里实例显示成仓库名 */
  const instanceLabels = $derived(Object.fromEntries(instances.map((item) => [item.id, instanceLabel(item)])));

  /** 加载总览与这个流程的最近运行；isSilent 时不显示加载中 */
  async function load(isSilent = false): Promise<void> {
    if (!isSilent) {
      isLoading = true;
    }
    try {
      overview = await getOverview();
      // 旧版 hub 不认 flow 参数会返回全部运行，这里再按流程过滤一次
      runs = (await listRuns({ flow: flowType, limit: 8 })).runs.filter((run) => run.flowType === flowType);
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
  <a class="back muted" href="/agents">← 总览</a>

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if overview === null}
    {#if isLoading}<p class="empty">加载中…</p>{/if}
  {:else if flow === null && instances.length === 0}
    <p class="empty">没有「{title}」这种流程，或者 Mac 还没同步过来。</p>
  {:else}
    <header class="page-header">
      <div class="page-title">
        <div class="title-row">
          <h1>{title}</h1>
          {#if isPaused}<span class="status status-neutral">已暂停</span>{/if}
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
        <ul class="instances">
          {#each instances as instance (`${instance.machineId}/${instance.id}`)}
            <li><InstanceCard {instance} {machines} onChanged={() => void afterCommand()} /></li>
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
          <span class="section-count">{instances.length}</span>
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
        <ul class="instances">
          {#each instances as instance (`${instance.machineId}/${instance.id}`)}
            <li><InstanceCard {instance} {machines} onChanged={() => void afterCommand()} /></li>
          {/each}
        </ul>
      {/if}
    {/if}

    {#if flowType === EXPLORE_FLOW}
      <IdeaList />
      <Preferences {productOrder} />
    {/if}

    <div class="section-header">
      <h2>{flowType === IMPLEMENT_FLOW ? '运行' : '最近运行'}</h2>
      <a class="link" href="/agents/runs?flow={flowType}">全部 →</a>
    </div>
    {#if runs.length === 0}
      <p class="empty">还没有运行</p>
    {:else}
      <RunItems {runs} {instanceLabels} />
    {/if}
  {/if}
</section>

<CommandToast />

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

  .back {
    align-self: flex-start;
    font-size: 13px;
    transition: color 0.15s;
  }

  .back:hover {
    color: var(--fg);
  }

  .page-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .page-title {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .page-sub {
    color: var(--muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .head-actions {
    display: flex;
    flex-wrap: wrap;
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

  .section-count {
    padding: 0 8px;
    border-radius: 999px;
    background: var(--chip-bg);
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
  }

  .instances {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .hint {
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
    text-decoration: underline;
  }

  @media (max-width: 720px) {
    .page {
      padding: 16px 16px 80px;
    }
  }
</style>
