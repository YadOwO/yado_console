/**
 * 发指令并等 Mac 回报结果。
 *
 * agentd 用长轮询等指令，指令发出后通常一秒内就被取走，简单的操作几秒内有结果；新建实例要 clone 仓库，还要再多几十秒。
 * 进度只分三段（hub 的指令状态就是 pending → sent → 终态，agentd 不回报「开始执行」）：
 * 已发出等 Mac 取走（pending）、Mac 已取走正在执行（sent）、完成 / 失败 / 作废。
 * 页面底部的提示条（CommandToast）显示最近一条指令的进度。
 *
 * 两种发法：
 * - performCommand：发完等结果，期间禁用各操作按钮（isBusy），避免连点发出重复指令。设置、实例操作等用它。
 * - submitCommand：后台发，不禁用按钮。待办、想法用它：点了就先从页面上拿掉那一条，可以接着处理下一条。
 *
 * 指令一点就立刻发给 hub（之后关掉页面 Mac 也会照做），结果则按发出的先后一条条查：
 * Mac 本来就是按顺序执行，这样不管攒了几条，同一时刻只有一个查询在轮询。
 */
import { errorMessage } from '../../lib/http';
import { getCommand, sendCommand, type CommandInput, type ICommand } from './api';

/** 轮询间隔 */
const POLL_INTERVAL_MS = 1500;

/** 一条指令从发出起最多等多久；超过后不再轮询，提示稍后刷新 */
const POLL_TIMEOUT_MS = 180_000;

/**
 * 等多久还没被取走就提示 Mac 可能离线。长轮询下正常情况一秒内就会被取走，15 秒还是 pending 基本说明 Mac 不在线。
 * 旧版 agentd（每分钟问一次）会因此误报「可能离线」，只是提示文案；升级 agentd 即可。
 */
const OFFLINE_HINT_MS = 15_000;

/** 成功的提示显示多久 */
const OK_NOTICE_MS = 6000;

/** 提示条的内容 */
export interface ICommandNotice {
  text: string;
  tone: 'info' | 'ok' | 'error';
}

/** 一条指令的结局 */
export interface ICommandOutcome {
  isOk: boolean;
  /** Mac 回报的一句话结果，或者没成功的原因 */
  text: string;
}

/**
 * 指令的进度：notice 是提示条的内容；isBusy 为 true 时各操作按钮禁用（只有 performCommand 会置）；
 * pendingCount 是还没有结果的指令数，提示条上显示「还有几条在处理」。
 */
export const commandState = $state<{ notice: ICommandNotice | null; isBusy: boolean; pendingCount: number }>({
  notice: null,
  isBusy: false,
  pendingCount: 0,
});

/** 已发出的指令数，也是每条指令的序号 */
let commandSequence = 0;

/** 提示条上现在这条提示属于哪条指令 */
let noticeOwner = 0;

/**
 * 失败提示出现时已经发出的最后一条指令。序号不超过它的指令之后的进度和成功不盖掉这条失败，
 * 否则连续处理几条时，中间失败的那条一闪就被后面的「完成」盖住了；之后新点的操作照常显示。
 */
let errorGuard = 0;

/** 还在等结果的 performCommand 数 */
let blockingCount = 0;

/** 前一条指令查完结果的时刻；结果按发出的先后一条条查 */
let previousTurn: Promise<void> = Promise.resolve();

/** 等待 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 显示某条指令的提示 */
function showNotice(sequence: number, notice: ICommandNotice): void {
  if (notice.tone === 'error') {
    errorGuard = commandSequence;
  } else if (commandState.notice?.tone === 'error' && sequence <= errorGuard) {
    return;
  }
  commandState.notice = notice;
  noticeOwner = sequence;
}

/**
 * 等指令执行完；超时返回 null。
 *
 * @param sentAt 指令发出的时刻；超时和「可能离线」都从这时算起，排在后面的指令不会各自再等满一轮
 */
async function waitForResult(command: ICommand, label: string, sequence: number, sentAt: number): Promise<ICommand | null> {
  const turn = previousTurn;
  let release = (): void => undefined;
  previousTurn = new Promise<void>((resolve) => {
    release = resolve;
  });
  await turn;
  try {
    // 排过队的：发出时拿到的状态已经旧了，轮到时先查一次，多半已经做完
    let current = Date.now() - sentAt > POLL_INTERVAL_MS ? await getCommand(command.id) : command;
    for (;;) {
      if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'expired') {
        return current;
      }
      if (Date.now() - sentAt >= POLL_TIMEOUT_MS) {
        return null;
      }
      if (current.status === 'sent') {
        showNotice(sequence, { text: `${label}：Mac 已取走，正在执行…`, tone: 'info' });
      } else if (Date.now() - sentAt > OFFLINE_HINT_MS) {
        showNotice(sequence, { text: `${label}：Mac 还没取走指令，可能离线；10 分钟内上线仍会执行`, tone: 'info' });
      }
      await sleep(POLL_INTERVAL_MS);
      current = await getCommand(command.id);
    }
  } finally {
    release();
  }
}

/** 发一条指令并等结果，进度显示在提示条上 */
async function execute(machineId: string, input: CommandInput, label: string): Promise<ICommandOutcome> {
  commandSequence += 1;
  const sequence = commandSequence;
  commandState.pendingCount += 1;
  showNotice(sequence, { text: `${label}：已发出，等待 Mac 取走…`, tone: 'info' });
  try {
    const sentAt = Date.now();
    const result = await waitForResult(await sendCommand(machineId, input), label, sequence, sentAt);
    if (result === null) {
      const text = `${label}：还没有结果，稍后刷新看看`;
      showNotice(sequence, { text, tone: 'info' });
      return { isOk: false, text };
    }
    if (result.status === 'succeeded') {
      const text = result.result ?? `${label}：完成`;
      showNotice(sequence, { text, tone: 'ok' });
      // 成功的提示过一会儿自动消失；期间换成了别的提示就不动它
      setTimeout(() => {
        if (noticeOwner === sequence && commandState.notice?.tone === 'ok') {
          commandState.notice = null;
        }
      }, OK_NOTICE_MS);
      return { isOk: true, text };
    }
    const text = `${label}失败：${result.result ?? '没有说明'}`;
    showNotice(sequence, { text, tone: 'error' });
    return { isOk: false, text };
  } catch (error) {
    const text = `${label}：${errorMessage(error)}`;
    showNotice(sequence, { text, tone: 'error' });
    return { isOk: false, text };
  } finally {
    commandState.pendingCount -= 1;
  }
}

/**
 * 发一条指令并等结果，期间禁用各操作按钮。
 *
 * @param label 操作名，如「立即运行 yadoI_be」
 * @returns 是否执行成功
 */
export async function performCommand(machineId: string, input: CommandInput, label: string): Promise<boolean> {
  blockingCount += 1;
  commandState.isBusy = true;
  try {
    return (await execute(machineId, input, label)).isOk;
  } finally {
    blockingCount -= 1;
    commandState.isBusy = blockingCount > 0;
  }
}

/**
 * 后台发一条指令，不禁用按钮；调用方自己保证同一条不会被点两次（点了就先从页面上拿掉）。
 *
 * @param label 操作名，如「标记不修」
 * @returns 结局：成功与否，和 Mac 回报的结果或没成功的原因
 */
export function submitCommand(machineId: string, input: CommandInput, label: string): Promise<ICommandOutcome> {
  return execute(machineId, input, label);
}

/** 关掉提示条 */
export function dismissNotice(): void {
  commandState.notice = null;
}
