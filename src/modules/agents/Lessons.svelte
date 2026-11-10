<script lang="ts">
  /**
   * Agent 经验：主审从 review、代码清理里总结的一句话规则，以后的 agent 都照着做，提出后马上生效。
   *
   * 先「通用」再按仓库分组，组标题显示生效中的条数与上限；已作废的收在每组下面，可以恢复。
   * 页面上只能作废、恢复：经验会写进给模型的提示词，改文字和手动新增只能在 Mac 上用 agentctl。
   * 生效中的已满时恢复会被 Mac 拒绝，原因显示在提示条上。
   *
   * 产品探索的「产品偏好」不在这里，在产品探索的流程页里。
   */
  import { onMount } from 'svelte';

  import { formatDate, formatFullTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { getLessons, lessonSourceLabel, type ILesson, type ILessonList } from './api';
  import AgentPage from './AgentPage.svelte';
  import { performCommand } from './command.svelte';
  import RuleList, { RULE_ACTION_LABEL, type IRuleGroup, type RuleAction } from './RuleList.svelte';

  /** 一组经验：某台机器的通用经验，或某个仓库的经验 */
  interface ILessonGroup extends IRuleGroup<ILesson> {
    machineId: string;
    /** 仓库的 owner/name；通用经验为 null */
    repo: string | null;
  }

  let list = $state<ILessonList | null>(null);
  let isLoading = $state(true);
  let errorText = $state<string | null>(null);

  const groups = $derived(list === null ? [] : groupLessons(list));

  /** 按机器、通用 / 仓库分组：通用在前，仓库按名字排；组内新的在前 */
  function groupLessons(data: ILessonList): ILessonGroup[] {
    const isMultiMachine = new Set(data.lessons.map((lesson) => lesson.machineId)).size > 1;
    const result = new Map<string, ILessonGroup>();
    for (const lesson of [...data.lessons].sort((a, b) => b.id - a.id)) {
      const repo = lesson.scope === 'repo' ? (lesson.repo ?? '') : null;
      const key = `${lesson.machineId}/${lesson.scope}/${repo ?? ''}`;
      let group = result.get(key);
      if (group === undefined) {
        const limits = data.limits.find((item) => item.machineId === lesson.machineId);
        const name = repo === null ? '通用' : repo === '' ? '未知仓库' : repo;
        group = {
          key,
          machineId: lesson.machineId,
          repo,
          title: isMultiMachine ? `${name}（${lesson.machineId}）` : name,
          limit: limits === undefined ? null : repo === null ? limits.global : limits.repo,
          active: [],
          voided: [],
        };
        result.set(key, group);
      }
      (lesson.status === 'active' ? group.active : group.voided).push(lesson);
    }
    return [...result.values()].sort(
      (a, b) =>
        a.machineId.localeCompare(b.machineId) ||
        (a.repo === null ? -1 : b.repo === null ? 1 : a.repo.localeCompare(b.repo)),
    );
  }

  /** 加载经验；isSilent 时不显示加载中 */
  async function load(isSilent = false): Promise<void> {
    if (!isSilent) {
      isLoading = true;
    }
    try {
      list = await getLessons();
      errorText = null;
    } catch (error) {
      errorText = errorMessage(error);
    } finally {
      isLoading = false;
    }
  }

  /** 作废（RuleList 已经确认过）或恢复一条经验；生效中的已满时恢复会被 Mac 拒绝 */
  async function act(lesson: ILesson, action: RuleAction): Promise<void> {
    const type = action === 'void' ? 'lesson.void' : 'lesson.restore';
    if (await performCommand(lesson.machineId, { type, payload: { id: lesson.id } }, `${RULE_ACTION_LABEL[action]} L${lesson.id}`)) {
      await load(true);
    }
  }

  onMount(() => {
    void load();
  });
</script>

{#snippet source(lesson: ILesson)}
  {#if lesson.sourceRunId !== null}
    <span><a class="link" href="/agents/runs/{lesson.machineId}/{lesson.sourceRunId}" title="提出它的运行：{lesson.sourceRunId}"
        >{lessonSourceLabel(lesson.source)}</a
      ></span>
  {:else}
    <span>{lessonSourceLabel(lesson.source)}</span>
  {/if}
{/snippet}

{#snippet hits(lesson: ILesson)}
  <span>
    命中 {lesson.hits} 次{#if lesson.lastHitAt !== null}，最近
      <time datetime={lesson.lastHitAt} title={formatFullTime(lesson.lastHitAt)}>{formatDate(lesson.lastHitAt)}</time>{/if}
  </span>
{/snippet}

{#snippet meta(lesson: ILesson, isVoided: boolean)}
  {#if isVoided}
    {#if lesson.replacedById !== null}<span>被 L{lesson.replacedById} 替换</span>{/if}
    {#if lesson.voidedAt !== null}
      <span><time datetime={lesson.voidedAt} title={formatFullTime(lesson.voidedAt)}>{formatDate(lesson.voidedAt)}</time>作废</span>
    {/if}
    {@render hits(lesson)}
    {@render source(lesson)}
  {:else}
    {@render hits(lesson)}
    {@render source(lesson)}
    {#if lesson.replacesId !== null}<span>替换了 L{lesson.replacesId}</span>{/if}
    <span><time datetime={lesson.createdAt} title={formatFullTime(lesson.createdAt)}>{formatDate(lesson.createdAt)}</time>加入</span>
  {/if}
{/snippet}

<AgentPage active="lessons" sub="主审总结的一句话规则，以后的 agent 都照着做，提出后马上生效">
  {#snippet actions()}
    <button class="btn" type="button" onclick={() => void load()} disabled={isLoading}>刷新</button>
  {/snippet}

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if list === null}
    {#if isLoading}<p class="empty">加载中…</p>{/if}
  {:else if groups.length === 0}
    <p class="empty">还没有经验。主审在 review、代码清理里发现值得记住的规则时会自动加上。</p>
  {:else}
    <RuleList {groups} prefix="L" voidHint="以后的 agent 不再照这条做" {meta} onAct={(lesson, action) => void act(lesson, action)} />
  {/if}

  <p class="muted note">
    经验提出后马上生效。页面上只能作废、恢复；改文字和手动加只能在 Mac 上用 <span class="mono">agentctl</span>。
    产品探索的「产品偏好」在<a class="link" href="/agents/ideas">想法</a>页里。
  </p>
</AgentPage>

<style>
  .note {
    font-size: 12px;
  }
</style>
