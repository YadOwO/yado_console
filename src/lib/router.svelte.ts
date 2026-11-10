/**
 * 极简路由：基于 History API，不引入路由库。
 *
 * 页面少、结构固定，用一个函数按路径匹配即可；站内 <a> 的点击由 App 统一拦截后走 navigate，
 * 中键、⌘ 点击等仍按浏览器默认在新标签页打开。
 *
 * 每条历史记录上记着离开时的滚动位置，按浏览器的后退或页面上的「返回」回来时恢复，不用重新找刚才看到哪。
 */
import { CALLBACK_PATH } from './auth';

/**
 * 当前地址；pathname 与 search 变化时，读取它的页面会重新渲染。
 * scroll 是进这一页时该滚到的位置：新打开的页面是 0，按「返回」回来的是离开时的位置。
 */
export const current = $state({ path: location.pathname, search: location.search, scroll: 0 });

/** 记在浏览器历史记录每一条上的东西 */
interface IEntryState {
  /** 是不是从站内点过来的；是的话「返回」可以直接退回上一页 */
  isInApp: boolean;
  /** 离开这一页时滚到了哪里 */
  scroll: number;
}

/** 读当前这条历史记录上记的东西；不是我们写的（如直接打开的地址）按默认值 */
function readEntry(): IEntryState {
  const state: unknown = history.state;
  if (typeof state !== 'object' || state === null) {
    return { isInApp: false, scroll: 0 };
  }
  return {
    isInApp: 'isInApp' in state && state.isInApp === true,
    scroll: 'scroll' in state && typeof state.scroll === 'number' ? state.scroll : 0,
  };
}

/** 读页面滚动位置的办法；滚动的是 App 里的内容区而不是整个文档，由 App 登记 */
let readScroll: () => number = () => 0;

/** 登记读页面滚动位置的办法 */
export function setScrollReader(reader: () => number): void {
  readScroll = reader;
}

/** 这一页是不是从站内点过来的：是的话「返回」退回上一页（位置和筛选都在），否则只能去固定的上级页面 */
export function canGoBack(): boolean {
  return readEntry().isInApp;
}

/** 管理端的页面 */
export type Route =
  | { name: 'tickets' }
  | { name: 'conversation'; id: string }
  | { name: 'agents' }
  | { name: 'agentFlow'; flowType: string }
  | { name: 'agentInbox' }
  | { name: 'agentIdeas' }
  | { name: 'agentRuns' }
  | { name: 'agentRun'; machineId: string; runId: string }
  | { name: 'agentLessons' }
  | { name: 'callback' }
  | { name: 'notFound' };

/** 对话详情的路径：/feedback/conversations/<对话 ID> */
const CONVERSATION_PATH = /^\/feedback\/conversations\/([0-9a-f-]{36})$/i;

/** agent 运行详情的路径：/agents/runs/<机器 ID>/<运行 ID> */
const AGENT_RUN_PATH = /^\/agents\/runs\/([a-z0-9-]{1,40})\/([\w.-]{1,200})$/;

/** agent 流程页的路径：/agents/flows/<流程类型> */
const AGENT_FLOW_PATH = /^\/agents\/flows\/([a-z][a-z0-9_-]{0,30})$/;

/** agent 的固定页面 */
const AGENT_PAGES: Record<string, Route> = {
  '/agents': { name: 'agents' },
  '/agents/inbox': { name: 'agentInbox' },
  '/agents/runs': { name: 'agentRuns' },
  '/agents/lessons': { name: 'agentLessons' },
  '/agents/ideas': { name: 'agentIdeas' },
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
  const agentFlow = AGENT_FLOW_PATH.exec(path)?.[1];
  if (agentFlow !== undefined) {
    return { name: 'agentFlow', flowType: agentFlow };
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
function sync(scroll: number): void {
  current.scroll = scroll;
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
    // 只换地址（如切换筛选），这条历史记录上记的东西照旧
    history.replaceState(history.state, '', url);
    sync(current.scroll);
    return;
  }
  // 离开前记下这一页滚到了哪里，按「返回」回来时恢复
  history.replaceState({ ...readEntry(), scroll: readScroll() }, '');
  history.pushState({ isInApp: true, scroll: 0 }, '', url);
  sync(0);
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
  // 带 data-back 的是「返回」：从站内点过来的就退回上一页，直接打开的才去它写的上级页面
  if (anchor.dataset.back !== undefined && canGoBack()) {
    history.back();
    return;
  }
  navigate(anchor.pathname + anchor.search + anchor.hash);
}

addEventListener('popstate', () => sync(readEntry().scroll));
