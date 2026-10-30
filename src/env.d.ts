/// <reference types="svelte" />
/// <reference types="vite/client" />

/** 构建时注入的配置，均可选；不配置时使用 src/lib/config.ts 中的线上值 */
interface ImportMetaEnv {
  /** 统一登录（Logto）地址 */
  readonly VITE_LOGTO_ENDPOINT?: string;
  /** Logto 后台「芽豆管理端」单页应用的 App ID */
  readonly VITE_LOGTO_APP_ID?: string;
  /** yado_hub 地址 */
  readonly VITE_HUB_API?: string;
  /** 为 'true' 时跳过登录，仅 pnpm dev 下生效 */
  readonly VITE_AUTH_DEV_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
