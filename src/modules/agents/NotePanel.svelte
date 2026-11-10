<script lang="ts">
  /**
   * 处理前写备注的小面板：一句说明、备注框、取消与确定。
   * 待办的「交给主审」「同意 / 拒绝」和想法的「采纳并开工 / 丢弃 / 已实现」共用。
   */
  let {
    note = $bindable(),
    hint = null,
    tip = null,
    placeholder,
    label,
    maxlength,
    rows = 2,
    confirmLabel,
    isPrimary = true,
    onCancel,
    onConfirm,
  }: {
    /** 备注内容 */
    note: string;
    /** 备注框上面的说明：点了确定会怎样 */
    hint?: string | null;
    /** 备注框下面的提醒：备注里最好写什么 */
    tip?: string | null;
    placeholder: string;
    /** 备注框给读屏软件的名字 */
    label: string;
    /** 备注最多几个字，与 hub、agentd 一致 */
    maxlength: number;
    /** 备注框起始几行；支持按内容自动撑高的浏览器会忽略 */
    rows?: number;
    confirmLabel: string;
    /** 确定是不是实心的主按钮；拒绝、丢弃这类不是 */
    isPrimary?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  } = $props();
</script>

<div class="panel">
  {#if hint !== null}<p class="muted hint">{hint}</p>{/if}
  <textarea bind:value={note} {rows} {maxlength} {placeholder} aria-label={label}></textarea>
  {#if tip !== null}<p class="muted hint">{tip}</p>{/if}
  <div class="btn-row">
    <button class="btn" type="button" onclick={onCancel}>取消</button>
    <button class="btn" class:btn-primary={isPrimary} type="button" onclick={onConfirm}>{confirmLabel}</button>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 10px;
    background: var(--surface-sunken);
  }

  .hint {
    font-size: 12px;
  }
</style>
