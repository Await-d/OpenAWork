# .agentdocs 索引

## Active Workflows
- [260516-team-page-重构调整方案](workflow/260516-team-page-重构调整方案.md) — TeamPage 重构：从"左侧 Sidebar + Tab 工作台"改为"对话中心 + 右侧可收起面板 + 顶部固定状态栏"；15 项任务 / 5 Wave / feature flag 保护
- [260509-skill-workspace-selection-spec](workflow/260509-skill-workspace-selection-spec.md) — 让用户在 chat 工作区维度可控地选择启用哪些 skill（workspace 默认 + session 覆盖），支持 AI 一键根据项目特征推荐勾选集；BUILTIN 始终可用、不参与过滤；pinned 仅首轮注入 system prompt
- [260507-web-图片生成工作台实施](workflow/260507-web-图片生成工作台实施.md) — 为 Web 左侧新增专用图片工作台入口，收口独立页面下的文生图、图片编辑、结果历史与产物联动能力
- [260507-image-workspace-新建图片工作区流程](workflow/260507-image-workspace-新建图片工作区流程.md) — 支持用户新建图片工作区，包含图片生成、编辑、历史记录等功能
- [260418-net10-网关功能迁移清单图](workflow/260418-net10-网关功能迁移清单图.md) — .NET 10 gateway 一比一迁移总账：按波次、能力闭环、前置依赖、完成定义与去重规则维护，防止遗漏与重复
- [260419-net10-wave1-agents-控制面迁移](workflow/260419-net10-wave1-agents-控制面迁移.md) — 收口 `.NET 10 gateway` Wave 1 控制面剩余的 `/agents` 管理面：复刻 TS catalog 语义、user_settings 持久化与集成测试
- [260419-net10-wave1-workflows-控制面迁移](workflow/260419-net10-wave1-workflows-控制面迁移.md) — 收口 `.NET 10 gateway` Wave 1 控制面中的 `/workflows`：优先补 team-playbook 模板控制面与 saved-template 协议，再评估 optimize/translate 附属端点
- [260419-net10-wave2-sessions-基础crud迁移](workflow/260419-net10-wave2-sessions-基础crud迁移.md) — 进入 Wave 2 首刀：补 `sessions` 主表与 `/sessions` 基础 CRUD，为 search/message_v2/stream/recovery 建立前置主表闭环
- [260419-net10-wave2-message-v2-权威消息层迁移](workflow/260419-net10-wave2-message-v2-权威消息层迁移.md) — 进入 Wave 2 第二刀：补 `message_v2 / part_v2` 权威消息层，为 event_log/run_events/stream 打下前置数据闭环
- [260419-net10-wave2-event-log-溯源层迁移](workflow/260419-net10-wave2-event-log-溯源层迁移.md) — 进入 Wave 2 第三刀：补 `event_log / event_sequences` 溯源层，为 run_events/stream/replay 打下 seq 与事件序语义闭环
- [260419-net10-wave2-run-events-运行线程迁移](workflow/260419-net10-wave2-run-events-运行线程迁移.md) — 进入 Wave 2 第四刀：补 `session_run_events / session_runtime_threads`，为 WS/SSE attach replay 与 active/stale runtime 判定打下 durable layer 闭环
- [260420-net10-wave2-ws-stream-runtime迁移](workflow/260420-net10-wave2-ws-stream-runtime迁移.md) — 进入 Wave 2 第五刀：补 `/sessions/:id/stream` WS runtime 最小闭环，先做 single-flight、durable run events、runtime thread 与 stop，显式排除 attach/SSE/replay
- [260420-net10-wave2-sse-attach-replay迁移](workflow/260420-net10-wave2-sse-attach-replay迁移.md) — 进入 Wave 2 第六刀：补 `/sessions/:id/stream/active` + `/sessions/:id/stream/attach`，实现 active snapshot、durable replay、live attach 与 keepalive 协议面
- [260420-net10-wave2-pending-interactions-持久化迁移](workflow/260420-net10-wave2-pending-interactions-持久化迁移.md) — 进入 Wave 2 第八刀：补 `permission_requests` + `question_requests` durable layer，为后续 permissions/questions resume 主线打下前置数据闭环
- [260422-net10-wave2-run-003-session-truncate迁移](workflow/260422-net10-wave2-run-003-session-truncate迁移.md) — 继续推进 RUN-003：补 `/sessions/{id}/messages/truncate` 最小写路由，把 message-v2 truncate 行为接到现有 sessions 主线
- [260416-team-创建流程设计分析](workflow/260416-team-创建流程设计分析.md) — Team 会话创建流、团队选择、agent 来源与模板复用设计分析
- [260416-team-创建实施方案](workflow/260416-team-创建实施方案.md) — Team 会话创建向导、DTO/API、template metadata 与测试落地计划

