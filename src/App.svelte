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
          <span>意见反馈</span>
          {#if pendingCount > 0}
            <span class="badge" aria-label="{pendingCount} 条待处理">{pendingCount}</span>
          {/if}
        </a>
      </div>
      <div class="account">
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
    gap: 20px;
    padding: 20px 12px;
    border-right: 1px solid var(--line);
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
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    color: var(--muted);
  }

  .nav-item:hover {
    background: var(--line);
  }

  .nav-item[aria-current='page'] {
    background: var(--surface);
    color: var(--fg);
    font-weight: 500;
  }

  .badge {
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--pending);
    color: #FFFFFF;
    font-size: 12px;
    line-height: 20px;
    text-align: center;
  }

  .account {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
  }

  .account-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .main {
    min-height: 0;
    overflow-y: auto;
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
    .account-name {
      display: none;
    }

    .brand {
      padding: 0;
    }

    .nav {
      flex-direction: row;
    }

    .account {
      padding: 0;
    }
  }
</style>
