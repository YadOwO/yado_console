<script lang="ts">
  /**
   * Agent 待办：主审交给你决定的问题，以及需要你看一下的运行（要你处理、失败、被中断）。
   *
   * 问题可以选「不修」（加进不修清单，以后同样的问题不再提）、「已处理」（你自己改了或决定不管），
   * 或「交给主审」：Mac 上另开一次运行，主审看最新代码在修和不修里选一个，可以先补充一段信息给它。
   * 运行只能「知道了」。处理都是发指令给 Mac，成功后从列表里消失。
   */
  import { onMount } from 'svelte';

  import { refreshAdminStatus } from '../../lib/admin-status.svelte';
  import { formatFullTime, formatTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { DELEGATE_NOTE_MAX, getOverview, runStatusClass, runStatusLabel, severityLabel, type IInboxItem } from './api';
  import AgentTabs from './AgentTabs.svelte';
  import { commandState, performCommand } from './command.svelte';

  let items = $state<IInboxItem[]>([]);
  let isLoading = $state(true);
  let errorText = $state<string | null>(null);
  /** 「交给主审」的说明 */
  const DELEGATE_HINT =
    '主审会看最新代码，在修和不修里选一个，不会再交回给你。选了修就照常修复、复审，推不推送跟实例的模式走（演练模式不推送）；' +
    '选了不修就加进不修清单。结果在运行记录里看。';

  /** 正在填写「交给主审」的待办 */
  let delegatingId = $state<string | null>(null);
  let note = $state('');

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

  /** 处理成功后从列表里去掉 */
  function removeItem(item: IInboxItem): void {
    items = items.filter((entry) => entry !== item);
    refreshAdminStatus().catch(() => undefined);
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
      removeItem(item);
    }
  }

  /** 打开「交给主审」的补充信息 */
  function openDelegate(item: IInboxItem): void {
    delegatingId = item.id;
    note = '';
  }

  /** 交给主审：Mac 上另开一次运行 */
  async function delegate(item: IInboxItem): Promise<void> {
    const text = note.trim();
    const payload: { itemId: string; action: 'delegate'; note?: string } = { itemId: item.id, action: 'delegate' };
    if (text !== '') {
      payload.note = text;
    }
    if (await performCommand(item.machineId, { type: 'inbox.resolve', payload }, '交给主审')) {
      delegatingId = null;
      removeItem(item);
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
          {#if delegatingId === item.id}
            <div class="delegate">
              <p class="muted hint">{DELEGATE_HINT}</p>
              <textarea
                bind:value={note}
                rows="3"
                maxlength={DELEGATE_NOTE_MAX}
                placeholder="补充信息（可选）：比如回答上面主审的问题"
                aria-label="补充给主审的信息"
              ></textarea>
              <div class="actions">
                <button class="btn" type="button" onclick={() => (delegatingId = null)}>取消</button>
                <button class="btn btn-primary" type="button" disabled={commandState.isBusy} onclick={() => void delegate(item)}
                  >交给主审</button
                >
              </div>
            </div>
          {:else}
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
                  class="btn"
                  type="button"
                  title="让主审（Opus）看最新代码，在修和不修里选一个"
                  disabled={commandState.isBusy}
                  onclick={() => openDelegate(item)}>交给主审</button
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
          {/if}
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
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .delegate {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  .hint {
    font-size: 12px;
  }

  textarea {
    width: 100%;
    min-height: 72px;
    max-height: 40vh;
    padding: 8px 12px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius);
    background: var(--field);
    resize: vertical;
    field-sizing: content;
  }

  @media (max-width: 720px) {
    .page {
      padding: 16px 16px 80px;
    }
  }
</style>
