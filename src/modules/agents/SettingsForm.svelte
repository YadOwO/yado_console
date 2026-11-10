<script lang="ts">
  /**
   * 一台机器的全局设置：同时跑几次运行、各角色默认模型、各模型的思考强度、运行材料保留天数。
   * 名字说不清的字段下面带一句说明。
   *
   * 只把改动过的字段发给 Mac。暂停整个流程在各流程页上做；检查命令、可推送的分支等安全相关的配置只能在 Mac 上改。
   */
  import { untrack } from 'svelte';

  import { ROLES, type IMachine, type ISettings, type Role, type SettingsPayload } from './api';
  import { commandState, performCommand } from './command.svelte';

  let { machine, settings, onSaved }: { machine: IMachine; settings: ISettings; onSaved: () => void } = $props();

  // 只在打开时取一次初始值，之后总览刷新不会冲掉正在编辑的内容
  const initial = untrack(() => settings);

  /** 各角色模型下面的一句说明：角色名本身说不清的才写 */
  const ROLE_HINTS: Partial<Record<Role, string>> = {
    reviewer: 'review、清理里找问题和复审',
    lead: '判断、写方案、写发布计划，整次运行都用它',
    fixer: '按主审的说明改代码；一次实现里写代码也用它',
  };

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
  <label class="form-row has-hint">
    <span>同时跑几个</span>
    <span class="control">
      <span class="inline">
        <input class="narrow" type="number" min="1" max="8" bind:value={maxConcurrentRuns} />
        <span class="muted">次运行</span>
      </span>
      <span class="hint">
        review、清理、探索、一次实现、发布加起来，最多同时跑几次，多出来的排队。等你点头的不占名额；
        同一个仓库一次只跑一个，所以没满也可能要等。
      </span>
    </span>
  </label>
  {#each ROLES as { role, label } (role)}
    <label class="form-row" class:has-hint={ROLE_HINTS[role] !== undefined}>
      <span>{label}模型</span>
      <span class="control">
        <select bind:value={models[role]}>
          {#each [...new Set([...machine.models, models[role]])] as model (model)}
            <option value={model}>{model}</option>
          {/each}
        </select>
        {#if ROLE_HINTS[role] !== undefined}<span class="hint">{ROLE_HINTS[role]}</span>{/if}
      </span>
    </label>
  {/each}
  {#if thinkingModels.length > 0}
    <div class="form-row thinking">
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
  <label class="form-row has-hint">
    <span>材料保留</span>
    <span class="control">
      <span class="inline">
        <input class="narrow" type="number" min="1" max="90" bind:value={retentionDays} />
        <span class="muted">天</span>
      </span>
      <span class="hint">跑成功的运行，Mac 上的代码副本留几天再删。没成功的一直留着，等你处理。</span>
    </span>
  </label>
  <div class="form-actions">
    <button class="btn btn-primary" type="submit" disabled={commandState.isBusy}>保存</button>
  </div>
</form>

<style>
  .control {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  /* 带说明的字段：左边的名字和输入框顶端对齐，不和说明一起居中 */
  .has-hint {
    align-items: start;
  }

  .has-hint > span:first-child {
    padding-top: 7px;
  }

  .hint {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
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
</style>
