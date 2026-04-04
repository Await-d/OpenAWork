# AgentDocs 索引

## 活跃工作流

- [260404-lsp-call-hierarchy-分阶段实施](./workflow/260404-lsp-call-hierarchy-分阶段实施.md) — richer LSP 在 implementation 归档后继续推进下一条 follow-up：正式接入 call hierarchy，并先冻结 tool 设计与验证边界
- [260404-子代理超时调整方案](./workflow/260404-子代理超时调整方案.md) — 子代理 child session timeout / deadline 详细调整方案：聚焦 gateway 最小闭环、统一终结原因、父会话回流、Web/Mobile 可见性与 DAG 后续演进
- [260404-t02-artifact实时预览实施](./workflow/260404-t02-artifact实时预览实施.md) — T-02 正式实施工作流：聚焦 Artifact 实时预览、可编辑产物、版本化与流式提取主链
- [260404-t01-跨会话记忆系统实施](./workflow/260404-t01-跨会话记忆系统实施.md) — T-01 正式实施工作流：包含 complexity assessment、success criteria、测试计划、依赖 DAG 与运行时 master plan
- [260401-buddy-伴侣功能集成方案](./workflow/260401-buddy-伴侣功能集成方案.md) — 面向 OpenAWork 的 buddy / companion 能力集成方案，聚焦能力裁剪、跨端挂点、状态模型、实验开关与分阶段 rollout（方案已冻结，全部 19 项待实施）
- [260331-claude-code-工具环境并行实施](./workflow/260331-claude-code-工具环境并行实施.md) — 按五人并行方案正式启动 Claude Code 风格工具环境接入实施（基础工具已完成，profile/surface/sandbox/stream/observability 层待实施）
- [260331-claude-code-五人并行开发方案](./workflow/260331-claude-code-五人并行开发方案.md) — 五条主线详细实施计划、依赖 DAG 与阶段验收策略（规划完成，Dev-1~Dev-5 共 47 项开发任务待执行）
- [260330-agent-gateway云端部署方案](./workflow/260330-agent-gateway云端部署方案.md) — 将 agent-gateway 升级为可独立云端部署的生产级服务（Mobile 端已完成，服务端基础设施/安全/Desktop/Web/文档共 14 项待实施）
- [260404-竞品差异化功能方案](./workflow/260404-竞品差异化功能方案.md) — ✅ 已完成全部 12 个竞品差异化功能详细技术方案（P0×3 + P1×4 + P2×5），含完整数据模型、API 设计、前端组件、实施阶段和验证矩阵

## 归档工作流（已完成）

- [260404-lsp-implementation-最小增量实施](./workflow/done/260404-lsp-implementation-最小增量实施.md) — 已完成 richer LSP 下一条最小增量：`lsp_goto_implementation` 已补齐 lsp-client capability/request、agent-core contract、gateway tool surface、sandbox、session visibility、prompt guidance 与 verification
- [260404-lsp-后续路线评估](./workflow/done/260404-lsp-后续路线评估.md) — 已完成 implementation / call hierarchy / language server coverage 三条 richer LSP follow-up 路线评估；结论为 implementation 作为下一条最小增量优先推进
- [260404-lsp-hover-轻量增强实施](./workflow/done/260404-lsp-hover-轻量增强实施.md) — 已完成 richer LSP 的最小 follow-up：`lsp_hover` 已补齐 agent-core/gateway tool surface、sandbox、session visibility、targeted tests 与 `verify-lsp-tools.ts` 验证，范围保持为 hover-only
- [260403-lsp-自动使用集成方案](./workflow/done/260403-lsp-自动使用集成方案.md) — 已完成 OpenAWork richer LSP Phase 1 收口：system prompt guidance、写后 diagnostics、合约统一、负向回归与 trigger 策略验收均已落地；Phase 5 评估结论为“hover 作为下一条轻量增强，implementation / call hierarchy / status-event-UI diagnostics 暂缓到独立后续工作流”
- [260403-三仓对话模式提示词对比](./workflow/done/260403-三仓对话模式提示词对比.md) — 已完成三仓模式提示词对比调研并将模式 prompt 收口为 gateway 单点注入 + 前端结构化透传
- [260403-变更记录功能收口实施](./workflow/done/260403-变更记录功能收口实施.md) — 已完成把 Sessions 页面补齐为会话级 file changes / snapshots / restore 的产品入口
- [260403-自动压缩二期实施](./workflow/done/260403-自动压缩二期实施.md) — 已完成 metadata-backed compactionMemory 接入 gateway 主模型输入链
- [260403-操作电脑语音github工作流集成](./workflow/done/260403-操作电脑语音github工作流集成.md) — 已完成桌面自动化工具面、语音输入闭环与 GitHub trigger 最小可用能力
- [260403-自动压缩一期实施](./workflow/done/260403-自动压缩一期实施.md) — 已完成 gateway 主模型输入链 runtime compaction
- [260402-对话模式默认agent方案](./workflow/done/260402-对话模式默认agent方案.md) — 已完成模式派生默认 agent + 用户手动覆盖优先的实施
- [260402-对话级文件变更记录保障融合方案](./workflow/done/260402-对话级文件变更记录保障融合方案.md) — 已完成对话级文件变更保障主线全量落地与验证
- [260402-任务使用链与完成回调收口](./workflow/done/260402-任务使用链与完成回调收口.md) — 已完成 task 使用链、任务完成回调与多端消费收口
- [260402-usage持久化回归修复](./workflow/done/260402-usage持久化回归修复.md) — 已修复 usage persistence 回归并恢复月度写入
- [260402-opencode-claude-任务体系修复收口](./workflow/done/260402-opencode-claude-任务体系修复收口.md) — 已修复任务体系主线合同断裂与 replay/bookend 判定
- [260402-opencode-claude-任务体系完成度核查](./workflow/done/260402-opencode-claude-任务体系完成度核查.md) — 已完成任务体系融合仓库级完成度审计
- [260401-opencode-claude-任务体系完整融合方案](./workflow/done/260401-opencode-claude-任务体系完整融合方案.md) — 已完成 fusion-native first 任务体系主线实施 D-01～D-11
- [260401-usage写入闭环实现](./workflow/done/260401-usage写入闭环实现.md) — 已完成 usage 月度记录闭环收口
- [260401-apps-真正纳入lint](./workflow/done/260401-apps-真正纳入lint.md) — 已让 desktop/mobile 真正参与 ESLint 门禁
- [260401-mcp-client-源码类型解析修复](./workflow/done/260401-mcp-client-源码类型解析修复.md) — 已修复 mcp-client 类型解析不稳定问题
- [260401-usage页面实现度分析](./workflow/done/260401-usage页面实现度分析.md) — 已完成 usage 页面实现度审计
- [260401-usage写入链路追踪](./workflow/done/260401-usage写入链路追踪.md) — 已完成 usage 上游链路追踪
- [260331-聊天刷新恢复与运行控制方案](./workflow/done/260331-聊天刷新恢复与运行控制方案.md) — 已完成 Chat 对话页待发队列持久化 + 刷新后运行控制恢复 + stopCapability 三态 + 附件二进制恢复
- [260331-手机端功能补全方案](./workflow/done/260331-手机端功能补全方案.md) — 已完成 P0 Bug 修复、UI 组件接入、附件上传增强与 STT 语音输入
- [260329-全工具特殊功能子代理模型复审方案](./workflow/done/260329-全工具特殊功能子代理模型复审方案.md) — 已完成全部工具/特殊功能/子代理模型复审，关键偏差已修复
- [260329-子代理工具提示词完全对齐方案](./workflow/done/260329-子代理工具提示词完全对齐方案.md) — 已被后续全工具复审方案覆盖
- [260329-前两天功能恢复补全](./workflow/done/260329-前两天功能恢复补全.md) — 功能线已被 03-29 至今的 81 次提交全面覆盖

