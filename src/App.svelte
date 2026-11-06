<script lang="ts">
  /**
   * 管理端根组件：确认登录与管理员身份，再按路径显示页面。
   *
   * 侧栏按功能分组，每个功能覆盖全部产品，页面内再按产品筛选；以后加功能只需加一个导航项和对应页面。
   */
  import { onMount } from 'svelte';

  import { adminStatus, refreshAdminStatus } from './lib/admin-status.svelte';
  import { getDisplayName, handleSignInCallback, isAuthenticated, signIn, signOut } from './lib/auth';
  import { IS_AUTH_DEV_BYPASS, LOGTO_APP_ID } from './lib/config';
  import { errorMessage, isUnauthorized } from './lib/http';
  import { current, handleLinkClick, matchRoute, navigate } from './lib/router.svelte';
  import AgentFlow from './modules/agents/Flow.svelte';
  import AgentInbox from './modules/agents/Inbox.svelte';
  import AgentLessons from './modules/agents/Lessons.svelte';
  import AgentOverview from './modules/agents/Overview.svelte';
  import AgentRunDetail from './modules/agents/RunDetail.svelte';
  import AgentRunList from './modules/agents/RunList.svelte';
  import Conversation from './modules/feedback/Conversation.svelte';
  import TicketList from './modules/feedback/TicketList.svelte';

  /** 启动阶段：确认登录与管理员身份后才进入 ready */
  type Phase =
    | { kind: 'loading' }
    | { kind: 'signedOut' }
    | { kind: 'forbidden' }
    | { kind: 'error'; message: string }
    | { kind: 'ready' };

  let phase = $state<Phase>({ kind: 'loading' });
  /** 当前账号的显示名 */
  let displayName = $state('');
  /** 页面滚动容器；切换页面时回到顶部 */
  let main = $state<HTMLElement>();

  const route = $derived(matchRoute(current.path));
  const pendingCount = $derived(adminStatus.value?.pendingTicketCount ?? 0);
  const agentInboxCount = $derived(adminStatus.value?.agentInboxCount ?? 0);
  const isAgentPage = $derived(route.name.startsWith('agent'));
  /** 账号头像上显示的首字 */
  const accountInitial = $derived(displayName.trim().slice(0, 1).toUpperCase());

  /** 处理登录回调，确认已登录且是管理员 */
  async function boot(): Promise<void> {
    phase = { kind: 'loading' };
    if (!IS_AUTH_DEV_BYPASS && LOGTO_APP_ID === '') {
      phase = { kind: 'error', message: '未配置 Logto App ID（VITE_LOGTO_APP_ID）' };
      return;
    }
    try {
      if (matchRoute(location.pathname).name === 'callback') {
        navigate(await handleSignInCallback(), { replace: true });
      }
      if (!(await isAuthenticated())) {
        phase = { kind: 'signedOut' };
        return;
      }
      const status = await refreshAdminStatus();
      displayName = await getDisplayName();
      phase = status.isAdmin ? { kind: 'ready' } : { kind: 'forbidden' };
    } catch (error) {
      if (matchRoute(location.pathname).name === 'callback') {
        // 回调失败（如刷新了回调页）时离开回调地址，避免重试时再次处理同一个授权码
        navigate('/', { replace: true });
      }
      phase = isUnauthorized(error) ? { kind: 'signedOut' } : { kind: 'error', message: errorMessage(error) };
    }
  }

  onMount(() => {
    void boot();
    // 回到页面时刷新待处理数
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && phase.kind === 'ready') {
        refreshAdminStatus().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  // 换页面时回到顶部
  $effect(() => {
    void current.path;
    main?.scrollTo(0, 0);
  });
</script>

<svelte:document onclick={handleLinkClick} />

{#if phase.kind === 'ready'}
  <div class="shell">
    <nav class="sidebar" aria-label="主导航">
      <a class="brand" href="/">
        <img src="/favicon.svg" alt="" width="22" height="22" />
        <span>芽豆管理端</span>
      </a>
      <div class="nav">
        <a
          class="nav-item"
          href="/feedback"
          aria-current={route.name === 'tickets' || route.name === 'conversation' ? 'page' : undefined}
        >
          <span class="nav-label">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
              <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6.5L5.5 20v-4H7a2.5 2.5 0 0 1-2.5-2.5z" stroke-linejoin="round" />
            </svg>
            <span>意见反馈</span>
          </span>
          {#if pendingCount > 0}
            <span class="badge" aria-label="{pendingCount} 条待处理">{pendingCount}</span>
          {/if}
        </a>
        <a class="nav-item" href="/agents" aria-current={isAgentPage ? 'page' : undefined}>
          <span class="nav-label">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
              <rect x="4.5" y="8" width="15" height="11" rx="3" />
              <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" stroke-linecap="round" />
            </svg>
            <span>Agent</span>
          </span>
          {#if agentInboxCount > 0}
            <span class="badge" aria-label="{agentInboxCount} 条待办">{agentInboxCount}</span>
          {/if}
        </a>
      </div>
      <div class="account">
        <span class="avatar" aria-hidden="true">{accountInitial}</span>
        <span class="account-name" title={displayName}>{displayName}</span>
        <button class="btn" type="button" onclick={() => void signOut()}>退出</button>
      </div>
    </nav>
    <main class="main" bind:this={main}>
      {#if route.name === 'tickets'}
        <TicketList />
      {:else if route.name === 'conversation'}
        {#key route.id}
          <Conversation id={route.id} />
        {/key}
      {:else if route.name === 'agents'}
        <AgentOverview />
      {:else if route.name === 'agentInbox'}
        <AgentInbox />
      {:else if route.name === 'agentRuns'}
        <AgentRunList />
      {:else if route.name === 'agentRun'}
        {#key `${route.machineId}/${route.runId}`}
          <AgentRunDetail machineId={route.machineId} runId={route.runId} />
        {/key}
      {:else if route.name === 'agentLessons'}
        <AgentLessons />
      {:else if route.name === 'agentFlow'}
        {#key route.flowType}
          <AgentFlow flowType={route.flowType} />
        {/key}
      {:else}
        <p class="empty">页面不存在，<a class="link" href="/feedback">回到意见反馈</a></p>
      {/if}
    </main>
  </div>
{:else}
  <div class="gate">
    <img src="/favicon.svg" alt="" width="56" height="56" />
    <h1>芽豆管理端</h1>
    {#if phase.kind === 'loading'}
      <p class="muted">正在确认登录状态…</p>
    {:else if phase.kind === 'signedOut'}
      <p class="muted">使用管理员账号登录</p>
      <button class="btn btn-primary" type="button" onclick={() => void signIn()}>登录</button>
    {:else if phase.kind === 'forbidden'}
      <p class="muted">当前账号「{displayName}」不是管理员</p>
      <button class="btn" type="button" onclick={() => void signOut()}>换个账号</button>
    {:else}
      <p class="error-banner">{phase.message}</p>
      <div class="gate-actions">
        <button class="btn" type="button" onclick={() => void boot()}>重试</button>
        <button class="btn" type="button" onclick={() => void signIn()}>重新登录</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .shell {
    display: grid;
    grid-template-columns: 208px minmax(0, 1fr);
    height: 100%;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 20px 14px;
    border-right: 1px solid var(--line);
    background: var(--surface);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .nav-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 36px;
    padding: 0 10px;
    border-radius: 9px;
    color: var(--muted);
    white-space: nowrap;
    transition: background-color 0.15s, color 0.15s;
  }

  .nav-label {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .nav-item svg {
    flex-shrink: 0;
    opacity: 0.75;
  }

  .nav-item:hover {
    background: var(--surface-sunken);
    color: var(--fg);
  }

  .nav-item[aria-current='page'] {
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg);
    font-weight: 500;
  }

  .nav-item[aria-current='page'] svg {
    opacity: 1;
  }

  .badge {
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--pending);
    color: var(--on-pending);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
    text-align: center;
  }

  .account {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 8px 0;
    border-top: 1px solid var(--line);
  }

  .avatar {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--surface-sunken);
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }

  .account-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account .btn {
    height: 28px;
    padding: 0 10px;
    font-size: 13px;
  }

  .main {
    min-height: 0;
    overflow-y: auto;
    scrollbar-color: var(--line-strong) transparent;
    scrollbar-width: thin;
  }

  .link {
    text-decoration: underline;
  }

  .gate {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 100%;
    padding: 24px 16px;
    text-align: center;
  }

  .gate h1 {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .gate-actions {
    display: flex;
    gap: 8px;
  }

  /* 手机：侧栏变成顶栏 */
  @media (max-width: 720px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }

    .sidebar {
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }

    .brand span,
    .account-name,
    .avatar {
      display: none;
    }

    .brand {
      padding: 0;
    }

    .nav {
      flex-direction: row;
      gap: 2px;
    }

    .nav-item {
      height: 32px;
      padding: 0 8px;
      gap: 6px;
    }

    .nav-label {
      gap: 6px;
    }

    .account {
      padding: 0;
      border-top: 0;
    }
  }
</style>
