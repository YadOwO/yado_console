/**
 * Agent 管理接口：yado_hub `/v1/admin/agents/*`，结构以 yado_hub 的 openapi.json 为准。
 *
 * 流程跑在 Mac 上的 agentd 里，hub 只存它同步上来的摘要。页面上的操作都是「发指令」：
 * hub 存下指令并立即唤醒 agentd 挂着的长轮询，agentd 取走执行并回报结果，页面轮询指令状态。
 */
import { HUB } from '../../lib/hub';
import { request } from '../../lib/http';

/** 调度：每天定时、每隔 N 分钟、cron 表达式，或者只手动（一次实现：每次在 Mac 上带着需求提） */
export type Schedule =
  | { kind: 'daily'; time: string; timezone: string }
  | { kind: 'interval'; minutes: number }
  | { kind: 'cron'; expression: string; timezone: string }
  | { kind: 'manual' };

/** 一次实现的流程类型：只能在 Mac 上用 /yado-implement 或 agentctl 提需求，页面上不能立即运行，只推新分支 */
export const IMPLEMENT_FLOW = 'implement';

/** 产品探索的流程类型：定时看每个产品出想法，只出想法不改代码 */
export const EXPLORE_FLOW = 'explore';

/** 挂系列文件夹（例如 ~/yado-code）的流程：实例只能在 Mac 上建，没有开发分支（同步上来的 branch 是 -） */
export const SERIES_FLOWS: ReadonlySet<string> = new Set([IMPLEMENT_FLOW, EXPLORE_FLOW]);

/** 各流程用到的角色；没列的三个都用 */
export const FLOW_ROLES: Readonly<Record<string, readonly Role[]>> = {
  [IMPLEMENT_FLOW]: ['lead', 'fixer'],
  [EXPLORE_FLOW]: ['lead'],
};

/** 调用模型的角色 */
export type Role = 'reviewer' | 'lead' | 'fixer';

/** 全部角色，按流程里出场的顺序 */
export const ROLES: { role: Role; label: string }[] = [
  { role: 'reviewer', label: '找问题' },
  { role: 'lead', label: '主审' },
  { role: 'fixer', label: '修复' },
];

/** 运行状态 */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'needs_attention'
  | 'failed'
  | 'canceled'
  | 'interrupted';

/** 运行的一步 */
export interface IStep {
  key: string;
  /** agentd 自己做的（agentd）或调用模型的（model） */
  kind: string;
  round: number;
  role: string | null;
  model: string | null;
  status: string;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
  finishedAt: string | null;
}

/** 问题与主审的判断 */
export interface IFinding {
  id: number;
  round: number;
  ref: string;
  title: string;
  file: string;
  line: number | null;
  severity: string;
  category: string;
  source: string;
  /** fix 修、wontfix 不修、escalate 交给你、defer 以后再做（代码清理）；还没判时为 null */
  verdict: string | null;
  reason: string | null;
  fixCommit: string | null;
  /** 交给你的问题的处理结果：wontfix 不修、done 已处理、delegated 交给主审 */
  resolution: string | null;
  /** 交给主审时，主审决定它的那次运行 */
  delegatedRunId: string | null;
}

/** 运行摘要 */
interface IRunBase {
  id: string;
  machineId: string;
  instanceId: string;
  flowType: string;
  status: RunStatus;
  trigger: string;
  isDryRun: boolean;
  baseCommit: string | null;
  headCommit: string | null;
  pushedCommit: string | null;
  rounds: number;
  summary: string | null;
  reason: string | null;
  inputTokens: number;
  outputTokens: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  acknowledgedAt: string | null;
  /** 交给主审的运行：那个问题所在的运行 */
  delegatedFrom: string | null;
}

/** 运行列表里的一项 */
export interface IRunListItem extends IRunBase {
  seq: number;
  findingCount: number;
  escalatedCount: number;
}