## Architecture Decisions

- [2026-04-04] OpenAWork richer LSP 当前正式支持面已扩展为 **definition / implementation / references / symbols / prepareRename / rename / hover / diagnostics / touch**；其中 call hierarchy、language server coverage 扩展与 status/event/UI diagnostics 继续延后到独立工作流。

- [2026-04-04] `textDocument/implementation` 是 hover 之后的最小增量 follow-up：它与现有 `definition` 协议形状同构、接线与验证成本最低且能显著提升接口/抽象类型场景；call hierarchy 与 language server coverage 延后到独立工作流。

- [2026-04-03] 自动压缩二期先采用 **metadata-backed compactionMemory**：在 `sessions.metadata_json` 中持久化累计摘要、`coveredUntilMessageId` 与统计字段，由 `buildPreparedUpstreamConversation()` 只对未覆盖的 omitted history 做增量归并；若 covered boundary 失效则从当前 omitted history 全量重建，而不是盲目叠加旧 memory。
- [2026-04-03] 对话模式提示词采用 **gateway request-scoped system prompt injection**：`dialogueMode / yoloMode` 作为结构化字段从 Web/Mobile/web-client 透传，真正的模式正文只保留在 `services/agent-gateway/src/routes/stream-system-prompts.ts`，并同时覆盖 `stream.ts` 与 `stream-runtime.ts`；不要再在前端拼接 `<system-reminder>` 文本。

- [2026-04-03] “操作电脑”首期在 OpenAWork 中采用 **desktop browser automation as a gateway-managed tool**：复用既有 `desktopAutomationManager` 与 sidecar Playwright 驱动，对外统一暴露单个 `desktop_automation` action-based 工具；不要把调试路由或独立 UI 面板继续发展成并行执行子系统。

- [2026-04-03] Web/Desktop 语音模式首期采用 **shared `VoiceRecorder` + browser SpeechRecognition**：共享组件负责 transcript 聚合、错误反馈与确认回填，Mobile 保持 `expo-speech-recognition` 独立实现；不要把 STT 输入与 companion TTS 输出混成同一需求。

- [2026-04-03] GitHub trigger 若要进入真实工作流，必须显式保存 **registering `ownerUserId`**：webhook 可继续匿名接收，但命中后创建的 session 必须带 `user_id`，并以该 owner 身份调用 `runSessionInBackground()`；否则只会退化成不可执行的 idle 壳会话。

- [2026-04-03] 自动压缩一期采用 **gateway 主模型输入链 runtime compaction**：`buildPreparedUpstreamConversation()` 在固定安全窗口即将丢弃历史时注入 compact boundary + structured summary；`command-card:*` 与 `assistant_event:*` 只作为 UI artifact，必须从模型上下文中过滤，避免 JSON 卡片反向污染后续模型轮次。

- [2026-04-03] Gateway 的 request-scoped agent 解析不能在 `streamRequestSchema` 层给 `model` 提前落默认值；必须先组合 `request/agent/session` 候选，再进入 provider/model resolve，否则隐式 `gpt-4o` 会吞掉 agent 派生模型。

- [2026-04-03] `ResolvedStreamModelRoute` 的最终 `systemPrompt/variant` 必须保留已经按优先级合成好的 `resolvedRequestData` 结果；不要让原始 `agentSelection` 在返回对象 merge 阶段反向覆盖 delegated/request-derived prompt。

- [2026-04-02] 对话模式默认 agent 采用 **request-scoped `agentId` + 明确优先级 `manual override > mode default > existing default`**；其中“现有默认”固定指当前 `provider/model/variant/systemPrompt` 解析链，不要继续依赖纯文本 prompt 暗示作为主选择机制。

- [2026-04-02] mode-derived `agentId` 在 Phase 1 只作为**结构化路由候选**：普通聊天中不得压过 delegated child-session 的 `delegatedSystemPrompt`；Web 先实现完整行为，Mobile 仅保证活跃路由协议兼容，legacy ChatScreen 不再作为 Phase 1 对齐目标。

- [2026-04-02] 对话级文件变更保障方案采用 **`session_run_events + session_file_diffs + session_snapshots` 作为唯一真相源，写前原文备份仅作为恢复兜底层**；不要把独立 snapshot repo、transcript JSONL 或 `structuredPatch` 展示语义升级成并列主事实源。

