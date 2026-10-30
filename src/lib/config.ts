/**
 * 管理端的全局配置。
 *
 * 这些值都会打进前端代码，不是秘密：Logto 的单页应用没有 App Secret，能否调用管理接口由各后端校验 token 决定。
 * 本地开发可以在 .env.local 里用 VITE_* 变量覆盖（见 .env.example）。
 */

/** 统一登录（Logto）地址 */
export const LOGTO_ENDPOINT: string = import.meta.env.VITE_LOGTO_ENDPOINT ?? 'https://accounts.yado1225.top';

/** Logto 后台「芽豆管理端」单页应用（yado_console）的 App ID */
export const LOGTO_APP_ID: string = import.meta.env.VITE_LOGTO_APP_ID ?? 'n2pvxn8lkz9mh2i51lxrg';

/** yado_hub 在 Logto 中的 API 资源标识，用于换取调用 yado_hub 的 access token */
export const HUB_RESOURCE = 'https://api.yado1225.top/hub';

/** yado_hub 地址 */
export const HUB_API: string = import.meta.env.VITE_HUB_API ?? 'https://hub-api.yado1225.top';

/** 本地开发跳过登录：只在 pnpm dev 下生效，生产构建里恒为 false，相关分支会被整段删掉 */
export const IS_AUTH_DEV_BYPASS: boolean = import.meta.env.DEV && import.meta.env.VITE_AUTH_DEV_BYPASS === 'true';

/** 已接入的产品；代号与 yado_hub 的 PRODUCT_CODES 一致 */
export const PRODUCTS = [
  { code: 'yadoa', name: 'yadoA' },
  { code: 'yadoi', name: 'yadoI' },
] as const;

/** 产品代号 */
export type ProductCode = (typeof PRODUCTS)[number]['code'];

/** 判断是否为已接入的产品代号 */
export function isProductCode(value: string | null): value is ProductCode {
  return PRODUCTS.some((product) => product.code === value);
}

/** 产品代号对应的显示名；未知代号（如已下线的产品）原样显示 */
export function productName(code: string): string {
  return PRODUCTS.find((product) => product.code === code)?.name ?? code;
}
