<script lang="ts">
  /**
   * 一次运行的详情：结论、问题与主审的判断、每一步、时间线。
   *
   * hub 只有摘要；问题详情、修复说明和 diff 在 Mac 上，用 agentctl report <运行 ID> 看完整报告。
   * 运行没结束时每 5 秒刷新一次，并可以取消。
   */
  import { onMount } from 'svelte';

  import { formatFullTime, formatTime } from '../../lib/format';
  import { errorMessage } from '../../lib/http';
  import {
    compactNumber,
    durationText,
    getRun,
    isRunActive,
    runStatusClass,
    runStatusLabel,
    severityLabel,
    shortSha,
    triggerLabel,
    verdictLabel,
    type IFinding,
    type IRunDetail,
  } from './api';
  import { commandState, performCommand } from './command.svelte';

  let { machineId, runId }: { machineId: string; runId: string } = $props();

  /** 自动刷新间隔（运行没结束时） */
  const REFRESH_INTERVAL_MS = 5000;

  /** 问题按主审的判断分组，交给你的排最前 */
  const GROUPS: { verdict: string | null; title: string }[] = [
    { verdict: 'escalate', title: '交给你' },
    { verdict: 'fix', title: '修' },
    { verdict: 'wontfix', title: '不修' },
    { verdict: null, title: '还没判' },
  ];

  let run = $state<IRunDetail | null>(null);
  let errorText = $state<string | null>(null);

  const groups = $derived(
    GROUPS.map((group) => ({
      ...group,
      findings: (run?.findings ?? []).filter((finding) => finding.verdict === group.verdict),
    })).filter((group) => group.findings.length > 0),
  );

  /** 加载详情 */
  async function load(): Promise<void> {
    try {
      run = await getRun(machineId, runId);
      errorText = null;
    } catch (error) {
      errorText = errorMessage(error);
    }
  }

  /** 取消运行 */
  async function cancel(): Promise<void> {
    if (confirm('取消这次运行？已经做完的步骤不会回滚，没推送的修复会丢掉。')) {
      if (await performCommand(machineId, { type: 'run.cancel', payload: { runId } }, '取消运行')) {
        await load();
      }
    }
  }

  /** 标题下面的一行：触发方式、开始时间、耗时、轮数 */
  function metaText(detail: IRunDetail): string {
    const parts = [triggerLabel(detail.trigger), formatTime(detail.queuedAt)];
    const duration = durationText(detail.startedAt, detail.finishedAt);
    if (duration !== '') {
      parts.push(duration);
    }
    parts.push(`${detail.rounds} 轮`);
    return parts.join(' · ');
  }

  /** 问题的位置 */
  function location(finding: IFinding): string {
    return finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && run !== null && isRunActive(run.status)) {
        void load();
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  });
</script>

