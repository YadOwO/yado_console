/**
 * 管理入口状态的共享副本：侧栏的待处理角标读它，列表页和对话页在数据变化后刷新它。
 */
import { fetchAdminStatus, type IAdminStatus } from './hub';

/** 最近一次查到的状态；启动前为 null */
export const adminStatus = $state<{ value: IAdminStatus | null }>({ value: null });

/** 重新查询并更新共享状态 */
export async function refreshAdminStatus(): Promise<IAdminStatus> {
  const status = await fetchAdminStatus();
  adminStatus.value = status;
  return status;
}
