<script lang="ts">
  /**
   * 产品探索的想法：主审定时看每个产品，提出接下来可以做什么，你决定采纳还是丢弃，都可以写一句备注。放在产品探索的流程页里。
   *
   * 按产品分组，组标题显示没处理的条数与上限；满了的产品下次探索会跳过，处理掉一条才会再想。
   * 采纳只是记下来，不会开工：要做的话在 Mac 上用 /yado-implement I<编号> 接着聊。
   * 你的处理和备注，主审下次探索前会看，可能总结成「产品偏好」（同一页下面）。
   * 已处理的收在每组下面，只有最近一部分。处理都是发指令给 Mac。
   */
  import { onMount } from 'svelte';

  import { refreshAdminStatus } from '../../lib/admin-status.svelte';
  import { formatDate, formatFullTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { getIdeas, IDEA_NOTE_MAX, IDEA_SIZE_LABEL, type IIdea, type IIdeaList } from './api';
  import { commandState, performCommand } from './command.svelte';

  /** 一组想法：某个产品探索实例下的一个产品 */
  interface IIdeaGroup {
    key: string;
    title: string;
    /** 每个产品没处理想法的上限；实例已删或旧版 agentd 时为 null */
    limit: number | null;
    open: IIdea[];
    decided: IIdea[];
  }

  /** 处理方式 */
  type Decision = 'adopted' | 'discarded';

  const DECISION_LABEL: Record<Decision, string> = { adopted: '采纳', discarded: '丢弃' };

  let list = $state<IIdeaList | null>(null);
  let isLoading = $state(true);
  let errorText = $state<string | null>(null);
  /** 正在写备注的想法与打算的处理 */
  let deciding = $state<{ key: string; decision: Decision } | null>(null);
  let note = $state('');

  const groups = $derived(list === null ? [] : groupIdeas(list));
  const openCount = $derived(groups.reduce((sum, group) => sum + group.open.length, 0));

  /** 想法在页面上的唯一键 */
  function ideaKey(idea: IIdea): string {
    return `${idea.machineId}/${idea.id}`;
  }

  /** 按机器、实例、产品分组，产品按名字排；没处理的旧的在前，已处理的新处理的在前 */
  function groupIdeas(data: IIdeaList): IIdeaGroup[] {
    const instanceCount = new Set(data.ideas.map((idea) => `${idea.machineId}/${idea.instanceId}`)).size;
    const result = new Map<string, IIdeaGroup>();
    for (const idea of data.ideas) {
      const key = `${idea.machineId}/${idea.instanceId}/${idea.product}`;
      let group = result.get(key);
      if (group === undefined) {
        const limit = data.limits.find((item) => item.machineId === idea.machineId && item.instanceId === idea.instanceId);
        group = {
          key,
          title: instanceCount > 1 ? `${idea.product}（${idea.instanceId}）` : idea.product,
          limit: limit?.ideaLimit ?? null,
          open: [],
          decided: [],
        };
        result.set(key, group);
      }
      (idea.status === 'open' ? group.open : group.decided).push(idea);
    }
    for (const group of result.values()) {
      group.open.sort((a, b) => a.id - b.id);
      group.decided.sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
    }
    // 有没处理的产品在前
    return [...result.values()].sort(
      (a, b) => Number(b.open.length > 0) - Number(a.open.length > 0) || a.title.localeCompare(b.title, 'zh-CN'),
    );
  }

  /** 加载想法 */
  async function load(): Promise<void> {
    try {
      list = await getIdeas();
      errorText = null;
    } catch (error) {
      errorText = errorMessage(error);
    } finally {
      isLoading = false;
    }
  }

  /** 打开备注框 */
  function openDecide(idea: IIdea, decision: Decision): void {
    deciding = { key: ideaKey(idea), decision };
    note = '';
  }

  /** 采纳或丢弃，带上备注 */
  async function decide(idea: IIdea, decision: Decision): Promise<void> {
    const text = note.trim();
    const payload: { id: number; decision: Decision; note?: string } = { id: idea.id, decision };
    if (text !== '') {
      payload.note = text;
    }
    if (await performCommand(idea.machineId, { type: 'idea.decide', payload }, `${DECISION_LABEL[decision]} I${idea.id}`)) {
      deciding = null;
      await load();
      refreshAdminStatus().catch(() => undefined);
    }
  }

  /** 没处理的是否已满 */
  function isFull(group: IIdeaGroup): boolean {
    return group.limit !== null && group.open.length >= group.limit;
  }

  onMount(() => {
    void load();
    refreshAdminStatus().catch(() => undefined);
  });
</script>

{#snippet body(idea: IIdea)}
  <p class="tags">
    <span class="tag">{IDEA_SIZE_LABEL[idea.size]}</span>
    {#each idea.repos as repo (repo)}<span class="tag mono">{repo}</span>{/each}
  </p>
  <div class="field">
    <span class="label">为什么</span>
    <p class="text">{idea.why}</p>
  </div>
  <div class="field">
    <span class="label">做什么</span>
    <p class="text">{idea.what}</p>
  </div>
  {#if idea.questions.length > 0}
    <div class="field">
      <span class="label">要你拿主意</span>
      <ol class="questions">
        {#each idea.questions as question, index (index)}<li>{question}</li>{/each}
      </ol>
    </div>
  {/if}
{/snippet}

<div class="block">
  <div class="section-header">
    <div class="section-title">
      <h2>想法</h2>
      {#if openCount > 0}<span class="section-count">{openCount} 条没处理</span>{/if}
    </div>
  </div>

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if list === null}
    {#if isLoading}<p class="empty">加载中…</p>{/if}
  {:else if groups.length === 0}
    <p class="empty">还没有想法。产品探索按时看每个产品，有值得做的会出现在这里。</p>
  {:else}
    {#each groups as group (group.key)}
      <div class="group">
        <div class="group-head">
          <h3>{group.title}</h3>
          <span
            class="count"
            class:full={isFull(group)}
            title={isFull(group)
              ? '没处理的满了，下次探索跳过这个产品'
              : group.limit === null
                ? `没处理 ${group.open.length} 条`
                : `没处理 ${group.open.length} 条，最多 ${group.limit} 条`}
          >
            {group.open.length}{group.limit === null ? '' : `/${group.limit}`}
          </span>
        </div>

        {#each group.open as idea (ideaKey(idea))}
          <article class="idea">
            <div class="idea-head">
              <span class="mono muted id">I{idea.id}</span>
              <h4>{idea.title}</h4>
              <a class="muted time" href="/agents/runs/{idea.machineId}/{idea.runId}" title={formatFullTime(idea.createdAt)}
                >{formatDate(idea.createdAt)}</a
              >
            </div>
            {@render body(idea)}
            {#if deciding !== null && deciding.key === ideaKey(idea)}
              {@const decision = deciding.decision}
              <div class="decide">
                <textarea
                  bind:value={note}
                  rows="2"
                  maxlength={IDEA_NOTE_MAX}
                  placeholder={decision === 'adopted' ? '备注（可选）：比如回答上面的问题、先做哪部分' : '备注（可选）：为什么不做，主审以后会参考'}
                  aria-label="备注"
                ></textarea>
                <div class="actions">
                  <button class="btn" type="button" onclick={() => (deciding = null)}>取消</button>
                  <button
                    class="btn"
                    class:btn-primary={decision === 'adopted'}
                    type="button"
                    disabled={commandState.isBusy}
                    onclick={() => void decide(idea, decision)}>确定{DECISION_LABEL[decision]}</button
                  >
                </div>
              </div>
            {:else}
              <div class="actions">
                <button class="btn" type="button" disabled={commandState.isBusy} onclick={() => openDecide(idea, 'discarded')}
                  >丢弃</button
                >
                <button
                  class="btn btn-primary"
                  type="button"
                  title="只是记下来，不会开工；要做的话在 Mac 上用 /yado-implement I{idea.id}"
                  disabled={commandState.isBusy}
                  onclick={() => openDecide(idea, 'adopted')}>采纳</button
                >
              </div>
            {/if}
          </article>
        {/each}

        {#if group.decided.length > 0}
          <details class="decided">
            <summary>已处理（{group.decided.length}）</summary>
            <ul class="list">
              {#each group.decided as idea (ideaKey(idea))}
                <li>
                  <details class="done">
                    <summary>
                      <span class="mono muted id">I{idea.id}</span>
                      <span class="status" class:status-resolved={idea.status === 'adopted'} class:status-neutral={idea.status === 'discarded'}
                        >{idea.status === 'adopted' ? '采纳' : '丢弃'}</span
                      >
                      <span class="done-title">{idea.title}</span>
                      {#if idea.decidedAt !== null}
                        <time class="muted time" datetime={idea.decidedAt} title={formatFullTime(idea.decidedAt)}>{formatDate(idea.decidedAt)}</time>
                      {/if}
                    </summary>
                    <div class="done-body">
                      {#if idea.note !== null}<p class="note-text">备注：{idea.note}</p>{/if}
                      {#if idea.status === 'adopted'}
                        <p class="muted hint">要做的话在 Mac 上用 <span class="mono">/yado-implement I{idea.id}</span></p>
                      {/if}
                      {@render body(idea)}
                    </div>
                  </details>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>
    {/each}
    <p class="muted footnote">
      采纳不会开工，要做的话在 Mac 上用 <span class="mono">/yado-implement I编号</span>。你的处理和备注，主审下次探索前会看，可能总结成下面的「产品偏好」。
    </p>
  {/if}
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 4px;
  }

  .section-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .section-count {
    padding: 0 8px;
    border-radius: 999px;
    background: var(--chip-bg);
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
    white-space: nowrap;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
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

  .idea {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }

  .idea-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  h4 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .id {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--chip-bg);
    line-height: 18px;
  }

  .time {
    flex-shrink: 0;
    margin-left: auto;
    font-size: 12px;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    color: var(--muted);
    font-size: 12px;
  }

  .text {
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .questions {
    margin: 0;
    padding-left: 20px;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .decide {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 10px;
    background: var(--surface-sunken);
  }

  textarea {
    width: 100%;
    min-height: 56px;
    max-height: 40vh;
    padding: 8px 12px;
    border: 1px solid var(--field-border);
    border-radius: 8px;
    background: var(--field);
    resize: vertical;
    field-sizing: content;
    transition: border-color 0.15s;
  }

  textarea:hover {
    border-color: var(--line-strong);
  }

  .decided > summary {
    width: fit-content;
    color: var(--muted);
    font-size: 13px;
    cursor: pointer;
  }

  .list {
    margin: 6px 0 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    list-style: none;
  }

  .list > li + li {
    border-top: 1px solid var(--line);
  }

  .done > summary {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 12px 10px 16px;
    cursor: pointer;
  }

  .done > summary:hover {
    background: var(--surface-hover);
  }

  .done-title {
    overflow-wrap: anywhere;
  }

  .done-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 16px 12px;
  }

  .note-text {
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--surface-sunken);
    overflow-wrap: anywhere;
  }

  .hint,
  .footnote {
    font-size: 12px;
  }

  @media (max-width: 720px) {
    .actions {
      justify-content: flex-start;
    }
  }
</style>
