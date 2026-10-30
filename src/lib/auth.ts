/**
 * 登录：以单页应用接入芽豆统一登录（Logto）。
 *
 * token 由 Logto SDK 存在 localStorage，过期前自动用 refresh token 续期。
 * 这里只负责「是谁」，「是不是管理员」由各后端的管理接口判断。
 */
import LogtoClient from '@logto/browser';

import { HUB_RESOURCE, IS_AUTH_DEV_BYPASS, LOGTO_APP_ID, LOGTO_ENDPOINT } from './config';

/** 登录回调路径；与 Logto 后台登记的 Redirect URI 一致 */
export const CALLBACK_PATH = '/callback';

/** 登录前所在页面的存储键，登录回来后跳回去 */
const RETURN_PATH_KEY = 'yado.console.returnPath';

/** Logto 客户端；以后接入其他后端时，把它的 API 资源加进 resources */
const client = new LogtoClient({
  endpoint: LOGTO_ENDPOINT,
  appId: LOGTO_APP_ID,
  resources: [HUB_RESOURCE],
});

/** 是否已登录 */
export async function isAuthenticated(): Promise<boolean> {
  if (IS_AUTH_DEV_BYPASS) {
    return true;
  }
  return client.isAuthenticated();
}

/** 跳转到统一登录页，记下当前页面以便登录后返回 */
export async function signIn(): Promise<void> {
  const path = location.pathname + location.search;
  try {
    sessionStorage.setItem(RETURN_PATH_KEY, path === CALLBACK_PATH ? '/' : path);
  } catch {
    // 无痕模式等场景存储不可用时，登录后回首页即可
  }
  await client.signIn(location.origin + CALLBACK_PATH);
}

/**
 * 处理登录回调，换取 token。
 *
 * @returns 登录前所在的站内路径
 */
export async function handleSignInCallback(): Promise<string> {
  await client.handleSignInCallback(location.href);
  let path = '/';
  try {
    path = sessionStorage.getItem(RETURN_PATH_KEY) ?? '/';
    sessionStorage.removeItem(RETURN_PATH_KEY);
  } catch {
    // 存储不可用时回首页
  }
  // 只接受站内路径，避免被构造成跳去外站
  return path.startsWith('/') && !path.startsWith('//') ? path : '/';
}

/** 退出登录：清掉本地 token 并结束 Logto 会话，回到首页 */
export async function signOut(): Promise<void> {
  if (IS_AUTH_DEV_BYPASS) {
    location.assign('/');
    return;
  }
  await client.signOut(location.origin + '/');
}

/**
 * 取调用某个后端用的 access token；SDK 有缓存，快过期时才续期。
 *
 * @param resource 后端在 Logto 中的 API 资源标识
 */
export async function getAccessToken(resource: string): Promise<string> {
  if (IS_AUTH_DEV_BYPASS) {
    return 'dev';
  }
  return client.getAccessToken(resource);
}

/** 当前账号的显示名：用户名，其次昵称，最后是 Logto 用户 ID */
export async function getDisplayName(): Promise<string> {
  if (IS_AUTH_DEV_BYPASS) {
    return 'dev-user';
  }
  const claims = await client.getIdTokenClaims();
  return claims.username ?? claims.name ?? claims.sub;
}
