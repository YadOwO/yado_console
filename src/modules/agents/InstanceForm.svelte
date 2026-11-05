<script lang="ts">
  /**
   * 新建或修改实例。
   *
   * 新建：选机器、流程、仓库与开发分支、调度；换流程时按它的默认调度预填。新实例一律是演练模式，看过结果再改成推送。
   * 修改：只把改动过的字段发给 Mac。「允许推到会触发部署的分支」只能在 Mac 上改，这里不提供。
   */
  import { untrack } from 'svelte';

  import {
    BROWSER_TIMEZONE,
    IMPLEMENT_FLOW,
    ROLES,
    type IInstance,
    type IMachine,
    type Role,
    type Schedule,
    type UpdateInstancePayload,
  } from './api';
  import { commandState, performCommand } from './command.svelte';

  /** 流程没报默认调度时（旧版 agentd）用的：每天北京时间 18:00 */
  const FALLBACK_SCHEDULE: Schedule = { kind: 'daily', time: '18:00', timezone: 'Asia/Shanghai' };

  let {
    instance,
    machines,
    onClose,
    onSaved,
  }: {
    /** 要修改的实例；null 表示新建 */
    instance: IInstance | null;
    machines: IMachine[];
    onClose: () => void;
    onSaved: () => void;
  } = $props();

  // 表单只在打开时取一次初始值，之后总览刷新不会冲掉正在编辑的内容
  const initial = untrack(() => instance);
  const initialMachines = untrack(() => machines);
  const initialMachine =
    initialMachines.find((item) => item.id === initial?.machineId) ??
    initialMachines.find((item) => item.isOnline) ??
    initialMachines[0] ??
    null;
  const initialFlowType = initial?.flowType ?? initialMachine?.flows[0]?.type ?? 'review';
  const initialSchedule: Schedule = initial?.schedule ?? flowDefaultSchedule(initialMachine, initialFlowType) ?? FALLBACK_SCHEDULE;

  let machineId = $state(initial?.machineId ?? initialMachine?.id ?? '');
  const machine = $derived(machines.find((item) => item.id === machineId) ?? null);
  let flowType = $state(initialFlowType);
  let repo = $state('YadOwO/');
  let branch = $state(initial?.branch ?? 'dev');
  let scheduleKind = $state<Schedule['kind']>(initialSchedule.kind);
  let time = $state(initialSchedule.kind === 'daily' ? initialSchedule.time : '18:00');
  let timezone = $state('timezone' in initialSchedule ? initialSchedule.timezone : 'Asia/Shanghai');
  let minutes = $state(initialSchedule.kind === 'interval' ? initialSchedule.minutes : 60);
  let expression = $state(initialSchedule.kind === 'cron' ? initialSchedule.expression : '0 18 * * *');
  let isDryRun = $state(initial?.isDryRun ?? true);
  let maxRounds = $state(initial?.maxRounds ?? 2);
  /** 各角色单独指定的模型；空字符串表示跟随全局 */
  let models = $state<Record<Role, string>>({
    reviewer: initial?.models.reviewer ?? '',
    lead: initial?.models.lead ?? '',
    fixer: initial?.models.fixer ?? '',
  });
  let errorText = $state<string | null>(null);

  /** 代码清理：每周挑改得多的文件做不改行为的重构，没有「review 到哪」 */
  const isCleanup = $derived(flowType === 'cleanup');
  /** 一次实现：调度固定只手动，在 Mac 上用 agentctl 提需求；只推新分支，没有演练模式和轮数 */
  const isImplement = $derived(flowType === IMPLEMENT_FLOW);
  /** 推送的是什么：review 推修复，代码清理推重构 */
  const changeNoun = $derived(isCleanup ? '重构' : '修复');
  /** 新建时的说明 */
  const createHint = $derived(
    isImplement
      ? '在 Mac 上用 agentctl implement <实例> <需求> 提需求；主审问清楚后在待办里确认开工，实现完推到新分支 feat/…，不碰开发分支。'
      : isCleanup
      ? '每周挑最近改得多的几个文件做不改行为的小重构。新实例是演练模式：只出报告不推送，看过结果再改成推送。'
      : flowType === 'review'
        ? '新实例是演练模式：只出报告不推送，看过结果再改成推送。从现在的最新提交开始 review。'
        : '新实例是演练模式：只出报告不推送，看过结果再改成推送。',
  );

  /** 某台机器上某种流程的默认调度；旧版 agentd 没报时为 null */
  function flowDefaultSchedule(target: IMachine | null, type: string): Schedule | null {
    return target?.flows.find((flow) => flow.type === type)?.defaultSchedule ?? null;
  }

  /** 把调度填进表单 */
  function fillSchedule(schedule: Schedule): void {
    scheduleKind = schedule.kind;
    if (schedule.kind === 'daily') {
      time = schedule.time;
      timezone = schedule.timezone;
    } else if (schedule.kind === 'interval') {
      minutes = schedule.minutes;
    } else if (schedule.kind === 'cron') {
      expression = schedule.expression;
      timezone = schedule.timezone;
    }
  }

  /** 换流程：有默认调度就按它预填，没有就保留表单里现在的 */
  function selectFlow(type: string): void {
    flowType = type;
    const schedule = flowDefaultSchedule(machine, type);
    if (schedule !== null) {
      fillSchedule(schedule);
    }
  }

  /** 时区选项：北京时间、本机时区，以及实例当前用的时区 */
  const timezones = $derived(
    [...new Set(['Asia/Shanghai', BROWSER_TIMEZONE, timezone])].map((value) => ({
      value,
      label: value === 'Asia/Shanghai' ? '北京时间' : value === BROWSER_TIMEZONE ? `本机时区（${value}）` : value,
    })),
  );

  /** 按表单内容组装调度 */
  function buildSchedule(): Schedule {
    if (isImplement || scheduleKind === 'manual') {
      return { kind: 'manual' };
    }
    if (scheduleKind === 'daily') {
      return { kind: 'daily', time, timezone };
    }
    if (scheduleKind === 'interval') {
      return { kind: 'interval', minutes };
    }
    return { kind: 'cron', expression: expression.trim(), timezone };
  }

  /** 只收集改动过的字段；用户取消切换到推送时返回 null */
  function buildPatch(current: IInstance, schedule: Schedule): UpdateInstancePayload | null {
    const patch: UpdateInstancePayload = { id: current.id };
    if (branch.trim() !== current.branch) {
      patch.branch = branch.trim();
    }
    if (JSON.stringify(schedule) !== JSON.stringify(current.schedule)) {
      patch.schedule = schedule;
    }
    if (isDryRun !== current.isDryRun) {
      if (!isDryRun && !confirm(`改成推送后，复审通过的${changeNoun}会直接推到 ${branch.trim()}。确定吗？`)) {
        return null;
      }
      patch.isDryRun = isDryRun;
    }
    if (maxRounds !== current.maxRounds) {
      patch.maxRounds = maxRounds;
    }
    const modelPatch: Partial<Record<Role, string | null>> = {};
    for (const { role } of ROLES) {
      const next = models[role] === '' ? null : models[role];
      if (next !== (current.models[role] ?? null)) {
        modelPatch[role] = next;
      }
    }
    if (Object.keys(modelPatch).length > 0) {
      patch.models = modelPatch;
    }
    return patch;
  }

  /** 提交：发指令给 Mac，成功后关闭表单 */
  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    errorText = null;
    const schedule = buildSchedule();
    if (schedule.kind === 'interval' && (!Number.isInteger(schedule.minutes) || schedule.minutes < 5)) {
      errorText = '间隔至少 5 分钟';
      return;
    }
    if (branch.trim() === '') {
      errorText = '请填写开发分支';
      return;
    }

    let isOk: boolean;
    if (initial === null) {
      const name = repo.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(name)) {
        errorText = '仓库格式应为 owner/name，例如 YadOwO/yado_ai';
        return;
      }
      isOk = await performCommand(
        machineId,
        { type: 'instance.create', payload: { flowType, repo: name, branch: branch.trim(), schedule } },
        `新建 ${name}`,
      );
    } else {
      const patch = buildPatch(initial, schedule);
      if (patch === null) {
        return;
      }
      if (Object.keys(patch).length === 1) {
        onClose();
        return;
      }
      isOk = await performCommand(initial.machineId, { type: 'instance.update', payload: patch }, `修改 ${initial.repo}`);
    }
    if (isOk) {
      onSaved();
    }
  }
