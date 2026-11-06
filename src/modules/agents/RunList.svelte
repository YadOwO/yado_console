<script lang="ts">
  /**
   * 运行记录：全部实例的运行，按实例与状态筛选，最新的在前。
   *
   * 筛选条件放在地址栏（?instance=&status=），刷新或从详情页返回时保持不变。
   */
  import { untrack } from 'svelte';

  import { errorMessage } from '../../lib/http';
  import { navigate, queryParam } from '../../lib/router.svelte';
  import { getOverview, listRuns, runStatusLabel, type IRunListItem } from './api';
  import AgentTabs from './AgentTabs.svelte';
  import RunItems from './RunItems.svelte';

  /** 状态筛选项 */
  const STATUSES = ['needs_attention', 'succeeded', 'failed', 'running', 'queued', 'canceled', 'interrupted'];

  const instance = $derived(queryParam('instance') ?? '');
  const status = $derived(queryParam('status') ?? '');

  /** 实例筛选项，从总览里取 */
  let instanceIds = $state<string[]>([]);
  let runs = $state<IRunListItem[]>([]);
  let nextBefore = $state<number | null>(null);
  let isLoading = $state(true);
  let isLoadingMore = $state(false);
  let errorText = $state<string | null>(null);
  /** 每次从第一页加载时递增；筛选切换后丢弃旧请求的结果 */
  let loadVersion = 0;

  /** 修改筛选条件，写回地址栏 */
  function setFilter(nextInstance: string, nextStatus: string): void {
    const params = new URLSearchParams();
    if (nextInstance !== '') {
      params.set('instance', nextInstance);
    }
    if (nextStatus !== '') {
      params.set('status', nextStatus);
    }
    const search = params.toString();
    navigate(search === '' ? '/agents/runs' : `/agents/runs?${search}`, { replace: true });
  }

  /** 从第一页重新加载 */
  async function reload(): Promise<void> {
    const version = ++loadVersion;
    isLoading = true;
    errorText = null;
    try {
      const page = await listRuns({ instance: instance || undefined, status: status || undefined });
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
    if (instanceIds.length === 0) {
      await loadInstanceIds();
    }
  }

  /** 实例筛选项从总览里取；取不到不影响列表 */
  async function loadInstanceIds(): Promise<void> {
    try {
      instanceIds = [...new Set((await getOverview()).instances.map((item) => item.id))].sort();
    } catch {
      // 筛选项只是方便，失败时只保留「全部实例」和地址栏里的实例
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
      const page = await listRuns({ instance: instance || undefined, status: status || undefined, before: nextBefore });
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
      <select aria-label="实例" value={instance} onchange={(event) => setFilter(event.currentTarget.value, status)}>
        <option value="">全部实例</option>
        {#each [...new Set([...instanceIds, ...(instance === '' ? [] : [instance])])] as id (id)}
          <option value={id}>{id}</option>
        {/each}
      </select>
      <select aria-label="状态" value={status} onchange={(event) => setFilter(instance, event.currentTarget.value)}>
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
    <RunItems {runs} />
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
