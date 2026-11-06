<script lang="ts">
  /**
   * 运行记录：全部流程的运行，按流程、实例与状态筛选，最新的在前。
   *
   * 筛选条件放在地址栏（?flow=&instance=&status=），刷新或从详情页返回时保持不变。
   */
  import { untrack } from 'svelte';

  import { errorMessage } from '../../lib/http';
  import { navigate, queryParam } from '../../lib/router.svelte';
  import { getOverview, instanceLabel, listRuns, runStatusLabel, type IInstance, type IMachine, type IRunListItem } from './api';
  import AgentTabs from './AgentTabs.svelte';
  import RunItems from './RunItems.svelte';

  /** 状态筛选项 */
  const STATUSES = ['needs_attention', 'waiting', 'succeeded', 'failed', 'running', 'queued', 'canceled', 'interrupted'];

  const flow = $derived(queryParam('flow') ?? '');
  const instance = $derived(queryParam('instance') ?? '');
  const status = $derived(queryParam('status') ?? '');

  /** 筛选项从总览里取 */
  let machines = $state<IMachine[]>([]);
  let instances = $state<IInstance[]>([]);
  let runs = $state<IRunListItem[]>([]);
  let nextBefore = $state<number | null>(null);
  let isLoading = $state(true);
  let isLoadingMore = $state(false);
  let errorText = $state<string | null>(null);
  /** 每次从第一页加载时递增；筛选切换后丢弃旧请求的结果 */
  let loadVersion = 0;

  /** 流程筛选项：各机器报的流程类型，按 agentd 的顺序去重；地址栏里的流程不在其中时也保留 */
  const flowOptions = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const machine of machines) {
      for (const item of machine.flows) {
        if (!seen.has(item.type)) {
          seen.set(item.type, item.title);
        }
      }
    }
    if (flow !== '' && !seen.has(flow)) {
      seen.set(flow, flow);
    }
    return [...seen.entries()].map(([type, title]) => ({ type, title }));
  });
  const flowTitles = $derived(Object.fromEntries(flowOptions.map((item) => [item.type, item.title])));
  /** 实例筛选项：选了流程就只列它的，没选时名字后面带上流程；地址栏里的实例不在列表里时也保留 */
  const instanceOptions = $derived.by(() => {
    const options = instances
      .filter((item) => flow === '' || item.flowType === flow)
      .map((item) => ({
        id: item.id,
        label: flow === '' ? `${instanceLabel(item)} · ${flowTitles[item.flowType] ?? item.flowType}` : instanceLabel(item),
      }));
    if (instance !== '' && !options.some((item) => item.id === instance)) {
      options.push({ id: instance, label: instance });
    }
    return options;
  });
  const instanceLabels = $derived(Object.fromEntries(instances.map((item) => [item.id, instanceLabel(item)])));

  /** 修改筛选条件，写回地址栏；换了流程就清掉实例，它多半不属于新流程 */
  function setFilter(next: Partial<{ flow: string; instance: string; status: string }>): void {
    const values = { flow, instance, status, ...next };
    if (next.flow !== undefined && next.flow !== flow) {
      values.instance = '';
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== '') {
        params.set(key, value);
      }
    }
    const search = params.toString();
    navigate(search === '' ? '/agents/runs' : `/agents/runs?${search}`, { replace: true });
  }

  /** 当前筛选条件 */
  function filter(): { flow?: string; instance?: string; status?: string } {
    return { flow: flow || undefined, instance: instance || undefined, status: status || undefined };
  }

  /** 从第一页重新加载 */
  async function reload(): Promise<void> {
    const version = ++loadVersion;
    isLoading = true;
    errorText = null;
    try {
      const page = await listRuns(filter());
      if (version === loadVersion) {
        runs = page.runs;
        nextBefore = page.nextBefore;
      }
    } catch (error) {
      if (version === loadVersion) {
        errorText = errorMessage(error);
      }
    } finally {
      if (version === loadVersion) {
        isLoading = false;
      }
    }
    if (machines.length === 0) {
      await loadOptions();
    }
  }

  /** 筛选项从总览里取；取不到不影响列表 */
  async function loadOptions(): Promise<void> {
    try {
      const overview = await getOverview();
      machines = overview.machines;
      instances = overview.instances;
    } catch {
      // 筛选项只是方便，失败时只保留「全部」和地址栏里的值
    }
  }

  /** 加载下一页 */
  async function loadMore(): Promise<void> {
    if (nextBefore === null || isLoadingMore) {
      return;
    }
    const version = loadVersion;
    isLoadingMore = true;
    try {
      const page = await listRuns({ ...filter(), before: nextBefore });
      if (version === loadVersion) {
        runs = [...runs, ...page.runs];
        nextBefore = page.nextBefore;
      }
    } catch (error) {
      errorText = errorMessage(error);
    } finally {
      isLoadingMore = false;
    }
  }

  // 筛选条件变化时从第一页重新加载
  $effect(() => {
    void flow;
    void instance;
    void status;
    untrack(() => void reload());
  });
</script>

<section class="page">
  <header class="page-header">
    <div class="page-title">
      <h1>Agent</h1>
      <p class="page-sub">每次运行的结论与过程</p>
    </div>
    <div class="filters">
      <select aria-label="流程" value={flow} onchange={(event) => setFilter({ flow: event.currentTarget.value })}>
        <option value="">全部流程</option>
        {#each flowOptions as option (option.type)}
          <option value={option.type}>{option.title}</option>
        {/each}
      </select>
      <select aria-label="实例" value={instance} onchange={(event) => setFilter({ instance: event.currentTarget.value })}>
        <option value="">全部实例</option>
        {#each instanceOptions as option (option.id)}
          <option value={option.id}>{option.label}</option>
        {/each}
      </select>
      <select aria-label="状态" value={status} onchange={(event) => setFilter({ status: event.currentTarget.value })}>
        <option value="">全部状态</option>
        {#each STATUSES as value (value)}
          <option {value}>{runStatusLabel(value)}</option>
        {/each}
      </select>
      <button class="btn" type="button" onclick={() => void reload()} disabled={isLoading}>刷新</button>
    </div>
  </header>
  <AgentTabs active="runs" />

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if isLoading && runs.length === 0}
    <p class="empty">加载中…</p>
  {:else if runs.length === 0}
    {#if errorText === null}<p class="empty">没有运行记录</p>{/if}
  {:else}
    <RunItems {runs} {instanceLabels} flowTitles={flow === '' ? flowTitles : null} />
    {#if nextBefore !== null}
      <div class="more">
        <button class="btn" type="button" onclick={() => void loadMore()} disabled={isLoadingMore}>
          {isLoadingMore ? '加载中…' : '加载更多'}
        </button>
      </div>
    {/if}
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
    flex-wrap: wrap;
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

  h1 {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .filters select {
    max-width: 220px;
  }

  .more {
    display: flex;
    justify-content: center;
  }

  @media (max-width: 720px) {
    .page {
      padding: 16px 16px 80px;
    }
  }
</style>
