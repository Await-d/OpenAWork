# agent-gateway — 知识库

## 概述

Fastify 5 HTTP/WS 服务器，是 Web、桌面端（Sidecar）和消息渠道的唯一后端。负责 JWT 认证、Agent 会话流式输出（SSE + WS）、消息渠道管理、LSP 代理、GitHub 集成和定时任务。

## 目录结构

```
src/
├── index.ts          # 启动入口：注册插件与路由，初始化管理员，启动监听
├── auth.ts           # Fastify JWT 认证插件（@fastify/jwt）
├── db.ts             # SQLite（better-sqlite3）：connectDb/closeDb/migrate/sqliteGet/Run
├── model-router.ts   # 将 LLM 请求路由到对应 Provider
├── tool-sandbox.ts   # Agent 任务的沙箱化工具执行
├── verification/     # 场景化验收脚本（Responses/任务权限恢复/子任务自动运行）
├── web-static.ts     # 通过 @fastify/static 托管构建后的 Web SPA
├── routes/
│   ├── sessions.ts   # Agent 会话的增删改查
│   └── stream.ts     # SSE 流式端点，实时 Agent 输出
├── channels/
│   ├── types.ts      # MessagingChannelService 接口及相关类型
│   ├── manager.ts    # 渠道生命周期管理器
│   ├── router.ts     # 渠道 HTTP 路由
│   ├── telegram.ts / discord.ts / feishu.ts / dingtalk.ts / slack.ts
│   ├── auto-reply.ts / identity-mapping.ts
│   └── mcp-oauth.ts / mcp-oauth-fallback.ts
├── github/           # GitHub Webhook 与触发路由
├── lsp/              # LSP 代理路由
├── cron/             # 定时任务路由与调度器
└── cli/              # CLI 入口辅助
```

## 查找指引

| 任务           | 位置                                             |
| -------------- | ------------------------------------------------ |
| 新增 HTTP 路由 | `src/routes/`（参考 sessions.ts）                |
| SSE 流式逻辑   | `src/routes/stream.ts`                           |
| JWT 认证       | `src/auth.ts`                                    |
| SQLite 查询    | `src/db.ts` — `sqliteGet` / `sqliteRun`          |
| 新增消息渠道   | `src/channels/` — 实现 `MessagingChannelService` |
| 渠道管理       | `src/channels/manager.ts`                        |
| LSP 代理       | `src/lsp/router.ts`                              |
| GitHub Webhook | `src/github/router.ts`                           |
| 定时任务       | `src/cron/router.ts`                             |
| 工具沙箱       | `src/tool-sandbox.ts`                            |
| 验收脚本       | `src/verification/verify-*.ts`                   |

## 架构说明

- **Fastify 5**：插件注册为顺序执行（`await app.register(...)`）。
- **认证**：JWT via `@fastify/jwt`。默认管理员从 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 环境变量初始化（开发默认 `admin@openAwork.local` / `admin123456`）。
- **数据库**：SQLite（`better-sqlite3`，同步 API）。`db.ts` 全为同步调用，无 async DB 操作。默认落到平台数据目录（Linux: `~/.local/share/OpenAWork/agent-gateway/openAwork.db`），也可通过 `OPENAWORK_DATA_DIR` / `OPENAWORK_DATABASE_PATH` 覆盖。
- **流式输出**：`/stream` 路由提供 SSE；`@fastify/websocket` 提供实时 WS。
- **桌面 Sidecar**：通过 `bun build --compile` 编译为二进制，嵌入 Tauri。构建 Tauri 用版本请执行 `pnpm build:binary`，而非 `pnpm build`。
- **消息渠道**：所有渠道实现 `MessagingChannelService`（start/stop/sendMessage/replyMessage），通过 `manager.ts` 注册管理。
- **ESLint**：此包参与代码检查（严格 TS 规则，与 `apps/` 不同）。

## 环境变量

```
GATEWAY_PORT=3000
GATEWAY_HOST=0.0.0.0
JWT_SECRET=                # 最少 32 字符，生成：openssl rand -base64 32
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
OPENAWORK_DATA_DIR=        # 可选，Gateway durable 数据根目录
OPENAWORK_DATABASE_PATH=   # 可选，显式 SQLite 文件路径
DATABASE_URL=              # 兼容保留的 SQLite 路径覆盖项（不要填 Postgres URL）
REDIS_URL=
AI_API_KEY=
AI_API_BASE_URL=
AI_DEFAULT_MODEL=
```

## 常用命令

```bash
pnpm --filter @openAwork/agent-gateway dev          # tsx watch 热重载
pnpm --filter @openAwork/agent-gateway build        # tsc 编译
pnpm --filter @openAwork/agent-gateway build:binary # bun 编译 → Tauri sidecar 二进制
pnpm --filter @openAwork/agent-gateway test         # 单测 + verification 验收脚本
pnpm --filter @openAwork/agent-gateway run test:verification # 仅跑验收脚本
pnpm --filter @openAwork/agent-gateway run test:task-tool    # 仅跑 task 默认免审批/自动运行回归
```

## 验收与回归约定

- `src/verification/verify-openai-responses.ts`：覆盖流式输出、工具回合与错误场景的后端验收链。
- `src/verification/verify-task-tool-no-permission.ts`：覆盖 task 子代理默认免审批，不会创建 `permission_requests`，也不会出现在 pending permissions 列表中的回归链。
- `src/verification/verify-task-tool-auto-run.ts`：覆盖 task 工具拿到执行上下文后，子会话会自动后台执行并回写父任务状态。
- CI 无需单独新增步骤：`.github/workflows/ci.yml` 已通过 `pnpm --filter "@openAwork/agent-gateway" test` 间接覆盖上述脚本。

## 测试分层说明

- `src/__tests__/permissions-routes.test.ts`：关注权限路由本身的 create/list/reply 与恢复交接，不重复承担 task 子代理端到端验收。
- `src/verification/verify-openai-responses.ts`：现在同时覆盖 Responses 的 EOF 缺尾部分隔符，以及 chat_completions 缺 `[DONE]` 的工具回合续跑边界。
- `src/verification/verify-permissions-routes.ts`：覆盖权限请求的 create/list/reply/pending 清空这条 HTTP 路由回归链。
- `src/verification/verify-session-task-routes.ts`：覆盖 `/sessions/:sessionId/tasks` 对任务图层级元数据的 HTTP 投影回归。
- `src/verification/verify-task-tool-no-permission.ts`：覆盖 task 子代理不会再进入权限待批准链路，前端 pending permissions 列表保持为空。
- `src/verification/verify-*.ts`：关注真实业务链路的 ATDD / regression；新增场景时优先放这里，只有 MCP resume、permission route handoff 这类窄职责才放回 `src/__tests__/`。

## 禁止事项

- 禁止本地开发使用 `build` 二进制，应使用 `dev`（tsx watch）。
- 禁止在 `db.ts` 外添加同步阻塞代码——Fastify 是异步框架。
- 新增渠道必须完整实现 `MessagingChannelService` 接口。
- 禁止从 `dist/` 导入——`@openAwork/*` 包使用 `workspace:*`。
- 禁止硬编码管理员凭据，必须使用环境变量。
