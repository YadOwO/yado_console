<script module lang="ts">
  /** 一条规则：经验或产品偏好，都是主审总结的一句话 */
  export interface IRule {
    /** agentd 本地的编号 */
    id: number;
    machineId: string;
    rule: string;
    reason: string | null;
  }

  /** 一组规则：组标题、生效中的上限、生效中的和已作废的 */
  export interface IRuleGroup<T extends IRule> {
    key: string;
    title: string;
    /** 生效中的上限；旧版 agentd 没报时为 null */
    limit: number | null;
    active: T[];
    voided: T[];
  }

  /** 页面上能对一条规则做的事：只有作废和恢复，改文字和新增只能在 Mac 上 */
  export type RuleAction = 'void' | 'restore';

  /** 按钮和提示条上的操作名 */
  export const RULE_ACTION_LABEL: Record<RuleAction, string> = { void: '作废', restore: '恢复' };
</script>

<script lang="ts" generics="T extends IRule">
  /**
   * 按组列出规则：组标题带「生效中条数 / 上限」，下面是生效中的（可以作废），已作废的收起来（可以恢复）。
   * 经验页和产品偏好共用；每条下面那行小字（来源、日期等）各不一样，由用的地方写。
   */
  import type { Snippet } from 'svelte';

  import { commandState } from './command.svelte';

  let {
    groups,
    prefix,
    heading = 'h2',
    voidHint,
    meta,
    onAct,
  }: {
    groups: IRuleGroup<T>[];
    /** 编号前面的字母：经验 L、产品偏好 P */
    prefix: string;
    /** 组标题用几级标题：单独成页的用 h2，放在别的小节下面的用 h3 */
    heading?: 'h2' | 'h3';
    /** 作废前确认时说明后果的一句，如「以后的 agent 不再照这条做」 */
    voidHint: string;
    /** 每条下面那行小字；第二个参数是这条是不是已作废 */
    meta: Snippet<[T, boolean]>;
    /** 作废（已经确认过）或恢复一条 */
    onAct: (item: T, action: RuleAction) => void;
  } = $props();

  /** 生效中的是否已满；满了再恢复会被 Mac 拒绝 */
  function isFull(group: IRuleGroup<T>): boolean {
    return group.limit !== null && group.active.length >= group.limit;
  }

  /** 作废前先确认；恢复直接做 */
  function act(item: T, action: RuleAction): void {
    if (action === 'void' && !confirm(`作废 ${prefix}${item.id}「${item.rule}」？${voidHint}，可以在「已作废」里恢复。`)) {
      return;
    }
    onAct(item, action);
  }
</script>

{#snippet row(item: T, action: RuleAction, title: string | undefined)}
  <li class="row" class:voided={action === 'restore'}>
    <span class="mono muted id-chip">{prefix}{item.id}</span>
    <p class="rule">
      {item.rule}{#if item.reason !== null}<span class="reason">{item.reason}</span>{/if}
    </p>
    <button class="btn row-btn" type="button" {title} disabled={commandState.isBusy} onclick={() => act(item, action)}
      >{RULE_ACTION_LABEL[action]}</button
    >
    <p class="meta">{@render meta(item, action === 'restore')}</p>
  </li>
{/snippet}

{#each groups as group (group.key)}
  <div class="group">
    <div class="group-head">
      <svelte:element this={heading}>{group.title}</svelte:element>
      <span
        class="pill"
        class:full={isFull(group)}
        title={group.limit === null ? `生效中 ${group.active.length} 条` : `生效中 ${group.active.length} 条，最多 ${group.limit} 条`}
      >
        {group.active.length}{group.limit === null ? '' : `/${group.limit}`}
      </span>
    </div>

    {#if group.active.length > 0}
      <ul class="list">
        {#each group.active as item (item.id)}
          {@render row(item, 'void', undefined)}
        {/each}
      </ul>
    {/if}

    {#if group.voided.length > 0}
      <details class="fold">
        <summary>已作废（{group.voided.length}）</summary>
        <ul class="list">
          {#each group.voided as item (item.id)}
            {@render row(item, 'restore', isFull(group) ? '生效中的已满，Mac 会拒绝；先作废一条再恢复' : undefined)}
          {/each}
        </ul>
      </details>
    {/if}
  </div>
{/each}

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* 一条两行：编号、规则（理由跟在后面）、按钮；下面一行是来源与日期 */
  .row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 3px 8px;
    padding: 10px 12px 10px 16px;
    transition: background-color 0.15s;
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .id-chip {
    justify-self: start;
  }

  .rule {
    font-size: 14px;
    overflow-wrap: anywhere;
  }

  .voided .rule {
    color: var(--muted);
  }

  .reason {
    margin-left: 8px;
    color: var(--muted);
  }

  .row-btn {
    grid-row: 1 / span 2;
    grid-column: 3;
    align-self: center;
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    grid-column: 2;
    gap: 0 6px;
    color: var(--muted);
    font-size: 12px;
  }

  /* 小字里的各段由用的地方写（不在这个组件里），所以用 :global 才选得到 */
  .meta > :global(span + span)::before {
    margin-right: 6px;
    content: '·';
  }

  .fold .list {
    margin-top: 6px;
  }
</style>