/** 事件 */
export interface IEvent {
  id: number;
  at: string;
  instanceId: string | null;
  runId: string | null;
  type: string;
  message: string;
}

/** 运行详情 */
export interface IRunDetail extends IRunBase {
  steps: IStep[];
  findings: IFinding[];
  events: IEvent[];
}

/** 实例：流程类型 + 仓库 + 开发分支 + 调度 */
export interface IInstance {
  id: string;
  machineId: string;
  flowType: string;
  repo: string;
  branch: string;
  schedule: Schedule;
  scheduleText: string;
  isEnabled: boolean;
  /** 演练模式：只出报告，不推送 */
  isDryRun: boolean;
  /** 是否允许推到会触发部署的分支；只能在 Mac 上改 */
  allowProtectedBranch: boolean;
  maxRounds: number;
  /** 这个实例单独指定的模型 */
  models: Partial<Record<Role, string>>;
  nextRunAt: string | null;
  /** 上次 review 到的提交；代码清理没有，恒为 null */
  cursor: string | null;
  checks: string[];
  /** 产品探索：每个产品最多几条没处理的想法；别的流程为 null */
  ideaLimit: number | null;
  /** 产品探索：主审能不能上网；别的流程为 null */
  isWebEnabled: boolean | null;
  lastRun: { id: string; status: RunStatus; summary: string | null; reason: string | null; queuedAt: string; finishedAt: string | null } | null;
}

/** 一条待办：交给你决定的问题，或需要你看一下的运行 */
export interface IInboxItem {
  /** finding-<问题 ID> 或 run-<运行 ID> */
  id: string;
  machineId: string;
  kind: 'finding' | 'run';
  instanceId: string;
  runId: string;
  title: string;
  /** 主审的理由或运行失败的原因 */
  detail: string | null;
  severity: string | null;
  location: string | null;
  runStatus: RunStatus | null;
  createdAt: string;
}

/** 全局设置 */
export interface ISettings {
  maxConcurrentRuns: number;
  models: Record<Role, string>;
  retentionDays: number;
  pausedFlows: string[];
}

/** 流程类型 */
export interface IFlow {
  type: string;
  title: string;
  description: string;
  isPaused: boolean;
  /** 新建这种流程的实例时默认的调度；旧版 agentd 没报时为 null */
  defaultSchedule: Schedule | null;
}

/** 经验：主审总结的一句话规则，以后的 agent 都照着做，提出后马上生效 */
export interface ILesson {
  /** agentd 本地的经验 ID，显示为 L<id> */
  id: number;
  machineId: string;
  /** global 所有仓库通用、repo 只用于 repo 那个仓库 */
  scope: 'global' | 'repo';
  /** scope 为 repo 时的 owner/name */
  repo: string | null;
  rule: string;
  reason: string | null;
  status: 'active' | 'void';
  /** cleanup、review（那次运行的主审提出的）或 manual（在 Mac 上手动加的） */
  source: string;
  sourceRunId: string | null;
  /** 这条替换掉的旧经验 */
  replacesId: number | null;
  /** 这条（已作废）被哪条新经验替换掉了 */
  replacedById: number | null;
  /** 之后的运行确认有问题违反了它的次数 */
  hits: number;
  lastHitAt: string | null;
  createdAt: string;
  voidedAt: string | null;
}

/** 某台机器生效中经验的上限 */
export interface ILessonLimits {
  machineId: string;
  global: number;
  repo: number;
}

/** 产品偏好：主审从你对想法的处理和备注里总结的一句话，以后的产品探索照着提想法 */
export interface IPreference {
  /** agentd 本地的偏好 ID，显示为 P<id> */
  id: number;
  machineId: string;
  instanceId: string;
  product: string;
  rule: string;
  reason: string | null;
  status: 'active' | 'void';
  /** 总结出它的那次探索 */
  sourceRunId: string | null;
  replacesId: number | null;
  replacedById: number | null;
  createdAt: string;
  voidedAt: string | null;
}

