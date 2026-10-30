# yado_console 项目规则

本文件适用于 yado_console 仓库（芽豆统一管理端，Svelte 5 纯静态单页应用），是 Codex、Kiro CLI、
Claude Code 及其他代码 Agent 的项目规则唯一来源。设计见 [docs/console-design.md](docs/console-design.md)。

## Agent 与 Skill 使用边界

- 本仓库是个人项目，不适用 Webull 工作流。
- 禁止调用或遵循任何名称以 `wb-` 开头的 skill，包括但不限于 `wb-commit`、
  `wb-code-review`、`wb-create-git-branch`、`wb-mr`、`wb-read-prd` 和 `wb-test-gen`。
- Git 提交、代码审查、分支和需求处理应遵循用户当次指令与本文件规则。

## 语言

- 对话回复、文档、代码注释、界面文案统一用中文。管理端只给内部使用，不做多语言。
- 代码标识符（变量、函数、类型、配置键）用英文。

## 轻量优先（最重要）

- 性能和体积是第一约束。`pnpm build` 会检查产物体积（`scripts/check-size.mjs`），超出预算即失败；
  不要为了通过检查而直接调高预算，确需放宽时先与维护者确认并写明原因。
- 不引入组件库、CSS 框架、路由库、状态管理库、日期库、图标库；需要的能力手写或用浏览器内置 API。
- 不要自行安装新依赖，需先与维护者确认。
- 只用系统字体，不加载网络字体和第三方脚本。

## 结构

```
src/lib/                    跨功能通用：配置、登录、请求、路由、时间格式、各后端连接
src/lib/<后端>.ts           一个后端一个文件：地址、Logto API 资源与后端级接口（如 hub.ts）
src/modules/<功能>/api.ts   该功能的管理接口与类型，结构以后端 openapi.json 为准
src/modules/<功能>/*.svelte 该功能的页面
src/App.svelte              登录与管理员校验、侧栏导航、按路径选页面
src/app.css                 全局颜色、字体与通用控件样式
```

- 新增功能：建 `modules/<功能>/`，在 `router.svelte.ts` 的 `matchRoute` 加路径，在 `App.svelte` 加导航项和页面。
- 新增后端：在 `lib/` 加连接文件，把它的 API 资源加进 `auth.ts` 的 resources，并把地址加进
  `deploy/nginx/console.yado1225.top.conf` 的 CSP `connect-src`。

## 代码约定

- Svelte 5 runes 写法（`$state`、`$derived`、`$effect`、`$props`），不用 Svelte 4 的 store 与 `export let`。
- 禁止 `any`、`@ts-ignore`；`as` 只用在 `lib/http.ts` 的响应解析这一处。
- 导出的函数、类型显式标注参数与返回值类型。
- 声明级注释用中文 `/** */`，说明业务含义或关键约束；流程说明用 `//`。
- 颜色只用 `app.css` 里的变量，浅色与深色都要适配；布局在 390px 宽的手机上不能横向滚动。

## 安全

- 不在代码里放任何密钥。Logto 单页应用的 App ID 和各后端地址不是秘密，可以写在 `lib/config.ts`。
- 管理员资格以后端为准，前端的判断只决定显示什么，不能当作权限控制。
- 用户提交的反馈内容只按纯文本渲染，不要用 `{@html}`。

## 改动前后

- 改完至少执行 `pnpm run check` 与 `pnpm run build`。
- 改了页面后在本地实际打开看一遍，包括浅色、深色和手机宽度，见 README「本地开发」。
