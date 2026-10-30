import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  // 端口固定：本地登录回调地址 http://localhost:5175/callback 登记在 Logto 后台
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
  build: {
    target: 'es2022',
    // 管理端只有一个页面入口，不拆包，首屏一次加载完
    modulePreload: { polyfill: false },
  },
});
