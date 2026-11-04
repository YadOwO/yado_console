<script lang="ts">
  /**
   * 运行列表：状态、实例、时间、结论，点进去看详情。总览的「最近运行」和运行记录页共用。
   */
  import { formatFullTime, formatTime } from '../../lib/format';
  import { durationText, runStatusClass, runStatusLabel, type IRunListItem } from './api';

  let { runs }: { runs: IRunListItem[] } = $props();

  /** 开始时间与耗时，如「昨天 23:16 · 9 分钟」 */
  function timeText(run: IRunListItem): string {
    const duration = durationText(run.startedAt, run.finishedAt);
    return duration === '' ? formatTime(run.queuedAt) : `${formatTime(run.queuedAt)} · ${duration}`;
  }
</script>

<ul class="list">
  {#each runs as run (`${run.machineId}/${run.id}`)}
    <li>
      <a class="row" href="/agents/runs/{run.machineId}/{run.id}">
        <div class="meta">
          <span class={runStatusClass(run.status)}>{runStatusLabel(run.status)}</span>
          <span class="instance">{run.instanceId}</span>
          {#if run.isDryRun}<span class="tag">演练</span>{/if}
          <time class="muted time" datetime={run.queuedAt} title={formatFullTime(run.queuedAt)}>
            {timeText(run)}
          </time>
        </div>
        <p class="summary">
          {#if run.reason !== null && run.status !== 'succeeded'}{run.reason}{:else}{run.summary ?? '（还没有结论）'}{/if}
        </p>
      </a>
    </li>
  {/each}
</ul>

<style>
  .list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    list-style: none;
  }

  .list li + li {
    border-top: 1px solid var(--line);
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 16px;
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
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

  .summary {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
</style>
