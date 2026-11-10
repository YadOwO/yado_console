<script lang="ts">
  /**
   * 一台机器的全局设置：同时最多跑几个、各角色默认模型、各模型的思考强度、运行材料保留天数。
   *
   * 只把改动过的字段发给 Mac。暂停整个流程在各流程页上做；检查命令、可推送的分支等安全相关的配置只能在 Mac 上改。
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

  /** 能选思考强度的模型；只在打开时取一次，和其他字段一样不被总览刷新冲掉 */
  const thinkingModels = untrack(() => (machine.modelThinking ?? []).filter((model) => model.options.length > 0));

  /** 每个模型选中的思考强度，初始是实际会用的 */
  let thinking = $state<Record<string, string>>(
    Object.fromEntries(thinkingModels.map((model) => [model.id, model.thinking ?? model.options[0] ?? ''])),
  );

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
    // 选回默认的发 null，以后默认变了也跟着变
    const thinkingPatch: Record<string, string | null> = {};
    for (const model of thinkingModels) {
      const value = thinking[model.id];
      if (value !== undefined && value !== model.thinking) {
        thinkingPatch[model.id] = value === model.defaultThinking ? null : value;
      }
    }
    if (Object.keys(thinkingPatch).length > 0) {
      patch.thinking = thinkingPatch;
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
  {#if thinkingModels.length > 0}
    <div class="field thinking">
      <span>思考强度</span>
      <div class="thinking-list">
        {#each thinkingModels as model (model.id)}
          <label class="thinking-row">
            <span class="model-id">{model.id}</span>
            <select bind:value={thinking[model.id]}>
              {#each model.options as option (option)}
                <option value={option}>{option === model.defaultThinking ? `${option}（默认）` : option}</option>
              {/each}
            </select>
          </label>
        {/each}
      </div>
    </div>
  {/if}
  <label class="field">
    <span>材料保留</span>
    <span class="inline">
      <input class="narrow" type="number" min="1" max="90" bind:value={retentionDays} />
      <span class="muted">天</span>
    </span>
  </label>
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

  .thinking {
    align-items: start;
  }

  .thinking-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .thinking-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 130px;
    align-items: center;
    gap: 8px;
  }

  .model-id {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  @media (max-width: 720px) {
    .field {
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }
  }
</style>
