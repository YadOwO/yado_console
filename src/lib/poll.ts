/**
 * 页面打开期间定时做一件事：只在页面可见时做，切回页面时立即补一次；页面在后台时不发请求。
 *
 * 第一次（进页面时）由调用方自己做，不看页面是否可见：在后台标签里打开的页面也要先有内容。
 */

/**
 * @param task 要做的事，如刷新一次数据
 * @param intervalMs 间隔
 * @returns 停止的函数，交给 onMount 返回
 */
export function pollWhileVisible(task: () => void, intervalMs: number): () => void {
  const run = (): void => {
    if (document.visibilityState === 'visible') {
      task();
    }
  };
  const timer = setInterval(run, intervalMs);
  document.addEventListener('visibilitychange', run);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', run);
  };
}