- [2026-04-02] usage 月度累计的真实写入点必须挂在 **`runModelRound` 的公共调用链** 上：`stream-model-round.ts` 负责产出 round usage，`stream.ts` 与 `stream-runtime.ts` 负责按 round 调用 `persistMonthlyUsageRecord()`；不要把 usage 持久化只绑在单一路由，否则 resume/background 会继续漏账。
- [2026-04-02] request-scoped durable replay 的 gating 必须以 **最新 durable event 的 `bookend.replayable`** 为准，而不能再用“是否出现 done/error”这种粗粒度终态判断；否则 `interaction_wait` 无法直接回放，而 `tool_handoff` 会被误回放。
- [2026-04-01] OpenCode 与 Claude Code 的任务体系融合应以 **Task Entity** 为主域对象；OpenCode `task` 与 Claude `Agent` 都降级为 `TaskRun` 执行动作，不能继续把工具名本身当作域核心。
- [2026-04-01] 融合后的统一核心只吸收 `Task lifecycle / TaskRun / Interaction / PlanTransition / 最小后台运行控制面`；OpenCode 的 session-level `todowrite`、Claude 的文件型 tasks 与 `diskOutput/polling/eviction` 都保留为扩展层，而不是核心标准。
- [2026-04-01] 任务体系后续实施采用 **fusion-native first**：旧版本 OpenCode / Claude Code surface 只作为语义来源与迁移输入，不再作为长期兼容目标；先定义新合同，再按需编写 importer / translator。
- [2026-04-01] 任务体系实施顺序固定为：先 `packages/shared/src/index.ts` 冻结共享合同，再改 `packages/agent-core/src/task-system/*`，然后收口 `services/agent-gateway/src/task-*.ts / background-task-tools.ts / session-run-events.ts`，最后才进入 `routes/stream*.ts` 与对外 surface；禁止从 gateway 热点路由倒着改起。
- [2026-04-01] D-09 的 durable replay 判断切换为 **latest bookend-driven**：`RunEventEnvelope` 承载 `bookend + cursor + outputOffset`，只有最新 bookend 为终态或 `interaction_wait` 时才允许 durable replay；`tool_handoff` 与 `interaction_resumed` 明确是非 replayable 边界，避免运行中的 request 被误当成可回放完成态。
- [2026-04-02] task 完成回调的参考语义不是“只写完成提醒”，而是 **子任务终态 → 父会话 `tool_result` 收敛 + `task_update` 广播 + 在 `run_in_background + request context` 条件下自动回流续跑父会话**；`task-parent-auto-resume` 只能在具备父请求上下文时启用，不能无条件对任何子任务补发续跑。
- [2026-04-02] `packages/web-client` 作为通用流式客户端必须消费 **完整 `RunEvent`**，不能继续把网关输出收窄为 `StreamChunk`；否则 `task_update`、`tool_result`、`permission_*`、`question_*` 等任务/交互事件会在宿主端静默丢失。
- [2026-04-02] mobile 侧子任务活动恢复必须镜像 gateway `/sessions/:id/tasks` 的投影语义：**只把 `tags.includes('task-tool') && sessionId` 的 delegated task 视为 subagent activity，并采用 `task_update` 增量 + `/tasks` 快照（发送/运行时快轮询、空闲时慢轮询、重连即补 sync）双轨恢复**；不能再只按 `sessionId` 过滤或只依赖流事件。
- [2026-04-01] D-10 的 tools/capabilities surface 采用 **openawork canonical 默认 + claude_code_* profile 次级呈现**：默认 `openawork` 只暴露 canonical/fusion-native 工具名；只有显式 `toolSurfaceProfile` 选择 `claude_code_*` 时才暴露 `Skill/AskUserQuestion/Agent/...` 等 presented names。
- [2026-04-01] 只要某个 profile 暴露了 presented tool name，就必须同时保证 `tool-definitions`、`isEnabledToolName/session-tool-visibility`、以及 `dispatchClaudeCodeTool` 三层都能归一到同一个 canonical tool；否则会出现“模型可见且 enabled，但运行期 unsupported”的错配。
- [2026-04-01] D-11 的验证矩阵优先放在 `src/verification/verify-*.ts` 而不是强行解锁脆弱的 route 集成：当 Node/vitest 环境仍会把 `sqlite` 相关 route suite 整体 skip 时，优先用真实 Fastify + in-memory DB 的 verification 脚本补关键链路（`/tools`、`/capabilities`、stream surface、replay/bookend、session delete abort`）。
- [2026-04-01] 对 stream/replay/bookend，最关键的 ATDD 不是“事件存在”，而是 **bookend gating 行为**：`interaction_wait` 必须直接 replay 且不触发 upstream；`tool_handoff` 必须继续走 upstream 而不能把旧 `done(tool_use)` 当成可回放完成态。

- [2026-04-01] Buddy / Companion 能力在 OpenAWork 中定位为“体验层 companion layer”，不进入 `agent-core` 状态机与消息真相模型；账号级偏好统一落 gateway `user_settings`，前端只持有瞬时 reaction/UI 状态，Web/Desktop 先行，Mobile 延后降级接入。
- [2026-04-01] Companion 的模型边界采用 request-scoped system prompt augmentation，而非写入 `session_messages`；注入逻辑必须同时覆盖 `services/agent-gateway/src/routes/stream.ts` 与 `stream-runtime.ts`，避免恢复执行与后台续跑时出现人格漂移。

- [2026-03-31] Chat 刷新恢复与运行管理采用“三轴分离”方案：`runtimeState`（后端真相源）与 `stopCapability`（precise / best_effort / observe_only）必须分开建模，queued messages 先做客户端分层持久化（文本/附件元信息）而非直接持久化 `File[]`；Phase 1 不追求跨设备精确接管。
- [2026-04-01] Chat 队列附件恢复采用“sessionStorage 元数据 + IndexedDB 二进制”双层模型：元数据负责刷新后可见性，真实 `File` / `Blob` 走本地 IndexedDB；仅当二进制缺失或环境不支持时才降级为 `requiresAttachmentRebind`。
- [2026-04-01] 浏览器端附件持久化必须以 IndexedDB 事务 `oncomplete` 作为成功时机，不能在单次 `put/get` 请求成功后提前判定已提交；否则会造成“看似持久化成功、实际刷新后丢附件”的假成功。

- [2026-03-31] Claude Code 风格工具环境接入 OpenAWork 时，保留现有 canonical 小写工具名作为执行真相源；在 `services/agent-gateway` 的模型可见层引入 session-scoped compatibility surface（`openawork / claude_code_simple / claude_code_default`），统一承担名称与入参适配，避免破坏现有 runtime/contracts。
- [2026-03-31] 实施阶段进一步收敛后，基础工具（`bash/read/edit/write/glob/grep/todowrite/task_*`）继续以 OpenCode 合同为主；非基础工具允许直接采用本地 `claude-code-sourcemap` 的 Claude-first 合同，其中 `Skill` 与 `AskUserQuestion` 已作为首批样板落地。
- [2026-03-31] 在新边界下，`WebFetch` 与 `WebSearch` 明确保留 OpenCode/现有合同，不再按 Claude Code 迁移；剩余候选中 `Agent` 与 `PlanMode` 属于高风险交互级能力，不适合作为下一批低风险切换目标。
- [2026-03-31] 进一步实施后，`Agent` 已以“对外 `Agent`、对内复用 `call_omo_agent`”的最小闭环落地；这允许保持基础 `task` 工具不变，同时把非基础代理调用收口为 Claude-first 合同。
- [2026-03-31] PlanMode 现以最小闭环落地：`EnterPlanMode` 只负责切换会话 `planMode` 状态；`ExitPlanMode` 复用既有 `question_requests` 审批与 resume 链，在用户批准后退出计划模式继续执行，不额外引入新的审批子系统。
- [2026-03-31] PlanMode 不应只靠 helper 测试自证：至少需要一条 `questions` 路由回归，验证 `ExitPlanMode` 的审批回答会真实更新 session metadata 并触发 resume 调用，否则容易在路由层出现 Promise/mock/时序问题而 helper 测试完全捕捉不到。
- [2026-03-31] PlanMode 还需要双层 gating：不仅 capability/visible-tools 层要在 task-created 与 channel 会话中隐藏 `EnterPlanMode/ExitPlanMode`，sandbox 运行时也要再次拒绝，防止模型绕过工具列表直接调用。
- [2026-03-31] `Agent` 与 `PlanMode` 这类高阶工具都需要 session-scoped 双层 gating：capability 列表和 sandbox 运行时必须同时限制 task-created 子会话与 channel 会话，否则会出现 UI 层已隐藏但模型仍可硬调的后端一致性漏洞。
- [2026-03-31] 对 `ExitPlanMode` 这类基于 `question_requests` 的审批工具，后端检查不能只停在 definition 和 questions route：还需要确认 `session-delete-recovery`、`session-runtime-state`、以及阻止删除的 pending interaction 分支都继续按普通 pending question 处理，否则删除/恢复链会悄悄偏离。
- [2026-03-31] stream 的恢复链也需要显式保存 observability：如果 `permission_requests` / `question_requests` 的 resume payload 不带 `presentedToolName/canonicalToolName/toolSurfaceProfile`，恢复执行时补写出的 `tool_result` 和 `run_event` 会退化成只有 toolName 的旧语义，导致 Claude-first 工具链在流式事件中丢失可追溯性。
- [2026-03-31] 当一条工具链已经补到 definition/sandbox/routes 后，仍应再升一级补进 `src/verification/verify-*.ts`：这次 `verify-claude-first-tools.ts` 证明了 `AskUserQuestion`、`Agent`、`PlanMode` 在真实 in-memory DB + Fastify + stream background/resume 场景下都能跑通，否则很多问题（如 whitelist 漏注册、resume payload 丢 observability）只靠 unit test 很难全部发现。

- [2026-03-30] `services/agent-gateway/src/routes/stream.ts` 已按职责拆分：核心流执行逻辑保留在 `stream.ts`，恢复/后台运行迁至 `stream-runtime.ts`，路由注册迁至 `stream-routes-plugin.ts`，以满足单文件 ≤1500 行约束并降低后续耦合。

- [2026-03-30] request-scoped chat replay 继续收敛：`session_run_events` 以 `session_id + client_request_id + seq` 形成 durable 请求级事件序列；只有存在终止事件时才直接 replay durable events，权限请求与权限回复都必须绑定同一 `clientRequestId`，避免跨请求事件串入回放。

- [2026-03-30] Chat 运行时协议的 replay 主真相源收敛为 request-scoped `session_run_events`：按 `session_id + client_request_id + seq` 顺序持久化并优先回放，`session_messages` 仅保留为兼容降级路径；`docs/chat-runtime-ssot.md` 是该协议层的当前规范文档。

- [2026-03-30] backend 安全与留痕优先采用“在现有 SQLite 主事实上增量扩表”而非重做 event-sourcing：新增 `request_workflow_logs`、`session_file_diffs`、`permission_decision_logs`、`session_run_events`，并让 workspace 权限文件与 `.gitignore/.agentignore` 真正进入 gateway 运行时决策链。

- [2026-03-30] 工作区本地 skills 采用独立 `/skills/local/discover` 与 `/skills/local/install` 路由接入，继续复用 `installed_skills` 作为运行时事实源；不把本地目录扫描混入远程 registry search/sync 缓存链路。

- [2026-03-30] `Prepare Release` 必须先跑发布前质量门禁再 bump/tag/dispatch；当前纳入门禁的只包含已验证绿色的 `format:check`、`typecheck`、`web build`、`agent-gateway test:unit`、`mobile test` 与发布稿 dry-run，开发中已知红项明确排除。

- [2026-03-30] 每次版本发布必须有中文更新日志：发布稿不再落本地仓库，统一由 `Prepare Release` 在 workflow 运行时临时生成；基础中文摘要人工必填，变更条目可由最近一段 git 提交历史自动提取；desktop/mobile 发布流只消费 runtime-only 发布稿，不再接受旁路说明。
- [2026-03-30] Desktop 版本日志在多平台构建完成后自动追加安装包下载链接；Mobile 在 EAS CLI 返回可用 URL 时会把 iOS / Android 构建产物链接追加到 workflow summary；GitHub Release body / workflow summary 负责承载最终可下载的版本日志，仓库内不再存储发布稿文件。

- [2026-03-30] 版本调整统一走 `scripts/release-version.mjs` + `prepare-release.yml`：脚本负责推断与同步版本，workflow 负责 commit/push 与触发现有 desktop/mobile 发布链，不再手工逐个改 `package.json` / `app.json` / `Cargo.toml`。
- [2026-03-30] 仓库版本号采用 9 进 1 进位规则而非无限 patch 增长：`0.0.9 → 0.1.0`、`0.9.9 → 1.0.0`；显式输入超出单段上限的版本（如 `0.0.10`）会被规范化。

- [2026-03-30] 系统版本展示统一以仓库根 `package.json` 的 semver 作为事实源：`__APP_VERSION__` 用于用户可见版本，git hash/tag/dirty 仅保留在 `buildVersion` / `__APP_BUILD_VERSION__` 等调试字段中。

- [2026-03-29] Agent 默认模型配置收敛为“页面可编辑 + runtime 真消费”：managed agent 支持 `model / variant / fallbackModels`，builtin 默认值来自 reference 候选，`task` / category delegation 与 `look_at` 优先读取 managed 配置，再回退到 reference fallback。

- [2026-03-27] 聊天内 HTML / TSX 效果预览路线优先收敛为“HTML 先走 `iframe + srcdoc + sandbox`、TSX 后走 `Worker + esbuild-wasm + iframe`”，先满足聊天中的效果证据而非完整在线 IDE；同上下文执行与 `allow-scripts + allow-same-origin` 组合均列为红线。

- [2026-03-27] 由 `task` 工具创建的 child session 默认隐藏 `task` 工具本身，避免子代理在未显式授权下继续递归委派；如确有需要，只能通过显式 session metadata（如 `taskToolEnabled: true`）重新开放。

- [2026-03-26] 会话级 todo 的“子代办”首选固定双 lane（`main` + `temp`）而不是树形子项或 arbitrary multi-list：主待办保持正式计划，临时待办承载插入想法与 parking 项；`todowrite/todoread` 继续只读写 `main`，新 temp lane 通过专用工具与 `/todo-lanes` 接口暴露，lane 级 revision 作为第二阶段并发收口。

- [2026-03-25] Agent 角色体系先收敛为 5 个核心角色（`general/researcher/planner/executor/reviewer`）+ 2 个 overlay（`writer/multimodal`）；神话人格名、命令入口与 `team-*` 仅作为 alias/preset，不直接作为 canonical role ID。

- [2026-03-25] 内置工具对外命名继续收敛到参考风格：模型默认可见工具优先使用 `websearch/list/read/glob/grep/write/webfetch/todowrite/todoread`，旧名如 `web_search/workspace_*` 仅作为执行兼容层保留；新增别名时必须同步更新 `services/agent-gateway/src/routes/tool-name-compat.ts`，否则 stream gating 会与 sandbox 注册失配。
- [2026-03-25] 高风险参考风格工具已分两批接入：第二批新增 `batch/skill/bash/apply_patch/question/task`。其中 `question` 通过 `question_requests + /questions/reply + resumeAnsweredQuestionRequest()` 形成最小阻塞恢复链；`task` 当前提供真实 child session + task graph 入口，但尚未实现完整自动子代理执行生命周期。

- [2026-03-25] `/start-work` 作为首条真实子任务生产路径：命中 `.agentdocs/workflow` 计划文件时，顶层“执行计划”任务会把 `pendingItems` 同步成 `parentTaskId` 子任务，并通过 `task_update.parentTaskId` 回放到前端；重复 checklist 项和重复执行不得在同一父任务下重复建同名子任务。当前 v1 采用 checklist 顺序 → `blockedBy` 串行依赖链，并在 `/sessions/:id/tasks` 投影 `completedSubtaskCount`、`readySubtaskCount` 与 `unmetDependencyCount` 给 UI 展示直接子项进度、可执行项与阻塞状态；同一计划根任务复用仅按 `workflow-plan:<relativePath>` 标签匹配，禁止再用标题兜底复用。
- [2026-03-25] session API 安全收敛：`GET /sessions/:id` 与 `/sessions/:id/children` 只返回公开投影字段，不再暴露 `user_id/messages_json`；删除 session 必须同步清理 `.agentdocs/tasks/<sessionId>.json`；`POST /sessions/import` 必须限制消息条数与导入字节数，避免大 payload 滥用。
- [2026-03-25] session/task 安全继续收口：`DELETE /sessions/:id` 现先按 `id + user_id` 校验归属，再清理 task graph；`POST /sessions` 与 `PATCH /sessions/:id` 共用严格 metadata allowlist；`metadata_json` 与 task graph JSON 损坏时均安全回退，避免脏数据直接炸掉路由或任务链路。

- [2026-03-24] 子任务语义采用“三层并存”模型：`parentSessionId` 继续表示子会话树，`AgentTask.parentTaskId` 表示真正父子任务树，`blockedBy` 继续只表示执行依赖 DAG；gateway `/sessions/:id/tasks` 负责把任务树投影成带 `depth/subtaskCount` 的 UI 友好结构，前端禁止再自行猜测层级。

- [2026-03-24] agent-gateway 对 OpenAI 上游协议采用“Responses 优先 + 对外 StreamChunk 保持稳定”策略：`model-router` 产出 `upstreamProtocol`，`stream.ts` 按协议选择 `/responses` 或 `/chat/completions`，`stream-protocol.ts` 负责把 Responses SSE 事件翻译回既有 `text_delta/tool_call_delta/done`。

- [2026-03-25] `@openAwork/agent-gateway` 的包级测试门禁采用“双层验证”：`vitest` 负责协议/路由单元测试，`tsx src/verification/verify-openai-responses.ts` 负责 OpenAI Responses 真实链路集成验证（文本、tool loop、incomplete、upstream error 四场景）。

- [2026-03-25] Responses 集成验证不只做“存在性断言”：脚本需校验关键事件有序子序列和终止事件唯一性，避免 `tool_use` 中间 done、重复终止或 error/done 混发这类协议回归漏检。

- [2026-03-24] Skills 市场第三方注册源采用“SQLite 快照离线优先 + 显式同步”结构：`GET /skills/search` 默认读取本地缓存，`POST /skills/registry-sources/sync` 才拉远端最新并覆盖缓存；同步失败保留旧快照，不用空结果冲掉可用数据。

- [2026-03-23] Chat 权限闭环采用 gateway `permission_requests` + Layout 轮询审批提示：先用 REST（requests/pending/reply）闭环真实审批，再视需要把 permission_* 纳入统一流式事件主链，避免一次性重构整个 stream client。
- [2026-03-23] 会话级任务与子会话可见性采用“SQLite sessions + `.agentdocs/tasks` 双源收敛”：child session 继续由 `metadata.parentSessionId` 表达，task 状态通过 `/sessions/:id/tasks` 从 `agent-core task-system` 投影到 Chat UI。
- [2026-03-23] Chat 的 MCP 面板统一复用 `shared-ui` 的 `MCPServerList`，Settings 的 MCP 配置修改必须通过真实持久化包装器保存，禁止页面内重复手写 MCP 状态卡片。

- [2026-03-23] Chat 命令能力统一由 gateway `/commands` 提供服务端注册表，Web 的 slash popup 与全局 CommandPalette 只消费同一份命令描述，不再维护前端硬编码命令列表。
- [2026-03-23] `/sessions/:id/commands/execute` 首个落地命令为 `/压缩会话`：命令执行结果写回 `sessions.messages_json`，并通过 `messages` 投影返回给 Chat UI，用于 status/compaction 卡片回放。

- [2026-03-23] 聊天界面集成 opencode 能力采用“服务端能力模型 + 聊天端呈现层”结构：`agent-core` 负责命令/工具/任务/权限/压缩语义，`agent-gateway` 负责路由、流式分发与审计落库，前端只做触发、展示与确认，避免重复子系统。

- [2026-03-23] 参考 `temp/opencode` 后，Chat 持久化目标态调整为简化版 `session/message/part` 三层主事实：`messages_json` 仅作兼容投影，流式 delta 保留事件通道、边界时点才落库，避免高频重写大 JSON。


## Coding Conventions

- 规划文档统一放置在 `.agentdocs/workflow/`，使用 `YYMMDD-任务名.md` 命名。

## Known Pitfalls

- [2026-04-04] 给 OpenAWork 增加新 LSP 能力时，不能只在 gateway 暴露新 tool；`packages/lsp-client/src/client.ts` 的 `initialize.capabilities` 也必须同步声明，否则 implementation / call hierarchy 这类能力在部分语言服务器上可能根本不会启用。

- [2026-04-04] richer LSP 新工具即使已经通过 `tool-definitions`、`capabilities`、`verify-lsp-tools.ts` 和 build，也仍可能在真实执行时因为 `services/agent-gateway/src/tool-sandbox.ts` 漏掉 import / allowlist / `sandbox.register(...)` 而断链；新增工具时必须把 sandbox 纳入专项复核清单。

- [2026-04-04] LSP 自动使用不能只看 capability surface 或 `verify-lsp-tools.ts` 一条脚本就判定完成：`read/write/edit/apply_patch` 的 side effect 必须在各自测试中显式断言 `touch/diagnostics`，同时提示词层也要锁定 fallback 与“禁止自动 rename / 禁止每轮自动 semantic query”，否则很容易出现“实现存在但策略未验收”的假完成。

- [2026-04-03] 参考 Claude Code 风格能力做产品集成时，最容易误判成“设置页/路由已存在就等于已集成完成”；这次实际缺口证明：desktop automation 若没进 tool surface、VoiceRecorder 若没有 transcript、GitHub trigger 若没有 owner + background stream，都会形成可见但不可用的假闭环。

- [2026-04-02] 做对话级文件变更记录时，最容易犯的错误不是“记得不够多”，而是**让展示层反客为主**：`structuredPatch`、tool result 摘要、甚至 transcript/JSONL 都适合展示和诊断，但不能替代 SQLite durable 主链；否则恢复、审计和 request-scoped replay 会很快漂移。

- [2026-04-02] `.agentdocs/workflow/done/260401-usage写入闭环实现.md` 这类归档文档即使写着“主链已接通”，也不能替代对当前代码的复验；本次实际代码已经回退到“`stream-model-round` 不再返回 usage、`stream.ts/stream-runtime.ts` 不再写 `usage_records`”，直到重新验证 `verify-openai-responses.ts + pnpm run test` 才确认真正恢复。
- [2026-04-02] 当 `packages/shared` 的导出合同变更后，若 `services/agent-gateway` 仍只跑裸 `tsc`，TypeScript 很容易继续吃旧声明；gateway 已切到 `tsc -b`，后续独立构建应保持 build mode，避免把“过期声明”误判成代码未修复。
- [2026-04-02] 如果 `tool_result` 只保存 `output` 而不把 `clientRequestId/fileDiffs/observability` 一起持久化，`stream replay` 与会话消息重载时会天然丢掉 request → tool → file 的 trace 语义；`tool_result` 必须被视为 durable trace 载体，而不只是展示结果。
- [2026-04-02] `session_snapshots.client_request_id` 现在承担通用 `snapshotRef` 语义；request 级快照统一写成 `req:<clientRequestId>`，为后续 `backup:` / `scope:` ref 预留稳定格式，避免把 snapshot 永远绑定死在 requestId 上。
- [2026-04-02] 进入 `tool_result / session_file_diffs / session_snapshots` 之前，文件 diff 必须先经过统一 trace 规范化（至少补齐 `clientRequestId/requestId/toolCallId/sourceKind/guaranteeLevel/observability`）；否则同一轮 diff 会在不同 durable 链里出现不同默认值，后续恢复和审计会漂移。
- [2026-04-02] `bash` 这类外部进程写路径默认不应伪装成结构化高保障 diff；当前统一通过 `workspace-reconcile.ts` 在命令前后做工作区快照对比，并强制落为 `sourceKind=workspace_reconcile`、`guaranteeLevel=weak`。
- [2026-04-02] session 读侧不要各自拼接 file diff / snapshot 语义；`session-manager-tools.ts` 与 `routes/sessions.ts` 统一复用 `session-file-changes-projection.ts` 输出 `fileChangesSummary`，避免读模型再次漂移。
- [2026-04-02] 请求级/会话级 file-changes 与 snapshot 读接口默认必须走轻量响应：`includeText=false` 时只返回 diff meta 与 snapshot 白名单 summary，不默认暴露 `before/after`、`files`、`backup refs` 等重/敏字段。
- [2026-04-02] `session_file_diffs` 与 `session_snapshots` 的读 API 不要靠全量内存过滤凑出来；已新增按 `clientRequestId` 过滤的 diff 查询、按 `snapshotRef` 取 detail，以及 snapshot compare helper，后续扩展 API 应复用这些 store 能力。
- [2026-04-02] 写前备份层当前先走专用目录 `data/file-backups/<sessionId>/<backupId>.txt` + `session_file_backups` 元数据表，不把原文大文本直接塞进 `session_file_diffs/session_snapshots`；后续更多写路径应复用同一 backup store，而不是各自写临时文件。
- [2026-04-02] `edit` 已成为第一条接入写前备份的写路径：`createEditTool()` 现在必须接收 `sessionId/userId/requestId/toolCallId`，这样 `backupBeforeRef` 才能带着会话级关联键回流进 durable diff/snapshot 主链。
- [2026-04-02] `workspace_write_file` / `write` 这类通用写工具不能在“写完之后”再补备份；当前统一通过 `workspace-tools.ts` 的 beforeWrite hook 在真正写入前生成 `backupBeforeRef`，再由 `tool-sandbox.ts` 的 gateway-managed 分支传入会话上下文。
- [2026-04-02] `apply_patch` 也必须走与 `edit/write` 相同的会话级写前备份路径：当前通过 `executeApplyPatch()` 暴露 beforeWrite hook，再由 `tool-sandbox.ts` 注入 `persistSessionFileBackup()`；不要把 session/user 感知直接硬编码进 patch 工具定义本身。
- [2026-04-02] `workspace_create_file` 按设计不会生成空的 `backupBeforeRef`：新文件没有写前原文，因此该路径应只产出普通 diff，而不是为 `before=''` 额外制造无意义备份记录。
- [2026-04-02] `apply_patch` 的备份时序必须是“先备份、后写入”，不能先改文件再补 `backupBeforeRef`；否则备份失败时会留下“文件已改但不可回滚”的窗口。
- [2026-04-02] `file_write/write_file` 这类 legacy alias 不能绕过备份层；`tool-sandbox.ts` 必须把它们并到与 `write` 相同的 gateway-managed 分支，并由专项测试验证。 
- [2026-04-02] `session_file_backups` 现在采用 content-addressed 存储：路径按 `data/file-backups/<tier>/<contentHash>.<format>` 组织，同一 `kind + content_hash + content_tier + hash_scope` 可跨 session/path 复用同一份落盘内容，但仍保留各自的 backup metadata 行。
- [2026-04-02] 备份 tier 策略已冻结：普通文本走 `text/raw`，`.ipynb` 虽单独归类为 `notebook` 但备份层仍坚持 raw-byte hash 以保证可还原原文，binary 内容会被显式识别并通过 `OPENAWORK_FILE_BACKUP_FAILURE_POLICY` 决定 block 或 degrade；所有写路径统一通过 `captureBeforeWriteBackup()` 执行该策略。
- [2026-04-02] session 删除对 backup 文件的清理顺序必须是：先收集 `storage_path` 候选、再删除 session/backup 行、最后按引用计数 GC 孤儿文件；不能在 session 删除前先删文件，否则会留下“删除失败但 backup 已丢失”的时序漏洞。
- [2026-04-02] `POST /sessions/:sessionId/restore/preview` 是当前最小恢复消费面：支持 `backupId` 或 `snapshotRef`，始终 validate-only；默认只返回轻量 diff meta，`includeText=true` 才返回全文内容。
- [2026-04-02] restore preview 的 `hashValidation` 不能再用原始相对路径直接喂给 `HashAnchoredEditorImpl`；必须先按 session workspace root 解析到 safe path，再计算行哈希，否则 snapshot 相对路径会全部退化成 `available=false`。
- [2026-04-02] `workspaceReview` 的 fallback 需要区分“工作区真的干净”与“git 不可用/非仓库”；当前 restore preview 已通过 `available + reason + conflicts` 结构化返回该状态，避免把不可检测误判成无风险。
- [2026-04-02] UI 读模型与排障明细必须分 surface：`/sessions/:sessionId/file-changes/read-model` 只返回 turn 级白名单字段（无 `before/after/requestId/toolCallId/backup refs`），而既有 `/file-changes`、`/snapshots*`、`/restore/preview` 保持 debug/detail surface。
- [2026-04-02] turn 读模型的稳定性不能依赖 SQLite 秒级时间戳的隐式顺序；`session_snapshots` 读取与 `buildSessionTurnDiffReadModel()` 都需要确定性次排序，否则 `latestSnapshotRef` 和 turns 列表会在同秒多快照时漂移。
- [2026-04-03] WS-6 验证层已拆成三类护栏：单测矩阵（guarantee/source/default/snapshot summary）、写工具 durable 闭环验收（`test:durable` / `verify-write-tools-durable-closure.ts`）、以及 resume/background 不断链验收（`stream-resume-reconcile.test.ts` + `verify-stream-runtime-durable-continuity.ts`）。新增写/恢复链路时，必须至少挂到其中一类，不允许只靠功能代码通过 build。
- [2026-04-03] restore 已不再只有 preview：`POST /sessions/:sessionId/restore/apply` 现支持 `backupId` / `snapshotRef` 二选一；默认若 workspaceReview 命中冲突则返回 409，成功 apply 会把 `restore_replay/strong` diff 与 request snapshot 回写 durable 主链。
- [2026-04-03] `restore/apply` 的 git 冲突门控也已形成固定契约：默认命中 `workspaceReview.conflicts` 时返回 409，仅在显式 `forceConflicts=true` 时继续 apply；相关分支已被 `test:restore` 实测覆盖。
- [2026-04-03] delete cleanup 的专项矩阵现在必须验证四件事：删除 blocker（至少 pendingInteraction）、父子会话级联删除、`audit_logs.session_id` 置空而非误删、以及 shared `storage_path` 仅在最后一个引用消失后才真正 GC。
- [2026-04-03] rollout gate 已升级为可执行清单：gateway rollout 前必须显式跑 `test:restore`、`test:delete-cleanup`、`test:durable`，并用 `docs/rollout-file-change-durable.md` + `docs/runbook.md` 作为上线/回滚/监控的统一依据。
- [2026-04-02] `.agentdocs/workflow/done` 与 `index.md` 中的“已完成”只能证明文档流程已归档，不能证明当前工作树真实完成；审计时必须同时检查 `git status`、`typecheck/build/test` 与关键 verification 脚本，尤其是 shared 合同导出与 stream replay/bookend 链路。
- [2026-04-01] Chat Completions 的流式 usage 不能只实现解析逻辑：OpenAI 语义要求请求体显式带 `stream_options.include_usage=true`，否则最后的 usage chunk 默认不会返回；如果只在 `stream-protocol.ts` 里写了解析，但没在 `upstream-request.ts` 打开这个选项，`usage_records` 在 chat 路径上仍会长期缺数。
- [2026-04-01] 即使已经在 chat 请求默认值里加入 `stream_options.include_usage=true`，也不能假设它会一直保留：`applyRequestOverridesToBody()` 若先合并外部 `requestOverrides.body.stream_options`，后续没有再做强制 merge，就可能把 `include_usage` 悄悄覆盖掉，导致 usage 写入回归失效。
- [2026-04-01] usage 相关能力不能只看页面是否已挂载：当前 `UsagePage` / `Settings usage` 虽已接通读取接口，但 `usage_records` 仍无写入实现，`/usage/breakdown` 固定返回空明细，`ModelPriceConfig` 在 settings 中也是 `onUpdate={() => undefined}` 的假可编辑状态，极易误判为“功能已完整落地”。
- [2026-04-01] usage 写入链路最容易卡在“上游明明有 usage，但协议层没透传”：`response.completed.response.usage` 若未在 `stream-protocol.ts` 提取并带到 `stream.ts` 的 `runModelRound()` 主循环，后续即使有价格表、`calculateTokenCost()` 和 `usage_records` 月表，也只会长期保持空壳读取态。

- [2026-04-01] 比较 OpenCode 与 Claude Code 任务体系时，最容易犯的错误是按同名工具直接对齐：OpenCode `task` 是委派执行动作，不是 Claude `TaskCreate/Get/List/Update` 那种任务实体管理；若不先拆开“实体 / 运行 / 交互 / 规划边界”四层，后续融合一定出现语义腐蚀。
- [2026-04-01] 当已明确采用融合优先方案后，最大的坑不是“兼容得不够”，而是继续把旧 tool 名、旧状态词、旧 API 形状带进新核心；这会把系统重新拖回双轨设计。

- [2026-04-01] Companion 类体验功能最容易在“多入口 + 多状态源 + 多恢复链路”上漂移：Settings、slash 和卡片入口必须统一落到同一设置写入链路；移动端本地存储只能做缓存，不能与 gateway 形成并列真相源。
- [2026-04-01] 对话级动态 system prompt 不能只改 `stream.ts` 主链：若漏掉 `stream-runtime.ts` 的 resume/background 路径，会出现“首轮像 buddy、恢复后不像 buddy”的人格漂移，而且很难靠 UI 手测稳定复现。

- [2026-03-31] 参考风格工具环境不能只做名字映射：`/capabilities`、stream 下发工具集、sandbox 入站执行、session metadata allowlist 与历史 `toolName` 留痕必须一起设计；否则极易出现“展示可用但运行不可用”或“reference 名称与 canonical 名称混淆无法排障”的漂移。
- [2026-03-31] Claude Code 风格工具环境实施时，不能把“每对话文件变更记录与日志”当成后置补丁：`request_workflow_logs`、`session_file_diffs`、`session_run_events` 必须与 profile/reference surface 同步设计，否则对话、工具调用、文件 diff 与运行日志会断链。
- [2026-03-31] 当前项目在对齐 Claude Code 行为时，参考真相源统一锁定为本地 `temp/claude-code-sourcemap`；并行子代理若失败，必须沿用原 `session_id` 续跑，避免丢失上下文与重复摸索。
- [2026-03-31] 在“基础工具 OpenCode-first、非基础工具 Claude-first”的混合路线下，最容易出问题的是展示层和执行层不同步：任何新切到 Claude-first 的工具，都必须同时更新 `tool-definitions`、`tool-sandbox`、`capabilities` 与对应测试，否则会出现 capability 名称已变、sandbox 仍按旧名执行的断裂。

- [2026-03-30] `apps/web` 若直接消费 `@openAwork/shared-ui` 的包导出，Vitest/Vite 可能继续读取旧的 `dist` 产物，导致跨包 UI 源码改动“看起来没生效”；已通过 `apps/web/vite.config.ts` alias 到 `packages/shared-ui/src/index.ts` 保持开发/测试与源码一致。
- [2026-04-01] monorepo 中直接消费 workspace 包的 package 若参与 type-aware lint / typecheck，不能只依赖 `package.json` 的 `dist` 导出；至少要在消费方 `tsconfig.json` 补齐源码 `paths + references`，必要时再把该包纳入根 `tsconfig.json` 的 solution references，否则 ESLint 可能把上游类型降级为 error type。
- [2026-04-01] `apps/web`、`apps/desktop`、`apps/mobile` 当前按仓库约定不参与根 ESLint；若保留 `package.json` 中的 `lint: eslint .`，一旦被 `pnpm --filter ... lint` 直接点名就会因为 `apps/**` 全局忽略而退出失败，脚本必须与该约定保持一致。
- [2026-04-01] app 层 lint 策略已调整为分层覆盖：`apps/desktop` 与 `apps/mobile` 参与根 ESLint、`lint-staged` 与 CI quality 门禁；`apps/web` 仅暂缓 lint，仍保留 typecheck，且因 desktop 直接复用 web 源码，web 变更仍可能影响 desktop 类型检查。
- [2026-04-02] mobile 侧若只依赖流式 `task_update` 增量事件、或把 `/sessions/:id/tasks` 里的“有 `sessionId` 的任务”一概当成子代理任务，页面重进、漏事件、重连后都会出现状态消失或普通任务误入活动面板；移动端任务可见性必须采用“`task-tool` 过滤 + 事件增量 + tasks 快照恢复”三者同时成立的模型。

- [2026-03-30] `release-mobile.yml` 的 preview OTA 不能只在 step 级判断 `inputs.profile == 'preview'`：如果 job 级 `if` 不放开 preview dispatch，prepare-release 触发的 mobile preview 会构建成功但永远不推 OTA。

- [2026-03-30] 如果 runtime-only 发布稿没有通过 annotated tag、workflow input 或临时文件 artifact 在 job 间正确传递，就会重新引入“Action 输入有说明、下游 workflow 丢失正文”的漂移；发布说明必须以 workflow 运行时携带的正文为准。

- [2026-03-30] 发布前门禁不要盲目照搬 CI 的全部检查：当前 `packages/lsp-client` lint 仍为红，`apps/desktop` 独立构建与 `agent-gateway build:binary` 也处于开发中红项；若未先收口这些基线问题，直接纳入 `Prepare Release` 只会把可用发布链整体锁死。

- [2026-03-30] Gateway/sidecar 读取版本时不要依赖源文件相对路径去找仓库根 `package.json`：编译后 `dist/` 和桌面 sidecar 的暂存目录层级会变，正确做法是以 `process.cwd()` 向上探测根包，找不到时回退到当前包版本或环境变量。
- [2026-03-30] Expo 移动端不要在运行时代码里跨 workspace 边界直接 import 根 `package.json` 取版本；更稳的做法是用 `app.config.ts` 注入版本，再通过 `expo-constants` 在 UI 里读取。

- [2026-03-27] `workspace-review.ts` 会同时被 `/workspace/review/status` 路由与 workspace review tool 复用；对“目标目录不是 Git 仓库”的 git 128 错误必须在 helper 层统一降级为空变更，否则 HTTP 和 tool 两条链路都会一起冒泡成 500/执行失败。

- [2026-03-26] 不要把 session todo 的“临时想法”直接并入主待办或误建模为任务树子节点：当前仓库已把子任务树/依赖图/子会话语义分离，todo v1 也应保持 lane 隔离；同时旧 `/sessions/:id` 与 `/sessions/:id/todos` 契约必须继续只代表 `main`，否则会破坏现有 Web/Desktop 轮询链路。

- [2026-03-25] 参考风格工具名对齐后，`tool-definitions`、`tool-sandbox` 与 `routes/tool-name-compat.ts` 必须同步更新；只改默认暴露名而不改 stream gating 映射，会出现“sandbox 可执行但 stream 先判定 not enabled”的假兼容。
- [2026-03-25] `question` / `task` 这类编排型工具不要先做空壳：即便第一版不能完整对齐 reference 生命周期，也至少要把持久化请求、恢复入口或 child session 入口接上，否则只会制造“名字存在但运行时不可信”的假能力。

- 仅做技术栈选型不做任务拆解 → 导致执行阶段依赖不清 → 需在计划中显式标注依赖关系、里程碑和验收标准。

- [2026-03-25] `DELETE /sessions/:id` 当前仍是“先删 DB、后删 graph 文件”的非原子流程；若 `unlink` 失败会留下 orphan task graph，需要后续补 warning 日志与补偿清理。

- [2026-03-25] `sanitizeSessionMetadataJson` 在 metadata 解析失败时仍会原样返回字符串；`parseSessionMetadataJson` 虽能保护写路径不 500，但读路径仍可能把不可解析 metadata_json 返回给前端，属于低风险一致性问题。

- [2026-03-24] `stream-protocol` 纯单测若直接 import `tool-definitions` 链，会经 `workspace-tools -> workspace-paths -> db.js` 把 `node:sqlite` 拉进 Vitest 解析；协议单测应 mock `tool-definitions`，DB/Fastify 级链路改用独立 `tsx` 验证脚本。

- [2026-03-25] `agent-gateway` 若直接消费 `@openAwork/mcp-client` / `@openAwork/skill-types` 而 tsconfig 未配置源码 `paths/references`，TypeScript 与 `tsx` 可能回退到包导出与 `dist` 产物，导致 MCP 相关 test/typecheck/build 不稳定；应在服务端包 tsconfig 显式声明 workspace 源码路径。


## Global Important Memory

- [2026-03-20] `packages/logger`（`@openAwork/logger`）已实现：WorkflowLogger（树状请求步骤日志）+ FrontendLogger（console 封装 + ring buffer）+ createRequestContext 工具函数；agent-gateway stream/sessions 路由全部插桩；web 端 `src/utils/logger.ts` 单例可直接 import 使用。

- [2026-03-20] UI 风格取向已确定并固化到 `.serena/memories/ui_style_orientation.md`：目标风格为「极简桌面工作台」参考 OpenCowork v0.6.0 源码验证模式；核心要素：Glass Card 主容器（rounded-lg + border-border/60 + bg-background/85 backdrop-blur-sm + 大阴影）、NavRail（w-12）、SessionListPanel（可折叠/拖拽）、ModeToolbar（layoutId 动画高亮）、OKLCH CSS token + Tailwind v4 @theme inline、motion 动画系统含全局 kill-switch；Web 端无 TitleBar 拖拽/窗口控制，Desktop 端用 Tauri data-tauri-drag-region；所有实施前必须阅读该记忆文件。
