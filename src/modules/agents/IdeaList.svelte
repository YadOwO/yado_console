<script lang="ts">
  /**
   * 产品探索的想法：主审定时看每个产品，提出接下来可以做什么，你决定采纳并开工、丢弃，或者自己做完了标成已实现，都可以写一句备注。放在顶部标签的「想法」页里。
   *
   * 按产品分组、按你在实例设置里排的先后，组标题显示没处理的条数与这个产品的上限；满了的产品下次探索会跳过，处理掉一条才会再想。
   * 采纳并开工：Mac 把想法加备注交给同一个系列的一次实现，做完推到新分支、进待办；已处理的那条能点进那次运行。
   * 已实现：你看了之后自己去做了、没走流程，只记下来，主审以后不会再提。
   * 想先聊清楚的，在 Mac 上用 /yado-implement I<编号>。
   * 你的处理和备注，主审下次探索前会看，可能总结成「产品偏好」（同一页下面）。
   * 已处理的收在每组下面，只有最近一部分。
   * 处理都是发指令给 Mac：点了确定就先从没处理的里拿掉，指令在后台发，可以接着看下一条；没成功的会放回来，备注还在。
   */
  import { onMount } from 'svelte';

  import { refreshBadges } from '../../lib/admin-status.svelte';
  import { formatDate, formatFullTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { getIdeas, IDEA_NOTE_MAX, IDEA_SIZE_LABEL, type CommandInput, type IIdea, type IIdeaList } from './api';
  import { submitCommand } from './command.svelte';
  import NotePanel from './NotePanel.svelte';

  /** 一组想法：某个产品探索实例下的一个产品 */
  interface IIdeaGroup {
    key: string;
    title: string;
    /** 这个产品没处理想法的上限；实例已删或旧版 agentd 时为 null */
    limit: number | null;
    /** 在实例设置里排的先后；没排过（旧版 agentd、PROJECTS.md 里已经没有的产品）时为 null */
    rank: number | null;
    open: IIdea[];
    decided: IIdea[];
  }

  /** 处理方式：adopted 是采纳并开工，done 是你自己做完了（没走流程） */
  type Decision = 'adopted' | 'discarded' | 'done';

  /** 按钮上的处理方式 */
  const DECISION_LABEL: Record<Decision, string> = { adopted: '采纳并开工', discarded: '丢弃', done: '已实现' };

  /** 备注框的提示：采纳并开工的备注会写进需求，其余的给主审以后参考 */
  const NOTE_PLACEHOLDER: Record<Decision, string> = {
    adopted: '备注（可选）：会写进需求',
    discarded: '备注（可选）：为什么不做，主审以后会参考',
    done: '备注（可选）：做在哪、和想法有什么不同，主审以后会参考',
  };

  /** 状态标签：已处理的列表里用 */
  const STATUS_LABEL: Record<IIdea['status'], string> = { open: '没处理', adopted: '采纳', discarded: '丢弃', done: '已实现' };

  let list = $state<IIdeaList | null>(null);
  let isLoading = $state(true);
  let errorText = $state<string | null>(null);
  /** 正在写备注的想法与打算的处理 */
  let deciding = $state<{ key: string; decision: Decision } | null>(null);
  let note = $state('');
  /** 已经点了确定、指令还在路上的想法（按 ideaKey），先不显示 */
  let hiddenKeys = $state.raw<readonly string[]>([]);
  /** 每次加载递增；连着处理几条时，先发的请求后回来不盖掉新的 */
  let loadVersion = 0;

  const groups = $derived(list === null ? [] : groupIdeas(list, hiddenKeys));
  const openCount = $derived(groups.reduce((sum, group) => sum + group.open.length, 0));

  /** 想法在页面上的唯一键 */
  function ideaKey(idea: IIdea): string {
    return `${idea.machineId}/${idea.id}`;
  }

  /**
   * 按机器、实例、产品分组。产品按你排的先后，没排过的放后面，其中有没处理的在前、再按名字；
   * 组内没处理的旧的在前，已处理的新处理的在前。
   */
  function groupIdeas(data: IIdeaList, hidden: readonly string[]): IIdeaGroup[] {
    const instanceCount = new Set(data.ideas.map((idea) => `${idea.machineId}/${idea.instanceId}`)).size;
    const result = new Map<string, IIdeaGroup>();
    for (const idea of data.ideas) {
      if (hidden.includes(ideaKey(idea))) {
        continue;
      }
      const key = `${idea.machineId}/${idea.instanceId}/${idea.product}`;
      let group = result.get(key);
      if (group === undefined) {
        const limit = data.limits.find((item) => item.machineId === idea.machineId && item.instanceId === idea.instanceId);
        // 旧版 hub 没有 products；旧版 agentd 报的是空数组
        const rank = limit?.products?.findIndex((item) => item.name === idea.product) ?? -1;
        group = {
          key,
          title: instanceCount > 1 ? `${idea.product}（${idea.instanceId}）` : idea.product,
          limit: limit?.products?.[rank]?.ideaLimit ?? limit?.ideaLimit ?? null,
          rank: rank < 0 ? null : rank,
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
    return [...result.values()].sort(
      (a, b) =>
        (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
        Number(b.open.length > 0) - Number(a.open.length > 0) ||
        a.title.localeCompare(b.title, 'zh-CN'),
    );
  }

  /** 加载想法 */
  async function load(): Promise<void> {
    const version = ++loadVersion;
    try {
      const data = await getIdeas();
      if (version === loadVersion) {
        list = data;
        errorText = null;
      }
    } catch (error) {
      if (version === loadVersion) {
        errorText = errorMessage(error);
      }
    } finally {
      isLoading = false;
    }
  }

  /** 打开备注框 */
  function openDecide(idea: IIdea, decision: Decision): void {
    deciding = { key: ideaKey(idea), decision };
    note = '';
  }

  /**
   * 采纳并开工、丢弃或标成已实现，带上备注。先从没处理的里拿掉，指令在后台发；
   * Mac 是先同步状态、再回报结果，所以成功后重新取一次，它就到「已处理」里了。
   */
  async function decide(idea: IIdea, decision: Decision): Promise<void> {
    const key = ideaKey(idea);
    const text = note.trim();
    const payload: { id: number; note?: string } = { id: idea.id };
    if (text !== '') {
      payload.note = text;
    }
    const command: CommandInput =
      decision === 'adopted' ? { type: 'idea.implement', payload } : { type: 'idea.decide', payload: { ...payload, decision } };
    deciding = null;
    hiddenKeys = [...hiddenKeys, key];
    const outcome = await submitCommand(idea.machineId, command, `${DECISION_LABEL[decision]} I${idea.id}`);
    if (outcome.isOk) {
      await load();
      refreshBadges();
    } else if (deciding === null) {
      // 没成功（原因在底部提示条上）：放回来，备注框照原样打开；你已经在写另一条时不打断
      deciding = { key, decision };
      note = text;
    }
    hiddenKeys = hiddenKeys.filter((item) => item !== key);
  }

  /** 没处理的是否已满 */
  function isFull(group: IIdeaGroup): boolean {
    return group.limit !== null && group.open.length >= group.limit;
  }

  onMount(() => {
    void load();
    refreshBadges();
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
      {#if openCount > 0}<span class="pill">{openCount} 条没处理</span>{/if}
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
            class="pill"
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
          <article class="idea card">
            <div class="idea-head">
              <span class="mono muted id-chip">I{idea.id}</span>
              <h4>{idea.title}</h4>
              <a class="muted time" href="/agents/runs/{idea.machineId}/{idea.runId}" title={formatFullTime(idea.createdAt)}
                >{formatDate(idea.createdAt)}</a
              >
            </div>
            {@render body(idea)}
            {#if deciding !== null && deciding.key === ideaKey(idea)}
              {@const decision = deciding.decision}
              <NotePanel
                bind:note
                tip={decision === 'adopted' && idea.questions.length > 0 ? '先在备注里回答上面的问题，没回答的按最稳妥的做法定' : null}
                placeholder={NOTE_PLACEHOLDER[decision]}
                label="备注"
                maxlength={IDEA_NOTE_MAX}
                confirmLabel="确定{DECISION_LABEL[decision]}"
                isPrimary={decision === 'adopted'}
                onCancel={() => (deciding = null)}
                onConfirm={() => void decide(idea, decision)}
              />
            {:else}
              <div class="btn-row">
                <button class="btn" type="button" onclick={() => openDecide(idea, 'discarded')}>丢弃</button>
                <button class="btn" type="button" onclick={() => openDecide(idea, 'done')}>已实现</button>
                <button class="btn btn-primary" type="button" onclick={() => openDecide(idea, 'adopted')}>采纳并开工</button>
              </div>
            {/if}
          </article>
        {/each}

        {#if group.decided.length > 0}
          <details class="fold">
            <summary>已处理（{group.decided.length}）</summary>
            <ul class="list">
              {#each group.decided as idea (ideaKey(idea))}
                <li>
                  <details class="done">
                    <summary>
                      <span class="mono muted id-chip">I{idea.id}</span>
                      <span class="status" class:status-resolved={idea.status !== 'discarded'} class:status-neutral={idea.status === 'discarded'}
                        >{STATUS_LABEL[idea.status]}</span
                      >
                      <span class="done-title">{idea.title}</span>
                      {#if idea.decidedAt !== null}
                        <time class="muted time" datetime={idea.decidedAt} title={formatFullTime(idea.decidedAt)}>{formatDate(idea.decidedAt)}</time>
                      {/if}
                    </summary>
                    <div class="done-body">
                      {#if idea.note !== null}<p class="note-text">备注：{idea.note}</p>{/if}
                      {#if idea.implementRunId}
                        <p class="hint"><a href="/agents/runs/{idea.machineId}/{idea.implementRunId}">已开工，看这次实现</a></p>
                      {:else if idea.status === 'adopted'}
                        <!-- 以前只采纳、没开工的 -->
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
      采纳并开工交给 Mac 上的一次实现，做完进待办；想先聊清楚的，用 <span class="mono">/yado-implement I编号</span>；自己做完了的点「已实现」。你的处理和备注，主审下次探索前会看，可能总结成下面的「产品偏好」。
    </p>
  {/if}
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .idea {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px 12px;
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

  .id-chip {
    flex-shrink: 0;
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

  /* 已处理的列表收在「已处理」下面，不用阴影 */
  .list {
    margin-top: 6px;
    box-shadow: none;
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

  /* 已开工的那条：点进一次实现的运行 */
  .hint a {
    text-decoration: underline;
  }
</style>
