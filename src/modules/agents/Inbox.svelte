<script lang="ts">
  /**
   * Agent 待办：主审交给你决定的问题，以及需要你看一下的运行（要你处理、失败、被中断）。
   *
   * 问题可以选「不修」（加进不修清单，以后同样的问题不再提）、「已处理」（你自己改了或决定不管），
   * 或「交给主审」：Mac 上另开一次运行，主审看最新代码在修和不修里选一个，可以先补充一段信息给它。
   * 一次实现做完的新功能（运行状态为成功）：选「不合」（feat 分支留着）、「合」（Mac 上合进开发分支）或「交给主审」（主审判合不合）。
   * 停下来的一次实现（Mac 判断能交给主审的，canDelegate）：「知道了」或「交给主审」，主审看停下的原因定处理办法，
   * 实现者照着改，都通过就推 feat 分支、作为新功能回到待办。其他运行只能「知道了」。
   * 等你点头的运行（发布计划待确认、发布要你确认、新功能改了项目规则要你确认）：看全文，同意或拒绝，可以写备注；页面不能改计划和命令。
   * 处理都是发指令给 Mac，成功后从列表里消失。
   */
  import { onMount } from 'svelte';

  import { refreshAdminStatus } from '../../lib/admin-status.svelte';
  import { formatFullTime, formatTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import { APPROVAL_NOTE_MAX, DELEGATE_NOTE_MAX, getOverview, runStatusClass, runStatusLabel, severityLabel, type IInboxItem } from './api';
  import AgentTabs from './AgentTabs.svelte';
  import { commandState, performCommand } from './command.svelte';

  let items = $state<IInboxItem[]>([]);
  let isLoading = $state(true);
  let errorText = $state<string | null>(null);
  /** 「交给主审」的说明 */
  const DELEGATE_HINT =
    '主审会看最新代码，在修和不修里选一个，不会再交回给你。选了修就照常修复、复审，通过了就推到开发分支；' +
    '选了不修就加进不修清单。结果在运行记录里看。';

  /** 停下来的一次实现「交给主审」的说明 */
  const RESCUE_DELEGATE_HINT =
    '主审看停下的原因和现在的代码，定怎么接着做完，实现者照着改；都通过就推到 feat 分支，作为新功能回到待办。' +
    '主审处理不了会说明要你做什么，再回到待办。';

  /** 新功能「交给主审」的说明 */
  const MERGE_DELEGATE_HINT =
    '主审看需求、重点关注和改动，只判合不合，不做代码 review。判合就合进开发分支；判不合会带着理由回到待办，你再选。';

  /**
   * 是不是一次实现做完的新功能：待办里只有它是成功状态的运行。
   * 这类待办选「合」或「交给主审」都会在 Mac 上另开一次运行。
   */
  function isDoneFeature(item: IInboxItem): boolean {
    return item.kind === 'run' && item.runStatus === 'succeeded';
  }

  /** 是不是停下来、能交给主审接着做的一次实现：由 Mac 判断 */
  function isRescuable(item: IInboxItem): boolean {
    return item.kind === 'run' && item.runStatus === 'needs_attention' && item.canDelegate === true;
  }

  /** 「交给主审」的说明：问题、新功能、停下来的一次实现各不一样 */
  function delegateHint(item: IInboxItem): string {
    if (isDoneFeature(item)) {
      return MERGE_DELEGATE_HINT;
    }
    return isRescuable(item) ? RESCUE_DELEGATE_HINT : DELEGATE_HINT;
  }

  /** 「交给主审」补充信息的提示 */
  function delegatePlaceholder(item: IInboxItem): string {
    if (isDoneFeature(item)) {
      return '补充信息（可选）：比如你最担心哪里';
    }
    return isRescuable(item) ? '补充信息（可选）：比如那段内容写到哪里' : '补充信息（可选）：比如回答上面主审的问题';
  }

  /** 同意或拒绝后会怎样：按等你点头的种类和决定；新功能的「合」也走这里确认 */
  function decideHint(item: IInboxItem, decision: 'approve' | 'reject'): string {
    if (isDoneFeature(item)) {
      return 'Mac 上把 feat 分支接到最新的开发分支，动过就再跑一遍检查，都通过才推上去，推上的删掉 feat 分支。没合成会回到待办。';
    }
    if (item.approvalKind === 'plan') {
      return decision === 'approve'
        ? 'Mac 上接着发：先确认 main 没动过，再按计划做服务器准备、快进 main、等部署跑完、检查线上。出问题就停下来再找你。'
        : '这次发布取消，什么都不做。备注会留在运行记录里。';
    }
    // 要你确认的事（发布时计划外的事、一次实现改了项目规则）：具体会怎样写在上面的全文里
    return decision === 'approve'
      ? '照上面写的去做，做完接着往下走。'
      : '不做这件事，接着往下走；怎么走看运行记录。';
  }

  /** 正在决定同意还是拒绝的待办，和选的决定 */
  let decidingId = $state<string | null>(null);
  let decision = $state<'approve' | 'reject'>('approve');

  /** 打开同意或拒绝的确认 */
  function openDecide(item: IInboxItem, value: 'approve' | 'reject'): void {
    delegatingId = null;
    decidingId = item.id;
    decision = value;
    note = '';
  }

  /** 同意或拒绝：Mac 上接着跑或取消 */
  async function decide(item: IInboxItem): Promise<void> {
    const text = note.trim();
    const payload: { itemId: string; action: 'approve' | 'reject'; note?: string } = { itemId: item.id, action: decision };
    if (text !== '') {
      payload.note = text;
    }
    const label = isDoneFeature(item) ? '合进开发分支' : decision === 'approve' ? '同意' : '拒绝';
    if (await performCommand(item.machineId, { type: 'inbox.resolve', payload }, label)) {
      decidingId = null;
      removeItem(item);
    }
  }

  /** 正在填写「交给主审」的待办 */
  let delegatingId = $state<string | null>(null);
  let note = $state('');

  /** 加载待办 */
  async function load(): Promise<void> {
    isLoading = true;
    try {
      items = (await getOverview()).inbox;
      errorText = null;
    } catch (error) {
      errorText = errorMessage(error);
    } finally {
      isLoading = false;
    }
  }

  /** 处理成功后从列表里去掉 */
  function removeItem(item: IInboxItem): void {
    items = items.filter((entry) => entry !== item);
    refreshAdminStatus().catch(() => undefined);
  }

  /** 处理一条待办；新功能的 done 就是「不合」 */
  async function resolve(item: IInboxItem, action: 'wontfix' | 'done'): Promise<void> {
    const label = action === 'wontfix' ? '标记不修' : isDoneFeature(item) ? '不合' : '标记已处理';
    if (await performCommand(item.machineId, { type: 'inbox.resolve', payload: { itemId: item.id, action } }, label)) {
      removeItem(item);
    }
  }

  /** 打开「交给主审」的补充信息 */
  function openDelegate(item: IInboxItem): void {
    decidingId = null;
    delegatingId = item.id;
    note = '';
  }

  /** 交给主审：Mac 上另开一次运行 */
  async function delegate(item: IInboxItem): Promise<void> {
    const text = note.trim();
    const payload: { itemId: string; action: 'delegate'; note?: string } = { itemId: item.id, action: 'delegate' };
    if (text !== '') {
      payload.note = text;
    }
    if (await performCommand(item.machineId, { type: 'inbox.resolve', payload }, '交给主审')) {
      delegatingId = null;
      removeItem(item);
    }
  }

  onMount(() => {
    void load();
    refreshAdminStatus().catch(() => undefined);
  });
</script>

<section class="page">
  <header class="page-header">
    <div class="page-title">
      <h1>Agent</h1>
      <p class="page-sub">主审交给你的问题、等你点头的发布，和需要你看一下的运行</p>
    </div>
    <button class="btn" type="button" onclick={() => void load()} disabled={isLoading}>刷新</button>
  </header>
  <AgentTabs active="inbox" />

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if isLoading && items.length === 0}
    <p class="empty">加载中…</p>
  {:else if items.length === 0 && errorText === null}
    <p class="empty">没有待办</p>
  {:else}
    <ul class="items">
      {#each items as item (`${item.machineId}/${item.id}`)}
        <li
          class="item"
          class:tone-pending={item.kind === 'finding' ||
            item.runStatus === 'needs_attention' ||
            item.runStatus === 'waiting' ||
            isDoneFeature(item)}
          class:tone-danger={item.runStatus === 'failed' || item.runStatus === 'interrupted'}
        >
          <div class="meta">
            {#if item.kind === 'finding'}
              <span class="status status-pending">要你决定</span>
              {#if item.severity !== null}<span class="tag">{severityLabel(item.severity)}</span>{/if}
            {:else if item.runStatus === 'waiting'}
              <span class="status status-pending">等你点头</span>
            {:else if isDoneFeature(item)}
              <span class="status status-pending">新功能</span>
            {:else if item.runStatus !== null}
              <span class={runStatusClass(item.runStatus)}>运行{runStatusLabel(item.runStatus)}</span>
            {/if}
            <a class="muted run-link" href="/agents/runs/{item.machineId}/{item.runId}">{item.instanceId}</a>
            <time class="muted time" datetime={item.createdAt} title={formatFullTime(item.createdAt)}>{formatTime(item.createdAt)}</time>
          </div>
          <p class="title">{item.title}</p>
          {#if item.location !== null}<p class="mono muted location">{item.location}</p>{/if}
          {#if item.detail !== null}<p class="detail">{item.detail}</p>{/if}
          {#if item.approvalText !== null}
            <details class="approval" open>
              <summary>{item.approvalKind === 'plan' ? '发布计划全文' : '要你确认的事'}</summary>
              <pre class="mono">{item.approvalText}</pre>
            </details>
          {/if}
          {#if decidingId === item.id}
            <div class="delegate">
              <p class="muted hint">{decideHint(item, decision)}</p>
              <textarea
                bind:value={note}
                rows="2"
                maxlength={APPROVAL_NOTE_MAX}
                placeholder={isDoneFeature(item)
                  ? '备注（可选）'
                  : decision === 'approve'
                    ? '备注（可选）：比如先发哪个'
                    : '备注（可选）：为什么不发'}
                aria-label="同意或拒绝的备注"
              ></textarea>
              <div class="actions">
                <button class="btn" type="button" onclick={() => (decidingId = null)}>取消</button>
                <button
                  class="btn"
                  class:btn-primary={decision === 'approve'}
                  type="button"
                  disabled={commandState.isBusy}
                  onclick={() => void decide(item)}
                  >{isDoneFeature(item) ? '确定合' : decision === 'approve' ? '确定同意' : '确定拒绝'}</button
                >
              </div>
            </div>
          {:else if delegatingId === item.id}
            <div class="delegate">
              <p class="muted hint">{delegateHint(item)}</p>
              <textarea
                bind:value={note}
                rows="3"
                maxlength={DELEGATE_NOTE_MAX}
                placeholder={delegatePlaceholder(item)}
                aria-label="补充给主审的信息"
              ></textarea>
              <div class="actions">
                <button class="btn" type="button" onclick={() => (delegatingId = null)}>取消</button>
                <button class="btn btn-primary" type="button" disabled={commandState.isBusy} onclick={() => void delegate(item)}
                  >交给主审</button
                >
              </div>
            </div>
          {:else}
            <div class="actions">
              {#if item.kind === 'finding'}
                <button
                  class="btn"
                  type="button"
                  title="加进不修清单，以后同样的问题不再提"
                  disabled={commandState.isBusy}
                  onclick={() => void resolve(item, 'wontfix')}>不修</button
                >
                <button
                  class="btn"
                  type="button"
                  title="让主审（Opus）看最新代码，在修和不修里选一个"
                  disabled={commandState.isBusy}
                  onclick={() => openDelegate(item)}>交给主审</button
                >
                <button
                  class="btn btn-primary"
                  type="button"
                  title="你已经处理了，或者决定不管"
                  disabled={commandState.isBusy}
                  onclick={() => void resolve(item, 'done')}>已处理</button
                >
              {:else if item.runStatus === 'waiting'}
                <button class="btn" type="button" disabled={commandState.isBusy} onclick={() => openDecide(item, 'reject')}
                  >拒绝</button
                >
                <button class="btn btn-primary" type="button" disabled={commandState.isBusy} onclick={() => openDecide(item, 'approve')}
                  >同意</button
                >
              {:else if isDoneFeature(item)}
                <button
                  class="btn"
                  type="button"
                  title="不进开发分支，feat 分支留着"
                  disabled={commandState.isBusy}
                  onclick={() => void resolve(item, 'done')}>不合</button
                >
                <button
                  class="btn"
                  type="button"
                  title="让主审（Opus）看需求和改动，判合不合"
                  disabled={commandState.isBusy}
                  onclick={() => openDelegate(item)}>交给主审</button
                >
                <button class="btn btn-primary" type="button" disabled={commandState.isBusy} onclick={() => openDecide(item, 'approve')}
                  >合</button
                >
              {:else if isRescuable(item)}
                <button class="btn" type="button" disabled={commandState.isBusy} onclick={() => void resolve(item, 'done')}
                  >知道了</button
                >
                <button
                  class="btn btn-primary"
                  type="button"
                  title="让主审（Opus）看停下的原因，定处理办法，实现者照着改完接着推"
                  disabled={commandState.isBusy}
                  onclick={() => openDelegate(item)}>交给主审</button
                >
              {:else}
                <button class="btn" type="button" disabled={commandState.isBusy} onclick={() => void resolve(item, 'done')}
                  >知道了</button
                >
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 24px 80px;
  }

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .page-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .page-sub {
    color: var(--muted);
    font-size: 13px;
  }

  h1 {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 14px 16px 12px 20px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }

  /* 左侧色条：橙=要你决定，红=运行失败或被中断 */
  .item::before {
    position: absolute;
    top: 14px;
    bottom: 14px;
    left: 0;
    width: 3px;
    background: var(--line-strong);
    content: '';
  }

  .item.tone-pending::before {
    background: var(--pending);
  }

  .item.tone-danger::before {
    background: var(--danger);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .run-link {
    text-decoration: underline;
    overflow-wrap: anywhere;
  }

  .time {
    margin-left: auto;
    font-size: 12px;
  }

  .title {
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .location {
    display: inline-block;
    max-width: 100%;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--surface-sunken);
    overflow-wrap: anywhere;
  }

  .detail {
    padding: 8px 10px;
    /* 一次实现完成后的说明有好几行（分支、重点关注） */
    white-space: pre-line;
    border-radius: 8px;
    background: var(--surface-sunken);
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .approval summary {
    color: var(--muted);
    font-size: 13px;
    cursor: pointer;
  }

  .approval pre {
    max-height: 60vh;
    margin: 6px 0 0;
    padding: 10px 12px;
    overflow: auto;
    border-radius: 8px;
    background: var(--surface-sunken);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .delegate {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 2px;
    padding: 12px;
    border-radius: 10px;
    background: var(--surface-sunken);
  }

  .hint {
    font-size: 12px;
  }

  textarea {
    width: 100%;
    min-height: 72px;
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

  @media (max-width: 720px) {
    .page {
      padding: 16px 16px 80px;
    }

    .actions {
      justify-content: flex-start;
    }
  }
</style>
