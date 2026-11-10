<script lang="ts">
  /**
   * Agent 顶部标签各页面（总览 / 待办 / 想法 / 运行记录 / 经验）共用的外壳：标题、一句说明、右上角的控件、标签栏。
   * 页面自己的内容写在标签里面，右上角的控件写在 actions 里。
   */
  import type { Snippet } from 'svelte';

  import AgentTabs, { type AgentTab } from './AgentTabs.svelte';

  let {
    active,
    sub,
    isWrapping = false,
    actions,
    children,
  }: {
    /** 当前所在的标签 */
    active: AgentTab;
    /** 标题下面的一句说明 */
    sub: string;
    /** 右上角控件多（如一排筛选）时为 true：放不下就换到标题下面，而不是把标题挤窄 */
    isWrapping?: boolean;
    /** 右上角的控件：刷新、筛选等 */
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="page">
  <header class="page-header" class:wraps={isWrapping}>
    <div class="page-title">
      <h1>Agent</h1>
      <p class="page-sub">{sub}</p>
    </div>
    {@render actions?.()}
  </header>
  <AgentTabs {active} />

  {@render children()}
</section>