<section class="page">
  <a class="back muted" href="/agents/runs">← 运行记录</a>

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}

  {#if run === null}
    {#if errorText === null}<p class="empty">加载中…</p>{/if}
  {:else}
    <header class="head">
      <div class="title-row">
        <h1>{run.instanceId}</h1>
        <span class={runStatusClass(run.status)}>{runStatusLabel(run.status)}</span>
        {#if run.isDryRun}<span class="tag">演练</span>{/if}
        {#if isRunActive(run.status)}
          <button class="btn danger" type="button" disabled={commandState.isBusy} onclick={() => void cancel()}>取消</button>
        {/if}
      </div>
      <p class="muted" title={formatFullTime(run.queuedAt)}><span class="mono">{run.id}</span> · {metaText(run)}</p>
    </header>

    {#if run.summary !== null || run.reason !== null}
      <div class="card">
        {#if run.summary !== null}<p>{run.summary}</p>{/if}
        {#if run.reason !== null}<p class="reason">{run.reason}</p>{/if}
      </div>
    {/if}

    <dl class="facts">
      {#if run.delegatedFrom !== null}
        <dt>来自</dt>
        <dd><a class="mono" href="/agents/runs/{machineId}/{run.delegatedFrom}">{run.delegatedFrom}</a> 里交给你的问题</dd>
        <dt>基于提交</dt>
        <dd class="mono">{shortSha(run.headCommit)}</dd>
      {:else}
        <dt>提交范围</dt>
        <dd class="mono">{shortSha(run.baseCommit)}..{shortSha(run.headCommit)}</dd>
      {/if}
      <dt>推送</dt>
      <dd class:mono={run.pushedCommit !== null}>{run.pushedCommit === null ? (run.isDryRun ? '演练不推送' : '没有推送') : shortSha(run.pushedCommit)}</dd>
      <dt>tokens</dt>
      <dd>输入 {compactNumber(run.inputTokens)} · 输出 {compactNumber(run.outputTokens)}</dd>
    </dl>

    {#each groups as group (group.title)}
      <h2>{group.title}（{group.findings.length}）</h2>
      <ul class="list">
        {#each group.findings as finding (finding.id)}
          <li class="finding">
            <div class="meta">
              <span class="mono muted">{finding.ref}</span>
              <span class="tag">{severityLabel(finding.severity)}</span>
              <span class="title">{finding.title}</span>
              {#if finding.resolution === 'delegated' && finding.delegatedRunId !== null}
                <a class="status status-resolved" href="/agents/runs/{machineId}/{finding.delegatedRunId}">已交给主审 →</a>
              {:else if finding.resolution !== null}
                <span class="status status-resolved">{finding.resolution === 'wontfix' ? '你选了不修' : '已处理'}</span>
              {/if}
            </div>
            <p class="mono muted location">{location(finding)}</p>
            {#if finding.reason !== null}<p class="reason">{verdictLabel(finding.verdict)}：{finding.reason}</p>{/if}
            {#if finding.fixCommit !== null}<p class="muted">修复提交 <span class="mono">{shortSha(finding.fixCommit)}</span></p>{/if}
          </li>
        {/each}
      </ul>
    {/each}

    <h2>步骤</h2>
    <ul class="list">
      {#each run.steps as step (step.key)}
        <li class="step">
          <span class="mono step-key">{step.key}</span>
          <span class="step-model muted">{step.model ?? ''}</span>
          <span class={step.status === 'failed' ? 'status status-danger' : step.status === 'running' ? 'status status-neutral' : 'muted'}>
            {step.status === 'succeeded' ? durationText(step.startedAt, step.finishedAt) : step.status === 'failed' ? '失败' : '进行中'}
          </span>
          {#if step.error !== null}<p class="step-error">{step.error}</p>{/if}
        </li>
      {/each}
    </ul>

    {#if run.events.length > 0}
      <details class="card">
        <summary>时间线（{run.events.length}）</summary>
        <ol class="events">
          {#each run.events as event (event.id)}
            <li>
              <time class="mono muted" datetime={event.at} title={formatFullTime(event.at)}>{formatTime(event.at)}</time>
              <span>{event.message}</span>
            </li>
          {/each}
        </ol>
      </details>
    {/if}

    <p class="muted note">问题详情、修复说明和 diff 只在 Mac 上：<span class="mono">agentctl report {run.id}</span></p>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 960px;
    padding: 24px 24px 80px;
  }

  .back {
    align-self: flex-start;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  h1 {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }

  h2 {
    margin-top: 6px;
    font-size: 15px;
    font-weight: 600;
  }

  .btn.danger {
    margin-left: auto;
    color: var(--danger);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .card summary {
    cursor: pointer;
    font-weight: 500;
  }

  .reason {
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 4px 16px;
    margin: 0;
  }

  .facts dt {
    color: var(--muted);
  }

  .facts dd {
    margin: 0;
  }

  .facts a {
    text-decoration: underline;
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

  .list li {
    padding: 10px 16px;
  }

  .list li + li {
    border-top: 1px solid var(--line);
  }

  .finding {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .title {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .location {
    overflow-wrap: anywhere;
  }

  .step {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
  }

  .step-key {
    min-width: 96px;
  }

  .step-model {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .step-error {
    flex-basis: 100%;
    color: var(--danger);
    overflow-wrap: anywhere;
  }

  .events {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }

  .events li {
    display: flex;
    gap: 12px;
  }

  .events time {
    flex-shrink: 0;
  }

  .events span {
    overflow-wrap: anywhere;
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
