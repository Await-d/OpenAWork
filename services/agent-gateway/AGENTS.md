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
| 子代理数量限制 | `src/task/subagent-limits.ts`（用户级可调）      |
| 子代理深度限制 | `src/task/subagent-depth.ts`                     |
| 子代理工具定义 | `src/task/task-tools.ts`                         |

## 架构说明

- **Fastify 5**：插件注册为顺序执行（`await app.register(...)`）。
- **认证**：JWT via `@fastify/jwt`。默认管理员从 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 环境变量初始化（开发默认 `admin@openAwork.local` / `admin123456`）。
- **数据库**：SQLite（`better-sqlite3`，同步 API）。`db.ts` 全为同步调用，无 async DB 操作。默认落到平台数据目录（Linux: `~/.local/share/OpenAWork/agent-gateway/openAwork.db`），也可通过 `OPENAWORK_DATA_DIR` / `OPENAWORK_DATABASE_PATH` 覆盖。
- **流式输出**：`/stream` 路由提供 SSE；`@fastify/websocket` 提供实时 WS。
- **桌面 Sidecar**：通过 `bun build --compile` 编译为二进制，嵌入 Tauri。构建 Tauri 用版本请执行 `bun run build:binary`，而非 `bun run build`。
- **消息渠道**：所有渠道实现 `MessagingChannelService`（start/stop/sendMessage/replyMessage），通过 `manager.ts` 注册管理。
- **渠道媒体能力（2026-09-23 两批落地）**：入站图片走通用消费链路（`auto-reply.ts:400` 的 `buildInputImageParts` → `InputImageContent`，支持 base64 / imageUrl 双形态）。**下载转 base64 的平台**：Telegram（`telegram-media.ts`，4MB 上限；文件 URL 携带 bot token 不可外泄；轮询 fire-and-forget `dispatchUpdate` 不 await 下载、不传 `pollAbort` 防竞态）、Slack（`slack-media.ts`，`url_private_download` + Bearer，需 `files:read` scope，4MB / 4 张上限）、WhatsApp（`whatsapp-media.ts`，两步 Graph API 下载，5MB 上限，经 `enrichInboundMessage` 钩子）。**直映射 URL 的平台**：Discord（CDN 附件 URL，签名约 24h 时效）、QQ（富媒体 `attachments[].url`，4 张上限）、企业微信（`PicUrl` → `imageUrl`，v1 不下载、mime 默认 `image/jpeg`）。出站：Telegram `/sendPhoto` multipart（caption ≤1024 截断）、Discord `/channels/{id}/messages` multipart（`payload_json` + `files[0]`，content ≤2000 截断，**multipart 不得带 `Content-Type: application/json`**）、Slack（`files.uploadV2`，`replyImage` 用 `thread_ts` 挂线程）、WhatsApp（两步：`/{phoneNumberId}/media` 上传 → `/messages` 发 image/document）；`PluginSendImage` / `replyImage` 由工具层能力探测自动打通（`tools/channel-tools.ts:95-122`），无需改描述符。所有下载实现统一对齐 `telegram-media.ts` 分层范式（入参超限零网络短路 → 上游响应校验 → 下载后长度复核 → 失败只 warn 返回 `null`，绝不抛错；消息按 `[User sent an image]` 占位符投递）。已知限制：非图片附件忽略；`sourceUrl` 在 Telegram/Discord 出站保留但不用（调用方先取 buffer）；企业微信入站图片 v1 仅 `PicUrl` 直映射（不下载 `MediaId`）；钉钉无任何媒体能力（入站图片与出站文件均不做）。**relay（`wsUrl` 中转）形态自 2026-09-23 起与 HTTP 入站一致支持 enrich**（`ChannelRelayOptions.enrich` + relay 内 / manager 注入双层兜底，失败原样投递）。
- **渠道出站文件能力（2026-09-23 第三批）**：通用 `PluginSendFile` 工具（参数 `{ file_path, content? }`，**无 `message_id`**——接口无 `replyFile`）经工具层按 `service.sendFile` 能力探测生效（缺失时抛 `Current channel does not support file sending.`）。已实现：Telegram（`sendTelegramDocument` → `/sendDocument` multipart，caption ≤1024 复用既有截断 helper）、Discord（复用 `postDiscordMessage`；错误前缀统一为 `Discord message send failed`）、Slack（`sendSlackFile` → `files.uploadV2`，需 `files:write` scope）、WhatsApp（`sendWhatsAppMedia` 两步：`/{phoneNumberId}/media` 上传 → `/messages` 发 `document`）、企业微信（应用模式 `media/upload?type=file` → `message/send` 的 `msgtype=file`；webhook 模式明确抛错）、QQ（`sendQQFile`，`file_type: 4`，c2c/group 可用、`channel` 目标抛错）。飞书/微信沿用专属文件工具（`FeishuSendFile` / `WeixinSendFile`）与通用工具**并存**（同 `PluginSendImage` + `FeishuSendImage` 的既有模式）；**钉钉 `sendFile` 未实现**（文件消息 API 细节不可验证，宁缺毋滥——调用命中能力探测文案）。**新增渠道工具时的策略层登记点（缺一不可，共 5 处）**：① `channels/descriptors-shared.ts` 的 `COMMON_CHANNEL_TOOLS`；② `session/channel-tool-visibility-policy.ts` 的 `CHANNEL_SEND_TOOL_NAMES`；③ `permission/tool-permission-derivers.ts` 的发送类名单（权限 scope 派生）；④ `packages/agent-core/src/permission/tool-category-map.ts` 的 `CHANNEL_PERMISSION_TOOL_NAMES`（**漏登记 → 落入 `custom`（ask），且 `tools/tool-sandbox-allow-by-default-guard.test.ts` 的「沙箱白名单必须已分类」不变量会失败**——本次收口即由该测试抓到）；⑤ `tools/channel-tool-parameters.ts` 的参数说明白名单（返回 `null` 会被兜底成「空参数、任意字段」，必须显式登记才能向模型传达正确 schema）。渠道 persona 提示词（`channels/channel-persona-prompt.ts`）已同步 `PluginSendFile` 指引。
- **渠道入站媒体扩展点与 enrich 钩子**：`MessagingChannelService.enrichInboundMessage?(message): Promise<ChannelMessage>`（`types.ts:208`）由 HTTP 入站路由在 parser 之后、notify 之前调用（`channel-inbound-route.ts:314`，仅通用 POST 分支），用于「无自有入站循环」的平台补下载媒体（WhatsApp 即此路径）；**双层失败兜底**（router 侧 service 调用包装 `channelLogWarn` + 路由侧 `enrichInboundMessageOrFallback` 的 `console.warn`）保证 enrich 失败原样投递、绝不丢消息；QQ 特殊分支不接入（QQ 图片在 parser 内直映射 URL）；**relay 形态已接入**（`ChannelRelayOptions.enrich` + manager 注入双层兜底，2026-09-23）。新增平台支持入站图片时：能直出 URL 的只需 parser 产出 `images`（`ChannelImageAttachment`：`base64?` / `imageUrl?` / `mediaType` 必填 / `fileName?`）；需 token 下载的参考 Telegram（service 内循环）、Slack（Bolt handler）或 WhatsApp（enrich 钩子）；飞书参考 `feishu-gateway.ts:69-93`。
- **会话权限阶梯**：三档 `ask`（默认）/`auto-edit`/`yolo`，统一由 `resolveSessionPermissionMode` 解析（`packages/agent-core/src/permission/session-permission-mode.ts:20`）。唯一执行点是 `src/tools/tool-sandbox.ts` 的 `ensurePermissionForTool`（:6142）。
- **阶梯顺序不变量**：免审批快捷分支（`tool-sandbox.ts:6215`，`yolo` 或后台 team 会话）与 `auto-edit` 分支（:6223）都在通配符 allow/deny（:6165）和作用域级 allow/deny（:6183）之后执行，因此 `auto-edit`/`yolo` 只能跳过 ask，绝不会放行被显式 `deny` 的调用。`auto-edit` 仅自动放行 `AUTO_EDIT_PERMISSION_CATEGORIES`（`edit`/`write`），并始终豁免 `AUTO_EDIT_EXCLUDED_TOOLS`（`workspace_review_revert`，回滚类仍需人工确认）。
- **deny-only 后置裁决（`permission.evaluate`）**：所有「放行 / 免审批」出口在返回前统一经过 `src/runtime/plugin-host.ts` 的 `permission.evaluate` hook（对齐 opencode v2.0.13），插件只能设 `effect='deny'`、永远无法授权，故上面的 deny-first 不变量不变；`ask` 路径也**先过该 hook 再落 pending**（否则被拒绝的调用会留下无人应答的 `permission_requests`）。`ensurePermissionForTool` 因此是 async，新增放行分支必须走 `gatePermissionDecision` 而不是直接 `return`；插件抛错只 warn，零插件注册时行为与改动前一致。
- **子会话继承档位**：task 子会话（`tool-sandbox.ts:4231`）与 handoff 子会话（`src/handoff/runner/watcher.ts:460`）仅在父会话确实表达过档位时（已写规范键或历史布尔 `yoloMode === true`）才按父会话解析结果继承 `permissionMode`，父会话未表达时保持缺席（按 `ask` 兜底，不凭空写入）；后台 team 成员无法交互审批，由 `isBackgroundAutoApprovedTeamSession`（`tool-sandbox.ts:5889`）判定免审批。
- **子代理委派权限门控（`task_run`）**：委派动作（`task` / `call_omo_agent`）默认 **`ask`**（`permission-categories.ts`）——chat 非 yolo 需用户批准；免审批仅限：`yolo` 档位、team 后台成员、**cron 无人会话的委派**（`isUnattendedSessionDelegationAutoApproved`，只放行 `task_run`，写操作仍 ask；`source` 只由服务端写入且不在 metadata PATCH 白名单）、渠道会话已启用工具（`channel-policy`）。用户批准（once/session/permanent）后同会话重试命中 saved approval 直接放行。显式 `deny` 始终优先（免审批分支在通配符 / 作用域级 deny 之后）。
- **子代理交付 = 单通道（对齐 opencode）**：子代理完成后由 `task/task-job-delivery.ts` 的 `deliverTaskCompletion` 统一交付——① 幂等准入（`message/synthetic-message-injection.ts` 写入 `role: 'synthetic'` 的合成消息，`notificationId` 同时作消息 id 与唤醒键）；② 纯函数 `resolveTaskJobWakeDecision` 决策（`resume:false` / 父会话在飞 / 父会话 paused 一律**留库待消费**，不注册定时重试）；③ 需要唤醒时走 `routes/stream-runtime.ts` 的 `continueSessionFromHistory()`（`handleStreamRequest` 的 `continueFromHistory` 模式：不落用户轮、不派发用户消息插件事件、不计入「用户手动交互」）。通知正文由 `formatSubagentNoticeText` 统一渲染为参考库的 `<subagent sessionID state description>` 标签形态（标签内 `state` 经 `toSubagentWireState` 映射为上游 wire 词表 `completed|error|cancelled`，`metadata.state` 保持客户端契约词表），并带 **4k 字符上限**（超出截断 + 指引去子会话读全文；`description`/`metadata` 不下发模型，来源信息必须在正文里）。**通知已落库 ⇒ 延后永不丢**（用户下一次自然发言时模型仍能看到它）。进程重启由 `task/task-job-recovery.ts` 在 `listen` 之后补偿投递。**自动唤醒受预算上限约束**（`task/task-wake-budget.ts`，上限 10）：唤醒是事件驱动的，若被唤醒的父会话又委派新的后台子代理，其完成会再次唤醒它 → 无界自激；因此 `deliverTaskCompletion` 在**决策为「要唤醒」之后**才消费预算，耗尽时**仍然投递通知**（只返回 `wake:'skipped'` + `deferReason:'budget-exhausted'`），计数只在**非网关内部请求**时重置（`isGatewayInternalRequestKey`——否则唤醒自身会把计数清零，上限永远触发不了）。
- **子代理结果的提取口径（对齐参考库 `SubagentCompletion.text`）**：同步 task 路径只回传子代理**最后一条有文本的 assistant 消息**（`extractLatestChildSessionSummary`，经 `getChildSessionSummary`），扫描窗口为**最近 20 条**消息且只读 `statuses: ['final']`（跳过 error 消息，对齐参考库的 `limit:20` + `message.error === undefined` 判定）；**禁止**再用 `collectDelegatedSessionText` 把整个子会话文本 + 工具输出全量拼进父会话工具结果（那是 200k 级上下文膨胀源；`collectDelegatedSessionText` 仅保留给 `background_output` 的主动查询）。`buildTaskToolTerminalMessage`（`task/delegated-task-display.ts`）与 `buildCallOmoAgentSyncOutput`（`tools/call-omo-agent-output.ts`）的同步结果同样以 `<subagent sessionID state>` 包裹（对齐参考库前台模型可见内容，state 用上游 wire 词表；保留 `task_id` resume 提示行），正文另有 **20k 字符上限**。
- **「留库待消费」的记录会在被消费后清理**：若通知之后同会话已出现 `user`/`assistant` 消息（用户/模型已翻过它），记录即被清除，避免重启后**重复唤醒旧通知**——判定在 `task/task-job.ts` 的 `completeConsumedBackgroundJobs`（按 `time_created` + `id` 比较、`role IN ('user','assistant')`、排除 `running`）；调用点两处：用户真实交互时（`routes/stream.ts` 的 `handleStreamRequest`，与唤醒预算重置同一分支）与启动恢复扫描前（`task/task-job-recovery.ts`）。
- **重启恢复的三种处置**（`task/task-job-recovery.ts`）：① 通知已被消费 → 跳过并清记录；② 持久记录仍为 `running`（执行被重启打断）→ 置 `error` 并投递「子代理执行被网关重启中断。」，**不得**当作完成；③ `cancelled` → 传 `resume:false` 只投递不唤醒。
- **通知必须覆盖所有终态路径，且注册前移到 spawn 时**：`tools/tool-sandbox.ts` 的 `settleChildTaskNotification` 统一「settle + 投递」，覆盖 `terminateChildSession` 与 `cancelBackgroundTaskEntry`——漏掉这两条会让取消/终止的子代理在父会话里**无声消失**；`registerBackgroundChildTask` 在 spawn 时与函数入口各注册一次（`task/task-job.ts` 的 `start()` 对 `running` 幂等），用于覆盖「进程在 `setTimeout` 触发前退出」的窗口。
- **唤醒失败保留记录、预算前置消耗**：`continueSessionFromHistory` 非 200 时返回 `deferReason: 'wake-failed'` + `wake: 'deferred'`（**不**清理记录，交重启恢复补偿）；唤醒预算在**调用前**消耗——前置消耗才能并发安全（成功后消耗会让并发投递同时通过检查），失败不回退（用户任一次真实发言即重置），见 `task/task-job-delivery.ts`。
- **关库竞态的错误措辞必须按运行时覆盖**：`isIgnorableChildFinalizeError`（`tools/tool-sandbox.ts`）除 `database is not open` 外还须匹配 bun:sqlite 的 `Cannot use a closed database`，否则网关关停 / 脚本收尾时后台终结算器会以 unhandled rejection 抛出（现象：验收脚本**断言全过却退出码 1**）。
- **`synthetic` 消息角色契约**：`role: 'synthetic'` 对模型**可见**（`message/message-to-model-messages.ts` 保留，`v2-runtime/upstream/native-message-bridge.ts` 降级为上游 `user`），客户端**不得**按用户输入渲染；`Message.description` + `metadata = { source:'subagent', childID, agent, state }` 是客户端 notice 契约（`packages/shared/src/subagent-notice.ts` 是提取语义的 SSOT）。通知正文带参考库的 `<subagent sessionID state description>` 标签（模型侧需要它区分来源）；`parseSubagentNotice` 解析时会**剥离该包裹**，客户端 `notice.text` 保持纯正文。**读路径必须回传 `description`/`metadata`**（`v2ToV1Message` 曾漏，属静默缺陷）。
- **子代理工具名**：规范名 `subagent`（对齐上游），`task` 为历史别名——名称归一在 `routes/tool-name-compat.ts` 与 `tools/legacy-tool-name-rewrite.ts` 的镜像表，运行期判定统一用 `task/task-tools.ts` 的 `isTaskToolName()`。`createdByTool: 'task'` 是存量会话的**溯源标记**，与暴露名解耦，不要一起改。
- **子代理数量限制（用户级可调）**：同时运行 / 任务树累计 / 嵌套深度三项统一由 `task/subagent-limits.ts` 的 `resolveSubagentLimitsForUser()` 从 `user_settings.subagent_limits` 读取（默认 4 / 24 / 1，护栏 16 / 200 / 8；越界值收敛到边界）；设置页「连接」tab 的「子代理」区域经 `PUT /settings/providers` 的 `subagentLimits` 字段读写，**保存后立即生效**（每次派发读库，不缓存、不需重启，已在运行的子代理不受影响）。历史键 `subagent_depth` 仅作为 `maxNestingDepth` 的回落来源保留。嵌套深度只由 `checkSubagentDepthAllowed` 一处判定（不再有第二条链深校验）；并发/累计只统计 `createdByTool === 'task'` 且同一任务树根的会话，resume 目标通过 `excludeRunningSessionId` 不占并发位。team 后台成员与 handoff 子会话不受本限制约束。
- **输出额度默认不下发（对齐 opencode v2.0.13）**：`modelRequestSchema.maxTokens` 无默认值——未显式指定时 `ModelRouteConfig.maxTokens === undefined`，网关不向请求注入 `max_tokens` / `max_output_tokens`，由上游按模型自身默认上限决定（对齐 opencode 的 `generation.maxTokens === undefined` 语义）。历史行为是固定下发 2048：推理模型的思考 token 与正文**共享同一份输出预算**，正文会在产出前就被上游以 `finish_reason: length` 截断（现象：**思考一段后直接停止、没有回复**；实测 `output=0, reasoning=2050`）。显式请求值与模型 / Provider 级 `requestOverrides.maxTokens` 原样生效，且**后者优先**（与 `inner-max-tokens-precedence` 契约、look_at 内层调用一致）；Anthropic 因 API 必填 `max_tokens` 走协议层 `outputLimit` 兜底。模型声明的 `maxOutputTokens` 只用于压缩 / 溢出计算，**不参与请求额度**；验收断言见 `verify-openai-responses.ts`（必须断言请求体**不含** `max_tokens`）。
- **OpenAI Chat 解析层对齐 opencode 参考库**（`packages/opencode-llm/src/protocols/openai-chat.ts`）：① **delta 字段宽容**——`OpenAIChatDelta` / `OpenAIChatChoice` / assistant 消息均用 `StructWithRest`，并显式声明 `refusal`（拒绝文本，按正文渲染）、`reasoning` / `reasoning_text` / `reasoning_details`（思维链字段变体）、`choice.usage`。**严格 Struct 会静默剥离未声明字段**：上游把可见内容放进这些字段时，客户端表现为「有思考、正文为空」（history 也会在回传时丢字段）；② **终态语义严格**——`mapFinishReason` 对未知值 / `error` / `network_error` 一律失败（不再折叠成 `'unknown'` 再被网关映射为 `end_turn`）；`ProtocolStream.onHalt` 与参考库一致**返回 Effect**（`route/protocol.ts`），`finishEvents` 在缺 `finish_reason` 且 `requireFinishReason`（默认 true，可用 `ModelCompatibility.requireFinishReason` 关闭）时**以 `incomplete-stream` 让整条流失败**（触发上层重试）。顶层 error 体仍以 `provider-error` 事件表达（网关依赖其 `context-overflow` 分类触发压缩），但会在 state 记 `providerFailed`，避免 `finishEvents` 叠加 incomplete-stream；网关侧 `provider-error` 同时标记 `doneEmitted`，避免再叠加误导性的 `STREAM_STALL`；③ **思维链是响应级通道**——`reasoning-0` 块保持打开，由 `finishEvents` 统一关闭，正文 / 拒绝文本出现不再关闭它。回归测试：`packages/opencode-llm/src/protocols/__tests__/openai-chat-delta-compat.test.ts`。
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
REDIS_URL=                 # 可选；未接入真实 Redis（仅终端面板端口过滤），不设置不影响运行
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
bun run --filter @openAwork/agent-gateway test:task-tool    # 仅跑 task 委派权限门控/自动运行回归
```

## 验收与回归约定

- `src/verification/verify-openai-responses.ts`：覆盖流式输出、工具回合与错误场景的后端验收链。
- `src/verification/verify-message-v2-event-projection.ts`：覆盖 message-v2 事件投影、Snapshot/PatchPart 与 session lifecycle 的正式验收链。
- `src/verification/verify-message-v2-deep-conversation.ts`：覆盖 message-v2 在 10+ 轮对话历史下的投影完整性、事件顺序与 transcript 读取一致性。
- `src/verification/verify-task-tool-permission-gate.ts`：覆盖 **task 委派权限门控**——默认（`ask`）档位下委派需要用户批准（产生 pending、子代理不启动）、`auto-edit` 档位仍需批准、`yolo` 档位免审批并自动运行、批准后重试命中 saved approval 继续执行、**cron 无人会话**委派免审批（但写操作仍 ask）、**渠道会话**走既有 `channel-policy` 豁免；team 后台成员的免审批由 team 验收覆盖。已接入 `test:task-permission` 与 `test:task-tool`。
- `src/verification/verify-task-tool-auto-run.ts`：覆盖 task 工具拿到执行上下文后，子会话会自动后台执行并回写父任务状态。
- `src/verification/verify-batch-permission-collect.ts`：覆盖**批量工具权限暂停**——只读兄弟在待批期间继续执行、被门控/待批准的兄弟写入 pending payload 的 `blockedToolCalls`（按 `tool_use` 顺序）、批准后整批按序恢复且只跑一轮上游。已接入 `test:batch-permission` 与 `test:verification`。
- `src/verification/verify-batch-permission-multi-pending.ts`：覆盖**多 pending 顺序审批**——第一个被批准后，被扣住的兄弟会升起自己的 pending 并使回合再次暂停（**不向上游发任何请求**）；逐个批准直至全部落定后**恰好一次**上游调用，结果保持 `tool_use` 顺序。同属 `test:batch-permission`。
- `src/verification/verify-subagent-selection.ts`：覆盖子代理选型契约（`web-researcher` 放行并落到内置描述符 / 未知 agent 被拒且错误信息列出名单 / `Agent` 工具与 `subagent_type` 参数的选型指引可见 / `web-researcher` 与 `scout` 的边界不丢失）。已接入 `test:subagent-selection` 与 `test:verification`。
- **验收脚本收集 `fetchCalls` 时必须排除标题/图标生成旁路请求**（用 `task-verification-helpers.ts` 的 `isSessionTitleGenerationRequest`）：task 子代理会话同样会生成图标（`stream-session-title.ts` 的 task 子代理例外），该 fire-and-forget 请求会打乱「子会话运行 + 父会话唤醒」的下标 / 计数断言。
- CI 无需单独新增步骤：`.github/workflows/ci.yml` 已通过 `bun run --filter "@openAwork/agent-gateway" test` 间接覆盖上述脚本。

## 测试分层说明

- `src/__tests__/permissions-routes.test.ts`：关注权限路由本身的 create/list/reply 与恢复交接，不重复承担 task 子代理端到端验收。
- `src/verification/verify-openai-responses.ts`：现在同时覆盖 Responses 的 EOF 缺尾部分隔符，以及 chat_completions 缺 `[DONE]` 的工具回合续跑边界。
- `src/verification/verify-message-v2-event-projection.ts` / `verify-message-v2-deep-conversation.ts`：message-v2 的正式验证资产必须走 `src/verification/verify-*.ts`，使用源码导入、临时 DB 与可控环境；`scripts/*.mjs` 只保留为兼容 wrapper，不再承载真实验证逻辑。
- `src/verification/verify-permissions-routes.ts`：覆盖权限请求的 create/list/reply/pending 清空这条 HTTP 路由回归链。
- `src/verification/verify-session-task-routes.ts`：覆盖 `/sessions/:sessionId/tasks` 对任务图层级元数据的 HTTP 投影回归。
- `src/verification/verify-task-tool-permission-gate.ts`：覆盖 task 委派在默认/`auto-edit` 档位会进入权限待批准链路（pending permissions 列表非空），仅在 `yolo` 或 team 后台场景免审批。
- `src/verification/verify-*.ts`：关注真实业务链路的 ATDD / regression；新增场景时优先放这里，只有 MCP resume、permission route handoff 这类窄职责才放回 `src/__tests__/`。

## 禁止事项

- 禁止本地开发使用 `build` 二进制，应使用 `dev`（bun --watch，可获真 PTY）；需要 Node 运行时则用 `dev:node`（tsx watch，显式管道降级）。
- 禁止在 `db.ts` 外添加同步阻塞代码——Fastify 是异步框架。
- 新增渠道必须完整实现 `MessagingChannelService` 接口。
- 禁止从 `dist/` 导入——`@openAwork/*` 包使用 `workspace:*`。
- 禁止硬编码管理员凭据，必须使用环境变量。
