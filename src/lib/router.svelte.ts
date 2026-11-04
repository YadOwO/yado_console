/**
 * 极简路由：基于 History API，不引入路由库。
 *
 * 页面少、结构固定，用一个函数按路径匹配即可；站内 <a> 的点击由 App 统一拦截后走 navigate，
 * 中键、⌘ 点击等仍按浏览器默认在新标签页打开。
 */
import { CALLBACK_PATH } from './auth';

/** 当前地址；pathname 与 search 变化时，读取它的页面会重新渲染 */
export const current = $state({ path: location.pathname, search: location.search });

/** 管理端的页面 */
export type Route =
  | { name: 'tickets' }
  | { name: 'conversation'; id: string }
  | { name: 'agents' }
  | { name: 'agentInbox' }
  | { name: 'agentRuns' }
  | { name: 'agentRun'; machineId: string; runId: string }
  | { name: 'callback' }
  | { name: 'notFound' };

/** 对话详情的路径：/feedback/conversations/<对话 ID> */
const CONVERSATION_PATH = /^\/feedback\/conversations\/([0-9a-f-]{36})$/i;

/** agent 运行详情的路径：/agents/runs/<机器 ID>/<运行 ID> */
const AGENT_RUN_PATH = /^\/agents\/runs\/([a-z0-9-]{1,40})\/([\w.-]{1,200})$/;

/** agent 的固定页面 */
const AGENT_PAGES: Record<string, Route> = {
  '/agents': { name: 'agents' },
  '/agents/inbox': { name: 'agentInbox' },
  '/agents/runs': { name: 'agentRuns' },
};

/** 按路径匹配页面 */
export function matchRoute(path: string): Route {
  if (path === '/' || path === '/feedback') {
    return { name: 'tickets' };
  }
  if (path === CALLBACK_PATH) {
    return { name: 'callback' };
  }
  const agentPage = AGENT_PAGES[path];
  if (agentPage !== undefined) {
    return agentPage;
  }
  const agentRun = AGENT_RUN_PATH.exec(path);
  if (agentRun?.[1] !== undefined && agentRun[2] !== undefined) {
    return { name: 'agentRun', machineId: agentRun[1], runId: agentRun[2] };
  }
  const id = CONVERSATION_PATH.exec(path)?.[1];
  if (id !== undefined) {
    return { name: 'conversation', id: id.toLowerCase() };
  }
  return { name: 'notFound' };
}

/** 把浏览器地址同步到 current */
function sync(): void {
  current.path = location.pathname;
  current.search = location.search;
}

/**
 * 站内跳转。
 *
 * @param url 站内地址，如 /feedback?status=resolved
 * @param options replace 为 true 时替换当前历史记录，用于切换筛选条件
 */
export function navigate(url: string, options: { replace?: boolean } = {}): void {
  if (options.replace === true) {
    history.replaceState(null, '', url);
  } else {
    history.pushState(null, '', url);
  }
  sync();
}

/** 读取当前地址的查询参数；在 $derived 中调用时，地址变化会触发重新计算 */
export function queryParam(name: string): string | null {
  return new URLSearchParams(current.search).get(name);
}

/** 拦截站内链接的普通左键点击，改走 navigate，避免整页刷新 */
export function handleLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const anchor = event.target instanceof Element ? event.target.closest('a') : null;
  if (anchor === null || anchor.target !== '' || anchor.hasAttribute('download') || anchor.origin !== location.origin) {
    return;
  }
  event.preventDefault();
  navigate(anchor.pathname + anchor.search + anchor.hash);
}

addEventListener('popstate', sync);
