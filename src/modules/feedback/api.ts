/**
 * 意见反馈的管理接口：yado_hub `/v1/admin/feedback/*`，结构以 yado_hub 的 openapi.json 为准。
 *
 * 每个用户在每个产品下只有一个对话，后端按消息自动拆成反馈单；管理员回复归入最新一单，不改变状态。
 */
import { HUB } from '../../lib/hub';
import { request } from '../../lib/http';

/** 单条消息正文的最大长度，与后端一致（按 JavaScript 字符串长度，即 UTF-16 计） */
export const MESSAGE_MAX_LENGTH = 1000;

/** 反馈单状态：pending 待处理，resolved 已处理 */
export type TicketStatus = 'pending' | 'resolved';

/** 消息发送方：user 用户，admin 管理员 */
export type Sender = 'user' | 'admin';

/** 用户发消息时附带的设备信息 */
export interface IClientInfo {
  /** App 版本与构建号，如 1.0.0 (12) */
  appVersion: string;
  /** 系统版本，如 iOS 27.1 */
  osVersion: string;
  /** 机型标识，如 iPhone18,1 */
  deviceModel: string;
  /** App 当前语言，如 zh-Hans */
  locale: string;
}

/** 反馈单 */
export interface ITicket {
  id: string;
  status: TicketStatus;
  /** 开单时间 */
  createdAt: string;
  /** 最近一次标记已处理的时间；待处理时为 null */
  resolvedAt: string | null;
  /** 本单最新一条消息的时间 */
  lastMessageAt: string;
}

/** 列表中的一张反馈单 */
export interface ITicketListItem extends ITicket {
  conversationId: string;
  /** 产品代号 */
  product: string;
  /** Logto 用户 ID */
  userId: string;
  /** 最新一条消息的摘要（最多 100 字） */
  lastMessage: { sender: Sender; content: string; createdAt: string } | null;
}

/** 反馈单列表的一页，按最新消息倒序 */
export interface ITicketPage {
  tickets: ITicketListItem[];
  /** 下一页游标；没有更多时为 null */
  nextBefore: number | null;
}

/** 对话详情 */
export interface IConversation {
  id: string;
  /** 产品代号 */
  product: string;
  /** Logto 用户 ID */
  userId: string;
  createdAt: string;
  /** 全部反馈单，从旧到新 */
  tickets: ITicket[];
}

/** 对话中的一条消息 */
export interface IMessage {
  /** 发送方客户端生成的 ID */
  id: string;
  /** 消息序号，越新越大 */
  seq: number;
  sender: Sender;
  content: string;
  createdAt: string;
  /** 所属反馈单，用于在消息之间画分隔线 */
  ticketId: string;
  /** 用户消息附带的设备信息；管理员消息为 null */
  clientInfo: IClientInfo | null;
}

/** 消息的一页，按序号倒序 */
export interface IMessagePage {
  messages: IMessage[];
  /** 更早消息的游标；没有更多时为 null */
  nextBefore: number | null;
}

/** 反馈单列表的筛选与分页 */
export interface ITicketFilter {
  /** 不传表示全部状态 */
  status?: TicketStatus;
  /** 不传表示全部产品 */
  product?: string;
  /** 上一页的 nextBefore */
  before?: number;
}

/** 每页条数 */
const PAGE_SIZE = 30;

/** 反馈单列表 */
export function listTickets(filter: ITicketFilter): Promise<ITicketPage> {
  return request<ITicketPage>(HUB, '/v1/admin/feedback/tickets', {
    query: { status: filter.status, product: filter.product, before: filter.before, limit: PAGE_SIZE },
  });
}

/** 对话详情：产品、用户与全部反馈单 */
export function getConversation(conversationId: string): Promise<IConversation> {
  return request<IConversation>(HUB, `/v1/admin/feedback/conversations/${conversationId}`);
}

/**
 * 对话消息，按序号倒序分页。
 *
 * @param before 只取比它旧的消息；不传表示从最新开始
 */
export function listMessages(conversationId: string, before?: number): Promise<IMessagePage> {
  return request<IMessagePage>(HUB, `/v1/admin/feedback/conversations/${conversationId}/messages`, {
    query: { before, limit: PAGE_SIZE },
  });
}

/**
 * 回复用户。
 *
 * @param messageId 客户端生成的消息 ID；重试时沿用同一个，后端据此去重
 */
export function sendReply(conversationId: string, messageId: string, content: string): Promise<IMessage> {
  return request<IMessage>(HUB, `/v1/admin/feedback/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { id: messageId, content },
  });
}

/** 修改反馈单状态；只有对话最新一单能改回待处理 */
export function updateTicketStatus(ticketId: string, status: TicketStatus): Promise<ITicket> {
  return request<ITicket>(HUB, `/v1/admin/feedback/tickets/${ticketId}/status`, {
    method: 'POST',
    body: { status },
  });
}

/** 状态的中文名 */
export function statusLabel(status: TicketStatus): string {
  return status === 'pending' ? '待处理' : '已处理';
}
