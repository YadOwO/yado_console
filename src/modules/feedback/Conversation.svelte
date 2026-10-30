<script lang="ts">
  /**
   * 对话详情：一个用户在一个产品下的全部消息，按反馈单分段，可以回复和修改最新一单的状态。
   *
   * 打开期间每 15 秒（页面可见时）拉一次最新消息，回到页面时立即拉一次。
   */
  import { onMount, tick } from 'svelte';

  import { refreshAdminStatus } from '../../lib/admin-status.svelte';
  import { productName } from '../../lib/config';
  import { formatFullTime, formatTime } from '../../lib/format';
  import { ApiError, errorMessage } from '../../lib/http';
  import {
    getConversation,
    listMessages,
    MESSAGE_MAX_LENGTH,
    sendReply,
    statusLabel,
    updateTicketStatus,
    type IClientInfo,
    type IConversation,
    type IMessage,
    type ITicket,
    type TicketStatus,
  } from './api';
  import { feedbackNav } from './nav';

  let { id }: { id: string } = $props();

  /** 自动刷新间隔 */
  const POLL_INTERVAL_MS = 15_000;
  /** 离底部小于这个距离时视为正在看最新消息，新消息到达时自动滚到底 */
  const STICK_TO_BOTTOM_PX = 80;
  /** 正文剩余不到这么多字时显示字数 */
  const COUNTER_THRESHOLD = 100;

  /** 消息区的一行：反馈单分隔线，或一条消息 */
  type Row =
    | { kind: 'divider'; key: string; ticket: ITicket | null; number: number | null }
    | { kind: 'message'; key: string; message: IMessage; device: string | null };

  let conversation = $state<IConversation | null>(null);
  /** 已加载的消息，按序号从旧到新 */
  let messages = $state<IMessage[]>([]);
  /** 更早消息的游标；null 表示已经到头 */
  let nextBefore = $state<number | null>(null);
  /** 首次加载失败的原因 */
  let loadError = $state<string | null>(null);
  /** 加载更早消息、修改状态失败的提示 */
  let noticeError = $state<string | null>(null);
  let isLoadingOlder = $state(false);
  let isUpdatingStatus = $state(false);
  let draft = $state('');
  let isSending = $state(false);
  let sendError = $state<string | null>(null);
  let isCopied = $state(false);
  let scroller = $state<HTMLElement>();

  /** 发送中或发送失败的回复：重试同样内容时沿用同一个 ID，网络抖动也不会重复回复 */
  let pendingReply: { id: string; content: string } | null = null;
  /** 后台刷新是否进行中，避免重叠 */
  let isRefreshing = false;

  const backHref = feedbackNav.listHref;
  const latestTicket = $derived(conversation?.tickets.at(-1) ?? null);
  const content = $derived(draft.trim());
  const overflow = $derived(Math.max(content.length - MESSAGE_MAX_LENGTH, 0));
  const canSend = $derived(conversation !== null && content.length > 0 && overflow === 0 && !isSending);
  const rows = $derived(buildRows(messages, conversation?.tickets ?? []));
  const latestDevice = $derived(findLatestDevice(messages));

  /** 设备信息的一行文字 */
  function deviceText(info: IClientInfo): string {
    return [info.appVersion, info.osVersion, info.deviceModel, info.locale].join(' · ');
  }

  /** 最近一条用户消息的设备信息 */
  function findLatestDevice(list: IMessage[]): string | null {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const info = list[index]?.clientInfo;
      if (info !== undefined && info !== null) {
        return deviceText(info);
      }
    }
    return null;
  }

  /**
   * 把消息排成行：所属反馈单变化处插一条分隔线；设备信息只在和上一条用户消息不同时显示。
   */
  function buildRows(list: IMessage[], tickets: ITicket[]): Row[] {
    const result: Row[] = [];
    let ticketId: string | null = null;
    let lastDevice: string | null = null;
    for (const message of list) {
      if (message.ticketId !== ticketId) {
        ticketId = message.ticketId;
        const index = tickets.findIndex((ticket) => ticket.id === message.ticketId);
        result.push({
          kind: 'divider',
          key: `divider-${message.seq}`,
          ticket: tickets[index] ?? null,
          number: index === -1 ? null : index + 1,
        });
      }
      let device: string | null = null;
      if (message.clientInfo !== null) {
        const text = deviceText(message.clientInfo);
        device = text === lastDevice ? null : text;
        lastDevice = text;
      }
      result.push({ kind: 'message', key: `message-${message.seq}`, message, device });
    }
    return result;
  }

  /** 是否停在消息区底部附近 */
  function isNearBottom(): boolean {
    if (scroller === undefined) {
      return true;
    }
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < STICK_TO_BOTTOM_PX;
  }

  /** 渲染完成后滚到最新消息 */
  async function scrollToBottom(): Promise<void> {
    await tick();
    scroller?.scrollTo({ top: scroller.scrollHeight });
  }

  /** 首次加载：对话详情与最新一页消息 */
  async function loadInitial(): Promise<void> {
    loadError = null;
    try {
      const [detail, page] = await Promise.all([getConversation(id), listMessages(id)]);
      conversation = detail;
      messages = [...page.messages].reverse();
      nextBefore = page.nextBefore;
      await scrollToBottom();
    } catch (error) {
      loadError = errorMessage(error);
    }
  }

  /** 后台刷新：拉最新一页，补上新消息；失败时不打扰，下次再试 */
  async function refreshLatest(): Promise<void> {
    if (isRefreshing || conversation === null) {
      return;
    }
    isRefreshing = true;
    try {
      const shouldStick = isNearBottom();
      const [detail, page] = await Promise.all([getConversation(id), listMessages(id)]);
      conversation = detail;
      const lastSeq = messages.at(-1)?.seq ?? 0;
      const newer = page.messages.filter((message) => message.seq > lastSeq).reverse();
      if (newer.length === 0) {
        return;
      }
      if (newer.length === page.messages.length && page.nextBefore !== null) {
        // 新消息超过一页，和已加载的接不上：直接换成最新一页
        messages = [...page.messages].reverse();
        nextBefore = page.nextBefore;
      } else {
        messages = [...messages, ...newer];
      }
      if (shouldStick) {
        await scrollToBottom();
      }
    } catch {
      // 网络抖动等，下一轮再试
    } finally {
      isRefreshing = false;
    }
  }

  /** 加载更早的消息，保持当前看到的位置不跳动 */
  async function loadOlder(): Promise<void> {
    const element = scroller;
    if (nextBefore === null || isLoadingOlder || element === undefined) {
      return;
    }
    isLoadingOlder = true;
    noticeError = null;
    const distanceFromBottom = element.scrollHeight - element.scrollTop;
    try {
      const page = await listMessages(id, nextBefore);
      const firstSeq = messages[0]?.seq ?? Number.POSITIVE_INFINITY;
      const older = page.messages.filter((message) => message.seq < firstSeq).reverse();
      messages = [...older, ...messages];
      nextBefore = page.nextBefore;
      await tick();
      element.scrollTop = element.scrollHeight - distanceFromBottom;
    } catch (error) {
      noticeError = errorMessage(error);
    } finally {
      isLoadingOlder = false;
    }
  }

  /** 把一条消息并入列表，已存在时忽略（后台刷新可能先一步拿到） */
  function appendMessage(message: IMessage): void {
    if (messages.some((item) => item.seq === message.seq)) {
      return;
    }
    messages = [...messages, message].sort((a, b) => a.seq - b.seq);
  }

  /**
   * 修改最新一单的状态。
   *
   * 只有最新一单能改回待处理；期间用户发来新消息开了新单时后端返回 409，刷新后按钮对应到新的一单。
   */
  async function setStatus(status: TicketStatus): Promise<void> {
    const ticket = latestTicket;
    if (ticket === null || conversation === null || isUpdatingStatus) {
      return;
    }
    isUpdatingStatus = true;
    noticeError = null;
    try {
      const updated = await updateTicketStatus(ticket.id, status);
      conversation.tickets = conversation.tickets.map((item) => (item.id === updated.id ? updated : item));
      refreshAdminStatus().catch(() => undefined);
    } catch (error) {
      noticeError = errorMessage(error);
      if (error instanceof ApiError && error.status === 409) {
        void refreshLatest();
      }
    } finally {
      isUpdatingStatus = false;
    }
  }

  /**
   * 发送回复。
   *
   * @param shouldResolve 为 true 时发送成功后把最新一单标记为已处理
   */
  async function send(shouldResolve: boolean): Promise<void> {
    if (!canSend) {
      return;
    }
    const reply = pendingReply?.content === content ? pendingReply : { id: crypto.randomUUID(), content };
    pendingReply = reply;
    isSending = true;
    sendError = null;
    try {
      const message = await sendReply(id, reply.id, reply.content);
      pendingReply = null;
      draft = '';
      appendMessage(message);
      await scrollToBottom();
      if (shouldResolve && latestTicket?.status === 'pending') {
        await setStatus('resolved');
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // 消息 ID 冲突：下次换一个新 ID
        pendingReply = null;
      }
      sendError = errorMessage(error);
    } finally {
      isSending = false;
    }
  }

  /** ⌘ / Ctrl + Enter 发送；输入法选字时的回车不算 */
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      void send(false);
    }
  }

  /** 复制 Logto 用户 ID，方便去 Logto 后台查账号 */
  async function copyUserId(): Promise<void> {
    if (conversation === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(conversation.userId);
      isCopied = true;
      setTimeout(() => (isCopied = false), 1500);
    } catch {
      // 浏览器不允许写剪贴板时，用户 ID 仍可手动选中复制
    }
  }

  onMount(() => {
    void loadInitial();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshLatest();
      }
    }, POLL_INTERVAL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void refreshLatest();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
