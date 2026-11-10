<script lang="ts">
  /**
   * 流程页仓库列表（.list）里的一行：仓库与分支、调度与下次运行、上次运行，右边是立即运行、暂停 / 恢复、设置、删除。
   * 一个流程的实例往往有好几个，一行压到两行高，一屏能同时看到仓库和最近运行；模式（推送 / 推新分支 / 只出想法）
   * 整个流程都一样，写在流程页标题旁边，不在每行重复。
   *
   * 一次实现每次都要带着需求在 Mac 上提，没有「立即运行」；挂系列文件夹的实例只能在 Mac 上建，这里也不提供删除。
   */
  import { formatFullTime, formatTime } from '../../lib/format';
  import {
    EXPLORE_FLOW,
    flowTitle,
    IMPLEMENT_FLOW,
    instanceLabel,
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

<!-- 左侧色条：绿=启用、灰=暂停，扫一眼就知道实例现在跑不跑 -->
<div class="instance bar" class:tone-muted={!instance.isEnabled} class:tone-resolved={instance.isEnabled}>
  <div class="instance-main">
    <div class="instance-head">
      <span class="repo" title={instance.repo}>{instanceLabel(instance)}</span>
      {#if !isSeries}<span class="tag">{instance.branch}</span>{/if}
      {#if !instance.isEnabled}<span class="status status-neutral">已暂停</span>{/if}
      <span class="instance-meta muted">
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
      </span>
    </div>
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
    {:else}
      <p class="last-run muted">还没有运行</p>
    {/if}
  </div>
  <div class="btn-row instance-actions">
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
    <button class="btn" type="button" aria-expanded={isEditing} onclick={() => (isEditing = !isEditing)}>
      {isEditing ? '收起' : '设置'}
    </button>
    {#if !isSeries}
      <button class="btn danger" type="button" disabled={commandState.isBusy} onclick={remove}>删除</button>
    {/if}
  </div>
  {#if isEditing}
    <div class="instance-edit">
      <InstanceForm
        {instance}
        {machines}
        onClose={() => (isEditing = false)}
        onSaved={() => {
          isEditing = false;
          onChanged();
        }}
      />
    </div>
  {/if}
</div>

<style>
  /* 左边两行（仓库与调度、上次运行），右边一排按钮竖直居中；设置表单占满整行 */
  .instance {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px 16px;
    padding: 10px 16px 10px 18px;
  }

  .instance.bar::before {
    top: 12px;
    bottom: 12px;
  }

  .instance-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .instance-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
    min-width: 0;
  }

  .repo {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .instance-meta {
    font-size: 12px;
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
    font-size: 13px;
  }

  .last-time {
    font-size: 12px;
    white-space: nowrap;
  }

  .last-summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  a.last-run:hover .last-summary {
    color: var(--fg);
    text-decoration: underline;
  }

  .instance-actions {
    flex-wrap: nowrap;
    gap: 6px;
  }

  .instance-actions .btn {
    height: 28px;
    padding: 0 10px;
    font-size: 13px;
  }

  .instance-edit {
    grid-column: 1 / -1;
    padding-top: 4px;
  }

  @media (max-width: 720px) {
    .instance {
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
    }

    .instance-actions {
      flex-wrap: wrap;
    }

    /* 手机上给上次运行的结论两行位置，不挤在一行截断 */
    .last-run {
      flex-wrap: wrap;
    }

    .last-summary {
      display: -webkit-box;
      flex-basis: 100%;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
  }
</style>
