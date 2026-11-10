<script module lang="ts">
  import type { IRunListItem } from './api';

  /**
   * 上次看到的列表，按筛选条件记着：从详情页返回或再切回这个标签时先原样显示（翻过的页也在），再在后台刷新最新一页。
   * 只记最近一个筛选条件的，换了条件就丢掉。
   */
  let lastList: { search: string; runs: IRunListItem[]; nextBefore: number | null } | null = null;
</script>

<script lang="ts">
  /**
   * 运行记录：全部流程的运行，按流程、实例与状态筛选，最新的在前。
   *
   * 筛选条件放在地址栏（?flow=&instance=&status=），刷新或从详情页返回时保持不变。
   */
  import { untrack } from 'svelte';

  import { errorMessage } from '../../lib/http';
  import { current, navigate, queryParam } from '../../lib/router.svelte';
  import { instanceLabel, listRuns, runStatusLabel } from './api';
  import AgentPage from './AgentPage.svelte';
  import { ensureOverview, overviewState } from './overview-store.svelte';
  import RunItems from './RunItems.svelte';

  /** 状态筛选项 */
  const STATUSES = ['needs_attention', 'waiting', 'succeeded', 'failed', 'running', 'queued', 'canceled', 'interrupted'];

  const flow = $derived(queryParam('flow') ?? '');
  const instance = $derived(queryParam('instance') ?? '');
  const status = $derived(queryParam('status') ?? '');

  /** 筛选项从总览里取；取不到不影响列表，只保留「全部」和地址栏里的值 */
  const instances = $derived(overviewState.value?.instances ?? []);
  let runs = $state.raw<IRunListItem[]>([]);
  let nextBefore = $state<number | null>(null);
  let isLoading = $state(true);
  let isLoadingMore = $state(false);
  let errorText = $state<string | null>(null);
  /** 每次从第一页加载时递增；筛选切换后丢弃旧请求的结果 */
  let loadVersion = 0;

  /** 流程筛选项：各机器报的流程类型，按 agentd 的顺序；地址栏里的流程不在其中时也保留 */
  const flowOptions = $derived.by(() => {
    const titles = { ...overviewState.flowTitles };
    if (flow !== '') {
      titles[flow] ??= flow;
    }
    return Object.entries(titles).map(([type, title]) => ({ type, title }));
  });
  /** 实例筛选项：选了流程就只列它的，没选时名字后面带上流程；地址栏里的实例不在列表里时也保留 */
  const instanceOptions = $derived.by(() => {
    const options = instances
      .filter((item) => flow === '' || item.flowType === flow)
      .map((item) => ({
        id: item.id,
        label: flow === '' ? `${instanceLabel(item)} · ${overviewState.flowTitles[item.flowType] ?? item.flowType}` : instanceLabel(item),
      }));
    if (instance !== '' && !options.some((item) => item.id === instance)) {
      options.push({ id: instance, label: instance });
    }
    return options;
  });

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

  /** 记下现在的列表，下次回到同样的筛选条件时先显示它 */
  function remember(): void {
    lastList = { search: current.search, runs, nextBefore };
  }

  /**
   * 从第一页重新加载。
   *
   * @param isKeepingOlder 为 true 时保留已经翻出来的更早的运行，只把最新一页换成新取的（返回这一页时用）
   */
  async function reload(isKeepingOlder = false): Promise<void> {
    const version = ++loadVersion;
    isLoading = true;
    errorText = null;
    try {
      const page = await listRuns(filter());
      if (version === loadVersion) {
        // seq 是 hub 上全局递增的序号，列表按它倒序；比新取的这一页更早的才留
        const oldest = page.runs.at(-1)?.seq;
        const older = isKeepingOlder && oldest !== undefined ? runs.filter((run) => run.seq < oldest) : [];
        runs = [...page.runs, ...older];
        nextBefore = older.length > 0 ? nextBefore : page.nextBefore;
        remember();
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
        remember();
      }
    } catch (error) {
      errorText = errorMessage(error);
    } finally {
      isLoadingMore = false;
    }
  }

  // 筛选条件变化时从第一页重新加载；和上次看的是同一个条件（多半是从详情页返回）就先显示上次的
  $effect(() => {
    void flow;
    void instance;
    void status;
    untrack(() => {
      const isSame = lastList !== null && lastList.search === current.search;
      if (lastList !== null && isSame) {
        runs = lastList.runs;
        nextBefore = lastList.nextBefore;
      }
      void reload(isSame);
    });
  });

  ensureOverview();
</script>

<AgentPage active="runs" sub="每次运行的结论与过程" isWrapping>
  {#snippet actions()}
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
  {/snippet}

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if isLoading && runs.length === 0}
    <p class="empty">加载中…</p>
  {:else if runs.length === 0}
    {#if errorText === null}<p class="empty">没有运行记录</p>{/if}
  {:else}
    <RunItems {runs} isShowingFlow={flow === ''} />
    {#if nextBefore !== null}
      <div class="more">
        <button class="btn" type="button" onclick={() => void loadMore()} disabled={isLoadingMore}>
          {isLoadingMore ? '加载中…' : '加载更多'}
        </button>
      </div>
    {/if}
  {/if}
</AgentPage>

<style>
  .filters select {
    max-width: 220px;
  }
</style>
