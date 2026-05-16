# web-client — 知识库

## 概述

浏览器端网关客户端：WebSocket + SSE 流式通信、认证辅助函数、会话 API 客户端，以及覆盖全部网关资源域的 HTTP 封装。被 `apps/web`、`apps/desktop` 和 `apps/mobile` 共同使用。

## 目录结构

```
src/
├── index.ts               # 桶导出——所有公开 API 在此导出
├── http.ts                # 共享 HTTP 辅助：HttpError、authHeader、expectJson 等
├── gateway-ws.ts          # GatewayWebSocketClient — 通过 WS 实时流式 Agent 输出
├── gateway-sse.ts         # GatewaySSEClient — SSE 流式客户端
├── auth.ts                # login()、refreshAccessToken()、logout() — JWT Token 管理
├── pairing.ts             # 设备配对（QR / desktop-default / pairing-token）
├── sessions.ts            # createSessionsClient() — Agent 会话增删改查
├── workspace.ts           # createWorkspaceClient() — 工作区文件/目录/审阅
├── settings.ts            # createSettingsClient() — providers/MCP/plugins/companion 等
├── skills.ts              # createSkillsClient() — 技能商城/安装/选择集/推荐
├── artifacts.ts           # createArtifactsClient() — 产物 CRUD/版本/图像生成
├── usage.ts               # createUsageClient() — 用量记录/费用拆分
├── cron.ts                # createCronClient() — 定时任务
├── channels.ts            # createChannelsClient() — 消息渠道 CRUD/启停
├── github.ts              # createGitHubClient() — GitHub trigger 注册
├── ssh.ts                 # createSshClient() — SSH 连接/文件浏览/上传
├── desktop-automation.ts  # createDesktopAutomationClient() — Playwright sidecar
├── health.ts              # createHealthClient() / isGatewayHealthy() — 探活
├── session-terminals.ts   # createSessionTerminalsClient() — 会话终端
├── team-runtime.ts        # createTeamRuntimeClient() — interaction-agent/team-leader
├── team.ts                # createTeamClient() — 团队工作区/运行时
├── team-phase-a.ts        # createTeamPhaseAClient() — 宪法/人格/记忆
├── memories.ts            # createMemoriesClient() — 长期记忆 CRUD
├── notifications.ts       # createNotificationsClient() — 通知
├── permissions.ts         # createPermissionsClient() — 权限请求
├── questions.ts           # createQuestionsClient() — 问题请求
├── agents.ts              # createAgentsClient() — 托管 Agent CRUD
├── workflows.ts           # createWorkflowsClient() — 工作流模板
├── capabilities.ts        # createCapabilitiesClient() — 能力查询
├── commands.ts            # createCommandsClient() — 命令执行
└── token-refresh.ts       # withTokenRefresh() — Token 自动刷新包装器
```

## 查找指引

| 任务                          | 位置                        |
| ----------------------------- | --------------------------- |
| WS 流式                       | `src/gateway-ws.ts`         |
| SSE 流式                      | `src/gateway-sse.ts`        |
| 认证（登录/刷新/登出）        | `src/auth.ts`               |
| 会话 CRUD                     | `src/sessions.ts`           |
| 工作区文件/目录/审阅          | `src/workspace.ts`          |
| 设置（providers/MCP/plugins） | `src/settings.ts`           |
| 技能商城/安装/选择集          | `src/skills.ts`             |
| 产物/图像生成                 | `src/artifacts.ts`          |
| 用量/费用                     | `src/usage.ts`              |
| 定时任务                      | `src/cron.ts`               |
| 消息渠道                      | `src/channels.ts`           |
| SSH 连接                      | `src/ssh.ts`                |
| 桌面自动化                    | `src/desktop-automation.ts` |
| 健康检查                      | `src/health.ts`             |
| 会话终端                      | `src/session-terminals.ts`  |
| 团队运行时                    | `src/team-runtime.ts`       |
| 长期记忆                      | `src/memories.ts`           |

## 强制规则

### 所有网关请求必须走 web-client

**禁止在 `apps/` 或其它 `packages/` 中直接调用 `fetch()` 访问 `agent-gateway` 端点。**

- 新增网关路由时，必须**先**在 `packages/web-client/src/` 中新建或扩展对应客户端模块，**再**在消费端（`apps/web`、`apps/desktop`、`apps/mobile`）通过 `@openAwork/web-client` 导入使用。
- 每个客户端模块遵循 `create<Domain>Client(baseUrl)` 工厂模式，返回一个方法集合对象，每个方法接收 `token` 作为第一个参数。
- 错误统一使用 `HttpError`（来自 `src/http.ts`），携带 `status` 和可选 `data`。
- 响应类型如果在 `apps/` 侧已有具体 schema（如 `AIProviderRef`），客户端层可用 `unknown` 透传，由消费端自行 `as` 收敛——避免跨包重复定义 schema。

### 例外（允许直连）

- 第三方外部 API（LLM 厂商、搜索引擎、GitHub releases 等）。
- `packages/` 内各自子领域客户端（`pairing`、`lsp-client`、`telemetry`、`agent-core`）——它们有独立的通信协议或运行在 Node.js 服务端。
- `apps/desktop/src/updater/` — 访问 GitHub releases 做自动更新。

### 新增客户端模块检查清单

- [ ] 在 `src/<domain>.ts` 中定义 `interface <Domain>Client` 和 `function create<Domain>Client(baseUrl)`。
- [ ] 在 `src/index.ts` 中导出 factory 函数和类型。
- [ ] 跑 `pnpm --filter @openAwork/web-client build` 确认 dist 产出。
- [ ] 在消费端用 `create<Domain>Client(gatewayUrl).<method>(token, ...)` 调用。

## 禁止事项

- 禁止在 Node.js/服务端上下文中使用此包——仅支持浏览器 API（`EventSource`、`WebSocket`、`fetch`）。
- 禁止将 Token 存储在非 Zustand 状态中——使用 `apps/web/src/stores/auth.ts`。
- 禁止绕过此包直接 `fetch` 网关端点——见上方「强制规则」。
- 禁止在客户端模块中引入 React / 框架依赖——保持纯 TS + fetch。
