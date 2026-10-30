<script lang="ts">
  /**
   * 反馈单列表：全部产品的反馈单，按状态与产品筛选，按最新消息倒序。
   *
   * 筛选条件放在地址栏（?status=&product=），刷新或从对话页返回时保持不变。
   */
  import { onMount, untrack } from 'svelte';

  import { refreshAdminStatus } from '../../lib/admin-status.svelte';
  import { isProductCode, PRODUCTS, productName, type ProductCode } from '../../lib/config';
  import { formatFullTime, formatTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { current, navigate, queryParam } from '../../lib/router.svelte';
  import { listTickets, statusLabel, type ITicketListItem, type TicketStatus } from './api';
  import { feedbackNav } from './nav';

  /** 状态筛选：多一个「全部」 */
  type StatusFilter = TicketStatus | 'all';

  /** 状态筛选项，默认看待处理 */
  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'pending', label: '待处理' },
    { value: 'resolved', label: '已处理' },
    { value: 'all', label: '全部' },
  ];

  const status = $derived(parseStatus(queryParam('status')));
  const product = $derived(parseProduct(queryParam('product')));

  let tickets = $state<ITicketListItem[]>([]);
  let nextBefore = $state<number | null>(null);
  let isLoading = $state(true);
  let isLoadingMore = $state(false);
  let errorText = $state<string | null>(null);
  /** 每次从第一页加载时递增；筛选切换后丢弃旧请求的结果 */
  let loadVersion = 0;

  /** 地址栏里的状态，非法值按默认的「待处理」处理 */
  function parseStatus(value: string | null): StatusFilter {
    return value === 'resolved' || value === 'all' ? value : 'pending';
  }

  /** 地址栏里的产品，未接入的代号按「全部」处理 */
  function parseProduct(value: string | null): ProductCode | 'all' {
    return isProductCode(value) ? value : 'all';
  }

  /** 修改筛选条件，写回地址栏 */
  function setFilter(nextStatus: StatusFilter, nextProduct: ProductCode | 'all'): void {
    const params = new URLSearchParams();
    if (nextStatus !== 'pending') {
      params.set('status', nextStatus);
    }
    if (nextProduct !== 'all') {
      params.set('product', nextProduct);
    }
    const search = params.toString();
    navigate(search === '' ? '/feedback' : `/feedback?${search}`, { replace: true });
  }

  /**
   * 从第一页重新加载。
   *
   * @param isSilent 为 true 时保留当前列表、不显示加载中，用于回到页面时的后台刷新
   */
  async function reload(isSilent = false): Promise<void> {
    const version = ++loadVersion;
    if (!isSilent) {
      isLoading = true;
      tickets = [];
      nextBefore = null;
    }
    errorText = null;
    try {
      const page = await listTickets({
        status: status === 'all' ? undefined : status,
        product: product === 'all' ? undefined : product,
      });
      if (version !== loadVersion) {
        return;
      }
      tickets = page.tickets;
      nextBefore = page.nextBefore;
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
      const page = await listTickets({
        status: status === 'all' ? undefined : status,
        product: product === 'all' ? undefined : product,
        before: nextBefore,
      });
      if (version !== loadVersion) {
        return;
      }
      const known = new Set(tickets.map((ticket) => ticket.id));
      tickets = [...tickets, ...page.tickets.filter((ticket) => !known.has(ticket.id))];
      nextBefore = page.nextBefore;
    } catch (error) {
      errorText = errorMessage(error);
    } finally {
      isLoadingMore = false;
    }
  }

  // 筛选条件变化时从第一页重新加载
  $effect(() => {
    void status;
    void product;
    untrack(() => void reload());
  });

  // 记下带筛选条件的列表地址，对话页返回时回到这里
  $effect(() => {
    feedbackNav.listHref = `/feedback${current.search}`;
  });

  onMount(() => {
    // 回到页面时在后台刷新，期间可能有新反馈
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void reload(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    refreshAdminStatus().catch(() => undefined);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
</script>

<section class="page">
  <header class="page-header">
    <h1>意见反馈</h1>
    <div class="filters">
      <div class="segmented" role="group" aria-label="状态">
        {#each STATUS_FILTERS as option (option.value)}
          <button
            type="button"
            aria-pressed={status === option.value}
            onclick={() => setFilter(option.value, product)}
          >
            {option.label}
          </button>
        {/each}
      </div>
      <select
        aria-label="产品"
        value={product}
        onchange={(event) => setFilter(status, parseProduct(event.currentTarget.value))}
      >
        <option value="all">全部产品</option>
        {#each PRODUCTS as option (option.code)}
          <option value={option.code}>{option.name}</option>
        {/each}
      </select>
      <button class="btn" type="button" onclick={() => void reload()} disabled={isLoading}>刷新</button>
    </div>
  </header>

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if isLoading}
    <p class="empty">加载中…</p>
  {:else if tickets.length === 0 && errorText === null}
    <p class="empty">{status === 'pending' ? '没有待处理的反馈' : '没有反馈'}</p>
  {:else}
    <ul class="tickets">
      {#each tickets as ticket (ticket.id)}
        <li>
          <a class="ticket" href="/feedback/conversations/{ticket.conversationId}">
            <div class="ticket-meta">
              <span class="tag">{productName(ticket.product)}</span>
              <span class="mono muted user" title="Logto 用户 ID">{ticket.userId}</span>
              <span class="status status-{ticket.status}">{statusLabel(ticket.status)}</span>
              <time class="muted time" datetime={ticket.lastMessageAt} title={formatFullTime(ticket.lastMessageAt)}>
                {formatTime(ticket.lastMessageAt)}
              </time>
            </div>
            <p class="preview">
              {#if ticket.lastMessage === null}
                <span class="muted">（没有消息）</span>
              {:else}
                {#if ticket.lastMessage.sender === 'admin'}<span class="muted">我们：</span>{/if}{ticket.lastMessage.content}
              {/if}
            </p>
          </a>
        </li>
      {/each}
    </ul>
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
    max-width: 960px;
    padding: 24px;
  }

  .page-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h1 {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .tickets {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    list-style: none;
  }

  .tickets li + li {
    border-top: 1px solid var(--line);
  }

  .ticket {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 16px;
  }

  .ticket:hover {
    background: var(--surface-hover);
  }

  .ticket-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .user {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time {
    font-size: 12px;
    white-space: nowrap;
  }

  .preview {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  .more {
    display: flex;
    justify-content: center;
  }

  @media (max-width: 720px) {
    .page {
      padding: 16px;
    }
  }
</style>
