# OpenAWork — 项目知识库

**生成时间：** 2026-03-21
**提交：** 7c73b44 | **分支：** main
**文档版本：** v2（含构建命令、测试命令、代码风格完整指引）

## 交互语言

- **所有对话必须使用中文**——包括回复、解释、提问、确认等一切交互内容，不得使用英文回复用户。

## 概述

跨平台 AI Agent 工作台：Fastify 网关 + React Web + Tauri 桌面端 + Expo 移动端。
技术栈：TypeScript（严格模式，NodeNext 模块），bun monorepo，Zod 校验，SQLite + Postgres。

## 目录结构

```
OpenAWork/
├── apps/
│   ├── web/          # React SPA（Vite），主要 UI
│   ├── desktop/      # Tauri v2 封装——通过相对导入直接复用 Web 页面
│   └── mobile/       # Expo Router（React Native），聊天 + 会话 + 设置
├── packages/
│   ├── agent-core/   # 核心 Agent 状态机、工具、会话、Provider 管理
│   ├── shared/       # 仅含消息/流类型——零业务逻辑
│   ├── shared-ui/    # 60+ React 组件，被所有应用使用
│   ├── multi-agent/  # 多 Agent 工作流 DAG 编排器
│   ├── skill-registry/ # 技能安装/生命周期/安全沙箱
│   ├── web-client/   # 浏览器端 WS + SSE 客户端及认证辅助
│   ├── platform-adapter/ # 平台路径解析（桌面 vs Web vs 移动端）
│   ├── mcp-client/   # MCP 协议客户端
│   ├── lsp-client/   # 网关 LSP 客户端
│   ├── pairing/      # 设备配对（二维码流程）
│   ├── browser-automation/ # 基于 Playwright 的浏览器工具
│   ├── logger/       # 结构化日志
│   ├── telemetry/    # Sentry + 分析
│   ├── artifacts/    # 产物存储与检索
│   └── skill-types/  # 共享技能类型定义
├── services/
│   └── agent-gateway/ # Fastify 5 HTTP/WS 服务器——后端
├── docs/             # 运行手册、技能开发指南、故障复盘模板
├── scripts/          # version.mjs、vite-plugin-version.mjs
└── .evidence/        # 参考实现（fastify、ioredis、postgres）——只读
```

## 查找指引

| 任务                | 位置                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Agent 状态机        | `packages/agent-core/src/state-machine.ts`                                                        |
| LLM Provider 配置   | `packages/agent-core/src/provider/`                                                               |
| 工具定义            | `packages/agent-core/src/tools/` + `tool-contract.ts`                                             |
| 会话持久化          | `packages/agent-core/src/sqlite-session-store.ts`                                                 |
| 多 Agent DAG        | `packages/multi-agent/src/dag.ts` + `orchestrator.ts`                                             |
| 网关 HTTP 路由      | `services/agent-gateway/src/routes/`                                                              |
| 网关 WS 流式        | `services/agent-gateway/src/routes/stream.ts`                                                     |
| 消息渠道            | `services/agent-gateway/src/channels/`                                                            |
| 待发队列（服务端）  | `services/agent-gateway/src/session/composer-queue-store.ts` + `routes/session-composer-queue.ts` |
| 技能安装/安全       | `packages/skill-registry/src/`                                                                    |
| 共享类型（消息/流） | `packages/shared/src/index.ts`                                                                    |
| UI 组件             | `packages/shared-ui/src/`                                                                         |
| Web 应用路由        | `apps/web/src/App.tsx`                                                                            |
| 桌面 Tauri 命令     | `apps/desktop/src-tauri/src/`                                                                     |
| 认证状态（Zustand） | `apps/web/src/stores/auth.ts`                                                                     |
| 浏览器端网关客户端  | `packages/web-client/src/`                                                                        |
| Docker 基础设施     | `docker-compose.yml`                                                                              |
| CI 流水线           | `.github/workflows/ci.yml`                                                                        |
| Agent 路由逻辑      | `packages/agent-core/src/routing.ts`                                                              |

## 架构说明

