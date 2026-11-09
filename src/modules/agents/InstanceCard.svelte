<script lang="ts">
  /**
   * 一个实例的卡片：仓库与分支、模式、调度与下次运行、上次运行，以及立即运行、暂停 / 恢复、设置、删除。
   *
   * 一次实现每次都要带着需求在 Mac 上提，没有「立即运行」；挂系列文件夹的实例只能在 Mac 上建，这里也不提供删除。
   */
  import { formatFullTime, formatTime } from '../../lib/format';
  import {
    EXPLORE_FLOW,
    flowTitle,
    IMPLEMENT_FLOW,
    runStatusClass,
    runStatusLabel,
    SERIES_FLOWS,
    shortSha,
    type CommandInput,
    type IInstance,
    type IMachine,
  } from './api';
  import { commandState, performCommand } from './command.svelte';
  import InstanceForm from './InstanceForm.svelte';

  let { instance, machines, onChanged }: { instance: IInstance; machines: IMachine[]; onChanged: () => void } = $props();

  let isEditing = $state(false);
  const isSeries = $derived(SERIES_FLOWS.has(instance.flowType));
  /** 产品探索各产品的想法上限；旧版 agentd 只有一个统一的上限 */
  const ideaLimits = $derived(instance.products?.map((item) => item.ideaLimit) ?? (instance.ideaLimit === null ? [] : [instance.ideaLimit]));

  /** 发一条针对这个实例的指令，成功后让上层刷新 */
  async function act(input: CommandInput, label: string): Promise<void> {
    if (await performCommand(instance.machineId, input, `${label} ${instance.repo}`)) {
      onChanged();
    }
  }

  /** 删除实例，先确认 */
  function remove(): void {
    if (confirm(`删除 ${instance.repo}（${instance.branch}）的${flowTitle(machines, instance.flowType)}？运行记录会保留，不修清单会清空。`)) {
      void act({ type: 'instance.delete', payload: { id: instance.id } }, '删除');
    }
  }
</script>

<article class="instance" class:paused={!instance.isEnabled} class:live={instance.isEnabled}>
  <div class="instance-head">
    <span class="repo">{instance.repo}</span>
    {#if !isSeries}<span class="tag">{instance.branch}</span>{/if}
    <span class="instance-state">
      {#if !instance.isEnabled}<span class="status status-neutral">已暂停</span>{/if}
      {#if instance.flowType === IMPLEMENT_FLOW}
        <span class="status status-resolved">推新分支</span>
      {:else if instance.flowType === EXPLORE_FLOW}
        <span class="status status-info">只出想法</span>
      {:else}
        <span class="status status-resolved">推送</span>
      {/if}
    </span>
  </div>
  <p class="instance-meta muted">
    {instance.scheduleText}
    {#if instance.isEnabled && instance.nextRunAt !== null}
      · 下次 <time datetime={instance.nextRunAt} title={formatFullTime(instance.nextRunAt)}>{formatTime(instance.nextRunAt)}</time>
    {/if}
    {#if instance.flowType === EXPLORE_FLOW}
      {#if ideaLimits.length > 0}
        {@const min = Math.min(...ideaLimits)}
        {@const max = Math.max(...ideaLimits)}
        · 每个产品最多 {min === max ? min : `${min}～${max}`} 条想法
      {/if}
      {#if instance.isWebEnabled === true}· 可以上网{/if}
    {:else if instance.flowType !== IMPLEMENT_FLOW}· 最多 {instance.maxRounds} 轮{/if}
    <!-- 代码清理没有「review 到哪」，cursor 恒为 null -->
    {#if instance.cursor !== null && instance.flowType !== 'cleanup'}
      · review 到 <span class="mono">{shortSha(instance.cursor)}</span>
    {/if}
  </p>
  {#if instance.lastRun !== null}
    <a
      class="last-run"
      href="/agents/runs/{instance.machineId}/{instance.lastRun.id}"
      title={instance.lastRun.reason ?? instance.lastRun.summary ?? undefined}
    >
      <span class={runStatusClass(instance.lastRun.status)}>{runStatusLabel(instance.lastRun.status)}</span>
      <span class="muted last-time">{formatTime(instance.lastRun.queuedAt)}</span>
      <span class="last-summary">{instance.lastRun.reason ?? instance.lastRun.summary ?? ''}</span>
    </a>
  {/if}
  <div class="actions">
    <!-- 一次实现每次都要带上需求，只能在 Mac 上用 agentctl implement 提 -->
    {#if instance.flowType !== IMPLEMENT_FLOW}
      <button
        class="btn"
        type="button"
        disabled={commandState.isBusy}
        onclick={() => void act({ type: 'instance.run', payload: { id: instance.id } }, '立即运行')}
      >
        立即运行
      </button>
    {/if}
    <button
      class="btn"
      type="button"
      disabled={commandState.isBusy}
      onclick={() =>
        void act(
          { type: 'instance.update', payload: { id: instance.id, isEnabled: !instance.isEnabled } },
          instance.isEnabled ? '暂停' : '恢复',
        )}
    >
      {instance.isEnabled ? '暂停' : '恢复'}
    </button>
    <button class="btn" type="button" onclick={() => (isEditing = !isEditing)}>{isEditing ? '收起' : '设置'}</button>
    {#if !isSeries}
      <button class="btn danger" type="button" disabled={commandState.isBusy} onclick={remove}>删除</button>
    {/if}
  </div>
  {#if isEditing}
    <InstanceForm
      {instance}
      {machines}
      onClose={() => (isEditing = false)}
      onSaved={() => {
        isEditing = false;
        onChanged();
      }}
    />
  {/if}
</article>

<style>
  .instance {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px 12px 20px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .instance:hover {
    border-color: var(--line-strong);
    box-shadow: var(--shadow-md);
  }

  /* 左侧色条：绿=启用、灰=暂停，扫一眼就知道实例现在跑不跑 */
  .instance::before {
    position: absolute;
    top: 14px;
    bottom: 14px;
    left: 0;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: transparent;
    content: '';
  }

  .instance.live::before {
    background: var(--resolved);
  }

  .instance.paused::before {
    background: var(--line-strong);
  }

  .instance-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .repo {
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .instance-state {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-left: auto;
  }

  .instance-meta {
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .instance-meta time,
  .instance-meta .mono {
    white-space: nowrap;
  }

  .last-run {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--surface-sunken);
  }

  .last-time {
    font-size: 12px;
    white-space: nowrap;
  }

  .last-summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .last-run:hover .last-summary {
    text-decoration: underline;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  .actions .btn {
    height: 30px;
    padding: 0 10px;
    font-size: 13px;
  }

  .btn.danger {
    color: var(--danger);
  }

  .btn.danger:hover:not(:disabled) {
    border-color: var(--danger);
  }

  @media (max-width: 720px) {
    .instance-state {
      margin-left: 0;
    }

    .actions {
      justify-content: flex-start;
    }

    /* 手机上给上次运行的结论两行位置，不挤在一行截断 */
    .last-run {
      flex-wrap: wrap;
    }

    .last-summary {
      display: -webkit-box;
      flex-basis: 100%;
      overflow: hidden;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
  }
</style>
