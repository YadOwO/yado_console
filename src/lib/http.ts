/**
 * 调用各后端管理接口的通用请求。
 *
 * 每次请求前向 Logto 取对应 API 资源的 access token；错误统一转成 ApiError，
 * 错误码与提示沿用后端的 { code, message }。
 */
import { getAccessToken } from './auth';

/** 一个后端：地址与它在 Logto 中的 API 资源标识 */
export interface IBackend {
  /** 后端地址，如 https://hub-api.yado1225.top */
  baseUrl: string;
  /** API 资源标识，如 https://api.yado1225.top/hub */
  resource: string;
}

/** 查询参数；值为 undefined 的项不发送 */
export type Query = Record<string, string | number | undefined>;

/** 请求选项 */
export interface IRequestOptions {
  /** 默认 GET */
  method?: 'GET' | 'POST';
  /** 查询参数 */
  query?: Query;
  /** JSON 请求体 */
  body?: unknown;
}

/** 接口调用失败 */
export class ApiError extends Error {
  /** HTTP 状态码；网络不通时为 0 */
  readonly status: number;
  /** 后端错误码，如 UNAUTHORIZED、TICKET_NOT_LATEST */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** 是否为「登录失效」：token 过期、被吊销或续期失败，需要重新登录 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** 给用户看的错误说明 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 从后端错误响应中取出 code 与 message */
function readErrorBody(data: unknown): { code?: string; message?: string } {
  if (typeof data !== 'object' || data === null) {
    return {};
  }
  return {
    code: 'code' in data && typeof data.code === 'string' ? data.code : undefined,
    message: 'message' in data && typeof data.message === 'string' ? data.message : undefined,
  };
}

/**
 * 调用后端接口并返回 JSON。
 *
 * @param backend 目标后端
 * @param path 接口路径，如 /v1/admin/status
 * @param options 方法、查询参数与请求体
 * @throws ApiError 登录失效、网络不通或后端返回错误
 */
export async function request<T>(backend: IBackend, path: string, options: IRequestOptions = {}): Promise<T> {
  const url = new URL(path, backend.baseUrl);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  let token: string;
  try {
    token = await getAccessToken(backend.resource);
  } catch {
    // refresh token 过期或被吊销时 SDK 会抛错，统一按登录失效处理
    throw new ApiError(401, 'TOKEN_UNAVAILABLE', '登录已失效，请重新登录');
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', '网络连接失败，请稍后重试');
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const { code, message } = readErrorBody(data);
    throw new ApiError(response.status, code ?? `HTTP_${response.status}`, message ?? `请求失败（${response.status}）`);
  }
  // 后端由我们自己维护，契约以其 openapi.json 为准，这里不再逐字段校验
  return data as T;
}