## Done Workflows
- [260516-team-phase-e-实施方案](workflow/done/260516-team-phase-e-实施方案.md) — ✅ 已完成 2026-05-16：Workflow 模板栈 + Role Adapter 矩阵 + 5 个内置 workflow 包 + 模板编辑器 + 模板驱动 handoff；12 项任务全部完成
- [260516-team-phase-d-实施方案](workflow/done/260516-team-phase-d-实施方案.md) — ✅ 已完成 2026-05-16：d 层结构化派发 + dispatch_package + 双重 review + D29 B3 失败分流 + toolset 门控 + 动态编制 + pm2-runner 生产接入；11 项任务全部完成
- [260515-team-phase-c-实施方案](workflow/done/260515-team-phase-c-实施方案.md) — ✅ 已完成 2026-05-16：c 层产物链（spec/plan/tasks）+ Constitution Check + [NEEDS CLARIFICATION] 推送 + 产物查看器 + 标记高亮 + 三步向导 UI + pm1-runner 运行时接入；10 项任务全部完成 + 3 项补完全部完成
- [260515-team-phase-b-实施方案](workflow/done/260515-team-phase-b-实施方案.md) — ✅ 已完成 2026-05-15：Session 状态机 + Handoff 协议 + Watcher + BackgroundTaskScheduler + 五层骨架 + 前端 TeamStatusBar/Session树/暂停取消/层级对话查看器；15 项任务全部完成 + 7 项补完任务全部完成
- [260515-team-phase-a-实施方案](workflow/done/260515-team-phase-a-实施方案.md) — ✅ 已完成 2026-05-15：团队宪法 + 角色 SOUL + 7 层指令分层栈 + memory 安全扫描 + ForceApply；12 项任务全部完成；3 项偏差记录
- [260509-opencode借鉴升级总览](workflow/done/260509-opencode借鉴升级总览.md) — ✅ 已归档 2026-05-09：8 份子工作流（P0×1 + P1×3 + P2×2 + P3×2）整批落地或显式推迟决议；agent-gateway 测试 335 → 472（+137），agent-core 新增 14 项；新增 6 个源码模块；修复 mutex 泄漏 / sandbox 未注册 / dev-browser 误导 prompt / GPT-5 400 / overloaded 重试 共 4 个真实 bug；推迟项跟踪表见文末
- [260509-p0-provider兼容性修复批](workflow/done/260509-p0-provider兼容性修复批.md) — ✅ P0 五项已完成 2026-05-09：GPT-5 reasoning clamp + Gemini-3/2.5 thinking 子集对齐 + `server_is_overloaded` 显式分支 + 工具确定性排序 + Anthropic adaptive thinking 空 text 保留（已存在），typecheck + 335/335 vitest 通过
- [260509-p1-compaction锚点摘要升级](workflow/done/260509-p1-compaction锚点摘要升级.md) — ✅ P1 已完成 2026-05-09：新建 `compaction-prompt.ts` 引入锚点风格 system prompt 与 `<previous-summary>` 更新指令；S3/S4/S5（工具截断、PRUNE_PROTECTED_TOOLS、summary/tail 顺序）已存在；8 项 prompt 单元 + 353/353 全量通过
- [260509-p1-子任务取消正确传播](workflow/done/260509-p1-子任务取消正确传播.md) — ✅ P1 核心已完成 2026-05-09：`cancel-descendant-streams.ts` 在 stream.ts 父 abort 分支 await BFS 级联取消（10s timeout、visited 防环、per-child 错误吞掉）；10 项单元 + 345/345 全量；UI reason 推迟
- [260509-p1-scout-agent与repo研究工具](workflow/done/260509-p1-scout-agent与repo研究工具.md) — ✅ P1 backend 完成 2026-05-09：`repo-reference.ts` / `repo-clone-tools.ts` / `repo-overview-tools.ts` + scout 内置 agent；并修复 mutex 内存泄漏 + tool-sandbox 未注册的两个 bug；67 项单元 + 420/420 全量；UI 卡片推迟
- [260509-p2-并行websearch-rollout](workflow/done/260509-p2-并行websearch-rollout.md) — ✅ P2 core 层完成 2026-05-09：`searchMultiProvider` + first-success/merge/sequential 三档 + canonical URL 去 utm_ + weight 排序；14 项单元 + agent-gateway 436/436 未受影响；settings UI 推迟
- [260509-p2-task工具schema与slashcommand补齐](workflow/done/260509-p2-task工具schema与slashcommand补齐.md) — ✅ P2-DELEGATE 已完成 2026-05-09：盘点发现 `session_id` 替代 `resume` 早就到位；本批补 `command` 为 reserved no-op + 15 项 schema 单元；T-DEADCODE 推迟独立工作流
- [260509-p3-session-warping评估](workflow/done/260509-p3-session-warping评估.md) — ✅ P3 ADR 产出 2026-05-09：结论不实施完整 warping（OpenAWork 单 instance 无 sync 层，`owner_id` 不适用），推荐阶段 0 但本批不做；ADR 全文见 `done/260509-session-warping-ADR.md`
- [260509-p3-会话路径过滤与devbrowser-skill](workflow/done/260509-p3-会话路径过滤与devbrowser-skill.md) — ✅ P3 后端完成 2026-05-09：(1) `/sessions?path=&includeDescendants=` + `session-path-filter.ts` 纯函数 + `/a` vs `/abc` 守卫 + 18 项单元；(2) `dev-browser` SKILL prompt 从虚假 oh-my-opencode API 改写到真实 `desktop_automation` 6 action + 反回归 token 黑名单 18 项单元；51 文件 / 472 全过
- [260422-gpt-image2-集成方案](workflow/done/260422-gpt-image2-集成方案.md) — 已完成 GPT Image 2 从设置、生成路由、Web/Desktop 聊天、生图结果联动、多模态 `input_image` 到移动端补齐的最小全链路闭环，并通过收口后的移动端安全/入口修复与复查
- [260420-net10-wave2-stop-active迁移](workflow/done/260420-net10-wave2-stop-active迁移.md) — 已完成 RUN-006 的最小 stop-active 收口：`.NET` 现已提供 `POST /sessions/{id}/stream/stop-active`，具备 owner/auth 校验、`{ stopped: boolean }` 返回、等待清理后返回，以及 session 级原子 active-slot 管理与 replay-slot 释放修复
- [260421-net10-wave2-run-008-question-reply-resume迁移](workflow/done/260421-net10-wave2-run-008-question-reply-resume迁移.md) — 已完成 RUN-008 的最小 owner-session question reply / resume 子切片：`.NET` 现已提供 `GET /sessions/{id}/questions/pending` 与 `POST /sessions/{id}/questions/reply`，支持 answered/dismissed、`ExitPlanMode`、owner-session runtime resume、规范化 observability 与严格 `nextRound` 约束
- [260421-net10-wave2-run-007-permanent-permission-materialization迁移](workflow/done/260421-net10-wave2-run-007-permanent-permission-materialization迁移.md) — 已完成 RUN-007 的最小 owner-session `decision=permanent` materialization 子切片：`.NET` 现已支持多根 workspace root 解析、`.openawork.permissions.json` 原子写入与 complete-phase 文件/DB 回滚，并通过集成测试覆盖 permanent 落盘、坏配置恢复、unresolved root rollback 与 complete failure 补偿
- [260420-net10-wave2-permissions-pause-resume迁移](workflow/done/260420-net10-wave2-permissions-pause-resume迁移.md) — 已完成 RUN-007 permissions pause / reply / resume 主线：`.NET` 现已提供 pending/create/reply、authoritative `tool_result` continuation bridge、continue-on-deny、multiroot session metadata 与 approved-bash workdir 校验，对齐 standalone-session scope 的 permission pause/resume 语义
- [260420-net10-wave2-commands-execute迁移](workflow/done/260420-net10-wave2-commands-execute迁移.md) — 已完成 RUN-009 的最小 commands execute 子集：`.NET` 现已提供 `/commands` 公开 server subset、`/sessions/{id}/commands/execute`、compact/summarize/handoff 与 standalone-session continuation bridge，为后续命令生态切片提供 substrate
- [260422-net10-wave2-run-009-init-deep迁移](workflow/done/260422-net10-wave2-run-009-init-deep迁移.md) — 已完成 RUN-009 的 `/init-deep` 最小 server command 子切片：`.NET` 现已公开 `slash-init-deep`，按 workspace-root scope 汇总现有 Instructions 文件到 `initDeepContext` metadata，并通过集成测试覆盖 list 可见、正向执行与 empty-context 护栏
- [260422-net10-wave2-run-009-refactor迁移](workflow/done/260422-net10-wave2-run-009-refactor迁移.md) — 已完成 RUN-009 的 `/refactor` 最小 server command 子切片：`.NET` 现已公开 `slash-refactor`，支持完整 slash `rawInput` / 引号 / `--key=value`，并以最小 `task_update + status card + metadata` 回写收口，同时保证 `/commands` 与 `/capabilities` 不再泄露 `slash-start-work`
- [260422-net10-wave2-run-002-sessions-search迁移](workflow/done/260422-net10-wave2-run-002-sessions-search迁移.md) — 已完成 RUN-002 的最小 `/sessions/search` 子切片：`.NET` 现已提供 `GET /sessions/search`，支持 `q + limit`、text / modified_files_summary 匹配、当前用户隔离、按时间倒序返回与 `<mark>` snippet，高级 FTS/bm25 parity 继续后置
- [260421-net10-wave2-data-014-task-parent-auto-resume-contexts迁移](workflow/done/260421-net10-wave2-data-014-task-parent-auto-resume-contexts迁移.md) — 已完成 DATA-014 的 durable model 子切片：`.NET` 现已提供 `task_parent_auto_resume_contexts` entity/store/migrations 与 `AutoResumeStoreTests`，并以 `version_token` compare-delete 封住 same-second retry 与旧消费者误删新行的 race
- [260421-net10-wave2-run-003-child-lineage-read-surface迁移](workflow/done/260421-net10-wave2-run-003-child-lineage-read-surface迁移.md) — 已完成 RUN-003 的最小 child lineage / children-tasks 读面子切片：`.NET` 现已提供 `GET /sessions/{id}/children` 与 `GET /sessions/{id}/tasks`，并用 session-derived task summary 暴露 child lineage、parentTaskId、depth、terminalReason 与 error-state
- [260421-net10-wave2-run-010-task-child-runtime-reconcile迁移](workflow/done/260421-net10-wave2-run-010-task-child-runtime-reconcile迁移.md) — 已完成 RUN-010 的最小 task-child runtime reconcile + parent auto-resume 子切片：`.NET` 现已能在 child terminal/stale/expired pending interaction 后消费 DATA-014 context 并自动续跑 parent session，且用 `version_token` compare-delete 封住 same-second retry 与旧消费者误删新行的 race
- [260420-message-runtime-assistant-trace-协议下沉实施](workflow/done/260420-message-runtime-assistant-trace-协议下沉实施.md) — 已完成 assistant_trace 协议 helper 下沉：shared 获得统一的 assistant_trace types + codec + parts transform，apps/web 改为消费共享实现，不再定义协议本体
- [260420-message-runtime-前端运行时协议收口实施](workflow/done/260420-message-runtime-前端运行时协议收口实施.md) — 已完成前端第二真相源的最小收口：assistant message 前端内部读取改为 parts-first，runtime 协议维持 transport/view 边界，流式本地消息不再把 assistant_trace JSON 当事实层
- [260420-message-runtime-compaction-结构收口实施](workflow/done/260420-message-runtime-compaction-结构收口实施.md) — 已完成 compaction 最高优先级差异的最小收口：`resolveCompactionContext()` 固定 marker 优先、metadata 仅 fallback，并接入 request context / prepared conversation / compaction driver
- [260420-message-runtime-参考库稳定结构移植实施](workflow/done/260420-message-runtime-参考库稳定结构移植实施.md) — 已完成 sender/read/tool-state 的下一轮参考库式移植：边缘 sender 统一到 `normalizedMessages`，主流 request context 读取收口到 `loadRequestContextConversation()`，`ToolPart.state` 读侧映射收口到 `tool-state-read-model.ts`
- [260420-message-runtime-对话存储与上游格式收敛方案](workflow/done/260420-message-runtime-对话存储与上游格式收敛方案.md) — 已完成消息存储/上游格式收敛的前三阶段最小代码收口（tool_result truth、normalized IR、request lineage + compaction codec），并沉淀前端协议脆弱点矩阵、风险与验证矩阵
- [260419-permission-第六阶段公开导出收缩](workflow/done/260419-permission-第六阶段公开导出收缩.md) — 已完成权限体系最后一层公开导出收缩：移除 `web-client` 与 `agent-core` 包根中无人消费的权限相关导出，并保留 gateway 仍在使用的 workspace permission API
- [260419-permission-第五阶段兼容面退役评估](workflow/done/260419-permission-第五阶段兼容面退役评估.md) — 已完成最后一层兼容面退役评估与实施：删除 web-client 内部无消费的 shared-session 权限别名，退役 agent-core 历史 `permissions/*` 兼容层，并保留仍在使用的 workspace permission 包根导出
- [260418-permission-第四阶段收尾评估](workflow/done/260418-permission-第四阶段收尾评估.md) — 已完成权限体系第四阶段收尾：browser 权限边界被确认为独立领域，shared-session 权限回复入口收成正式命名，Web 侧权限回复提交改为共用 helper
- [260418-permission-第三阶段内核收口](workflow/done/260418-permission-第三阶段内核收口.md) — 已完成权限体系第三阶段：gateway 内部统一 permission-contract，agent-core 旧权限管理器降级为兼容层，并打通构建级验证
- [260418-permission-第二阶段协议收口](workflow/done/260418-permission-第二阶段协议收口.md) — 已完成权限协议第二阶段收口：共享权限字面量与读模型 helper 下沉到 `shared/web-client`，`apps/web` 改为消费统一 helper，`shared-ui` 不再本地复制核心权限联合类型
- [260418-permission-统一使用方式改造](workflow/done/260418-permission-统一使用方式改造.md) — 已完成首轮权限收口：workspace 权限配置语义统一、`PermissionManagerImpl` 最终规则求值对齐、跨 workspace 持久化隔离与验证闭环
- [260417-net10-settings-第二批只读迁移](workflow/done/260417-net10-settings-第二批只读迁移.md) — 已完成 `/settings/mcp-status`、`/settings/upstream-retry`、`/settings/compaction`、`/settings/file-patterns` 第二批只读迁移
- [260417-net10-settings-首批只读迁移](workflow/done/260417-net10-settings-首批只读迁移.md) — 已完成最小 JWT 鉴权基础与 `/settings/model-prices`、`/settings/workers` 首批只读迁移
- [260417-net10-网关框架搭建实施方案](workflow/done/260417-net10-网关框架搭建实施方案.md) — .NET 10 gateway 骨架开发已完成：EF Core/MediatR、SQLite+PostgreSQL migrations、树结构工作流日志、SSE/WS/HostedService skeleton、sidecar publish/smoke
- [260415-team-page-收口方案](workflow/done/260415-team-page-收口方案.md) — Team 页面收口、契约稳定化、shell adapter 与验收闭环