/** 经验列表 */
export interface ILessonList {
  /** 全部机器的经验，含已作废的 */
  lessons: ILesson[];
  /** 旧版 agentd 没报上限的机器不在里面 */
  limits: ILessonLimits[];
  /** 全部机器的产品偏好，含最近作废的；旧版 hub 没有 */
  preferences?: IPreference[];
  /** 各机器每个产品生效中偏好的上限 */
  preferenceLimits?: { machineId: string; limit: number }[];
}

/** 想法的大小：S 半天内、M 一两天、L 更大 */
export type IdeaSize = 'S' | 'M' | 'L';

/** 产品探索的想法：主审定时看每个产品，提出接下来可以做什么 */
export interface IIdea {
  /** agentd 本地的想法 ID，显示为 I<id> */
  id: number;
  machineId: string;
  instanceId: string;
  product: string;
  /** 提出它的那次运行 */
  runId: string;
  title: string;
  /** 为什么值得做 */
  why: string;
  /** 做什么 */
  what: string;
  /** 涉及的仓库目录名 */
  repos: string[];
  size: IdeaSize;
  /** 要你拿主意的问题 */
  questions: string[];
  /** open 没处理、adopted 采纳、discarded 丢弃 */
  status: 'open' | 'adopted' | 'discarded';
  /** 你处理时写的备注 */
  note: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** 想法列表 */
export interface IIdeaList {
  /** 没处理的全部，已处理的只有最近一部分 */
  ideas: IIdea[];
  /** 各产品探索实例每个产品没处理想法的上限 */
  limits: { machineId: string; instanceId: string; ideaLimit: number }[];
}

/** 处理想法时备注的上限，与 hub、agentd 一致 */
export const IDEA_NOTE_MAX = 500;

/** 每个产品没处理想法的上限最大能设到几，与 hub、agentd 一致 */
export const IDEA_LIMIT_MAX = 10;

/** 想法大小的中文 */
export const IDEA_SIZE_LABEL: Record<IdeaSize, string> = { S: '小（半天内）', M: '中（一两天）', L: '大' };

/** 跑 agentd 的机器 */
export interface IMachine {
  id: string;
  agentdVersion: string;
  /** 最近 3 分钟内联系过 hub（领指令或同步） */
  isOnline: boolean;
  lastSeenAt: string;
  health: { status: 'ok' | 'degraded'; detail: string; activeRuns: number; queuedRuns: number } | null;
  settings: ISettings | null;
  /** 可选的模型 */
  models: string[];
  flows: IFlow[];
}

/** 某一天的汇总 */
export interface IDaySummary {
  date: string;
  timezone: string;
  /** 各状态的运行数 */
  runs: Partial<Record<RunStatus, number>>;
  findings: { total: number; fixed: number; wontfix: number; escalated: number };
  pushed: number;
  /** 到点检查但没有新提交的次数 */
  noChangeChecks: number;
}

/** 总览 */
export interface IOverview {
  machines: IMachine[];
  instances: IInstance[];
  inbox: IInboxItem[];
  today: IDaySummary;
}

/** 运行列表的一页 */
export interface IRunPage {
  runs: IRunListItem[];
  nextBefore: number | null;
}

/** 页面能发的指令（白名单，与 hub 一致） */
export type CommandInput =
  | {
      type: 'instance.create';
      payload: { flowType: string; repo: string; branch: string; schedule?: Schedule };
    }
  | {
      type: 'instance.update';
      payload: {
        id: string;
        branch?: string;
        schedule?: Schedule;
        isEnabled?: boolean;
        isDryRun?: boolean;
        maxRounds?: number;
        /** null 表示改回跟随全局 */
        models?: Partial<Record<Role, string | null>>;
        /** 产品探索：每个产品最多几条没处理的想法 */
        ideaLimit?: number;
        /** 产品探索：主审能不能上网 */
        isWebEnabled?: boolean;
      };
    }
  | { type: 'instance.delete'; payload: { id: string } }
  | { type: 'instance.run'; payload: { id: string } }
  | { type: 'run.cancel'; payload: { runId: string } }
  | {
      type: 'settings.update';
      payload: Partial<{
        maxConcurrentRuns: number;
        models: Partial<Record<Role, string>>;
        retentionDays: number;
        pausedFlows: string[];
      }>;
    }
  | { type: 'inbox.resolve'; payload: { itemId: string; action: 'wontfix' | 'done' | 'delegate'; note?: string } }
  | { type: 'sync.now'; payload: Record<string, never> }
  // 经验只能作废、恢复；改文字和新增只能在 Mac 上用 agentctl
  | { type: 'lesson.void'; payload: { id: number } }
  | { type: 'lesson.restore'; payload: { id: number } }
  // 产品探索：想法只能采纳或丢弃（可以写备注），采纳不会开工；偏好和经验一样只能作废、恢复
  | { type: 'idea.decide'; payload: { id: number; decision: 'adopted' | 'discarded'; note?: string } }
  | { type: 'preference.void'; payload: { id: number } }
  | { type: 'preference.restore'; payload: { id: number } };

/** 修改实例的参数 */
export type UpdateInstancePayload = Extract<CommandInput, { type: 'instance.update' }>['payload'];

/** 修改全局设置的参数 */
export type SettingsPayload = Extract<CommandInput, { type: 'settings.update' }>['payload'];

/** 指令状态：pending 等 Mac 取走、sent 已送到等结果、succeeded、failed、expired 一直没送到 */
export type CommandStatus = 'pending' | 'sent' | 'succeeded' | 'failed' | 'expired';

/** 已发出的指令 */
export interface ICommand {
  id: string;
  machineId: string;
  type: string;
  status: CommandStatus;
  /** Mac 回报的一句话结果 */
  result: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** 浏览器所在时区，「今天」按它算 */
export const BROWSER_TIMEZONE: string = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** 总览：机器、实例、待办与今天的汇总 */
export function getOverview(): Promise<IOverview> {
  return request<IOverview>(HUB, '/v1/admin/agents/overview', { query: { tz: BROWSER_TIMEZONE } });
}

/** 运行列表的筛选 */
export interface IRunFilter {
  /** 流程类型；旧版 hub 不认这个参数，会返回全部 */
  flow?: string;
  instance?: string;
  status?: string;
  before?: number;
  limit?: number;
}

/** 运行列表，最新的在前 */
export function listRuns(filter: IRunFilter): Promise<IRunPage> {
  return request<IRunPage>(HUB, '/v1/admin/agents/runs', {
    query: { flow: filter.flow, instance: filter.instance, status: filter.status, before: filter.before, limit: filter.limit ?? 30 },
  });
}

/** 运行详情 */
export function getRun(machineId: string, runId: string): Promise<IRunDetail> {
  return request<IRunDetail>(
    HUB,
    `/v1/admin/agents/runs/${encodeURIComponent(machineId)}/${encodeURIComponent(runId)}`,
  );
}

/** 经验、产品偏好与各机器的上限 */
export function getLessons(): Promise<ILessonList> {
  return request<ILessonList>(HUB, '/v1/admin/agents/lessons');
}

/** 产品探索的想法与各实例的上限 */
export function getIdeas(): Promise<IIdeaList> {
  return request<IIdeaList>(HUB, '/v1/admin/agents/ideas');
}

/** 发指令 */
export function sendCommand(machineId: string, input: CommandInput): Promise<ICommand> {
  return request<ICommand>(HUB, '/v1/admin/agents/commands', { method: 'POST', body: { machineId, ...input } });
}

/** 查指令结果 */
export function getCommand(id: string): Promise<ICommand> {
  return request<ICommand>(HUB, `/v1/admin/agents/commands/${id}`);
}

/** 运行状态的中文与配色；配色对应 app.css 的 .status-* */
const RUN_STATUS = new Map<string, { label: string; tone: string }>([
  ['queued', { label: '排队中', tone: 'neutral' }],
  ['running', { label: '运行中', tone: 'neutral' }],
  ['succeeded', { label: '完成', tone: 'resolved' }],
  ['needs_attention', { label: '要你处理', tone: 'pending' }],
  ['failed', { label: '失败', tone: 'danger' }],
  ['canceled', { label: '已取消', tone: 'neutral' }],
  ['interrupted', { label: '被中断', tone: 'danger' }],
]);

/** 运行状态的中文与配色；不认识的状态原样显示 */
function runStatusInfo(status: string): { label: string; tone: string } {
  return RUN_STATUS.get(status) ?? { label: status, tone: 'neutral' };
}

/** 运行状态的中文 */
export function runStatusLabel(status: string): string {
  return runStatusInfo(status).label;
}

/** 运行状态对应的 .status-* 样式 */
export function runStatusClass(status: string): string {
  return `status status-${runStatusInfo(status).tone}`;
}

/** 运行是否还没结束 */
export function isRunActive(status: string): boolean {
  return status === 'queued' || status === 'running';
}

/** 主审判断的中文 */
export function verdictLabel(verdict: string | null): string {
  switch (verdict) {
    case 'fix':
      return '修';
    case 'wontfix':
      return '不修';
    case 'escalate':
      return '交给你';
    case 'defer':
      return '以后再做';
    case 'attention':
      return '重点看';
    default:
      return '未判';
  }
}

/** 经验来源的中文 */
export function lessonSourceLabel(source: string): string {
  switch (source) {
    case 'cleanup':
      return '代码清理';
    case 'review':
      return 'review';
    case 'manual':
      return '手动';
    default:
      return source;
  }
}

/** 严重程度的中文 */
export function severityLabel(severity: string | null): string {
  switch (severity) {
    case 'high':
      return '高';
    case 'medium':
      return '中';
    case 'low':
      return '低';
    default:
      return severity ?? '';
  }
}

/** 提交号取前 7 位 */
/** 交给主审时补充信息的最大长度，与 hub、agentd 一致 */
export const DELEGATE_NOTE_MAX = 1000;

/** 触发方式的中文 */
export function triggerLabel(trigger: string): string {
  if (trigger === 'manual') {
    return '手动';
  }
  return trigger === 'delegate' ? '交给主审' : '定时';
}

/** 提交号取前 7 位 */
export function shortSha(sha: string | null): string {
  return sha === null ? '—' : sha.slice(0, 7);
}

/** token 数的紧凑写法，如 1.6M、68k */
export function compactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}

/** 两个时刻之间的时长，如 9 分钟、45 秒 */
export function durationText(from: string | null, to: string | null): string {
  if (from === null || to === null) {
    return '';
  }
  const seconds = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`;
}

/** 流程类型的中文名，机器没报（旧版 agentd 或还没同步）时用 */
const FLOW_TITLES: Record<string, string> = {
  review: '代码 review',
  cleanup: '代码清理',
  [IMPLEMENT_FLOW]: '一次实现',
  [EXPLORE_FLOW]: '产品探索',
};

/** 流程类型的中文名：以机器报上来的为准 */
export function flowTitle(machines: IMachine[], flowType: string): string {
  for (const machine of machines) {
    const flow = machine.flows.find((item) => item.type === flowType);
    if (flow !== undefined) {
      return flow.title;
    }
  }
  return FLOW_TITLES[flowType] ?? flowType;
}

/** 实例在页面上的名字：仓库实例只写仓库名（不带 owner），挂系列文件夹的写文件夹 */
export function instanceLabel(instance: IInstance): string {
  if (SERIES_FLOWS.has(instance.flowType)) {
    return instance.repo;
  }
  return instance.repo.slice(instance.repo.indexOf('/') + 1);
}
