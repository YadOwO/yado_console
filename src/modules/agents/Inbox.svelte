<script lang="ts">
  /**
   * Agent 待办：主审交给你决定的问题，以及需要你看一下的运行（要你处理、失败、被中断）。
   *
   * 问题可以选「不修」（加进不修清单，以后同样的问题不再提）或「已处理」（你自己改了或决定不管）；
   * 运行只能「知道了」。处理都是发指令给 Mac，成功后从列表里消失。
   */
  import { onMount } from 'svelte';

  import { refreshAdminStatus } from '../../lib/admin-status.svelte';
  import { formatFullTime, formatTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { getOverview, runStatusClass, runStatusLabel, severityLabel, type IInboxItem } from './api';
  import AgentTabs from './AgentTabs.svelte';
  import { commandState, performCommand } from './command.svelte';

  let items = $state<IInboxItem[]>([]);
  let isLoading = $state(true);
  let errorText = $state<string | null>(null);

  /** 加载待办 */
  async function load(): Promise<void> {
    isLoading = true;
    try {
      items = (await getOverview()).inbox;
      errorText = null;
    } catch (error) {
      errorText = errorMessage(error);
    } finally {
      isLoading = false;
    }
  }

  /** 处理一条待办 */
  async function resolve(item: IInboxItem, action: 'wontfix' | 'done'): Promise<void> {
    if (
      await performCommand(
        item.machineId,
        { type: 'inbox.resolve', payload: { itemId: item.id, action } },
        action === 'wontfix' ? '标记不修' : '标记已处理',
      )
    ) {
      items = items.filter((entry) => entry !== item);
      refreshAdminStatus().catch(() => undefined);
    }
  }

  onMount(() => {
    void load();
    refreshAdminStatus().catch(() => undefined);
  });
</script>

<section class="page">
  <header class="page-header">
    <h1>Agent</h1>
    <button class="btn" type="button" onclick={() => void load()} disabled={isLoading}>刷新</button>
  </header>
  <AgentTabs active="inbox" />

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if isLoading && items.length === 0}
    <p class="empty">加载中…</p>
  {:else if items.length === 0 && errorText === null}
    <p class="empty">没有待办</p>
  {:else}
    <ul class="items">
      {#each items as item (`${item.machineId}/${item.id}`)}
        <li class="item">
          <div class="meta">
            {#if item.kind === 'finding'}
              <span class="status status-pending">要你决定</span>
              {#if item.severity !== null}<span class="tag">{severityLabel(item.severity)}</span>{/if}
            {:else if item.runStatus !== null}
              <span class={runStatusClass(item.runStatus)}>运行{runStatusLabel(item.runStatus)}</span>
            {/if}
            <a class="muted run-link" href="/agents/runs/{item.machineId}/{item.runId}">{item.instanceId}</a>
            <time class="muted time" datetime={item.createdAt} title={formatFullTime(item.createdAt)}>{formatTime(item.createdAt)}</time>
          </div>
          <p class="title">{item.title}</p>
          {#if item.location !== null}<p class="mono muted location">{item.location}</p>{/if}
          {#if item.detail !== null}<p class="detail">{item.detail}</p>{/if}
          <div class="actions">
            {#if item.kind === 'finding'}
              <button
                class="btn"
                type="button"
                title="加进不修清单，以后同样的问题不再提"
                disabled={commandState.isBusy}
                onclick={() => void resolve(item, 'wontfix')}>不修</button
              >
              <button
                class="btn btn-primary"
                type="button"
                title="你已经处理了，或者决定不管"
                disabled={commandState.isBusy}
                onclick={() => void resolve(item, 'done')}>已处理</button
              >
            {:else}
              <button class="btn" type="button" disabled={commandState.isBusy} onclick={() => void resolve(item, 'done')}
                >知道了</button
              >
            {/if}
          </div>
        </li>
      {/each}
    </ul>
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

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h1 {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .run-link {
    text-decoration: underline;
    overflow-wrap: anywhere;
  }

  .time {
    margin-left: auto;
    font-size: 12px;
  }

  .title {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .location,
  .detail {
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  @media (max-width: 720px) {
    .page {
      padding: 16px 16px 80px;
    }
  }
</style>