</script>

<form class="form" onsubmit={submit}>
  {#if initial === null}
    {#if machines.length > 1}
      <label class="field">
        <span>机器</span>
        <select bind:value={machineId}>
          {#each machines as option (option.id)}
            <option value={option.id}>{option.id}{option.isOnline ? '' : '（离线）'}</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="field">
      <span>流程</span>
      <select bind:value={() => flowType, selectFlow}>
        {#each machine?.flows ?? [] as flow (flow.type)}
          <option value={flow.type}>{flow.title}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>仓库</span>
      <input bind:value={repo} placeholder="YadOwO/yado_ai" autocomplete="off" spellcheck="false" />
    </label>
  {/if}

  <label class="field">
    <span>开发分支</span>
    <input bind:value={branch} autocomplete="off" spellcheck="false" />
  </label>
  {#if initial !== null && flowType === 'review' && branch.trim() !== initial.branch}
    <p class="hint">换分支后从新分支的最新提交开始 review。</p>
  {/if}

  {#if isImplement}
    <div class="field">
      <span>什么时候跑</span>
      <span class="muted">只手动：每次在 Mac 上带着需求提</span>
    </div>
  {:else}
  <div class="field">
    <span>什么时候跑</span>
    <div class="inline">
      <select bind:value={scheduleKind} aria-label="调度方式">
        <option value="daily">每天</option>
        <option value="interval">每隔</option>
        <option value="cron">cron</option>
      </select>
      {#if scheduleKind === 'daily'}
        <input type="time" bind:value={time} required aria-label="时间" />
      {:else if scheduleKind === 'interval'}
        <input class="narrow" type="number" min="5" step="5" bind:value={minutes} aria-label="分钟" />
        <span class="muted">分钟</span>
      {:else}
        <input class="mono" bind:value={expression} aria-label="cron 表达式" spellcheck="false" />
      {/if}
      {#if scheduleKind !== 'interval'}
        <select bind:value={timezone} aria-label="时区">
          {#each timezones as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      {/if}
    </div>
  </div>
  {#if scheduleKind === 'cron'}
    <p class="hint">cron 五段：分 时 日 月 周，例如 <span class="mono">0 4 * * 6</span> 是每周六 04:00。</p>
  {/if}
  {/if}

  {#if initial === null}
    <p class="hint">{createHint}</p>
  {:else}
    {#if !isImplement}
    <div class="field">
      <span>模式</span>
      <div class="segmented" role="group" aria-label="模式">
        <button type="button" aria-pressed={isDryRun} onclick={() => (isDryRun = true)}>演练</button>
        <button type="button" aria-pressed={!isDryRun} onclick={() => (isDryRun = false)}>推送</button>
      </div>
    </div>
    <p class="hint">演练只出报告；推送会把复审通过的{changeNoun}直接推到开发分支。</p>
    <label class="field">
      <span>最多几轮</span>
      <input class="narrow" type="number" min="1" max="5" bind:value={maxRounds} />
    </label>
    {/if}
    {#each ROLES as { role, label } (role)}
      <label class="field">
        <span>{label}模型</span>
        <select bind:value={models[role]}>
          <option value="">跟随全局（{machine?.settings?.models[role] ?? '—'}）</option>
          {#each [...new Set([...(machine?.models ?? []), ...(models[role] === '' ? [] : [models[role]])])] as model (model)}
            <option value={model}>{model}</option>
          {/each}
        </select>
      </label>
    {/each}
  {/if}

  {#if errorText !== null}
    <p class="error-banner">{errorText}</p>
  {/if}
  <div class="actions">
    <button class="btn" type="button" onclick={onClose}>取消</button>
    <button class="btn btn-primary" type="submit" disabled={commandState.isBusy || machineId === ''}>
      {initial === null ? '新建' : '保存'}
    </button>
  </div>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-sunken);
  }

  .field {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    max-width: 640px;
  }

  .field > span {
    color: var(--muted);
  }

  .field .segmented {
    justify-self: start;
  }

  .inline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .narrow {
    width: 80px;
  }

  .hint {
    margin-left: 100px;
    color: var(--muted);
    font-size: 12px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  @media (max-width: 720px) {
    .field {
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }

    .hint {
      margin-left: 0;
    }
  }
</style>