- **桌面端复用 Web 页面**：`apps/desktop/src/App.tsx` 直接从 `../../web/src/pages/` 和 `../../web/src/stores/` 相对导入——非构建产物依赖，是直接 TS 导入。
- **网关作为桌面端 Sidecar**：通过 `bun build --compile` 编译为单文件可执行程序（产物名 `openawork-gateway`），由 `apps/desktop/src-tauri/scripts/bundle-sidecar.mjs` 暂存到 `apps/desktop/src-tauri/binaries/openawork-gateway-<target-triple>`。
- **流式输出**：网关通过 SSE（`/stream` 路由）+ WebSocket 实现实时 Agent 输出。
- **消息渠道**：Telegram、Discord、飞书、钉钉、Slack 各自实现 `MessagingChannelService` 接口，位于 `services/agent-gateway/src/channels/`。
- **哈希锚定编辑**：自定义文件编辑工具（`packages/agent-core/src/tools/hash-edit.ts`）使用 SHA-256 行哈希替代行号，防止编辑漂移。
- **路由分级**：`packages/agent-core/src/routing.ts` 定义 R0–R3 路由分级（复杂度层级），用于 Agent 任务调度。
- **通知中心生命周期（收口 + 对账）**：`notifications` 表的状态五态 `unread / read / acted / archived / expired`，语义分类 `actionable`（权限、提问，进红点）/ `informational`（任务结果，不进铃铛）。**铃铛「待处理」= `kind='actionable' AND status='unread'`**，`pendingActionableCount` 与列表行必须同口径（统一由 `session/notification-store.ts` 的 `buildPendingNotificationSnapshot` 产出，HTTP `view=pending` 与 `/notification-events` 的 `sync` 快照共用）。终结路径只有三类：①用户真的响应 → `acted`（`markPermissionNotificationsActedByRequestIds` / `markQuestionNotificationsActedByRequestIds`，同时认 `dedupe_key=<eventType>:<requestId>` 与 body 首行 `requestId=` 前缀，兼容存量行）；②会话终止 / 停止运行 → `expired`（`expireActionableNotificationsForSession`）；③超过 TTL 惰性过期。**关键不变量：新增任何「消解 pending 交互」的路径（自动裁决、批量处理、停止、回滚）都必须在同一处调用对应收口函数**——漏调就是「用户明明处理完了，铃铛还挂着」。为兜住这类遗漏，读 `pending` 视图时会跑 `reconcileActionableNotifications` 与 `permission_requests` / `question_requests`（`status IN ('pending','deciding')`）对账，把底层已消解的未读项收成 `expired`；判定分级为「能解析 requestId 就精确匹配，解析不出只在同会话已无同类 pending 时收口」，并留 30s 宽限期避免误清刚生成的通知；body 首行的 `requestId=` 兜底只对 `permission_asked` 生效（`question_asked` 的 body 是模型生成的提问标题，不可信）。**对账只覆盖 `permission_asked` / `question_asked` 两类**：它们的对照源是 `permission_requests` / `question_requests`。其余 actionable 事件类型（目前只有 `composer_queue_blocked`）没有对照实体，`reconcileActionableNotifications` 会**直接跳过、保持原状**，生命周期由各自模块维护（`expireQueueBlockedNotificationsForSession` + TTL）。改动前的实现把「未知 event_type」一律当成「已彻底消解」收成 `expired`，等于任何新增的 actionable 类型都会在 30s 宽限期后被静默清掉——新增 actionable 事件类型时必须同时提供自己的收口路径，否则就是给自己埋一条「红点自己灭掉」的静默缺陷。**对账必须挂在 `/notification-events` 的心跳上周期性跑一次（`RECONCILE_EVERY_N_HEARTBEATS`，60s）**：快照只在握手 / 重连 / 收到 `notification.changed` 后请求，一旦某条路径漏了收口就不会有事件、客户端也就永远不读快照——兜底会形同虚设，用户开着页面时铃铛会一直亮到手动点开面板。`question_asked` 通知必须带 `dedupe_key`（body 是提问标题，不含可解析 id），否则对账只能退化为会话级判定。
- **子代理结果交付（单通道）**：子代理结算后由 `services/agent-gateway/src/task/task-job-delivery.ts` 的 `deliverTaskCompletion` 投递——先幂等准入（`injectSyntheticSessionMessage`，`notificationId` 同时作消息 id 与唤醒请求键），再由纯函数 `resolveTaskJobWakeDecision` 决策，最后 `continueSessionFromHistory` 唤醒。通知以 **`synthetic` 角色**落库（对模型可见、客户端不得按用户输入渲染；`description` + `metadata = { source:'subagent', childID, agent, state }` 是 notice 契约）。**通知正文由 `formatSubagentNoticeText` 渲染为参考库的 `<subagent sessionID state description>` 标签形态**（标签内 `state` 用上游 wire 词表 `completed|error|cancelled`；客户端 `parseSubagentNotice` 解析时剥离标签），并带 4k 字符上限（超出截断 + 指引去子会话读全文）；**同步 task 结果只取子代理最后一条 assistant 文本**（`extractLatestChildSessionSummary`，不再全量拼接子会话文本/工具输出），并同样以 `<subagent sessionID state>` 包裹（保留 `task_id` resume 提示行），正文另有 20k 字符上限（`delegated-task-display.ts`）。**通知已落库 ⇒ 延后永不丢**，故禁止恢复「定时重试 / 伪造用户请求」类补偿路径；自动唤醒受 `task/task-wake-budget.ts` 上限约束（用户真实交互才重置计数）。
- **待发队列（服务端落库）**：输入框在流式期间按 Enter 排队的消息，**以网关 SQLite `session_composer_queue` 表为唯一真相源**（`session/composer-queue-store.ts` + `routes/session-composer-queue.ts`，按 `user_id` + `session_id` 归属，未拥有会话一律 404）。客户端只在三处与后端交互——`use-composer-queue-backend.ts` 的 `hydrate`（进会话拉全量）/ `enqueue`（**入队即落库**，失败则回滚内存条目并把文本退回输入框）/ `remove`；**消费时机仍是「发送成功后」**才删服务端记录（`run-send-message.ts` 的 `cleanupConsumedQueuedMessage`），因为 flush 会先摘队首再发送、失败还要放回，出队即删会让重试凭空丢消息。localStorage 快照降级为**只读兜底**（仅网关没问成时顶上），不再写入。幂等键复用客户端生成的 `itemId`，天然抵抗入队重试与双标签页。
- **待发队列附件跨端（磁盘型产物副本）**：附件二进制**不入库**，而是入队落库后由客户端**后台补传**到 `/sessions/:id/artifacts`（磁盘型产物，经 `infra/artifact-manager.ts` 的**进程内单例**读写索引 `artifacts-index.json` + 磁盘文件；上传是顺序执行、总量上限 64MiB，任一文件失败即回滚已传副本），成功后用 `PATCH /sessions/:id/composer-queue/:itemId/attachments` 把 `artifactId` 回填条目并顺带清 `requiresAttachmentRebind`。换端水合按**两级**取回附件：本地 IndexedDB → 网关 `GET /sessions/:id/artifacts/:artifactId/content`（下载成功后 best-effort 写回 IndexedDB 缓存）；两级都不可得才标记 `requiresAttachmentRebind` 提示重新选文件。**条目离开队列即回收副本**：`session/composer-queue-artifact-purge.ts` 在 DELETE 单条 / 清空路由里联动删除磁盘产物（客户端有 5 条消费出口 + 移出 / 恢复 / 清空共 8 个调用点，逐点删除必漏，故下沉到服务端）；「上传完成但条目已消失」的孤儿窗口由客户端在 PATCH 404 时回收。上传路径走 `@openAwork/web-client` 的 `createArtifactsClient`（`uploadToSession` / `downloadFromSession` / `removeFromSession`），严禁在 apps 内直连。上传侧的硬约束：**单文件 24MiB**（服务端该路由 `bodyLimit` 40MiB，而 body 里是 base64，膨胀 4/3 后超限必然 413，故客户端提前跳过而非白传一次）、单条总量 64MiB；上传 / 下载**超时单独放宽到 120s**（`fetchWithTimeout` 默认 20s 是按读 JSON 接口定的，大附件必然超时并被归一成「网络异常」，排查方向会被带偏）；同一条目**按 `itemId` 串行化上传**——入队补传与水合补齐会撞车，双份副本互相覆盖后再也没人引用先完成的那份。服务端以**实际落盘字节**写 `sizeBytes`，不采信客户端上报值（跨端恢复要用它校验下载结果）。回收侧用 `ArtifactManager.removeMany` **一次落盘**（`remove` 逐条会把整个索引重写 N 遍，清空队列 / 删除会话时退化成 O(n²) 写放大），且回收**必须吞掉自己的失败**：它的调用点都在「条目已删」之后，此处抛错会让响应变 500，客户端据此把条目放回本地 → 与服务端状态分叉。
- **.evidence/**：fastify、ioredis、postgres 的只读参考源码，禁止编辑。
- **待发队列的跨端互斥（消费租约）**：队列落在服务端，而「判断空闲 → 发送」发生在客户端，因此同一会话被多端（桌面端 ↔ Web）或同机多标签页打开时，各端会各自把同一条待发消息发一遍。互斥由**数据库层的原子 claim** 保证：`session_composer_queue` 的 `claimed_by` / `claimed_until` 两列 + `POST/DELETE .../:itemId/claim`，单条 UPDATE 的 WHERE 同时判定「未被他人持有」与「自己的持有可续期」，不依赖事务隔离级别。客户端身份是**每标签页一个**的 `clientId`（sessionStorage，`composer-queue-client-id.ts`）——共用 id 会让同机双标签页互认为「自己人」而双双放行。`claim` 是**三态**，调用方必须区分：`true` 拿到权可发；`false` 另一端正在处理，跳过并**丢弃本地副本**（切勿就此重新水合，那会拉回同一条仍在该会话队列里的条目 → 再次 claim 失败 → 再次水合，形成死循环）；抛错 = 没问成，必须**保留**本地条目并退避重试（`QUEUE_CLAIM_RETRY_MS`），移除会让消息静默消失、硬发则可能重复。flush 流程中**不得预先摘队首**，摘除必须在 claim 成功之后。发送失败要 `releaseClaim` 交还租约，否则该条目要等租约（默认 60s）过期才能被接手。**已知边界**：`SESSION_ALREADY_RUNNING` 的兜底回流会先删条目（此刻副本随删除被回收）再幂等重建，重建条目在**另一台设备**上会退化为「需重新选择附件」（本端不受影响，本地 Blob 仍在）——这是「宁可能力降级、不留磁盘泄漏」的取舍；发送路径目前仍是「把附件重新上传一份新副本」，复用队列副本而跳过重传是后续优化方向。
- **待发队列的网关侧自动续跑（无人值守消费）**：客户端的 flush effect 只在「该会话被打开且空闲」时消费队列，用户切走别处 / 关掉页面后原会话跑完没有任何驱动源。现在由网关补上：`routes/stream.ts` 的回合收尾（`finally` 里的 `clearReservation()` **之后**，顺序不可颠倒——drain 用同一张 in-flight 注册表自判「是否仍在跑」）调用 `session/composer-queue-auto-run.ts` 的 `scheduleComposerQueueAutoRun`，fire-and-forget、事件驱动，**不建定时器也不轮询**（队列条目只由用户入队产生，服务端不自己造条目，因此没有无限自激的土壤）。消费顺序：判 pending 交互 → 判 in-flight → 读队首 → 可消费性判定 → claim → 扣预算 → 出队 → `runSessionInBackground` 起轮（`clientRequestId = itemId`，网关未受理则用原 id + 原 `enqueuedAt` 幂等回填，FIFO 位置不变）。四条硬约束：① **只消费队首**，队首不可自动消费就整队停住，不越过它去发后面的（顺序不能乱）；② **先出队再起轮，不持租约跑完整轮**——租约上限只有 5 分钟而一整轮 agent 回合经常更久，持租约会让另一端的客户端在过期后抢到条目重发；③ **出队时不得回收附件副本**（走 `removeComposerQueueItem` 而不是路由层的 `purgeComposerQueueAttachments`）：客户端发送是「重新上传一份新副本再引用」，服务端自动轮没有这一步、直接引用队列里的 `artifactId`，回收会让模型读图 404——副本在此从「队列临时文件」转为「消息资产」；④ **带非图片附件（`file` / `audio` / `video`）或 `requiresAttachmentRebind` 的条目不自动发**：服务端没有把这些类型重建成模型输入的等价装配，硬发就是静默丢附件，保留给用户切回来手动发。会话处于等待审批 / 等待回答时同样停住并保留队列——这正好是「ask 档撞审批就停在 paused、用户批准后继续」的预期语义。连续自动轮上限 `MAX_CONSECUTIVE_QUEUE_AUTO_RUNS`（20），用户真实交互（`isGatewayInternalRequestKey === false` 的那条路径，与唤醒预算共用同一判定）即重置；总开关 `OPENAWORK_DISABLE_COMPOSER_QUEUE_AUTO_RUN=1`。队首**不可自动消费**（非图片附件 / `requiresAttachmentRebind` / 图片缺 `artifactId`）时不再静默停住：投递一条 `kind='actionable'`、`event_type='composer_queue_blocked'`、`dedupeKey=composer_queue_blocked:<sessionId>` 的铃铛提醒（每会话一条，重复触发只刷新同一条未读项），正文带「队列第 N 条（共 M 条）」与**按原因区分**的指引——`unsupported-attachment`（非图片类型）、`attachment-missing-copy`（是图片但跨端副本已失效）、`attachment-rebind`（需重新选择文件）三种文案不可混用，把「副本丢了」说成「不支持文件类型」会让用户去找一个不存在的问题。收口有三条路径：出队成功 / 队列转空时 drain 内自带一次 sync、用户在页面上移出或清空条目或回填附件时由 `session-composer-queue` 路由调 `syncComposerQueueBlockedNotification`、以及 24h TTL。**`pending` 交互 / in-flight / 预算耗尽这三种「没发但不阻塞」的情形不得投递该提醒**——等待审批本身已有 `permission_asked` 在亮红点，再叠一条只会让铃铛变得不可信。
- **输入历史（服务端落库）**：输入框上下键调出的历史原先只活在浏览器 Zustand 内存（无 persist，刷新即丢），现以网关 `session_composer_input_history` 表为唯一真相源（`session/composer-input-history-store.ts` + `routes/session-composer-input-history.ts`）。按 `session_id` + `user_id` 归属，**每会话固定只保留最新 50 条**（写入后在同一事务内裁剪，自增 id 兼作顺序与裁剪依据）；相邻重复不重复插入，非相邻重复保留。`GET/POST /sessions/:id/composer-input-history` 分别水合与追加，POST 支持批量（新会话建立后把 pending 期间的输入一次迁入）并返回落库后的全量，客户端直接覆盖本地缓存，避免两端各写一份裁剪逻辑。客户端 `use-composer-input-history` 保留内存缓存做即时上下键体验：进入会话时水合、发送成功 / 入队时乐观写入后台落库，晚到的水合响应按请求代号丢弃；网关不可达时降级为本地记录，**不阻塞发送**。草稿不入库；会话删除经 FK CASCADE + `session-delete-recovery-statements.ts` 清理。

## 约定

### TypeScript

- `strict: true`、`noUncheckedIndexedAccess: true`、`noImplicitOverride: true`
- 模块系统：`NodeNext`（所有导入使用 `.js` 扩展名，即使源文件为 `.ts`）
- 强制使用 `consistent-type-imports`：纯类型导入必须使用 `import type { ... }`
- **禁止** `as any`、`@ts-ignore`、`@ts-expect-error`、空 catch 块、空函数——均视为错误

### 提交规范（husky + commitlint 强制执行）

- 格式：`type(scope): <中文描述>` — **scope 必填，描述必须以中文字符开头**
- 类型：feat | fix | docs | style | refactor | perf | test | build | chore | ci | revert | release
- 标题最大长度：100 字符
- 示例：`feat(gateway): 新增GitHub路由支持`
- scope 统一使用**小写**，优先采用模块 / 包 / 应用名（如 `gateway`、`web`、`shared-ui`、`agentdocs`）
- 正文 / 尾注可选；**禁止**出现任何 Sisyphus 协作尾注或相关协作痕迹
- 详细说明与示例见：`docs/commit-convention.md`

### 自动构建触发规则

- **默认普通提交不触发自动构建**：`feat / fix / docs / style / refactor / perf / test / build / chore / ci / revert` 提交只跑 CI（lint + typecheck + test），不会自动 bump 版本、不会自动打 tag、不会触发桌面端发布。
- **只有 `release(<scope>):` 提交会触发自动构建**：自上次 `desktop-v*` tag 以来，存在至少一条形如 `release(<scope>): <中文描述>` 的提交时，`auto-release.yml` 才会执行版本提升、打 tag 与触发 `release-desktop.yml`。
- **scope 决定构建哪些平台**：触发提交的 scope 会路由自动构建目标，`desktop-v*` 锚点 tag 仍照常推送（用于终止触发检测循环），但桌面端构建只在 scope 命中时才触发：
  - `release(desktop):` → 只构建桌面端
  - `release(mobile):` → 只构建手机端（EAS preview 构建 + preview 通道 OTA）
  - `release(all):` → 桌面端 + 手机端都构建（需要两端同时发布时的推荐写法）
  - 其他 scope（如 `release(preview):`、`release(auto):`、`release(gateway):`）→ 维持现状，只构建桌面端
- **手机端自动构建不产生 tag**：手机端由 `auto-release.yml` 通过 `workflow_dispatch` 调用 `release-mobile.yml`（`profile=preview`），**不会打 `mobile-v*` tag**；`mobile-v*` tag 仍严格表示正式 mobile release。
- **`EXPO_TOKEN` 未配置时手机端自动跳过**：`auto-release.yml` 会跳过手机端 dispatch 并在 workflow summary 中说明原因，不会导致自动发布流程失败。
- **推荐写法**：
  - `release(all): 准备发布预览版`
  - `release(preview): 触发自动构建并发布桌面预览版`
  - `release(auto): 收口本轮迭代并触发自动发布`
- **优先级**：自动 release notes 摘要会优先取最近一条 `release(<scope>):` 提交的中文描述。
- **手动通道仍可用**：`prepare-release.yml`、`release-desktop.yml`、`release-mobile.yml` 的 `workflow_dispatch` 入口不受影响，可在 GitHub Actions 页面手动触发。
- **bot 自身的 `build(release): 自动提升版本到 vX` 不算触发提交**，不会引发递归构建。

### 代码风格（Prettier）

- 单引号（`singleQuote: true`）、分号（`semi: true`）、尾随逗号（`trailingComma: "all"`）
- 行宽 100（`printWidth: 100`）、2 空格缩进、空格括号（`bracketSpacing: true`）
- 箭头函数参数始终加括号（`arrowParens: "always"`）

### 包名规范

- 所有 workspace 包使用 `@openAwork/` scope
- 包内所有导出必须经过 `src/index.ts`——禁止消费者直接导入内部模块路径

### ESLint 范围与规则

- 代码检查默认覆盖 `packages/`、`services/`、`apps/desktop`、`apps/mobile`；`apps/web` 当前按阶段性策略仍被根目录 ESLint 排除
- `@typescript-eslint/no-explicit-any`: error — 禁止 `any` 类型
- `@typescript-eslint/ban-ts-comment`: error — 禁止 `@ts-ignore`/`@ts-expect-error`
- `@typescript-eslint/consistent-type-imports`: error — 纯类型导入必须用 `import type`
- `@typescript-eslint/no-empty-function`: error — 禁止空函数体
- `no-empty`: error — 禁止空 catch 块
- 未使用变量以 `_` 前缀豁免（`_varName`，如 `_unused`）

### 命名约定

- 类/接口/类型：`PascalCase`（如 `AgentState`、`ToolRegistry`）
- 函数/变量：`camelCase`（如 `withRetry`、`computeDelay`）
- 常量：`UPPER_SNAKE_CASE`（如 `MAX_RETRIES`）
- 文件名：`kebab-case`（如 `state-machine.ts`、`sqlite-session-store.ts`）
- 前缀 `_` 表示有意忽略的变量（ESLint 豁免）

### 错误处理

- 禁止空 catch 块——必须记录日志或重新抛出
- 使用项目自定义错误类（`src/error/`）而非裸 `Error`
- 异步函数必须处理 rejection，禁止 unhandled promise rejection
- Zod 校验失败应在边界层（路由/网关入口）统一处理，返回结构化错误

### 浏览器端 id 生成

- 浏览器 / 移动端生成唯一 id 一律用 `@openAwork/web-client` 导出的 `createRandomUuid()`（内部按 `crypto.randomUUID` → `crypto.getRandomValues` → `Math.random` 依次降级）。
- **禁止**直接调用 `crypto.randomUUID()`：该方法只在**安全上下文**（HTTPS / localhost）下存在。通过 `http://<内网 IP 或内网域名>` 访问时它是 `undefined`，抛 `TypeError: crypto.randomUUID is not a function`；这类调用又多在 toast / 消息规范化 / 请求 id 等非关键路径上，一旦抛错会顺着 React 树把整页打崩（典型表现：团队页白屏 + unhandled rejection）。
- 兜底项 `Math.random` 仅允许用于瞬态 UI id，不得用于 token / 幂等键 / 签名等安全语义。
- 该工具由 `@openAwork/web-client` 导出，而 `apps/mobile` 的 Metro 按包入口（`dist/`）解析。**新增或修改 web-client 的导出后必须执行 `bun run --filter @openAwork/web-client build`**，否则 mobile 侧拿到滞后的 `dist`，源码里新加的导出会静默变成 `undefined`（表现为 `xxx is not a function`，且 web 侧因 alias 到源码而完全不复现）。各处 vitest 已 alias 到源码，测试不受构建顺序影响。

### 时间与时区（服务端时间必须按 UTC 解析后本地展示）

**现象与根因**：网关 SQLite 的时间列由 `datetime('now')` 写入 —— **UTC、秒级、空格分隔、不带时区后缀**（`2026-11-18 15:48:55`）。而 `new Date(str)` / `Date.parse(str)` 在 V8 中按**本地时区**解释这种字符串：东八区下会被当成「本地 15:48:55」（真实是 UTC 15:48:55 = 本地 23:48:55），于是会话列表的相对时间、按天分组、通知、审计日志、用量时间**整体少 8 小时**。

**三条硬约定**：

1. **存储语义不变**：时间仍以 UTC 落库，**禁止**改成写本地时间，也**禁止**在显示层做 `-8h` / `+8h` 补偿 —— 那只是把同一个 bug 换个方向再写一遍。
2. **解析入口唯一**：凡是解析服务端下发的时间，一律走 `@openAwork/shared` 的 `parseServerTimestamp` / `toServerDate` / `toServerIsoString` / `formatServerDateTime` / `formatServerTime` / `formatServerDate`（`packages/shared/src/server-timestamp.ts`）。它对四种入参都正确：无时区 SQLite 文本（按 UTC 补 `Z`）、带时区 ISO（原样）、epoch 毫秒（原样）、`Date` 实例。**禁止**在新代码里对可能来自 SQLite 的字符串直接 `new Date(...)`。
3. **网关出口优先给带时区的时间**：`routes/sessions.ts` 的 `buildSafeSessionSelectColumns` 已用 `strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at` 投影（SQLite 对无后缀文本一律按 UTC 解释，因此与本机时区无关）。新增对外返回时间列的接口应同样输出带 `Z` 的 ISO 或 epoch 毫秒，让**任何客户端**（Web / 桌面 / 移动端 / 第三方脚本）拿到即正确，而不是要求每个消费方各自补 `Z`。

**测试怎么写**：断言必须与运行环境时区无关 —— 用 `Date.UTC(...)` 或「同一个 `Date` 的 `toLocale*` 结果」作为期望值。硬编码 `+08:00` 字面量在 CI（UTC）上必挂。

## 常用命令

```bash
# 开发（所有包并行）
bun run dev

# 构建所有包
bun run build

# 代码检查（lint:eslint 覆盖 packages/services/mobile/desktop/scripts，
# lint:web 覆盖 apps/web 的 React Compiler 规则）
bun run lint
bun run lint:fix

# 仅 apps/web 的 React Compiler 反模式检查
bun run --filter @openAwork/web lint

# 格式化
bun run format
bun run format:check

# React Compiler 脱靶监控（判断手写 memo 能否清理的唯一依据）
bun run check:react-compiler
bun run check:react-compiler -- --json=compiler-report.json
bun run check:react-compiler -- --baseline=compiler-report.json

# 提交 / 推送前门禁（本地已在 husky 里自动接好，等价于 CI quality job）
bun run preflight

# 全量类型检查
bun run typecheck

# 全量测试
bun run test

# E2E（Web）
bun run test:e2e

# 仅网关
bun run --filter @openAwork/agent-gateway dev
bun run --filter @openAwork/agent-gateway build:binary

# 清理所有
bun run clean

# 单个包测试（以 agent-core 为例，替换包名即可）
bun run --filter @openAwork/agent-core test

# 单个测试文件
bun run --filter @openAwork/agent-core test src/__tests__/state-machine.test.ts
# 网关的 test 会运行完整套件，单跑指定文件需用 test:unit
bun run --filter @openAwork/agent-gateway test:unit src/__tests__/session/composer-queue-auto-run.test.ts

# 匹配测试名称关键字
bun run --filter @openAwork/agent-core test -t "测试名称关键字"

# 带覆盖率
bun run --filter @openAwork/agent-core test --coverage

# 监听模式（开发时）
cd packages/agent-core && bunx vitest
```

## 环境变量

必需变量（参见 `.env.example`）：

- `JWT_SECRET` — 最少 32 字符，生成：`openssl rand -base64 32`
- `OPENAWORK_DATA_DIR` — Gateway 持久化数据根目录；默认走平台数据目录（Linux: `~/.local/share/OpenAWork/agent-gateway`）
- `OPENAWORK_DATABASE_PATH` — 可选，显式 SQLite 文件路径；优先级高于 `OPENAWORK_DATA_DIR`
- `DATABASE_URL` — 兼容保留的 SQLite 路径覆盖项，**不是** Postgres 连接串
- `REDIS_URL` — **可选，未接入**：网关不连接真实 Redis（`services/agent-gateway/src/infra/db.ts` 的 `redis` 是进程内 Map 桩，TTL 被忽略），该变量仅用于终端面板「监听端口」列表的端口过滤（默认 6379）；多实例部署前需先实现真正的 Redis 适配
- `AI_API_KEY`、`AI_API_BASE_URL`、`AI_DEFAULT_MODEL`
- `GATEWAY_PORT`（默认 3000）、`GATEWAY_HOST`
- `OPENAWORK_CRON_MAX_CONCURRENT` — 定时任务全局并发上限（默认 3，硬上限 50）。每个并发都是一条完整 agent 会话；超过上限的**到点**触发会跳过并每任务每分钟最多落一条 `skipped` 执行记录（手动「立即运行」改为直接返回 409 并带原因）

Docker：`docker-compose up` 启动网关 + Web，并把 Gateway durable 数据挂到 `gateway_data` 卷（不含 Redis，理由见上）。

## 代码组织规则

### 文件体积限制

- **单文件行数上限：1500 行**。1300–2000 行为预警区间，应主动评估拆分；超过 2000 行必须立即拆分，不得以任何理由豁免。
- 拆分时优先按**职责边界**切分，而非随机截断：
  - UI 渲染逻辑 → 独立子组件
  - 数据获取 / 副作用 → 独立 hook（`use*.ts`）
  - 纯计算 / 格式化 → `utils/` 工具函数
  - 常量 / 枚举 → `constants/` 或同级 `*.constants.ts`
- **体积例外登记（不是豁免）**：文件若已按职责完成域抽取、且剩余部分经**量化验证**确认属于「装配层」（逐块实测「拆文件净减」均低于 10%），须在 `docs/architecture/<name>-split-plan.md` 登记：当前行数、已拆域清单、每块的净减实测、后续**数据流重构**方案与前置条件。登记不改变「1500 行是目标」这一结论，仅用于标明当前阻塞点已不在文件拆分；每季度复核一次，且不得新增同类登记（新文件一律先按规则拆分）。
  - 当前登记项：`apps/web/src/pages/chat-page/ChatPage.tsx`（见 `docs/architecture/chat-page-split-plan.md` 第十节）。

### 组件提取原则

- **复杂 UI 优先组件化**：单个渲染块超过 80 行、或包含 3 层以上嵌套 JSX，必须提取为独立组件。
- **通用功能必须组件化**：在 2 个及以上页面/组件中重复出现的 UI 片段，提取到 `@openAwork/shared-ui` 或本地 `src/components/`。
- 提取规则：
  - 页面级子区域 → `src/components/<PageName>/` 子目录
  - 跨页面通用组件 → `src/components/` 或上报至 `packages/shared-ui/src/`
  - 与业务无关的纯展示组件 → 优先放 `shared-ui`

### 拆分检查清单（提交前自查）

在提交涉及页面/组件的改动前，确认以下各项：

- [ ] 当前文件是否超过 1500 行？→ 超过则必须拆分后再提交（1300–1500 行应主动评估）
- [ ] 是否有可提取为独立组件的渲染块（>80 行 或 >3 层嵌套）？
- [ ] 是否有在其他页面已存在的相似 UI 逻辑？→ 合并为共享组件
- [ ] 拆出的 hook/util 是否有对应单元测试？

### 反模式（禁止）

- 禁止在单个页面文件中堆砌多个独立功能的完整实现——每个功能域独立文件。
- 禁止用注释分隔替代文件拆分（`// ====== Section A ======`）——这是拆分信号，不是解决方案。
- 禁止因"暂时"而跳过拆分——技术债从第一次妥协开始累积。

## UI 设计规范

### 核心原则

- **设计质量优先**：UI 实现必须以用户体验和视觉美感为首要目标，功能完成不是降低设计标准的理由。
- **E · Nebula 色彩体系**：所有 UI 必须使用正式定稿的 token（靛青主强调 + 琥珀对比 + 珊瑚互补 + 靛蓝辅助）。详见 `packages/shared-ui/DESIGN-TOKENS.md`。
- **专业工具强制使用**：所有涉及 UI 的任务必须加载专业 skill，禁止在不参考设计规范的情况下徒手堆砌样式。

### 色彩强制规则

- 主强调色（靛青）：仅用于 CTA / active / 选中态
- 对比色（琥珀）：仅用于 warning / 次级强调 / 数据高亮
- 互补色（珊瑚）：仅用于 danger / destructive
- 辅助色（靛蓝）：仅用于 info / 链接 / 代码高亮
- 线条分 5 级：invisible → subtle → default → emphasis → strong
- 文字分 4 级：strong → default → muted → subtle
- 禁止硬编码色值，必须通过 CSS 变量引用

### 用户体验要求

- **操作流畅性**：交互元素必须有明确的 hover / active / focus 状态，禁止裸样式按钮。
- **视觉层次**：页面必须具备清晰的信息层级（主操作 > 次操作 > 辅助信息），禁止所有元素等权重平铺。
- **空间节奏**：间距必须遵循 4/8/12/16/20/24/32/48 的 token 阶梯，禁止魔法数字。
- **反馈完整性**：loading、empty、error 三态必须设计，禁止只实现 happy path。
- **Focus 可访问性**：所有可交互元素必须有 focus ring（accent 色 2px outline + 4px subtle shadow）。

### 执行约束

- 禁止以"先实现功能再优化样式"为由跳过设计——样式与功能同步交付。
- 禁止复制粘贴通用 AI 生成的平庸布局——每个页面需结合实际场景做针对性设计。
- 禁止忽略移动端适配——所有 Web 页面默认需响应式支持（最低 375px 宽度）。
- UI 改动提交前必须经过视觉自查：对齐、间距、色彩对比度（WCAG AA 标准）。
- **新增/修改组件前必须阅读** `packages/shared-ui/DESIGN-TOKENS.md`。

## 禁止事项

- 禁止从 monorepo 内的 `dist/` 导入——使用 TypeScript 项目引用解析的 `workspace:*` 依赖
- 禁止编辑 `.evidence/` 下的文件——仅作参考
- 禁止抑制 TS 错误（`as any`、`@ts-ignore`）——lint 视为错误
- 禁止使用纯英文提交描述——commitlint 会拒绝
- 禁止将包加入 `apps/` 的根 ESLint——设计上排除
- 禁止使用 CommonJS（`require`、`module.exports`）——项目为纯 ESM（`"type": "module"`）
- **严禁执行任何 git 回滚指令**，包括但不限于：`git reset --hard`、`git reset --soft`、`git reset --mixed`、`git revert`、`git checkout -- .`、`git restore`、`git clean -fd`——除非用户明确以书面形式授权，否则一律禁止
- **禁止在 `apps/` 或 `packages/`（web-client 除外）中直接调用 `fetch()` 访问网关端点**——所有对 `agent-gateway` 的 HTTP 请求必须通过 `@openAwork/web-client` 的封装客户端发起。新增网关路由时，必须先在 `packages/web-client/src/` 中新建或扩展对应客户端模块，再在消费端调用。唯一例外：第三方外部 API（LLM 厂商、GitHub releases 等）和 `packages/` 内各自子领域客户端（`pairing`、`lsp-client`、`telemetry`）可保留直连。

## 注意事项

- `apps/desktop` 使用 `useHasHydrated()` 模式（Zustand persist 水合守卫）——`apps/web` 中也有相同模式，两者均为有意保留，并非重复。
- 移动端使用手动屏幕状态机（非 React Navigation 栈）——`apps/mobile/src/navigation/AppNavigator.tsx`
- 若 `agent-gateway` 或 Fastify 插件类型突然出现 `app.jwt`、`request.user`、`request.jwtVerify`、`injectWS`、`websocket`、`hide` 等属性缺失，优先排查 **Fastify 依赖是否分叉**，先运行 `bun run check:fastify-alignment`；这类问题常由 `bun.lock` 中同时解析出多份 `fastify` / `fastify-plugin` 版本引起，表现会像“类型增强失效”而非业务代码直接报错。
- `bun run check:fastify-alignment` 已接入根 `package.json` 的 `lint-staged`，凡是改动 `package.json` / `bun.lock` / workspace 子包清单后，提交前都应以它为首要排查入口；如果它失败，先修依赖对齐，再看后续 lint / typecheck。
- **`.husky/` 已纳入版本控制**（只入库 `pre-commit` / `commit-msg` / `pre-push` 三个脚本，`.husky/_/` 仍被忽略）。新克隆后 `bun install` 会通过 `prepare` 脚本自动装好钩子，无需手工 `husky`。
  - `pre-commit` → `bunx lint-staged`，只校验**已暂存**文件，覆盖 ESLint + `prettier --check` + Fastify/Docker 版本对齐。
  - `commit-msg` → `bunx --bun commitlint --edit`，提交信息不合规在 commit 阶段即被拦下。
  - `pre-push` → `bun run preflight`，等价于 CI `quality` job 的全量门禁：`format:check` → `lint` → `typecheck` → `check:fastify-alignment` → `check:docker-versions`。
  - **踩坑记录**：`.husky/` 早期被 `.gitignore` 忽略，导致 `lint-staged` 形同虚设，未格式化代码一路流进 main，直到 CI 红灯才暴露（2026-10-11，commit `1e28048c` 一次性带进 29 个未格式化文件）。同时 CI 的 `Lint` 与 `Format check` 是**串行**步骤，Lint 一挂后续全部 skip，一次推送只能暴露一个问题，得反复推送才能收敛——因此 `Format check` 已调到 `Lint` 之前（prettier 比 ESLint 快得多，格式问题十几秒就能暴露）。**提交前跑 `bun run preflight` 是硬要求**，不要用 `--no-verify` 绕过（CI 仍会拦）。
  - **CI 里必须设 `HUSKY=0`**（已加在 `auto-release` / `prepare-release` / `release-desktop` / `release-mobile` / `sync-anthropic-skills` 的顶层 `env`）：`bun install` 的 `prepare` 脚本会在 runner 上装出真实 hooks，而上述流程需要机器人自己 `git commit` / `git push`。hooks 一旦在 CI 生效，本地门禁（尤其 `pre-push` 的全量 `preflight`）会直接拦下机器人提交——2026-10-12 v1.2.9 发布就是这么挂的：`pre-push` 的 `format:check` 检到了 workflow 生成的 `release-notes.md`（该文件已加入 `.prettierignore`）。新增任何会 `git push` / `git tag` 的 workflow 时，记得一并加 `HUSKY: '0'`。
- **`apps/web` 的测试不在 CI 的 `Unit Tests` 步骤内**——该步骤的 `--filter` 列表遗漏了 `@openAwork/web`，其 566 个测试文件从未在流水线执行过。改动 `apps/web` 的组件 / hook / store 后必须本地跑 `bun run --filter @openAwork/web test`：`bun run preflight` 只覆盖格式 / lint / 类型，不含测试，否则测试失败在本地完全无感知。
- **提交信息行宽**：`@commitlint/config-conventional` 带 `body-max-line-length`（100 字符），**正文每行都要换行**，不要写成一段长文本；标题同样受 100 字符上限约束。注意 CI 的 `Commit Message` 步骤用 `FROM_SHA=TO_SHA~1` **只校验最新那一个提交**，历史提交的正文不合规不会被复查，但本地新提交必须一次写对。
- **已知竞态（非阻断，但排查 typecheck 诡异报错时要看）**：各包 `typecheck` 脚本是 `tsc -b tsconfig.typecheck.json --emitDeclarationOnly --force`，而 `bun run --workspaces` / `bun run --filter A --filter B` 都是**并行**执行。下游包（如 `shared-ui`）经 project reference 构建 `shared` 时读 `packages/shared/dist/index.d.ts`，而 `shared` 自己的 typecheck 同时在覆写同一文件，偶发读到半截产物报 `TS1005: '}' expected`。CI 用同样的并行 filter 写法，理论上同样会偶发。**碰到这类 `dist/*.d.ts` 语法错误，先 `bun run --filter @openAwork/shared build` 重建产物再重跑**，不要去改源码。
- 手机端云端自动构建依赖 GitHub Secret `EXPO_TOKEN`（EAS 云构建凭证）。未配置时 `auto-release.yml` 会**自动跳过**手机端 dispatch，并在 workflow summary 中说明原因，自动发布流程仍会成功结束；需要启用手机端自动构建时，先在仓库 Secrets 中配置 `EXPO_TOKEN` 即可，无需改动任何 workflow。
- `packages/agent-core/src/catwalk/` — 模型评测/对比模块
- `packages/agent-core/src/crush-ignore/` — 文件排除规则（Agent 上下文的 .gitignore）
- `.agentdocs/` — AI 工作流规划文档，非运行时代码
- `.assistant/` — Agent 会话状态，非运行时代码
- 所有单元测试使用 Vitest（非 Jest），测试文件位于 `src/**/*.test.ts`
- E2E 使用 Playwright（Web + 桌面端）

## agent-core 子包说明

核心包结构（`packages/agent-core/src/`）：

| 模块                      | 说明                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state-machine.ts`        | Agent FSM：idle→running→tool-calling→retry→interrupted→error（纯函数，无副作用）                                                                                                                                                                      |
| `tool-contract.ts`        | `ToolDefinition`、`ToolRegistry`——所有工具必须通过此注册                                                                                                                                                                                              |
| `routing.ts`              | R0–R3 路由分级（只读/单文件/多文件/架构级），5 维度计算                                                                                                                                                                                               |
| `sqlite-session-store.ts` | 生产级 SQLite 会话存储                                                                                                                                                                                                                                |
| `retry.ts`                | `withRetry`、`computeDelay`、`RetryAbortedError`                                                                                                                                                                                                      |
| `provider/`               | LLM Provider 管理：anthropic \| openai \| deepseek \| gemini \| ollama \| openrouter \| qwen \| moonshot \| mimo \| custom。平台「单一事实来源」在 `provider/catalog.ts`（`PROVIDER_CATALOG`），新增平台只需在 catalog 加一条 + `ProviderType` 加一员 |
| `tools/hash-edit.ts`      | SHA-256 行哈希锚定编辑，防止行号漂移                                                                                                                                                                                                                  |
| `error/`                  | 自定义错误类型基类                                                                                                                                                                                                                                    |
