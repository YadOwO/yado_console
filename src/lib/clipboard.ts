/** 复制后按钮上短暂显示结果多久（毫秒） */
export const COPY_FEEDBACK_MS = 1500;

/** 把文字写进剪贴板；浏览器不允许（非 https、没授权）时返回 false，不抛错 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