## Architecture Decisions
- [2026-04-23] GPT Image 2 的最小产品闭环固定为“专用图片模型档 + 专用图片生成 route + 正常聊天流 `input_image` 扩展”，而不是复用 `activeSelection.chat` 或把文生图硬塞进文本主链。
- [2026-04-23] 移动端的真实入口以 Expo Router `app/*` 为准；若共享实现放在 `src/screens/*`，必须由 `app/*` 明确委托，不能只修改未接入的 screen 文件。
- [2026-04-20] `assistant_trace` 协议 helper 的最小治理固定为“shared 持有协议、web 保留接线”：`packages/shared/src/assistant-trace.ts` 负责类型、codec 与 parts transform，`apps/web/src/pages/chat-page/support.ts` 只保留 parse 依赖适配与业务接线，不再定义协议本体。
- [2026-04-20] 前端运行时协议的最小收口固定为“parts-first、trace-fallback”：assistant message 在 browser 内部读取时优先使用 `ChatMessage.parts`，`assistant_trace` JSON 仅作为 fallback/兼容内容；web-client 继续只是 transport，`chat-stream-state.ts` 继续只是 runtime overlay，不应再承担消息树真相源角色。
- [2026-04-20] compaction 的 canonical 判定固定为“marker 优先、metadata 仅 fallback”：`session-message-store.ts` 的 `resolveCompactionContext()` 是唯一的 compaction context 解析入口，`buildPreparedUpstreamConversation()`、`loadRequestContextConversation()` 与 `session-compaction.ts` 必须复用它，不能各自再手写 marker/fallback 分支。
- [2026-04-20] `.NET` 的 RUN-007 / RUN-009 组合固定采用“最小 tool-result continuation bridge”策略：permissions reply 后先从 `request_payload_json` 解析 `toolCallId/rawInput/nextRound/requestData`，approve/reject 先生成 authoritative `tool_result`（并落 `tool` part 的 `metadata.toolResultContent` + `session_run_events`），再把 `InitialToolResult` 送入 `ISessionStreamRuntimeService` 继续 completion；这已解除 standalone-session blocker，但 task child reconciliation 与 workspace permanent-rule materialization 继续留给 `DATA-014` 之后的切片。
- [2026-04-20] `.NET` 当前对 RUN-007 / RUN-009 的边界固定为“公开命令子集 + hardened bash bridge”：`GET /commands` 只暴露当前已实现的 server commands，`POST /sessions/{id}/commands/execute` 也只接受这一公开子集；handoff 明确保持 text-only/minimal。permissions approve 的 bash continuation 现已收口到固定 `/bin/bash` + 命令安全约束检查（当前为黑名单约束而非独立 allowlist）、基于 `WORKSPACE_ROOTS + WORKSPACE_ROOT` 的配置根与 session-root 回退的 workdir 校验、symlink 拒绝、输出截断与 generic error text；owner-session `decision=permanent` 的最小 materialization 现已由后续切片补齐，但完整 workspace persistent-permission 命中短路仍未对齐 TS tool-sandbox。
- [2026-04-21] `RUN-007/RUN-009` 当前 acceptance 之后，Wave 2 的下一硬前置固定为 `DATA-014 / task_parent_auto_resume_contexts`：standalone-session continuation 已够用，但 task-child lineage / parent-child auto-resume 与后续 `RUN-010` reconcile 需要先有 child→parent auto-resume context 的 durable model，不能继续仅靠最小 commands execute 子集硬推。
- [2026-04-22] `RUN-009 /init-deep` 的当前 `.NET` 对齐边界固定为 workspace-root scope：它只汇总 workspace root 作用域内现有 Instructions 文件到 `initDeepContext` metadata，并返回 status card + `audit_ref`；不要把它实现成 workingDirectory 祖先链聚合，也不要把 command template 文案误读成“生成 AGENTS 文件”。
- [2026-04-22] `RUN-009 /refactor` 的当前 `.NET` 对齐边界固定为“最小任务启动面”：它只解析完整 slash `rawInput`（含引号参数与 `--key=value`）、写入 `refactorStartedAt/refactorStrategy/refactorScope/refactorTarget/refactorTaskId`、返回 `task_update + status card`；不要把它扩成真实 LSP 重构执行，也不要让 `/capabilities` 比 `/commands` 暴露更多隐藏 server commands。
- [2026-04-22] `RUN-002 /sessions/search` 的当前 `.NET` 对齐边界固定为最小读闭环：只支持 `q + limit -> { results[] }`、只搜索 `text` 与 `modified_files_summary`、基于现有 `sessions + message_v2 + part_v2` 读模型返回结果；完整 `session_messages_fts / bm25 / snippet(...)` parity 继续留给后续子切片。
- [2026-04-21] `DATA-014` 的 durable context 不能再用秒级时间戳充当隐式版本号；`.NET` 侧最终改成内部 `version_token` compare-delete，专门防止 same-second retry 与旧消费者误删新行。
- [2026-04-21] 最小 `RUN-010` 子切片的 `.NET` 对齐边界固定为：child terminal/stale/expired pending interaction → auto-resume parent session；timeout stop 路径必须保留 `terminalReason=timeout` 优先级，不能被后续 cancelled 收尾覆盖。
- [2026-04-21] 最小 `RUN-003` 读面子切片固定采用“专用 `/children` + `/tasks` 读路由，而不是把 child lineage 再塞回 `GET /sessions/{id}`”的对齐方式；children 走 descendant session public shape，tasks 走 session-derived child task summary。
- [2026-04-21] 最小 `RUN-008` owner-session reply/resume 子切片固定按 TS 真值收口：pending 列表不主动过期；expired pending 仍可 answered；background reconciler 不替 question 做 expiry/dismiss；resume 的 `observability` 只保留 `presentedToolName/canonicalToolName/adapterVersion`；`nextRound` 必填。
- [2026-04-21] 最小 `RUN-006` stop-active 子切片固定要求 stream single-flight 的 active slot 在 registry 层 session 级原子化；即使命中 persisted replay，`SessionStreamRuntimeService` 也必须走 `finally` 释放 slot，不能留下隐形 active request。

