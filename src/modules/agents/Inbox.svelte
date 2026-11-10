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
   *
   * 待办按实例（仓库或系列文件夹）分组，组标题写仓库名和流程。页面打开期间每 10 秒自己刷新一次。
   * 处理都是发指令给 Mac：点了就先从列表里拿掉，指令在后台发，可以接着处理下一条，不用等 Mac 回话；
   * 没成功的那条会回到列表里，写明原因，写过的备注还在。
   */
  import { onMount } from 'svelte';

  import { formatFullTime, formatTime } from '../../lib/format';
  import {
    APPROVAL_NOTE_MAX,
    DELEGATE_NOTE_MAX,
    flowTitle,
    instanceLabel,
    runStatusClass,
    runStatusLabel,
    severityLabel,
    type IInboxItem,
  } from './api';
  import AgentPage from './AgentPage.svelte';
  import { submitCommand } from './command.svelte';
  import NotePanel from './NotePanel.svelte';
  import { hideInboxItem, inboxKey, overviewState, refreshOverview, showInboxItem, visibleInbox, watchOverview } from './overview-store.svelte';

  /** 一组待办：同一个实例（仓库或系列文件夹）的 */
  interface IInboxGroup {
    key: string;
    /** 仓库名或系列文件夹；实例已经删掉时是实例 ID */
    title: string;
    /** 流程的中文名；实例已经删掉时为 null */
    flow: string | null;
    items: IInboxItem[];
  }

  /** 要先写备注的处理：交给主审、同意、拒绝 */
  type PanelMode = 'delegate' | 'approve' | 'reject';

  /** 能对一条待办做的处理 */
  type Action = 'wontfix' | 'done' | 'delegate' | 'approve' | 'reject';

  /** 按实例分组，组和组内都保持 hub 给的先后 */
  const groups = $derived.by(() => {
    const overview = overviewState.value;
    const result = new Map<string, IInboxGroup>();
    for (const item of visibleInbox()) {
      const key = `${item.machineId}/${item.instanceId}`;
      let group = result.get(key);
      if (group === undefined) {
        const instance = overview?.instances.find((entry) => entry.machineId === item.machineId && entry.id === item.instanceId);
        group = {
          key,
          title: instance === undefined ? item.instanceId : instanceLabel(instance),
          flow: instance === undefined ? null : flowTitle(overview?.machines ?? [], instance.flowType),
          items: [],
        };
        result.set(key, group);
      }
      group.items.push(item);
    }
    return [...result.values()];
  });

  /** 没处理成功的待办（按 inboxKey）：原因，和当时写的备注（重新打开时填回去） */
  let failures = $state<Record<string, { text: string; note: string }>>({});

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

  /** 备注框里的提示：交给主审是补充信息，同意或拒绝是备注 */
  function notePlaceholder(item: IInboxItem, mode: PanelMode): string {
    if (mode === 'delegate') {
      if (isDoneFeature(item)) {
        return '补充信息（可选）：比如你最担心哪里';
      }
      return isRescuable(item) ? '补充信息（可选）：比如那段内容写到哪里' : '补充信息（可选）：比如回答上面主审的问题';
    }
    if (isDoneFeature(item)) {
      return '备注（可选）';
    }
    return mode === 'approve' ? '备注（可选）：比如先发哪个' : '备注（可选）：为什么不发';
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

  /** 正在写备注的待办（按 inboxKey），和打算做的事：交给主审、同意或拒绝 */
  let panel = $state<{ key: string; mode: PanelMode } | null>(null);
  let note = $state('');

  /** 打开备注框；上次没处理成功的，把当时写的备注填回去 */
  function openPanel(item: IInboxItem, mode: PanelMode): void {
    const key = inboxKey(item);
    panel = { key, mode };
    note = failures[key]?.note ?? '';
  }

  /**
   * 处理一条待办：先从列表里拿掉，指令在后台发。
   * Mac 是先同步状态、再回报结果，所以成功后刷新一次总览，hub 上那条就没了；没成功就放回列表并写明原因。
   */
  async function send(item: IInboxItem, action: Action, label: string, noteText = ''): Promise<void> {
    const key = inboxKey(item);
    const payload: { itemId: string; action: Action; note?: string } = { itemId: item.id, action };
    if (noteText !== '') {
      payload.note = noteText;
    }
    if (panel?.key === key) {
      panel = null;
    }
    delete failures[key];
    hideInboxItem(key);
    const outcome = await submitCommand(item.machineId, { type: 'inbox.resolve', payload }, label);
    if (outcome.isOk) {
      await refreshOverview({ isFresh: true });
    } else {
      failures[key] = { text: outcome.text, note: noteText };
    }
    showInboxItem(key);
  }

  /** 不修、已处理、知道了；新功能的 done 就是「不合」 */
  function resolve(item: IInboxItem, action: 'wontfix' | 'done'): void {
    const label = action === 'wontfix' ? '标记不修' : isDoneFeature(item) ? '不合' : '标记已处理';
    void send(item, action, label);
  }

  /** 备注面板上面的说明：点了确定会怎样 */
  function panelHint(item: IInboxItem, mode: PanelMode): string {
    return mode === 'delegate' ? delegateHint(item) : decideHint(item, mode);
  }

  /** 备注面板确定按钮上的字 */
  function confirmLabel(item: IInboxItem, mode: PanelMode): string {
    if (mode === 'delegate') {
      return '交给主审';
    }
    return isDoneFeature(item) ? '确定合' : mode === 'approve' ? '确定同意' : '确定拒绝';
  }

  /** 备注面板上点了确定：交给主审（Mac 上另开一次运行），同意或拒绝（Mac 上接着跑或取消；新功能的同意就是「合」） */
  function confirmPanel(item: IInboxItem, mode: PanelMode): void {
    const label = mode === 'delegate' ? '交给主审' : isDoneFeature(item) ? '合进开发分支' : mode === 'approve' ? '同意' : '拒绝';
    void send(item, mode, label, note.trim());
  }

  onMount(() => watchOverview());
</script>

<AgentPage active="inbox" sub="主审交给你的问题、等你点头的发布，和需要你看一下的运行">
  {#snippet actions()}
    <button class="btn" type="button" onclick={() => void refreshOverview({ isSilent: false })} disabled={overviewState.isLoading}
      >刷新</button
    >
  {/snippet}

  {#if overviewState.errorText !== null}
    <p class="error-banner">{overviewState.errorText}</p>
  {/if}

  {#if overviewState.value === null}
    {#if overviewState.errorText === null}<p class="empty">加载中…</p>{/if}
  {:else if groups.length === 0}
    <p class="empty">没有待办</p>
  {:else}
    {#each groups as group (group.key)}
      <div class="group-head">
        <h2>{group.title}</h2>
        {#if group.flow !== null}<span class="tag">{group.flow}</span>{/if}
        <span class="muted group-count">{group.items.length} 条</span>
      </div>
      <ul class="items">
        {#each group.items as item (inboxKey(item))}
          {@const key = inboxKey(item)}
          <li
            class="item card bar"
            class:tone-pending={item.kind === 'finding' ||
              item.runStatus === 'needs_attention' ||
              item.runStatus === 'waiting' ||
              isDoneFeature(item)}
            class:tone-danger={item.runStatus === 'failed' || item.runStatus === 'interrupted'}
          >
            <div class="inline-row">
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
              <a class="muted link" href="/agents/runs/{item.machineId}/{item.runId}">看这次运行</a>
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
            {#if failures[key] !== undefined}
              <p class="error-banner">没处理成功，这条还在。{failures[key].text}</p>
            {/if}
            {#if panel !== null && panel.key === key}
              {@const mode = panel.mode}
              <NotePanel
                bind:note
                hint={panelHint(item, mode)}
                placeholder={notePlaceholder(item, mode)}
                label={mode === 'delegate' ? '补充给主审的信息' : '同意或拒绝的备注'}
                maxlength={mode === 'delegate' ? DELEGATE_NOTE_MAX : APPROVAL_NOTE_MAX}
                rows={mode === 'delegate' ? 3 : 2}
                confirmLabel={confirmLabel(item, mode)}
                isPrimary={mode !== 'reject'}
                onCancel={() => (panel = null)}
                onConfirm={() => confirmPanel(item, mode)}
              />
            {:else}
              <div class="btn-row">
                {#if item.kind === 'finding'}
                  <button class="btn" type="button" title="加进不修清单，以后同样的问题不再提" onclick={() => resolve(item, 'wontfix')}
                    >不修</button
                  >
                  <button
                    class="btn"
                    type="button"
                    title="让主审（Opus）看最新代码，在修和不修里选一个"
                    onclick={() => openPanel(item, 'delegate')}>交给主审</button
                  >
                  <button class="btn btn-primary" type="button" title="你已经处理了，或者决定不管" onclick={() => resolve(item, 'done')}
                    >已处理</button
                  >
                {:else if item.runStatus === 'waiting'}
                  <button class="btn" type="button" onclick={() => openPanel(item, 'reject')}>拒绝</button>
                  <button class="btn btn-primary" type="button" onclick={() => openPanel(item, 'approve')}>同意</button>
                {:else if isDoneFeature(item)}
                  <button class="btn" type="button" title="不进开发分支，feat 分支留着" onclick={() => resolve(item, 'done')}>不合</button>
                  <button class="btn" type="button" title="让主审（Opus）看需求和改动，判合不合" onclick={() => openPanel(item, 'delegate')}
                    >交给主审</button
                  >
                  <button class="btn btn-primary" type="button" onclick={() => openPanel(item, 'approve')}>合</button>
                {:else if isRescuable(item)}
                  <button class="btn" type="button" onclick={() => resolve(item, 'done')}>知道了</button>
                  <button
                    class="btn btn-primary"
                    type="button"
                    title="让主审（Opus）看停下的原因，定处理办法，实现者照着改完接着推"
                    onclick={() => openPanel(item, 'delegate')}>交给主审</button
                  >
                {:else}
                  <button class="btn" type="button" onclick={() => resolve(item, 'done')}>知道了</button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</AgentPage>

<style>
  /* 组标题：仓库名 + 流程 + 条数 */
  .group-head {
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .group-count {
    font-size: 12px;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* 左侧色条（.bar）：橙=要你决定，红=运行失败或被中断 */
  .item {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 14px 16px 12px 20px;
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
</style>
