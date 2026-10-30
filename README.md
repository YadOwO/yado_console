# yado_console

芽豆统一管理端：一个网页管理芽豆全部产品，第一版只有意见反馈。纯静态单页应用（Svelte 5），
由服务器上已有的 nginx 直接提供，直接调用各后端的管理接口。设计见 [docs/console-design.md](docs/console-design.md)。

| 项目 | 值 |
| --- | --- |
| 地址 | `https://console.yado1225.top`（泛域名证书已覆盖） |
| 登录 | 芽豆统一登录（Logto）的单页应用，管理员账号 `admin` |
| 后端 | yado_hub `https://hub-api.yado1225.top` |
| 服务器目录 | `/opt/yado/nginx/html/yado-console/`（`current` 软链指向当前版本） |

## 本地开发

```bash
pnpm install
pnpm dev        # http://localhost:5175
pnpm check      # 类型检查
pnpm build      # 构建并检查体积预算
```

两种用法：

- **连线上 yado_hub，真实登录**：不需要任何配置。要求 Logto 应用已登记 `http://localhost:5175` 的回调地址，
  yado_hub 的 `CORS_ORIGINS` 包含 `http://localhost:5175`。
- **连本机 yado_hub，跳过登录**：把 `.env.example` 复制为 `.env.local`，打开其中两行；
  本机 yado_hub 的 `.env` 也要开启 `AUTH_DEV_BYPASS=true`，并把 `AUTH_DEV_USER_ID` 加进 `ADMIN_USER_IDS`。

## 首次上线（一次性）

1. **GitHub**：创建仓库 `YadOwO/yado_console` 并推送。
2. **DNS**：添加 A 记录 `console` → `8.163.21.152`。
3. **Logto**：Console → Applications → 新建 **Single page app**，名称「芽豆管理端」：
   - Redirect URIs：`https://console.yado1225.top/callback`、`http://localhost:5175/callback`
   - Post sign-out redirect URIs：`https://console.yado1225.top/`、`http://localhost:5175/`
   - 把 App ID 写进 `src/lib/config.ts` 的 `LOGTO_APP_ID` 默认值（App ID 不是秘密）。
4. **yado_hub 跨域**：服务器 `/opt/yado/yado-hub/.env` 的 `CORS_ORIGINS` 改为
   `https://console.yado1225.top,http://localhost:5175`，然后 `docker compose up -d yado-hub`。
5. **站点目录与部署脚本**：
   ```bash
   install -d -o yado -g yado -m 755 /opt/yado/nginx/html/yado-console
   # 本机：scp deploy/scripts/deploy-yado-console.sh root@8.163.21.152:/opt/yado/scripts/
   chown yado:yado /opt/yado/scripts/deploy-yado-console.sh && chmod 755 /opt/yado/scripts/deploy-yado-console.sh
   ```
6. **CI 密钥**：
   ```bash
   # 本机生成一把新的部署密钥，不要复用其他服务的
   ssh-keygen -t ed25519 -f ~/.ssh/yado_console_ci_deploy -C github-actions-yado-console-deploy -N ''
   ```
   在服务器 `/home/yado/.ssh/authorized_keys` 追加：
   ```
   command="/opt/yado/scripts/deploy-yado-console.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <公钥内容>
   ```
   私钥内容填入 GitHub 仓库 Secret `DEPLOY_SSH_KEY`；需要部署通知时再配 `BARK_DEVICE_KEY`。
7. **nginx**：把 `deploy/nginx/console.yado1225.top.conf` 放到 `/opt/yado/nginx/conf.d/`，
   `docker exec yado-nginx-1 nginx -t && docker exec yado-nginx-1 nginx -s reload`。
8. **上线**：合并到 `main` 触发 Actions，或手动 workflow_dispatch。Actions 最后会确认线上首页已是本次构建。

## 日常发布

在 `dev` 开发，合并到 `main` 后 GitHub Actions 依次执行类型检查、构建（含体积预算）、预压缩，
再把产物经 SSH 传给服务器部署脚本：解压到新的版本目录，原子切换 `current` 软链，保留最近 5 个版本。

## 回滚

```bash
ssh root@8.163.21.152
cd /opt/yado/nginx/html/yado-console
ls releases                                   # 版本目录名是发布时刻，如 20261030153000
ln -sfn releases/<上一个版本> .current.tmp && mv -T .current.tmp current
```

不需要 reload nginx。下次合并到 `main` 会照常发布新版本。
