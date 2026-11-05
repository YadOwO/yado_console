<script lang="ts">
  /**
   * Agent 各页面顶部的标签（总览 / 待办 / 运行记录 / 经验），以及底部的指令进度提示条。
   */
  import { adminStatus } from '../../lib/admin-status.svelte';
  import { commandState, dismissNotice } from './command.svelte';

  /** 当前所在的标签 */
  let { active }: { active: 'overview' | 'inbox' | 'runs' | 'lessons' } = $props();

  const inboxCount = $derived(adminStatus.value?.agentInboxCount ?? 0);
</script>

<nav class="tabs" aria-label="Agent">
  <a href="/agents" aria-current={active === 'overview' ? 'page' : undefined}>总览</a>
  <a href="/agents/inbox" aria-current={active === 'inbox' ? 'page' : undefined}>
    待办{#if inboxCount > 0}<span class="count">{inboxCount}</span>{/if}
  </a>
  <a href="/agents/runs" aria-current={active === 'runs' ? 'page' : undefined}>运行记录</a>
  <a href="/agents/lessons" aria-current={active === 'lessons' ? 'page' : undefined}>经验</a>
</nav>

{#if commandState.notice !== null}
  <div class="toast toast-{commandState.notice.tone}" role="status">
    <span>{commandState.notice.text}</span>
    <button type="button" aria-label="关闭" onclick={dismissNotice}>×</button>
  </div>
{/if}

<style>
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--line);
  }

  .tabs a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: -1px;
    padding: 6px 10px;
    border-bottom: 2px solid transparent;
    color: var(--muted);
  }

  .tabs a[aria-current='page'] {
    border-bottom-color: var(--fg);
    color: var(--fg);
    font-weight: 500;
  }

  .count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--pending);
    color: #FFFFFF;
    font-size: 11px;
    line-height: 18px;
    text-align: center;
  }

  .toast {
    position: fixed;
    right: 16px;
    bottom: 16px;
    left: 16px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 560px;
    margin: 0 auto;
    padding: 10px 12px 10px 16px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .toast span {
    flex: 1;
    overflow-wrap: anywhere;
  }

  .toast-ok span {
    color: var(--resolved);
  }

  .toast-error span {
    color: var(--danger);
  }

  .toast button {
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
</style>
