/**
 * yado_hub（芽豆公共服务）的连接信息与管理入口接口。
 *
 * 各功能的管理接口写在 modules/<功能>/api.ts 里，都经这里的 HUB 发请求。
 */
import { HUB_API, HUB_RESOURCE } from './config';
import { request, type IBackend } from './http';

/** yado_hub 后端 */
export const HUB: IBackend = { baseUrl: HUB_API, resource: HUB_RESOURCE };

/** 管理入口状态 */
export interface IAdminStatus {
  /** 当前账号是否为管理员 */
  isAdmin: boolean;
  /** 全部产品的待处理反馈单数；非管理员为 null */
  pendingTicketCount: number | null;
}

/** 查询当前账号是否为管理员，以及待处理的反馈单数；非管理员也返回 200 */
export function fetchAdminStatus(): Promise<IAdminStatus> {
  return request<IAdminStatus>(HUB, '/v1/admin/status');
}
