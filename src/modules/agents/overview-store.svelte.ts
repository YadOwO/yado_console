/**
 * 总览的共享副本：总览、待办、想法、流程页、运行记录、运行详情都读这一份。
 *
 * 换页面时先显示上一次取到的，再在后台刷新，不用每进一页都等一次「加载中」；同一时刻的请求合并成一个。
 * 取到后顺手把侧栏的待办数对齐：hub 的待办数就是总览里待办的条数，不用为角标再单独查一次。
 *
 * 待办点了处理后先从页面上拿掉（hideInboxItem），指令在后台发；Mac 是先同步状态、再回报结果，
 * 所以指令成功后刷新一次总览，那条就真的没了，再放开（showInboxItem）；失败时直接放开，它会回到列表里。
 */
import { adminStatus } from '../../lib/admin-status.svelte';
import { errorMessage } from '../../lib/http';
import { pollWhileVisible } from '../../lib/poll';
import { getOverview, instanceLabel, type IInboxItem, type IOverview } from './api';

/** 页面打开期间的自动刷新间隔 */
const REFRESH_INTERVAL_MS = 10_000;

/** 最近一次取到的总览；整份替换、页面只读，用 raw 省掉逐层代理的开销 */
let value = $state.raw<IOverview | null>(null);
/** 最近一次刷新失败的原因；成功后清空。失败时保留旧数据 */
let errorText = $state<string | null>(null);
/** 是否要显示「加载中」：还没有数据，或者手动点了刷新 */
let isLoading = $state(false);
/** 已经点了处理、指令还在路上的待办（机器/待办 ID），先不显示 */
let hiddenInboxKeys = $state.raw<readonly string[]>([]);

/** 实例 ID → 页面上的名字（仓库名或系列文件夹）；运行列表显示它，没有对应项时显示实例 ID */
const instanceLabels = $derived(Object.fromEntries((value?.instances ?? []).map((item) => [item.id, instanceLabel(item)])));

/** 流程类型 → 中文名：各机器报的，按 agentd 的顺序，同一种只取第一个 */
const flowTitles = $derived.by(() => {
  const titles: Record<string, string> = {};
  for (const machine of value?.machines ?? []) {
    for (const flow of machine.flows) {
      titles[flow.type] ??= flow.title;
    }
  }
  return titles;
});

/** 正在进行的请求；同一时刻只发一个 */
let inFlight: Promise<IOverview | null> | null = null;

/** 总览的共享状态，各页面只读 */
export const overviewState = {
  get value(): IOverview | null {
    return value;
  },
  get errorText(): string | null {
    return errorText;
  },
  get isLoading(): boolean {
    return isLoading;
  },
  get instanceLabels(): Record<string, string> {
    return instanceLabels;
  },
  get flowTitles(): Record<string, string> {
    return flowTitles;
  },
};

/** 待办在页面上的唯一键 */
export function inboxKey(item: IInboxItem): string {
  return `${item.machineId}/${item.id}`;
}

/** 页面上该显示的待办：去掉已经点了处理、指令还在路上的 */
export function visibleInbox(): IInboxItem[] {
  const inbox = value?.inbox ?? [];
  return hiddenInboxKeys.length === 0 ? inbox : inbox.filter((item) => !hiddenInboxKeys.includes(inboxKey(item)));
}

/** 把侧栏和标签上的待办数对齐到页面上实际显示的条数 */
function syncInboxCount(): void {
  if (value !== null && adminStatus.value?.isAdmin === true) {
    adminStatus.value.agentInboxCount = visibleInbox().length;
  }
}

/** 点了处理：先从页面上拿掉 */
export function hideInboxItem(key: string): void {
  hiddenInboxKeys = [...hiddenInboxKeys, key];
  syncInboxCount();
}

/** 指令有结果了：放开，hub 上还有这条的话会重新显示 */
export function showInboxItem(key: string): void {
  hiddenInboxKeys = hiddenInboxKeys.filter((item) => item !== key);
  syncInboxCount();
}

/** 取一次总览，写进共享状态；失败返回 null */
async function fetchOverview(): Promise<IOverview | null> {
  try {
    const data = await getOverview();
    value = data;
    errorText = null;
    syncInboxCount();
    return data;
  } catch (error) {
    errorText = errorMessage(error);
    return null;
  } finally {
    isLoading = false;
    inFlight = null;
  }
}

/**
 * 刷新总览。已有请求在路上时直接等它，不重复发。
 *
 * @param options.isSilent 默认 true：后台刷新，不显示「加载中」；手动点刷新时传 false
 * @param options.isFresh 要求数据是调用之后才取的（指令刚成功时用）：路上那个请求可能是之前发的，等它完再取一次
 * @returns 取到的总览；失败返回 null，原因在 overviewState.errorText
 */
export async function refreshOverview(options: { isSilent?: boolean; isFresh?: boolean } = {}): Promise<IOverview | null> {
  if (options.isFresh === true && inFlight !== null) {
    await inFlight;
  }
  if (options.isSilent === false || value === null) {
    isLoading = true;
  }
  inFlight ??= fetchOverview();
  return inFlight;
}

/** 只是要用总览里的名字（仓库名、流程名）的页面：已经有就不再取 */
export function ensureOverview(): void {
  if (value === null) {
    void refreshOverview();
  }
}

/**
 * 页面打开期间让总览保持最新：马上刷一次（不看页面是否可见，在后台标签里打开的也要先有内容），
 * 之后页面可见时每 10 秒刷一次，切回页面时立即刷一次。
 *
 * @param onRefreshed 每次取到新数据后调用，用来跟着刷新页面自己的数据（如流程页的最近运行）
 * @returns 停止刷新的函数，交给 onMount 返回
 */
export function watchOverview(onRefreshed?: () => void): () => void {
  const refresh = (): void => {
    void refreshOverview().then((data) => {
      if (data !== null) {
        onRefreshed?.();
      }
    });
  };
  refresh();
  return pollWhileVisible(refresh, REFRESH_INTERVAL_MS);
}
