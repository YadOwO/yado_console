<script lang="ts">
  /**
   * 一台机器的全局设置：同时最多跑几个、各角色默认模型、运行材料保留天数、暂停某类流程。
   *
   * 只把改动过的字段发给 Mac。检查命令、可推送的分支等安全相关的配置只能在 Mac 上改。
   */
  import { untrack } from 'svelte';

  import { ROLES, type IMachine, type ISettings, type Role, type SettingsPayload } from './api';
  import { commandState, performCommand } from './command.svelte';

  let { machine, settings, onSaved }: { machine: IMachine; settings: ISettings; onSaved: () => void } = $props();

  // 只在打开时取一次初始值，之后总览刷新不会冲掉正在编辑的内容
  const initial = untrack(() => settings);

  let maxConcurrentRuns = $state(initial.maxConcurrentRuns);
  let retentionDays = $state(initial.retentionDays);
  let models = $state<Record<Role, string>>({ ...initial.models });
  let pausedFlows = $state<string[]>([...initial.pausedFlows]);

  /** 切换某类流程的暂停 */
  function togglePaused(type: string, isPaused: boolean): void {
    pausedFlows = isPaused ? [...pausedFlows, type] : pausedFlows.filter((item) => item !== type);
  }

  /** 提交改动过的字段 */
  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const patch: SettingsPayload = {};
    if (maxConcurrentRuns !== initial.maxConcurrentRuns) {
      patch.maxConcurrentRuns = maxConcurrentRuns;
    }
    if (retentionDays !== initial.retentionDays) {
      patch.retentionDays = retentionDays;
    }
    const modelPatch: Partial<Record<Role, string>> = {};
    for (const { role } of ROLES) {
      if (models[role] !== initial.models[role]) {
        modelPatch[role] = models[role];
      }
    }
    if (Object.keys(modelPatch).length > 0) {
      patch.models = modelPatch;
    }
    if ([...pausedFlows].sort().join() !== [...initial.pausedFlows].sort().join()) {
      patch.pausedFlows = pausedFlows;
    }
    if (Object.keys(patch).length === 0) {
      return;
    }
    if (await performCommand(machine.id, { type: 'settings.update', payload: patch }, '修改全局设置')) {
      onSaved();
    }
  }
</script>

<form class="form" onsubmit={submit}>
  <label class="field">
    <span>同时最多跑</span>
    <span class="inline">
      <input class="narrow" type="number" min="1" max="8" bind:value={maxConcurrentRuns} />
      <span class="muted">个</span>
    </span>
  </label>
  {#each ROLES as { role, label } (role)}
    <label class="field">
      <span>{label}模型</span>
      <select bind:value={models[role]}>
        {#each [...new Set([...machine.models, models[role]])] as model (model)}
          <option value={model}>{model}</option>
        {/each}
      </select>
    </label>
  {/each}
  <label class="field">
    <span>材料保留</span>
    <span class="inline">
      <input class="narrow" type="number" min="1" max="90" bind:value={retentionDays} />
      <span class="muted">天</span>
    </span>
  </label>
  {#each machine.flows as flow (flow.type)}
    <label class="field">
      <span>{flow.title}</span>
      <span class="inline">
        <input
          type="checkbox"
          checked={pausedFlows.includes(flow.type)}
          onchange={(event) => togglePaused(flow.type, event.currentTarget.checked)}
        />
        <span class="muted">暂停这类流程（所有仓库都不跑）</span>
      </span>
    </label>
  {/each}
  <div class="actions">
    <button class="btn btn-primary" type="submit" disabled={commandState.isBusy}>保存</button>
  </div>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
  }

  .field {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
  }

  .field > span:first-child {
    color: var(--muted);
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .narrow {
    width: 80px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 720px) {
    .field {
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }
  }
</style>
