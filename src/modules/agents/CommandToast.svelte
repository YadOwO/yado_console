<script lang="ts">
  /**
   * 页面底部的指令进度提示条：最近一条指令发到哪一步、结果如何；连续处理了几条时写明还有几条在路上。Agent 的各页面都放一个。
   */
  import { commandState, dismissNotice } from './command.svelte';
</script>

{#if commandState.notice !== null}
  <div class="toast toast-{commandState.notice.tone}" role="status">
    <span>
      {commandState.notice.text}{#if commandState.pendingCount > 1}<small class="muted">（还有 {commandState.pendingCount - 1} 条在处理）</small>{/if}
    </span>
    <button type="button" aria-label="关闭" onclick={dismissNotice}>×</button>
  </div>
{/if}

<style>
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
    box-shadow: var(--shadow-md);
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
