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
| 子代理交付     | `src/task/task-job-delivery.ts`（单通道交付）    |
| 子代理生命周期 | `src/task/task-job.ts` + `task-job-recovery.ts`  |
| 子代理深度限制 | `src/task/subagent-depth.ts`                     |
| 子代理工具定义 | `src/task/task-tools.ts`                         |

## 架构说明

- **Fastify 5**：插件注册为顺序执行（`await app.register(...)`）。
- **认证**：JWT via `@fastify/jwt`。默认管理员从 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 环境变量初始化（开发默认 `admin@openAwork.local` / `admin123456`）。
- **数据库**：SQLite（`better-sqlite3`，同步 API）。`db.ts` 全为同步调用，无 async DB 操作。默认落到平台数据目录（Linux: `~/.local/share/OpenAWork/agent-gateway/openAwork.db`），也可通过 `OPENAWORK_DATA_DIR` / `OPENAWORK_DATABASE_PATH` 覆盖。
- **流式输出**：`/stream` 路由提供 SSE；`@fastify/websocket` 提供实时 WS。
- **桌面 Sidecar**：通过 `bun build --compile` 编译为二进制，嵌入 Tauri。构建 Tauri 用版本请执行 `bun run build:binary`，而非 `bun run build`。
- **消息渠道**：所有渠道实现 `MessagingChannelService`（start/stop/sendMessage/replyMessage），通过 `manager.ts` 注册管理。
- **会话权限阶梯**：三档 `ask`（默认）/`auto-edit`/`yolo`，统一由 `resolveSessionPermissionMode` 解析（`packages/agent-core/src/permission/session-permission-mode.ts:20`）。唯一执行点是 `src/tools/tool-sandbox.ts` 的 `ensurePermissionForTool`（:6142）。
- **阶梯顺序不变量**：免审批快捷分支（`tool-sandbox.ts:6215`，`yolo` 或后台 team 会话）与 `auto-edit` 分支（:6223）都在通配符 allow/deny（:6165）和作用域级 allow/deny（:6183）之后执行，因此 `auto-edit`/`yolo` 只能跳过 ask，绝不会放行被显式 `deny` 的调用。`auto-edit` 仅自动放行 `AUTO_EDIT_PERMISSION_CATEGORIES`（`edit`/`write`），并始终豁免 `AUTO_EDIT_EXCLUDED_TOOLS`（`workspace_review_revert`，回滚类仍需人工确认）。
- **deny-only 后置裁决（`permission.evaluate`）**：所有「放行 / 免审批」出口在返回前统一经过 `src/runtime/plugin-host.ts` 的 `permission.evaluate` hook（对齐 opencode v2.0.13），插件只能设 `effect='deny'`、永远无法授权，故上面的 deny-first 不变量不变；`ask` 路径也**先过该 hook 再落 pending**（否则被拒绝的调用会留下无人应答的 `permission_requests`）。`ensurePermissionForTool` 因此是 async，新增放行分支必须走 `gatePermissionDecision` 而不是直接 `return`；插件抛错只 warn，零插件注册时行为与改动前一致。
- **子会话继承档位**：task 子会话（`tool-sandbox.ts:4231`）与 handoff 子会话（`src/handoff/runner/watcher.ts:460`）仅在父会话确实表达过档位时（已写规范键或历史布尔 `yoloMode === true`）才按父会话解析结果继承 `permissionMode`，父会话未表达时保持缺席（按 `ask` 兜底，不凭空写入）；后台 team 成员无法交互审批，由 `isBackgroundAutoApprovedTeamSession`（`tool-sandbox.ts:5889`）判定免审批。
- **子代理交付 = 单通道（对齐 opencode）**：子代理完成后由 `task/task-job-delivery.ts` 的 `deliverTaskCompletion` 统一交付——① 幂等准入（`message/synthetic-message-injection.ts` 写入 `role: 'synthetic'` 的合成消息，`notificationId` 同时作消息 id 与唤醒键）；② 纯函数 `resolveTaskJobWakeDecision` 决策（`resume:false` / 父会话在飞 / 父会话 paused 一律**留库待消费**，不注册定时重试）；③ 需要唤醒时走 `routes/stream-runtime.ts` 的 `continueSessionFromHistory()`（`handleStreamRequest` 的 `continueFromHistory` 模式：不落用户轮、不派发用户消息插件事件、不计入「用户手动交互」）。**通知已落库 ⇒ 延后永不丢**（用户下一次自然发言时模型仍能看到它）。进程重启由 `task/task-job-recovery.ts` 在 `listen` 之后补偿投递。**自动唤醒受预算上限约束**（`task/task-wake-budget.ts`，上限 10）：唤醒是事件驱动的，若被唤醒的父会话又委派新的后台子代理，其完成会再次唤醒它 → 无界自激；因此 `deliverTaskCompletion` 在**决策为「要唤醒」之后**才消费预算，耗尽时**仍然投递通知**（只返回 `wake:'skipped'` + `deferReason:'budget-exhausted'`），计数只在**非网关内部请求**时重置（`isGatewayInternalRequestKey`——否则唤醒自身会把计数清零，上限永远触发不了）。
- **`synthetic` 消息角色契约**：`role: 'synthetic'` 对模型**可见**（`message/message-to-model-messages.ts` 保留，`v2-runtime/upstream/native-message-bridge.ts` 降级为上游 `user`），客户端**不得**按用户输入渲染；`Message.description` + `metadata = { source:'subagent', childID, agent, state }` 是客户端 notice 契约（`packages/shared/src/subagent-notice.ts` 是提取语义的 SSOT）。**读路径必须回传 `description`/`metadata`**（`v2ToV1Message` 曾漏，属静默缺陷）。
- **子代理工具名**：规范名 `subagent`（对齐上游），`task` 为历史别名——名称归一在 `routes/tool-name-compat.ts` 与 `tools/legacy-tool-name-rewrite.ts` 的镜像表，运行期判定统一用 `task/task-tools.ts` 的 `isTaskToolName()`。`createdByTool: 'task'` 是存量会话的**溯源标记**，与暴露名解耦，不要一起改。
- **发布顺序约束**：会话 metadata PATCH 校验是 `.strict()`（`src/session/session-workspace-metadata.ts:136`，`permissionMode` 在 :175），未知键直接报错；.NET 侧同语义（`services/agent-gateway-dotnet/src/OpenAWork.Gateway.Application/Features/Sessions/SessionMetadataSupport.cs:222`，未知键返回 `unrecognized_keys`）。因此网关（含 .NET 校验）必须先于客户端发送 `permissionMode` 上线；回滚时先回滚客户端。
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
OPENAWORK_BROWSER_LIVE=     # 1 = 启用网关侧浏览器实时预览（跨域页面也能采集控制台 / 网络）
BROWSER_LIVE_IDLE_TTL_MS=   # 浏览器实时预览会话空闲回收毫秒数，默认 120000
DESKTOP_AUTOMATION=         # 1 = 桌面自动化工具；同时兼容开启浏览器实时预览（桌面 sidecar 会注入）
```

## 常用命令

```bash
bun run --filter @openAwork/agent-gateway dev          # bun --watch 热重载（真 PTY）
bun run --filter @openAwork/agent-gateway dev:node     # tsx watch 热重载（Node 运行时 / 无 PTY 兜底）
bun run --filter @openAwork/agent-gateway build        # tsc 编译
bun run --filter @openAwork/agent-gateway build:binary # bun 编译 → Tauri sidecar 二进制
bun run --filter @openAwork/agent-gateway test         # 单测 + verification 验收脚本
bun run --filter @openAwork/agent-gateway test:verification # 仅跑验收脚本
bun run --filter @openAwork/agent-gateway test:message-v2   # 仅跑 message-v2 事件投影 / 深会话历史验收
bun run --filter @openAwork/agent-gateway test:task-tool    # 仅跑 task 默认免审批/自动运行回归
```

## 验收与回归约定

- `src/verification/verify-openai-responses.ts`：覆盖流式输出、工具回合与错误场景的后端验收链。
- `src/verification/verify-message-v2-event-projection.ts`：覆盖 message-v2 事件投影、Snapshot/PatchPart 与 session lifecycle 的正式验收链。
- `src/verification/verify-message-v2-deep-conversation.ts`：覆盖 message-v2 在 10+ 轮对话历史下的投影完整性、事件顺序与 transcript 读取一致性。
- `src/verification/verify-task-tool-no-permission.ts`：覆盖 task 子代理默认免审批，不会创建 `permission_requests`，也不会出现在 pending permissions 列表中的回归链。
- `src/verification/verify-task-tool-auto-run.ts`：覆盖 task 工具拿到执行上下文后，子会话会自动后台执行并回写父任务状态。
- `src/verification/verify-batch-permission-collect.ts`：覆盖**批量工具权限暂停**——只读兄弟在待批期间继续执行、被门控/待批准的兄弟写入 pending payload 的 `blockedToolCalls`（按 `tool_use` 顺序）、批准后整批按序恢复且只跑一轮上游。已接入 `test:batch-permission` 与 `test:verification`。
- `src/verification/verify-batch-permission-multi-pending.ts`：覆盖**多 pending 顺序审批**——第一个被批准后，被扣住的兄弟会升起自己的 pending 并使回合再次暂停（**不向上游发任何请求**）；逐个批准直至全部落定后**恰好一次**上游调用，结果保持 `tool_use` 顺序。同属 `test:batch-permission`。
- CI 无需单独新增步骤：`.github/workflows/ci.yml` 已通过 `bun run --filter "@openAwork/agent-gateway" test` 间接覆盖上述脚本。

## 测试分层说明

- `src/__tests__/permissions-routes.test.ts`：关注权限路由本身的 create/list/reply 与恢复交接，不重复承担 task 子代理端到端验收。
- `src/verification/verify-openai-responses.ts`：现在同时覆盖 Responses 的 EOF 缺尾部分隔符，以及 chat_completions 缺 `[DONE]` 的工具回合续跑边界。
- `src/verification/verify-message-v2-event-projection.ts` / `verify-message-v2-deep-conversation.ts`：message-v2 的正式验证资产必须走 `src/verification/verify-*.ts`，使用源码导入、临时 DB 与可控环境；`scripts/*.mjs` 只保留为兼容 wrapper，不再承载真实验证逻辑。
- `src/verification/verify-permissions-routes.ts`：覆盖权限请求的 create/list/reply/pending 清空这条 HTTP 路由回归链。
- `src/verification/verify-session-task-routes.ts`：覆盖 `/sessions/:sessionId/tasks` 对任务图层级元数据的 HTTP 投影回归。
- `src/verification/verify-task-tool-no-permission.ts`：覆盖 task 子代理不会再进入权限待批准链路，前端 pending permissions 列表保持为空。
- `src/verification/verify-*.ts`：关注真实业务链路的 ATDD / regression；新增场景时优先放这里，只有 MCP resume、permission route handoff 这类窄职责才放回 `src/__tests__/`。

## 禁止事项

- 禁止本地开发使用 `build` 二进制，应使用 `dev`（bun --watch，可获真 PTY）；需要 Node 运行时则用 `dev:node`（tsx watch，显式管道降级）。
- 禁止在 `db.ts` 外添加同步阻塞代码——Fastify 是异步框架。
- 新增渠道必须完整实现 `MessagingChannelService` 接口。
- 禁止从 `dist/` 导入——`@openAwork/*` 包使用 `workspace:*`。
- 禁止硬编码管理员凭据，必须使用环境变量。