</script>

<section class="conversation">
  <header class="header">
    <a class="back muted" href={backHref}>← 反馈列表</a>
    {#if conversation !== null}
      <div class="who">
        <span class="tag">{productName(conversation.product)}</span>
        <button class="user mono" type="button" title="复制 Logto 用户 ID" onclick={() => void copyUserId()}>
          {isCopied ? '已复制' : conversation.userId}
        </button>
      </div>
      {#if latestTicket !== null}
        <div class="actions">
          <span class="status status-{latestTicket.status}">{statusLabel(latestTicket.status)}</span>
          {#if latestTicket.status === 'pending'}
            <button class="btn" type="button" disabled={isUpdatingStatus} onclick={() => void setStatus('resolved')}>
              标记已处理
            </button>
          {:else}
            <button class="btn" type="button" disabled={isUpdatingStatus} onclick={() => void setStatus('pending')}>
              重新打开
            </button>
          {/if}
        </div>
      {/if}
    {/if}
  </header>

  {#if latestDevice !== null}
    <p class="device muted">最近设备：{latestDevice}</p>
  {/if}
  {#if noticeError !== null}
    <p class="error-banner notice">{noticeError}</p>
  {/if}

  <div class="messages" bind:this={scroller}>
    {#if loadError !== null}
      <div class="empty">
        <p class="error-banner">{loadError}</p>
        <button class="btn retry" type="button" onclick={() => void loadInitial()}>重试</button>
      </div>
    {:else if conversation === null}
      <p class="empty">加载中…</p>
    {:else}
      {#if nextBefore !== null}
        <div class="older">
          <button class="btn" type="button" disabled={isLoadingOlder} onclick={() => void loadOlder()}>
            {isLoadingOlder ? '加载中…' : '加载更早的消息'}
          </button>
        </div>
      {/if}
      {#each rows as row (row.key)}
        {#if row.kind === 'divider'}
          <div class="divider">
            <span>
              {row.number === null ? '新反馈单' : `反馈单 ${row.number}`}
              {#if row.ticket !== null}
                · {statusLabel(row.ticket.status)} · {formatTime(row.ticket.createdAt)}
              {/if}
            </span>
          </div>
        {:else}
          <div class="message" class:from-admin={row.message.sender === 'admin'}>
            <div class="bubble">{row.message.content}</div>
            <div class="meta muted">
              <time datetime={row.message.createdAt} title={formatFullTime(row.message.createdAt)}>
                {formatTime(row.message.createdAt)}
              </time>
              {#if row.device !== null}
                <span class="mono">· {row.device}</span>
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <form
    class="composer"
    onsubmit={(event) => {
      event.preventDefault();
      void send(false);
    }}
  >
    <textarea
      bind:value={draft}
      rows="3"
      placeholder="回复用户…（⌘ / Ctrl + Enter 发送）"
      aria-label="回复内容"
      disabled={conversation === null}
      onkeydown={onKeydown}
    ></textarea>
    <div class="composer-bar">
      {#if sendError !== null}
        <span class="send-error">{sendError}</span>
      {/if}
      <span class="counter" class:over={overflow > 0}>
        {content.length > MESSAGE_MAX_LENGTH - COUNTER_THRESHOLD ? `${content.length} / ${MESSAGE_MAX_LENGTH}` : ''}
      </span>
      {#if latestTicket?.status === 'pending'}
        <button class="btn" type="button" disabled={!canSend} onclick={() => void send(true)}>发送并标记已处理</button>
      {/if}
      <button class="btn btn-primary" type="submit" disabled={!canSend}>{isSending ? '发送中…' : '发送'}</button>
    </div>
  </form>
</section>

<style>
  .conversation {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-width: 960px;
  }

  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 16px 24px 8px;
  }

  .back:hover {
    color: var(--fg);
  }

  .who {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .user {
    min-width: 0;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: none;
    cursor: copy;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .device {
    padding: 0 24px 8px;
    font-size: 12px;
  }

  .notice {
    margin: 0 24px 8px;
  }

  .messages {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 24px;
    border-top: 1px solid var(--line);
  }

  .retry {
    margin-top: 12px;
  }

  .older {
    display: flex;
    justify-content: center;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--line);
  }

  .message {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    max-width: 75%;
  }

  .message.from-admin {
    align-items: flex-end;
    align-self: flex-end;
  }

  .bubble {
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bubble-user);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .from-admin .bubble {
    border-color: transparent;
    background: var(--bubble-admin);
    color: var(--on-bubble-admin);
  }

  .meta {
    font-size: 12px;
  }

  .meta .mono {
    font-size: 11px;
  }

  .composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 24px 16px;
    border-top: 1px solid var(--line);
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

  .composer-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .send-error {
    flex: 1;
    color: var(--danger);
  }

  .counter {
    color: var(--muted);
    font-size: 12px;
  }

  .counter.over {
    color: var(--danger);
  }

  @media (max-width: 720px) {
    .header,
    .messages,
    .composer {
      padding-right: 16px;
      padding-left: 16px;
    }

    .device {
      padding: 0 16px 8px;
    }

    .notice {
      margin: 0 16px 8px;
    }

    .message {
      max-width: 88%;
    }
  }
</style>
