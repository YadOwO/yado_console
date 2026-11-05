<script lang="ts">
  /**
   * Agent 经验：主审从 review、代码清理里总结的一句话规则，以后的 agent 都照着做，提出后马上生效。
   *
   * 先「通用」再按仓库分组，组标题显示生效中的条数与上限；已作废的收在每组下面，可以恢复。
   * 页面上只能作废、恢复：经验会写进给模型的提示词，改文字和手动新增只能在 Mac 上用 agentctl。
   * 生效中的已满时恢复会被 Mac 拒绝，原因显示在提示条上。
   */
  import { onMount } from 'svelte';

  import { formatDate, formatFullTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { getLessons, lessonSourceLabel, type ILesson, type ILessonList } from './api';
  import AgentTabs from './AgentTabs.svelte';
  import { commandState, performCommand } from './command.svelte';

  /** 一组经验：某台机器的通用经验，或某个仓库的经验 */
  interface ILessonGroup {
    key: string;
    machineId: string;
    /** 仓库的 owner/name；通用经验为 null */
    repo: string | null;
    title: string;
    /** 生效中经验的上限；旧版 agentd 没报时为 null */
    limit: number | null;
    active: ILesson[];
    voided: ILesson[];
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

  /** 作废一条经验，先确认 */
  async function voidLesson(lesson: ILesson): Promise<void> {
    if (!confirm(`作废 L${lesson.id}「${lesson.rule}」？以后的 agent 不再照这条做，可以在「已作废」里恢复。`)) {
      return;
    }
    if (await performCommand(lesson.machineId, { type: 'lesson.void', payload: { id: lesson.id } }, `作废 L${lesson.id}`)) {
      await load(true);
    }
  }

  /** 恢复一条已作废的经验；生效中的已满时 Mac 会拒绝 */
  async function restore(lesson: ILesson): Promise<void> {
    if (await performCommand(lesson.machineId, { type: 'lesson.restore', payload: { id: lesson.id } }, `恢复 L${lesson.id}`)) {
      await load(true);
    }
  }

  /** 生效中的是否已满 */
  function isFull(group: ILessonGroup): boolean {
    return group.limit !== null && group.active.length >= group.limit;
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

<section class="page">
  <header class="page-header">
    <h1>Agent</h1>
    <button class="btn" type="button" onclick={() => void load()} disabled={isLoading}>刷新</button>
  </header>
  <AgentTabs active="lessons" />

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if list === null}
    {#if isLoading}<p class="empty">加载中…</p>{/if}
  {:else if groups.length === 0}
    <p class="empty">还没有经验。主审在 review、代码清理里发现值得记住的规则时会自动加上。</p>
  {:else}
    {#each groups as group (group.key)}
      <div class="group">
        <div class="group-head">
          <h2>{group.title}</h2>
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
            {#each group.active as lesson (lesson.id)}
              <li class="lesson">
                <span class="mono muted id">L{lesson.id}</span>
                <p class="rule">
                  {lesson.rule}{#if lesson.reason !== null}<span class="reason">{lesson.reason}</span>{/if}
                </p>
                <button
                  class="btn row-btn"
                  type="button"
                  disabled={commandState.isBusy}
                  onclick={() => void voidLesson(lesson)}>作废</button
                >
                <p class="meta">
                  {@render hits(lesson)}
                  {@render source(lesson)}
                  {#if lesson.replacesId !== null}<span>替换了 L{lesson.replacesId}</span>{/if}
                  <span><time datetime={lesson.createdAt} title={formatFullTime(lesson.createdAt)}>{formatDate(lesson.createdAt)}</time>加入</span>
                </p>
              </li>
            {/each}
          </ul>
        {/if}

        {#if group.voided.length > 0}
          <details class="voided">
            <summary>已作废（{group.voided.length}）</summary>
            <ul class="list">
              {#each group.voided as lesson (lesson.id)}
                <li class="lesson">
                  <span class="mono muted id">L{lesson.id}</span>
                  <p class="rule">
                    {lesson.rule}{#if lesson.reason !== null}<span class="reason">{lesson.reason}</span>{/if}
                  </p>
                  <button
                    class="btn row-btn"
                    type="button"
                    title={isFull(group) ? '生效中的已满，Mac 会拒绝；先作废一条再恢复' : undefined}
                    disabled={commandState.isBusy}
                    onclick={() => void restore(lesson)}>恢复</button
                  >
                  <p class="meta">
                    {#if lesson.replacedById !== null}<span>被 L{lesson.replacedById} 替换</span>{/if}
                    {#if lesson.voidedAt !== null}
                      <span><time datetime={lesson.voidedAt} title={formatFullTime(lesson.voidedAt)}>{formatDate(lesson.voidedAt)}</time>作废</span>
                    {/if}
                    {@render hits(lesson)}
                    {@render source(lesson)}
                  </p>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>
    {/each}
  {/if}

  <p class="muted note">经验提出后马上生效。页面上只能作废、恢复；改文字和手动加只能在 Mac 上用 <span class="mono">agentctl</span>。</p>
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 960px;
    padding: 24px 24px 80px;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h1 {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .group-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .count {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .count.full {
    color: var(--pending);
  }

  .list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    list-style: none;
  }

  /* 一条两行：编号、规则（理由跟在后面）、按钮；下面一行是命中、来源与日期 */
  .lesson {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 2px 8px;
    padding: 8px 12px 8px 16px;
  }

  .lesson + .lesson {
    border-top: 1px solid var(--line);
  }

  .rule {
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
    height: 26px;
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

  .note {
    font-size: 12px;
  }

  @media (max-width: 720px) {
    .page {
      padding: 16px 16px 80px;
    }
  }
</style>
