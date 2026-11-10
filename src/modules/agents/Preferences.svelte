<script lang="ts">
  /**
   * 产品偏好：主审从你对产品探索想法的处理和备注里总结的一句话，以后的探索照着提想法。放在顶部标签的「想法」页里，想法列表下面。
   *
   * 按产品分组、和想法一样按你排的先后，组标题显示生效中的条数与上限；已作废的收在每组下面，可以恢复。
   * 页面上只能作废、恢复：偏好会写进给主审的材料，改文字和新增不开放。这个产品生效中的已满时恢复会被 Mac 拒绝。
   */
  import { onMount } from 'svelte';

  import { formatDate, formatFullTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { getLessons, type ILessonList, type IPreference } from './api';
  import { performCommand } from './command.svelte';
  import RuleList, { RULE_ACTION_LABEL, type IRuleGroup, type RuleAction } from './RuleList.svelte';

  /** 一组产品偏好：某台机器上的一个产品 */
  interface IPreferenceGroup extends IRuleGroup<IPreference> {
    product: string;
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

  /** 作废（RuleList 已经确认过）或恢复一条偏好；这个产品生效中的已满时恢复会被 Mac 拒绝 */
  async function act(preference: IPreference, action: RuleAction): Promise<void> {
    const type = action === 'void' ? 'preference.void' : 'preference.restore';
    const label = `${RULE_ACTION_LABEL[action]} P${preference.id}`;
    if (await performCommand(preference.machineId, { type, payload: { id: preference.id } }, label)) {
      await load();
    }
  }

  onMount(() => {
    void load();
  });
</script>

{#snippet meta(preference: IPreference, isVoided: boolean)}
  {#if isVoided}
    {#if preference.replacedById !== null}<span>被 P{preference.replacedById} 替换</span>{/if}
    {#if preference.voidedAt !== null}
      <span
        ><time datetime={preference.voidedAt} title={formatFullTime(preference.voidedAt)}>{formatDate(preference.voidedAt)}</time>作废</span
      >
    {/if}
  {:else}
    {#if preference.sourceRunId !== null}
      <span><a class="link" href="/agents/runs/{preference.machineId}/{preference.sourceRunId}">来源运行</a></span>
    {/if}
    {#if preference.replacesId !== null}<span>替换了 P{preference.replacesId}</span>{/if}
    <span
      ><time datetime={preference.createdAt} title={formatFullTime(preference.createdAt)}>{formatDate(preference.createdAt)}</time>加入</span
    >
  {/if}
{/snippet}

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
  <RuleList
    {groups}
    prefix="P"
    heading="h3"
    voidHint="以后的产品探索不再照这条提想法"
    {meta}
    onAct={(preference, action) => void act(preference, action)}
  />
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-sub {
    margin-top: -8px;
    font-size: 13px;
  }
</style>
