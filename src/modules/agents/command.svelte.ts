/**
 * 发指令并等 Mac 回报结果。
 *
 * agentd 每分钟来问一次有没有指令，正常一分钟左右有结果；新建实例要 clone 仓库，还要再多几十秒。
 * 页面底部的提示条（CommandToast）显示最近一条指令的进度；执行期间禁用各操作按钮，避免连点发出重复指令。
 */
import { errorMessage } from '../../lib/http';
import { getCommand, sendCommand, type CommandInput, type ICommand } from './api';

/** 轮询间隔 */
const POLL_INTERVAL_MS = 1500;

/** 最多等多久；超过后不再轮询，提示稍后刷新 */
const POLL_TIMEOUT_MS = 180_000;

/** 等多久还没被取走就提示 Mac 可能离线（Mac 每分钟来问一次，留点余量） */
const OFFLINE_HINT_MS = 90_000;

/** 成功的提示显示多久 */
const OK_NOTICE_MS = 6000;

/** 提示条的内容 */
export interface ICommandNotice {
  text: string;
  tone: 'info' | 'ok' | 'error';
}

/** 最近一条指令的进度；isBusy 为 true 时各操作按钮禁用 */
export const commandState = $state<{ notice: ICommandNotice | null; isBusy: boolean }>({ notice: null, isBusy: false });

/** 已发出的指令数；提示条自动消失前据此判断期间有没有发新指令 */
let commandSequence = 0;

/** 等待 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等指令执行完；超时返回 null */
async function waitForResult(command: ICommand, label: string): Promise<ICommand | null> {
  const startedAt = Date.now();
  let current = command;
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'expired') {
      return current;
    }
    if (current.status === 'sent') {
      commandState.notice = { text: `${label}：Mac 正在执行…`, tone: 'info' };
    } else if (Date.now() - startedAt > OFFLINE_HINT_MS) {
      commandState.notice = { text: `${label}：Mac 还没取走指令，可能离线；10 分钟内上线仍会执行`, tone: 'info' };
    }
    await sleep(POLL_INTERVAL_MS);
    current = await getCommand(command.id);
  }
  return null;
}

/**
 * 发一条指令并等结果，进度显示在提示条上。
 *
 * @param label 操作名，如「立即运行 yadoI_be」
 * @returns 是否执行成功
 */
export async function performCommand(machineId: string, input: CommandInput, label: string): Promise<boolean> {
  commandSequence += 1;
  commandState.isBusy = true;
  commandState.notice = { text: `${label}：已发出，Mac 每分钟来取一次指令，稍等…`, tone: 'info' };
  try {
    const result = await waitForResult(await sendCommand(machineId, input), label);
    if (result === null) {
      commandState.notice = { text: `${label}：还没有结果，稍后刷新看看`, tone: 'info' };
      return false;
    }
    if (result.status === 'succeeded') {
      commandState.notice = { text: result.result ?? `${label}：完成`, tone: 'ok' };
      // 成功的提示过一会儿自动消失；期间又发了别的指令就不动它
      const sequence = commandSequence;
      setTimeout(() => {
        if (sequence === commandSequence && commandState.notice?.tone === 'ok') {
          commandState.notice = null;
        }
      }, OK_NOTICE_MS);
      return true;
    }
    commandState.notice = { text: `${label}失败：${result.result ?? '没有说明'}`, tone: 'error' };
    return false;
  } catch (error) {
    commandState.notice = { text: `${label}：${errorMessage(error)}`, tone: 'error' };
    return false;
  } finally {
    commandState.isBusy = false;
  }
}

/** 关掉提示条 */
export function dismissNotice(): void {
  commandState.notice = null;
}
