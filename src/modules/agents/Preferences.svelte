<script lang="ts">
  /**
   * 产品偏好：主审从你对产品探索想法的处理和备注里总结的一句话，以后的探索照着提想法。放在产品探索的流程页里。
   *
   * 按产品分组、和想法一样按你排的先后，组标题显示生效中的条数与上限；已作废的收在每组下面，可以恢复。
   * 页面上只能作废、恢复：偏好会写进给主审的材料，改文字和新增不开放。这个产品生效中的已满时恢复会被 Mac 拒绝。
   */
  import { onMount } from 'svelte';

  import { formatDate, formatFullTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { getLessons, type ILessonList, type IPreference } from './api';
  import { commandState, performCommand } from './command.svelte';

  /** 一组产品偏好：某台机器上的一个产品 */
  interface IPreferenceGroup {
    key: string;
    product: string;
    title: string;
    /** 每个产品生效中偏好的上限；旧版 agentd 没报时为 null */
    limit: number | null;
    active: IPreference[];
    voided: IPreference[];
  }

  let {
    productOrder = [],
  }: {
    /** 产品探索实例里排的产品先后；没排过的产品按名字排在后面 */
    productOrder?: string[];
  } = $props();

  let list = $state<ILessonList | null>(null);
  let errorText = $state<string | null>(null);

  const groups = $derived(list === null ? [] : groupPreferences(list));

  /** 产品在 productOrder 里的位置；不在里面的排在最后 */
  function rankOf(product: string): number {
    const index = productOrder.indexOf(product);
    return index < 0 ? Infinity : index;
  }

  /** 按机器、产品分组，产品按你排的先后、再按名字；组内新的在前 */
  function groupPreferences(data: ILessonList): IPreferenceGroup[] {
    // 旧版 hub 没有这两个字段
    const preferences = data.preferences ?? [];
    const limits = data.preferenceLimits ?? [];
    const isMultiMachine = new Set(preferences.map((item) => item.machineId)).size > 1;
    const result = new Map<string, IPreferenceGroup>();
    for (const preference of [...preferences].sort((a, b) => b.id - a.id)) {
      const key = `${preference.machineId}/${preference.product}`;
      let group = result.get(key);
      if (group === undefined) {
        group = {
          key,
          product: preference.product,
          title: isMultiMachine ? `${preference.product}（${preference.machineId}）` : preference.product,
          limit: limits.find((item) => item.machineId === preference.machineId)?.limit ?? null,
          active: [],
          voided: [],
        };
        result.set(key, group);
      }
      (preference.status === 'active' ? group.active : group.voided).push(preference);
    }
    return [...result.values()].sort(
      (a, b) => rankOf(a.product) - rankOf(b.product) || a.title.localeCompare(b.title, 'zh-CN'),
    );
  }

  /** 加载偏好（和经验一个接口） */
  async function load(): Promise<void> {
    try {
      list = await getLessons();
      errorText = null;
    } catch (error) {
      errorText = errorMessage(error);
    }
  }

  /** 作废一条，先确认 */
  async function voidPreference(preference: IPreference): Promise<void> {
    if (!confirm(`作废 P${preference.id}「${preference.rule}」？以后的产品探索不再照这条提想法，可以在「已作废」里恢复。`)) {
      return;
    }
    if (
      await performCommand(preference.machineId, { type: 'preference.void', payload: { id: preference.id } }, `作废 P${preference.id}`)
    ) {
      await load();
    }
  }

  /** 恢复一条已作废的；这个产品已满时 Mac 会拒绝 */
  async function restorePreference(preference: IPreference): Promise<void> {
    if (
      await performCommand(preference.machineId, { type: 'preference.restore', payload: { id: preference.id } }, `恢复 P${preference.id}`)
    ) {
      await load();
    }
  }

  /** 生效中的是否已满 */
  function isFull(group: IPreferenceGroup): boolean {
    return group.limit !== null && group.active.length >= group.limit;
  }

  onMount(() => {
    void load();
  });
</script>

<div class="block">
  <div class="section-header">
    <h2>产品偏好</h2>
  </div>
  <p class="muted section-sub">主审从你对想法的处理和备注里总结的，以后的探索照着提想法；页面上只能作废、恢复</p>

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if list !== null && groups.length === 0}
    <p class="empty">还没有产品偏好。你处理几条想法并写上备注，主审会从里面总结。</p>
  {/if}
  {#each groups as group (group.key)}
    <div class="group">
      <div class="group-head">
        <h3>{group.title}</h3>
        <span
          class="count"
          class:full={isFull(group)}
          title={group.limit === null ? `生效中 ${group.active.length} 条` : `生效中 ${group.active.length} 条，最多 ${group.limit} 条`}
        >
          {group.active.length}{group.limit === null ? '' : `/${group.limit}`}
        </span>
      </div>

      {#if group.active.length > 0}
        <ul class="list">
          {#each group.active as preference (preference.id)}
            <li class="row">
              <span class="mono muted id">P{preference.id}</span>
              <p class="rule">
                {preference.rule}{#if preference.reason !== null}<span class="reason">{preference.reason}</span>{/if}
              </p>
              <button class="btn row-btn" type="button" disabled={commandState.isBusy} onclick={() => void voidPreference(preference)}
                >作废</button
              >
              <p class="meta">
                {#if preference.sourceRunId !== null}
                  <span><a class="link" href="/agents/runs/{preference.machineId}/{preference.sourceRunId}">来源运行</a></span>
                {/if}
                {#if preference.replacesId !== null}<span>替换了 P{preference.replacesId}</span>{/if}
                <span
                  ><time datetime={preference.createdAt} title={formatFullTime(preference.createdAt)}>{formatDate(preference.createdAt)}</time
                  >加入</span
                >
              </p>
            </li>
          {/each}
        </ul>
      {/if}

      {#if group.voided.length > 0}
        <details class="voided">
          <summary>已作废（{group.voided.length}）</summary>
          <ul class="list">
            {#each group.voided as preference (preference.id)}
              <li class="row">
                <span class="mono muted id">P{preference.id}</span>
                <p class="rule">
                  {preference.rule}{#if preference.reason !== null}<span class="reason">{preference.reason}</span>{/if}
                </p>
                <button
                  class="btn row-btn"
                  type="button"
                  title={isFull(group) ? '这个产品生效中的已满，Mac 会拒绝；先作废一条再恢复' : undefined}
                  disabled={commandState.isBusy}
                  onclick={() => void restorePreference(preference)}>恢复</button
                >
                <p class="meta">
                  {#if preference.replacedById !== null}<span>被 P{preference.replacedById} 替换</span>{/if}
                  {#if preference.voidedAt !== null}
                    <span
                      ><time datetime={preference.voidedAt} title={formatFullTime(preference.voidedAt)}>{formatDate(preference.voidedAt)}</time
                      >作废</span
                    >
                  {/if}
                </p>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    </div>
  {/each}
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
  }

  .section-sub {
    margin-top: -8px;
    font-size: 13px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .count {
    padding: 0 8px;
    border-radius: 999px;
    background: var(--chip-bg);
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
    white-space: nowrap;
  }

  .count.full {
    background: var(--pending-bg);
    color: var(--pending);
  }

  .list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    list-style: none;
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

  .row + .row {
    border-top: 1px solid var(--line);
  }

  .id {
    justify-self: start;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--chip-bg);
    line-height: 18px;
  }

  .rule {
    font-size: 14px;
    overflow-wrap: anywhere;
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

  .meta > span + span::before {
    margin-right: 6px;
    content: '·';
  }

  .link {
    text-decoration: underline;
  }

  .voided summary {
    width: fit-content;
    color: var(--muted);
    font-size: 13px;
    cursor: pointer;
  }

  .voided .list {
    margin-top: 6px;
  }

  .voided .rule {
    color: var(--muted);
  }
</style>
