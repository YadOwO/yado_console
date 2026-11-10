<script module lang="ts">
  /** Agent 顶部的标签 */
  export type AgentTab = 'overview' | 'inbox' | 'ideas' | 'runs' | 'lessons';
</script>

<script lang="ts">
  /**
   * Agent 全局页面顶部的标签（总览 / 待办 / 想法 / 运行记录 / 经验），以及底部的指令进度提示条。
   * 待办和想法是每天要处理的，标签上带没处理的条数。各流程自己的设置（实例）在流程页里，从总览的流程卡进。
   */
  import { adminStatus } from '../../lib/admin-status.svelte';
  import CommandToast from './CommandToast.svelte';

  /** 当前所在的标签 */
  let { active }: { active: AgentTab } = $props();

  const inboxCount = $derived(adminStatus.value?.agentInboxCount ?? 0);
  /** 产品探索还没处理的想法数 */
  const ideaCount = $derived(adminStatus.value?.agentIdeaCount ?? 0);
</script>

<nav class="tabs" aria-label="Agent">
  <a href="/agents" aria-current={active === 'overview' ? 'page' : undefined}>总览</a>
  <a href="/agents/inbox" aria-current={active === 'inbox' ? 'page' : undefined}>
    待办{#if inboxCount > 0}<span class="badge badge-small">{inboxCount}</span>{/if}
  </a>
  <a href="/agents/ideas" aria-current={active === 'ideas' ? 'page' : undefined}>
    想法{#if ideaCount > 0}<span class="badge badge-small">{ideaCount}</span>{/if}
  </a>
  <a href="/agents/runs" aria-current={active === 'runs' ? 'page' : undefined}>运行记录</a>
  <a href="/agents/lessons" aria-current={active === 'lessons' ? 'page' : undefined}>经验</a>
</nav>

<CommandToast />

<style>
  .tabs {
    display: flex;
    align-self: flex-start;
    gap: 2px;
    max-width: 100%;
    padding: 3px;
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface-sunken);
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tabs a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    color: var(--muted);
    white-space: nowrap;
    transition: background-color 0.15s, color 0.15s;
  }

  .tabs a:hover {
    color: var(--fg);
  }

  .tabs a[aria-current='page'] {
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    color: var(--fg);
    font-weight: 500;
  }
</style>
