<script lang="ts">
  /**
   * 运行列表：状态、实例、时间、结论，点进去看详情。流程页的「最近运行」和运行记录页共用。
   *
   * 实例显示仓库名（名字从各页面共用的总览里取），取不到时显示实例 ID；跨流程的列表传 isShowingFlow，每条前面带流程标签。
   *
   * 还没结束的运行多两行：这次做什么（一次实现的需求、发哪些仓库等），和现在在干什么（运行中是哪一步，排队中是在等什么）。
   * 结束了的只看结论，结论里已经写了做的是什么。
   */
  import { formatFullTime, formatTime } from '../../lib/format';
  import { durationText, isRunActive, runStatusClass, runStatusLabel, type IRunListItem } from './api';
  import { overviewState } from './overview-store.svelte';

  let {
    runs,
    isShowingFlow = false,
  }: {
    runs: IRunListItem[];
    /** 每条前面带不带流程标签：列表里混着几种流程时带 */
    isShowingFlow?: boolean;
  } = $props();

  /** 开始时间与耗时，如「昨天 23:16 · 9 分钟」；正在跑的写已经跑了多久 */
  function timeText(run: IRunListItem): string {
    if (run.status === 'running' && run.startedAt !== null) {
      return `${formatTime(run.queuedAt)} · 已跑 ${durationText(run.startedAt, new Date().toISOString())}`;
    }
    const duration = durationText(run.startedAt, run.finishedAt);
    return duration === '' ? formatTime(run.queuedAt) : `${formatTime(run.queuedAt)} · ${duration}`;
  }

  /** 还没结束、又知道现在在干什么的运行，显示这一句代替结论；运行中的前面加「正在」 */
  function activityText(run: IRunListItem): string | null {
    if (!isRunActive(run.status) || run.activity === null) {
      return null;
    }
    return run.status === 'running' ? `正在：${run.activity}` : run.activity;
  }
</script>

<ul class="list">
  {#each runs as run (`${run.machineId}/${run.id}`)}
    <li>
      <a class="row" href="/agents/runs/{run.machineId}/{run.id}">
        <div class="inline-row">
          <span class={runStatusClass(run.status)}>{runStatusLabel(run.status)}</span>
          {#if isShowingFlow}<span class="tag">{overviewState.flowTitles[run.flowType] ?? run.flowType}</span>{/if}
          <span class="instance">{overviewState.instanceLabels[run.instanceId] ?? run.instanceId}</span>
          <time class="muted time" datetime={run.queuedAt} title={formatFullTime(run.queuedAt)}>
            {timeText(run)}
          </time>
        </div>
        {#if isRunActive(run.status) && run.topic !== null}
          <p class="topic">{run.topic}</p>
        {/if}
        <p class="summary">
          {#if activityText(run) !== null}{activityText(run)}{:else if run.reason !== null && run.status !== 'succeeded'}{run.reason}{:else}{run.summary ?? '（还没有结论）'}{/if}
        </p>
      </a>
    </li>
  {/each}
</ul>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 12px 16px;
    transition: background-color 0.15s;
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .instance {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .time {
    margin-left: auto;
    font-size: 12px;
    white-space: nowrap;
  }

  .topic {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary {
    display: -webkit-box;
    overflow: hidden;
    color: var(--muted);
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
</style>