## Coding Conventions
- 移动端 provider 密钥仅允许存于 `SecureStore`；任何写入 SQLite / settings JSON 的 provider config 都必须先去密钥化。
- 多模态附件的传输分层固定为：图片走结构化 `inputParts` / `input_image`，非图片可做文本摘要，但内部 `artifactId` 与 preview 不应进入用户可见聊天正文。
- 若 gateway 需要同时支持 `chat_completions` 与 `responses`，优先先产出协议无关 IR，再由末端 renderer 负责最终 body；不要在 `stream-model-round.ts` 或任意 provider-specific helper 里重新拼一套语义。

## Known Pitfalls
- 移动端若继续同时保留 Expo Router `app/*` 与 `src/screens/*` 两套实现，后续功能很容易再次只改到未接入路径；改动前先确认真实入口。
- WebSocket 鉴权若继续把 bearer token 放进 query string，会泄露给代理日志和调试链路；移动端现已改为 Authorization header，其他客户端也应避免回退。
- `pendingPermissionRequestId` 的 paused 识别依赖 `isError !== true`；如果 gateway 在 fallback `tool_result` 里把“等待审批”继续标成 error，前端会把它当 failed 而不是 paused。
- `DATA-014` / RUN-010 这条链路不能再用秒级时间戳充当 compare-delete 的版本条件；必须使用独立 `version_token`，否则 same-second retry 会重新打开旧消费者误删新行的 race。
- 最小 RUN-010 的 timeout stop 路径里，必须先写 `terminalReason=timeout` 再 stop active request；否则真实 registry 的 wait-for-completion 语义会让 cancelled 收尾提前清空 context。
- RUN-003 最小读面里，child tasks 的失败判定不能只看 `terminalReason`；若 child session 已回到 `idle` 但最新 assistant message `status=error`，`/sessions/{id}/tasks` 仍必须把它投影为 `failed`。
- RUN-008 最小 owner-session reply/resume 里，不要把 `.NET` 自己的 question 过期/后台 dismiss 语义混进 TS 真值；pending list、reply、background reconcile 都必须保持同一最小口径。

## Global Important Memory
- `.agentdocs/runtime/` 已在仓库 `.gitignore` 中忽略，可安全存放本次 orchestration 的临时执行产物。
