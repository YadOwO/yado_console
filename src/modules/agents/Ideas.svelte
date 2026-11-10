<script lang="ts">
  /**
   * 想法：产品探索提出的想法（采纳并开工 / 丢弃 / 已实现）和主审总结的产品偏好。
   *
   * 想法是每天要看的，所以和待办一样放在顶部标签里，标签上带没处理的条数；产品探索的实例设置仍在它的流程页里。
   */
  import { onMount } from 'svelte';

  import { EXPLORE_FLOW } from './api';
  import AgentPage from './AgentPage.svelte';
  import IdeaList from './IdeaList.svelte';
  import { ensureOverview, overviewState } from './overview-store.svelte';
  import Preferences from './Preferences.svelte';

  /** 产品探索实例设置里排的产品先后，产品偏好跟着这个排 */
  const productOrder = $derived(
    (overviewState.value?.instances ?? [])
      .filter((item) => item.flowType === EXPLORE_FLOW)
      .flatMap((item) => item.products ?? [])
      .map((item) => item.name),
  );

  onMount(ensureOverview);
</script>

<AgentPage active="ideas" sub="产品探索提出的想法，你定做不做">
  {#snippet actions()}
    <a class="btn" href="/agents/flows/{EXPLORE_FLOW}">探索的设置</a>
  {/snippet}

  <IdeaList />
  <Preferences {productOrder} />
</AgentPage>
