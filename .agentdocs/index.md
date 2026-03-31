# AgentDocs 索引

## 活跃工作流

- [260331-claude-code-五人并行开发方案](./workflow/260331-claude-code-五人并行开发方案.md) — 基于已冻结的 Claude Code 风格工具环境接入方案，按 `tool-definitions / stream / tool-sandbox / session metadata / capabilities / tests` 五条主线设计五人可并行推进的详细实施计划、依赖 DAG 与阶段验收策略

- [260331-手机端功能补全方案](./workflow/260331-手机端功能补全方案.md) — 修复 P0 Bug（AppNavigator 登录跳转/token 过期写入/Host 模式 URL/历史消息加载）并接通已有但未挂载的 AgentActivityPanel/MobileVoiceRecorder/MobileAttachmentBar/DialogueModeSelector 组件

- [260330-agent-gateway云端部署方案](./workflow/260330-agent-gateway云端部署方案.md) — 将 agent-gateway 升级为可独立云端部署的生产级服务：新建 Dockerfile、接入真实 Redis、安全加固（JWT/CORS/Admin 默认值）、CloudWorkerConnection stub 收口、Desktop 云端引导对齐，附完整 cloud-deployment.md 文档


- [260329-全工具特殊功能子代理模型复审方案](./workflow/260329-全工具特殊功能子代理模型复审方案.md) — 再次对照 `temp/opencode` 与 `temp/oh-my-openagent`，复审当前仓库的全部工具、特殊功能使用方式与子代理模型路由是否一致，并继续收口残余关键偏差

- [260327-聊天-html-tsx-效果预览方案](./workflow/260327-聊天-html-tsx-效果预览方案.md) — 为聊天界面补充 HTML / TSX 文件效果预览能力的最优实施路线，先冻结“聊天中低摩擦看效果”的产品目标，再在受信/不受信隔离、Web/Tauri 兼容与分阶段 rollout 上收敛

- [260327-opencode任务体系对齐方案](./workflow/260327-opencode任务体系对齐方案.md) — 对齐 `temp/opencode` 的任务创建、子任务 agent 选择、完成回调、主线程结果接收与主界面子代理运行状态展示，目标是把现有 child session + task graph 升级为更接近参考实现的完整子代理执行闭环

- [260325-内置工具对齐与补齐方案](./workflow/260325-内置工具对齐与补齐方案.md) — 在已完成参考库命名收敛的基础上，继续以 BDD + TDD 方式补齐缺失内置工具；首批优先实现高确定性的 `glob`，`webfetch` 在语义明确后进入下一阶段

- [260324-opencode-代理对标调整方案](./workflow/260324-opencode-代理对标调整方案.md) — 正在对照 `temp/opencode` 的中转代理实现，核查 OpenAWork 当前上游请求构造、流式解析与 GPT-5/Responses 兼容差距，目标是收敛到可验证的最小代理兼容补丁

- [260323-聊天界面-opencode能力集成方案](./workflow/260323-聊天界面-opencode能力集成方案.md) — 已完成 Chat UI 挂载位、agent-core/gateway 接线与官方 opencode 聊天产品化模式核查，方案已冻结为“服务端能力真相源 + 聊天端触发/展示/确认”，按协议先行、只读先行、写入后置推进

- [260323-opencode对标会话持久化方案](./workflow/260323-opencode对标会话持久化方案.md) — 已完成 `temp/opencode` 源码级对标，确认应采用简化版 `session/message/part` 三层主事实，`messages_json` 仅保留兼容层，delta 继续走事件不落库

- [260323-聊天消息后端持久化方案](./workflow/260323-聊天消息后端持久化方案.md) — 已完成 Web Chat → Gateway → SessionStore 现状核查，确认当前缺口在“写入缺失 + 读取契约错位 + 历史未回灌”，推荐以 gateway 为事实源分阶段补齐保存与回放闭环

- [260321-mobile-功能补全方案](./workflow/260321-mobile-功能补全方案.md) — 移动端 13 项遗留问题全部完成：P0 导航可用性（Onboarding/Settings/Chat返回）、P1 UX（标题/中文化/Settings按钮）、P2 代码规范（as any消除/Onboarding真实逻辑），typecheck 零错误

- [260321-优先级调整与修复方案](./workflow/260321-优先级调整与修复方案.md) — 代码检查后确认的8项真实遗留问题（FIX-01~08），含Gateway骨架端点/前端硬编码/FileSearch接线/permissions结构

- [260321-ui数据联通补充方案](./workflow/260321-ui数据联通补充方案.md) — UI组件已渲染但数据空/硬编码问题（UI-01~06）：ChatPage stream事件解析/SettingsPage BudgetAlert/FileSearch搜索/ContextPanel token/Provider持久化/Gateway骨架端点

- [260321-mock数据真实化方案](./workflow/260321-mock数据真实化方案.md) — 主体接线已完成；GW-06/FE-06 已被后续优先级方案覆盖修复，当前剩余以验证步骤与文档回写为主

- [260321-workspace-context-feature.md](./workflow/260321-workspace-context-feature.md) — Gateway + Web + Desktop 主体已完成；当前主要是旧 checklist 的 T-08/T-11 状态描述存在漂移，需随收口方案统一回写

- [260320-shared-ui-web集成方案](./workflow/260320-shared-ui-web集成方案.md) — shared-ui 40+ 组件全部接入 Web 端 ✅ 全部完成

- [260319-四开发者任务分配方案](./workflow/260319-四开发者任务分配方案.md) — 85个任务全部 ✅，待归档

## 归档工作流（已完成）

- [260331-claude-code-工具环境集成方案](./workflow/done/260331-claude-code-工具环境集成方案.md) — 已完成：冻结 OpenAWork 对齐 `claude-code-sourcemap` 的推荐路线为“保留 canonical 小写工具不动，在 gateway 增加 Claude Code 风格兼容 surface + session-scoped profile + input adapter”，并明确 P1/P2/P3 rollout 与高/中/低语义兼容分层

- [260330-发布前质量门禁补齐方案](./workflow/done/260330-发布前质量门禁补齐方案.md) — 已完成：`Prepare Release` 现会在 bump / tag / dispatch 之前执行格式检查、全量类型检查、Web 生产构建、Gateway 单元测试、Mobile 单元测试和发布稿 dry-run 校验；明确暂不纳入 Desktop/Gateway 开发中的 P0 构建红项

- [260330-后台保险操作对齐复检](./workflow/done/260330-后台保险操作对齐复检.md) — 已完成：补齐项目 ignore 规则真加载、durable request workflow logs、durable session file diffs、workspace 权限文件桥接、permission decision logs 与 durable session run events

- [260330-工具移植与格式加强复检](./workflow/done/260330-工具移植与格式加强复检.md) — 已完成：加强复检并继续收口 `codesearch`、canonical `read/write`、canonical `grep/glob`、legacy 文件工具参数形状、完整 LSP 套件与 task CRUD 工具面

- [260330-中文发布日志强制方案](./workflow/done/260330-中文发布日志强制方案.md) — 已完成：`Prepare Release` 现强制要求中文 `release_notes`，发布稿仅在 GitHub workflow 运行时临时生成；desktop/mobile 发布流统一消费同一份 runtime-only 发布稿，desktop 还会在构建完成后自动把各平台安装包下载链接追加到 GitHub Release body 中

- [260330-skills工作区动态加载实现方案](./workflow/done/260330-skills工作区动态加载实现方案.md) — 已完成：新增工作区本地 skills 扫描与安装路由、Skills 页面“本地”视图，以及基于 `installed_skills` 的运行时即时生效闭环；本地技能首版支持手动扫描与重新加载，不含文件监听热更新

- [260330-自动版本调整方案](./workflow/done/260330-自动版本调整方案.md) — 已完成：新增 `scripts/release-version.mjs` + `prepare-release.yml` 自动版本调整链路；支持 conventional commits 自动推断 bump、同步 monorepo 版本文件，并按 desktop/mobile 现有发布链自动创建 tag 或 dispatch preview；版本号采用 9 进 1 进位规则

- [260330-统一系统版本来源方案](./workflow/done/260330-统一系统版本来源方案.md) — 已完成：统一 Web / Desktop / Gateway / Mobile 的系统版本来源；Web/Desktop 共用 Vite 版本插件，Gateway 改为根包优先/当前包兜底的版本发现，Mobile 改为 `app.config.ts + expo-constants`；typecheck 全绿，Web build、Gateway unit、Mobile test 均通过

- [260329-剩余参考能力全部补齐方案](./workflow/done/260329-剩余参考能力全部补齐方案.md) — 已完成：补齐 `session_*`、`ast_grep_*`、`skill_mcp`、`interactive_bash`、`call_omo_agent`、`look_at` 等剩余 reference tool family，并让 Agents 页面支持 `model / variant / fallbackModels` 的可视化配置与运行时生效

- [260327-子代理任务默认权限收敛](./workflow/done/260327-子代理任务默认权限收敛.md) — 已完成：task 创建的 child session 默认不再暴露 `task` 工具，子代理不能继续默认递归委派；新增 session 级工具可见性过滤、单测与端到端验证证据

- [260327-非git目录review状态修复](./workflow/done/260327-非git目录review状态修复.md) — 已完成：`/workspace/review/status` 与复用它的 workspace review helper 在目标目录不是 Git 仓库时不再抛 500，而是统一返回空变更；新增非仓库目录回归测试，相关类型检查通过

- [260326-子代办双lane实现](./workflow/done/260326-子代办双lane实现.md) — 已完成：按 TDD + BDD 分三阶段落地双 lane todo。Gateway 已支持 `main/temp` 存储、temp 专用工具与 `/todo-lanes` 聚合路由；Web/Desktop 已改为主区 main-only、右侧面板区分主待办与临时待办，并通过阶段性 git 提交收口

- [260326-agent实体管理升级方案](./workflow/done/260326-agent实体管理升级方案.md) — 已完成：将 `/agents` 从偏好页升级为实体管理台，支持 custom agent 新增、builtin override、禁用、移除、自定义编辑，以及单个/全部恢复默认，并联动 `/capabilities`；后续又按 Chat 风格收敛样式，并改为从 `temp/oh-my-openagent` / `temp/opencode` 本地参考快照提取 builtin description 与 prompt

- [260326-子代办双lane方案](./workflow/done/260326-子代办双lane方案.md) — 已完成：冻结会话级 todo 的 v1 推荐架构为固定双 lane（`main` + `temp`），保留 `todowrite/todoread` 仅作用于主待办，新增 temp 专用工具与 `/todo-lanes` 聚合读取路径，并将 lane 级 revision / promote / mobile 接入定义为后续演进阶段

- [260326-agent管理页面方案](./workflow/done/260326-agent管理页面方案.md) — 已完成：新增 `/agents` 页面与导航入口，基于 `/capabilities` + `/agents/preferences` 支持查看全部 Agent、搜索过滤，以及用户级显示名/备注/收藏/隐藏管理

- [260325-agent角色体系规范化方案](./workflow/done/260325-agent角色体系规范化方案.md) — 已完成：冻结 5 个核心角色 + 2 个 overlay，落共享 alias registry / preset packs / runtime canonical role 传递，并让 `/capabilities` 与 Chat slash 菜单展示规范角色信息

- [260324-子任务层级实现方案](./workflow/done/260324-子任务层级实现方案.md) — 已完成：参考 `temp/opencode` 与 `temp/oh-my-openagent` 落地一等子任务树；`AgentTask` 新增 `parentTaskId`，gateway `/sessions/:id/tasks` 返回层级投影，Web PlanPanel 与右侧任务区已支持子任务缩进展示

- [260324-skills离线缓存刷新方案](./workflow/done/260324-skills离线缓存刷新方案.md) — 已完成：第三方 Skills 源已改为 SQLite 快照离线优先，新增显式同步接口，市场页首开不再依赖用户第三方源远端 fan-out

- [260321-剩余功能收口详细方案](./workflow/done/260321-剩余功能收口详细方案.md) — P0 Chat 主链路、Web Settings 去 demo 化，P1 Mobile Settings 与 Artifacts，P2 Multi-Agent 审批闭环均已完成；根级 lint 与 desktop Rust 检查存在环境/仓库噪音限制，见文档 Notes
- [260321-模式设计补全方案](./workflow/done/260321-模式设计补全方案.md) — 已补全三组历史模式设计：Worker 执行模式（Local/Cloud/Sandbox）、DAG DataFlow（sequential/parallel/conditional）、CLI 审批模式（auto/prompt/deny），均具备 red→green 测试与手工验证
- [260321-chat模式会话绑定方案](./workflow/done/260321-chat模式会话绑定方案.md) — Chat 顶部 DialogueMode 与 YOLO 按钮已绑定到会话 metadata，刷新/切换会话可恢复状态
- [260322-权限永久同意工作区持久化方案](./workflow/done/260322-权限永久同意工作区持久化方案.md) — 永久同意已写入工作区 `.openawork.permissions.json`，新启动/新 manager 可自动读取并免重复询问
- [260322-参考剩余功能集成方案](./workflow/done/260322-参考剩余功能集成方案.md) — 全部 13 项任务完成：Phase 1 执行层（文件审阅/桌面自动化/SSH UX）、Phase 2 协同与渠道（团队协同/WeCom/WhatsApp/QQ）、Phase 3 工作流（Prompt 优化器/翻译工作流），共 24 条绿灯测试证据
- [260320-shared-ui-web集成方案](./workflow/done/) — 全部完成，待移至 done/ ✅
- [260319-四开发者任务分配方案](./workflow/done/) — 全部完成，待移至 done/ ✅
- [260320-logger-工作流日志系统方案](./workflow/done/260320-logger-工作流日志系统方案.md) ✅
- [260320-自动更新功能设计](./workflow/done/260320-自动更新功能设计.md) ✅
- [260320-未完成缺口补充方案](./workflow/done/260320-未完成缺口补充方案.md) ✅
- [260320-web-desktop-功能迁移方案](./workflow/done/260320-web-desktop-功能迁移方案.md) ✅
- [260320-opencowork-ui-改造方案](./workflow/done/260320-opencowork-ui-改造方案.md) ✅
- [260319-web端方案](./workflow/done/260319-web端方案.md) ✅

- [260318-跨平台-ai-智能体-任务计划](./workflow/260318-跨平台-ai-智能体-任务计划.md)
- [260318-mcp-skills-统一工具扩展框架](./workflow/260318-mcp-skills-统一工具扩展框架.md)
- [260318-openwork对标差距补充方案](./workflow/260318-openwork对标差距补充方案.md)
- [260318-扩展能力方案-多agent与浏览器自动化等](./workflow/260318-扩展能力方案-多agent与浏览器自动化等.md)
- [260318-crush续作特性补充方案](./workflow/260318-crush续作特性补充方案.md)
- [260318-omo-opencode核心机制研究](./workflow/260318-omo-opencode核心机制研究.md)
- [260319-web端方案](./workflow/done/260319-web端方案.md) ✅
- [260319-对话团队agent决策层协议](./workflow/260319-对话团队agent决策层协议.md)
- [260319-lsp集成方案](./workflow/260319-lsp集成方案.md)
- [260319-缺陷补充与方案整合](./workflow/260319-缺陷补充与方案整合.md)
- [260319-skills市场完整方案](./workflow/260319-skills市场完整方案.md)
- [260319-opencowork借鉴方案](./workflow/260319-opencowork借鉴方案.md)
- [260319-ai-provider配置管理方案](./workflow/260319-ai-provider配置管理方案.md)
- [260319-opencowork-补充借鉴方案](./workflow/260319-opencowork-补充借鉴方案.md)

## Architecture Decisions

- [2026-03-31] Claude Code 风格工具环境接入 OpenAWork 时，保留现有 canonical 小写工具名作为执行真相源；在 `services/agent-gateway` 的模型可见层引入 session-scoped compatibility surface（`openawork / claude_code_simple / claude_code_default`），统一承担名称与入参适配，避免破坏现有 runtime/contracts。

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

- [2026-03-18] MCP+Skills 统一工具扩展框架：Skills 层封装复合能力，Tool Registry 统一路由（packages/agent-core），MCP Client 适配层支持 SSE/WebSocket/stdio（packages/mcp-client），内置工具层处理平台原生能力；移动端仅 SSE/WebSocket，桌面端额外支持 stdio 子进程；Skill Manifest v1（skill.yaml）含权限声明/约束/生命周期；权限双层模型：install-time 授权 + 运行时 ToolRegistry.listAvailable() 过滤；Plugin 系统扩展 Skill 支持 Slash Commands/Subagents/Lifecycle Hooks；Cloud Worker/沙箱模式支持云端隔离执行；Orchestrator CLI 支持 auto/prompt/deny 审批策略；凭据通过 SecureStore/Stronghold 代理（非直接读取 API Key）。
- [2026-03-18] 扩展能力方案（方案四）覆盖多 Agent 编排（AgentDAG/DAGNode/DAGEdge + React Flow 可视化）、浏览器自动化（Playwright，桌面全功能/移动端代理）、Token 成本监控（per-model 单价 + BudgetAlert）、工作流可视化编排（低代码拖拽 + 8 种节点类型，复用 DAG 调度）、多模态输入（图片/语音 Whisper/批量文件）、GitHub 深度集成（App webhook + 危险操作二次确认）、Generative UI（props schema 严格校验 + 组件白名单防 XSS）；移动端 React Flow 降级为时间轴视图。
- [2026-03-18] OpenWork 对标差距：用户体验层（Onboarding 三路径/QR 配对/Cloud Worker）、细粒度权限（once/session/permanent/reject + 审计日志自动脱敏）、Artifacts 管理（file/document/log/summary + 分享链接）、File Browser（全文/文件名/符号搜索）、会话摘要作为 Artifact、Skills 市场 + Developer Mode（SSE 事件流 Inspector）；PermissionManager 与 ToolRegistry 共享权限决策事件。
- [2026-03-18] Crush（charmbracelet 续作）补充特性：Catwalk 在线模型注册中心（启动时后台静默更新，支持 embedded 快照离线降级）、会话中途模型切换（保留上下文）、.crushignore 独立忽略层（优先级高于 .gitignore）、disabled_tools 完全隐藏工具（LLM 不感知）、MCP HTTP transport、Git commit 归因（Co-Authored-By/Assisted-By trailer）、结构化日志系统（tail/follow 实时查看）、匿名遥测（opt-out，首次启动告知，不收集内容数据）、多平台路径适配（Windows %LOCALAPPDATA%）。
- [2026-03-18] omo（oh-my-openagent）差距分析：Hash-Anchored Edit（行内容哈希验证，编辑成功率 6.7%→68.3%）、Auto Compact 95% 阈值（已实现）、ralph-loop 自引用执行循环（DONE 检测，最大 100 次迭代）、runtime-fallback Hook（429/503 自动切换备用模型 + cooldown）、Task System（跨会话持久依赖图 .sisyphus/tasks/，blockedBy 空则自动并行）、/init-deep 层级 AGENTS.md（文件读取时自动向上注入最近 AGENTS.md）；11 专业 Agent + Category 系统（8 类按域优化模型）。
- [2026-03-18] Crush（charmbracelet/crush）续作特性：Catwalk 在线模型注册中心（embedded 快照离线降级 + 自定义源 URL）；会话中途模型切换（保留上下文 + 兼容性检测）；.crushignore 独立文件过滤（独立于 .gitignore）；allowed_tools 白名单 + disabled_tools 完全隐藏工具（防 prompt injection）；--yolo 全跳过权限（移动端禁用）；MCP HTTP transport 新增支持（无状态+会话ID）；Co-Authored-By/Assisted-By Git commit 归因；结构化日志系统（tail/follow/filter）；匿名遥测（opt-out/DO_NOT_TRACK）；多平台路径适配（Windows %LOCALAPPDATA%）。
- [2026-03-18] omo/OpenCode 核心机制：11 专业 Agent（Sisyphus 编排/Hephaestus 执行/Oracle 咨询/Librarian 文档/Explore 代码库）；Category 系统（visual-engineering/ultrabrain/deep/quick 等按域选模型）；Hash-Anchored Edit（行内容哈希验证，编辑成功率 6.7%→68.3%）；ralph-loop 自引用执行循环（DONE 检测+最大迭代）；runtime-fallback Hook（429/503 自动切换备用模型+cooldown）；Task System（跨会话持久依赖图，blockedBy 自动并行）；/init-deep 层级 AGENTS.md 目录上下文注入；Skill-Embedded MCP OAuth 2.1（PKCE+动态注册+Token 自动刷新）；内置 MCP（websearch/context7/grep_app）。
- [2026-03-18] OpenWork 对标差距：Artifacts 作为一等公民（file/document/log/summary 类型，ArtifactManager list/open/share/download）；Onboarding 五步流程（Host/Client/Cloud 三路径）；QR 码 Host/Client 配对（30秒 Token，局域网直连，TLS 指纹验证）；FolderAuthorizationManager 双层目录授权；四级权限语义（once/session/permanent/reject）；AuditLogManager（工具调用+权限决策结构化日志，自动脱敏，90天保留）；Developer Mode 事件流 Inspector；SkillRegistry 客户端（search/install/update/checkUpdates）。
- [2026-03-18] 扩展能力方案：AgentDAG 多 Agent 并发调度（packages/multi-agent）；浏览器自动化 Playwright/Browser-use（桌面全功能，移动端代理）；Token 成本监控（UsageDashboard+BudgetAlert+CostEstimator）；工作流可视化编排（React Flow 拖拽+条件分支+LoopNode，WorkflowTemplate SQLite 持久化）；多模态输入（图片/语音 Whisper/批量文件）；GitHub App 事件触发+危险操作二次确认；Generative UI（schema 校验+白名单组件：form/table/chart/approval/code_diff）；浏览器自动化仅桌面全功能，移动端通过 Host 代理。
- [2026-03-18] 客户端 AI 智能体采用 TypeScript 统一栈（Expo + Tauri + 共享 agent-core）— 以小团队快速迭代为优先，保留后续扩展到混合推理能力。
- [2026-03-19] Web 端（React SPA + PWA）通过 Agent Gateway HTTP API 接入，共用 agent-core，不重复 AI 逻辑。
- [2026-03-19] 对话团队 Agent 采用四层决策协议（路由层 D1 + 执行模式 D2 + 子 Agent 身份 D3 + 失败升级 D4），参考 HelloAGENTS G4 路由机制，解决「执行层有余、决策层不足」问题。
- [2026-03-19] LSP 集成采用 vscode-jsonrpc/node 最小化依赖（参考 opencode），桌面端本地 spawn LSP 服务器，移动端通过 Agent Gateway WS 代理订阅诊断；MVP 支持 TypeScript / Go / Python，新包 packages/lsp-client/。
- [2026-03-19] 整合修订层确立五大 MVP 前必须功能：.agentignore 文件过滤（安全底线）、Onboarding 流程、QR 码 Host/Client 配对、Artifacts 管理 + 文件变更视图、四级权限语义；多 Agent 接口统一为 AgentDAG（废弃 AgentGraph）；补充 Auto Compact、流式断点续传、统一错误体验、审计日志四大架构缺陷修复。
- [2026-03-19] Skills 市场采用多源注册中心架构：内置官方源 + 用户自定义第三方市场（URL + 可选 Token + 信任级别）；标准 REST API 协议（v1）开放给第三方实现；安装生命周期含签名验证/权限确认/ToolRegistry 注册；新包 packages/skill-registry/；opkg CLI 完整命令集。
- [2026-03-19] OpenCowork 借鉴三大模块：①消息平台 Channel 系统（工厂注册 + 7 平台，Telegram/Discord P0）放 agent-gateway；②Cron 定时调度（at/every/cron + 并发控制 + 执行历史）放 agent-gateway；③新增 3 个缺口：SSH 远程连接、系统原生通知、web_search 内置工具（DuckDuckGo 默认）。
- [2026-03-19] AI Provider 配置管理：21 个内置预设（含 9 个国内 Provider，DeepSeek/Qwen/MiniMax/百度/月之暗面/智谱/硅基流动/小米）；五维 active 选择（chat/fast/translation/speech/image）；完整类型系统（ThinkingConfig/requestOverrides/mergeBuiltinModels/calculateTokenCost/normalizeBaseUrl）；OAuth 2.0 + PKCE 流程；新模块 packages/agent-core/src/provider/。
- [2026-03-19] OpenCowork 补充借鉴：①Plan 状态机（drafting→approved→implementing→completed，与 D2 ExecutionMode 集成）；②Team 实时协作（事件驱动 TeamStore，DAGEvent→TeamEvent 映射，成员防重复+任务不回滚）；③Settings 版本化迁移（version+migrate，升级不丢用户配置）；④API Quota 实时监控；⑤ContextPanel 显式上下文管理；⑥FileTreePanel 树形变更视图；⑦Web Search 9 种引擎配置。

## Coding Conventions

- 规划文档统一放置在 `.agentdocs/workflow/`，使用 `YYMMDD-任务名.md` 命名。

## Known Pitfalls

- [2026-03-31] 参考风格工具环境不能只做名字映射：`/capabilities`、stream 下发工具集、sandbox 入站执行、session metadata allowlist 与历史 `toolName` 留痕必须一起设计；否则极易出现“展示可用但运行不可用”或“reference 名称与 canonical 名称混淆无法排障”的漂移。
- [2026-03-31] Claude Code 风格工具环境实施时，不能把“每对话文件变更记录与日志”当成后置补丁：`request_workflow_logs`、`session_file_diffs`、`session_run_events` 必须与 profile/reference surface 同步设计，否则对话、工具调用、文件 diff 与运行日志会断链。

- [2026-03-30] `apps/web` 若直接消费 `@openAwork/shared-ui` 的包导出，Vitest/Vite 可能继续读取旧的 `dist` 产物，导致跨包 UI 源码改动“看起来没生效”；已通过 `apps/web/vite.config.ts` alias 到 `packages/shared-ui/src/index.ts` 保持开发/测试与源码一致。

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

## Known Pitfalls

- [2026-03-24] `stream-protocol` 纯单测若直接 import `tool-definitions` 链，会经 `workspace-tools -> workspace-paths -> db.js` 把 `node:sqlite` 拉进 Vitest 解析；协议单测应 mock `tool-definitions`，DB/Fastify 级链路改用独立 `tsx` 验证脚本。

- [2026-03-25] `agent-gateway` 若直接消费 `@openAwork/mcp-client` / `@openAwork/skill-types` 而 tsconfig 未配置源码 `paths/references`，TypeScript 与 `tsx` 可能回退到包导出与 `dist` 产物，导致 MCP 相关 test/typecheck/build 不稳定；应在服务端包 tsconfig 显式声明 workspace 源码路径。

- [2026-03-21] mock数据真实化方案描述的问题已基本完成，剩余骨架端点（/settings/mcp-status、/settings/diagnostics、/settings/workers 返回空数组）和 SettingsPage 两处硬编码 → 见 260321-优先级调整与修复方案.md FIX-01~05
- [2026-03-21] workspace-context 的 Gateway 层（workspace.ts + sessions workspace patch）和 Layout.tsx 右侧面板已完成接线，唯一遗漏是 FileSearch.onSearch 传 `async () => []` 空函数 → FIX-07b
- [2026-03-21] packages/agent-core/src/permissions/ 有 permission-manager.ts 但无 index.ts；根 index.ts 实际走 ./permission/index.js（不同目录）→ FIX-08，不影响运行时

## Global Important Memory

- [2026-03-20] `packages/logger`（`@openAwork/logger`）已实现：WorkflowLogger（树状请求步骤日志）+ FrontendLogger（console 封装 + ring buffer）+ createRequestContext 工具函数；agent-gateway stream/sessions 路由全部插桩；web 端 `src/utils/logger.ts` 单例可直接 import 使用。

- [2026-03-20] UI 风格取向已确定并固化到 `.serena/memories/ui_style_orientation.md`：目标风格为「极简桌面工作台」参考 OpenCowork v0.6.0 源码验证模式；核心要素：Glass Card 主容器（rounded-lg + border-border/60 + bg-background/85 backdrop-blur-sm + 大阴影）、NavRail（w-12）、SessionListPanel（可折叠/拖拽）、ModeToolbar（layoutId 动画高亮）、OKLCH CSS token + Tailwind v4 @theme inline、motion 动画系统含全局 kill-switch；Web 端无 TitleBar 拖拽/窗口控制，Desktop 端用 Tauri data-tauri-drag-region；所有实施前必须阅读该记忆文件。
- 用户已确认主推荐技术栈可行，当前目标是输出「详细任务计划方案」，优先产出可直接执行的分阶段计划。
- [2026-03-19] 方案需支持 Web 端（React SPA + PWA），通过 Agent Gateway HTTP API 接入，共用 agent-core 逻辑，无需重复 AI 实现。
- [2026-03-19] Web 端方案已完成实现：apps/web（Vite+React19+Tailwind+PWA）、packages/web-client（WS+SSE降级）、packages/shared-ui（ChatMessage/StreamRenderer/ToolCallCard/PlanPanel）、Gateway 内嵌静态 serve、docker-compose 一键部署、Playwright E2E、CI 集成、docs/web-deployment.md 部署文档。
- [2026-03-19] LSP Phase L1 已完成：packages/lsp-client（language.ts/types.ts/server.ts/client.ts/index.ts），支持 TypeScript/Go/Python，NearestRoot Monorepo 感知，LSPManager 懒启动+broken集合，构建通过。
- [2026-03-19] MCP+Skills Phase A 已完成：packages/skill-types（SkillManifest/MCPToolDef/ToolRegistry 接口），packages/mcp-client（MCPClientAdapterImpl SSE+StreamableHTTP降级+ToolRegistryImpl），构建通过。
- [2026-03-19] 决策层 D-01/D-02 已完成：packages/agent-core/src/routing.ts（ConversationRouter 五维评估/路由判定 R0-R3/信息依赖链追问/子Agent身份协议），构建通过，不影响现有接口。
- [2026-03-19] P0 缺陷整合已完成：(P-01) AgentIgnoreManager（.agentignore+内置安全规则，packages/agent-core/src/filesystem/ignore.ts）；(P-02) tool-sandbox 集成 ignore 检查（file_read/file_write 调用前拦截）；(P-10) packages/multi-agent 新建包，统一 AgentDAG/DAGNode/DAGEdge/WorkflowMode/RetryPolicy 接口，DAGRunner 含重试+根因分析+事件发射，废弃 AgentGraph；(L-07) lsp-client 单元测试 35 个全绿（language/server/NearestRoot 覆盖）。
- [2026-03-19] P1 全部完成：(D-03~D-08) MultiAgentOrchestratorImpl（WorkflowMode/human_approval_required/risk_escalation/RetryPolicy/根因分析）+ WorkflowModeToggle+RootCausePanel UI 组件；(MCP B-01~B-04) packages/skills（SkillRegistry 安装/卸载/权限/内置Skills：web_search/file_read/clipboard_read）；(L-08~L-10) Gateway LSP 路由（/lsp/status /lsp/diagnostics /lsp/touch /lsp/events WS），所有包构建通过。
- [2026-03-19] 第二轮 P0 完成：(L-11/L-12) lsp_diagnostics+lsp_touch 工具注册到 agent-core + 7个单测全绿；(P-04) packages/pairing（PairingManagerImpl：30秒Token/QR/确认连接/6测试全绿）；(P-06/P-08) packages/artifacts（ArtifactManager+FileBrowserAPI）+ packages/agent-core/src/permission（PermissionManagerImpl：四级决策once/session/permanent/reject + revoke + disableTool），所有包构建通过。
- [2026-03-19] 并发批次完成：(PR-01~PR-04) packages/agent-core/src/provider（ProviderManagerImpl：8+个内置Provider预设含价格/五维active选择/normalizeBaseUrl/mergeBuiltinModels/buildRequestOverrides/calculateTokenCost）；(SM-01~SM-04) packages/skill-registry（RegistrySourceManager/SkillInstaller/SkillRegistryClientImpl/跨源并发搜索/verifySource）；(Q-01) ContextCompactor（Auto Compact 95%阈值/summarize/truncate/sliding三策略）；(Q-02) StreamRecoveryManager（每50token检查点/recover/clear），全部构建通过，agent-core 85测试全绿。
- [2026-03-19] 推荐批次完成：(Q-03) AgentError统一分类（network/auth/rate_limit/model/tool/permission/context_overflow/unknown + classifyHttpError/classifyNetworkError/formatRetryMessage）；(Q-04) AuditLogManager（内存存储+脱敏SENSITIVE_PATTERNS+JSON/Markdown导出）；(OC-01~OC-06/OC-08~OC-10) Gateway Channel系统（ChannelManager工厂注册+Telegram轮询适配器+Discord API适配器+CRUD路由）+ CronScheduler（at/every/cron三种调度+并发控制maxConcurrent+执行历史+enable/disable路由），所有包构建通过。
- [2026-03-19] P0收尾批次完成：(P-05) QRCodeDisplay+QRCodeScanner UI组件（30秒倒计时/相机扫码/手动输入）；(P-09) PermissionPrompt（riskLevel差异化：high不显示永久允许/reason/previewAction/四级决策按钮）；(Q-05) AuditLogExportButton（JSON/Markdown格式选择+下载）；(L-16) DiagnosticCard（内联诊断卡片：severity颜色+图标+行号+点击跳转）；(OC-05) AutoReplyPipeline（/help//new//status//init命令拦截+streaming/非streaming回复路由），shared-ui和gateway构建通过。
- [2026-03-19] P0最终收尾：(P-07) FileStatusPanel（A/M/D/R状态+行数统计+点击回调）+FileSearch（text/filename/symbol三种模式+300ms防抖）；(L-13/L-14) packages/lsp-client/src/tauri.ts（RustAnalyzerServer+ESLintServer+BiomeServer，createTauriLSPServerInfo工厂）；(L-15) LSPWebSocketClient（移动端WS订阅/自动重连/touchFile/getDiagnostics），lsp-client 35测试全绿，shared-ui构建通过。
- [2026-03-19] Mobile离线能力完善：(M-01) chat页面接入appendMessage+saveDraft（500ms防抖草稿，发送后持久化，启动时offline-first加载）；(M-02) sessions页面接入listSessions离线缓存（先展示本地再合并远端）；(M-03) settings页面新增Model选择（6预设+SecureStore持久化）+MCP Servers管理（CRUD+Switch+SecureStore）；(M-04) 新增session-store.test.ts（10用例）+use-network-state.test.ts（9用例），全部27测试通过。
- [2026-03-20] 高优先级功能全部完成：(1) Catwalk 在线模型注册中心（CatwalkRegistryImpl 补全自定义源URL/autoUpdate/startAutoUpdate，静默后台同步，离线快照降级）；(2) 会话中途模型切换补全 ContextTransferStatus（estimateContextTransfer：tokenCount/estimatedCostUSD/compatible/warning，关联 catwalk contextWindow）；(3) Hash-Anchored Edit（packages/agent-core/src/tools/hash-edit.ts：LineHash/AnchoredEdit/HashAnchoredEditorImpl，SHA-256前8字符行哈希验证，applyEdits原子性写入+回滚）；(4) runtime-fallback Hook（packages/agent-core/src/hooks/runtime-fallback.ts：RuntimeFallbackHookImpl，429/503触发冷却+切换备用模型，per-model cooldown 60s）；(5) ralph-loop 自引用执行循环（packages/agent-core/src/ralph-loop/index.ts：RalphLoopImpl，DONE检测+最大100次迭代+stop强制终止）；(6) 浏览器自动化（packages/browser-automation/：DesktopBrowserAutomation Playwright全功能+MobileBrowserAutomationProxy代理接口+InProcessDesktopProxyTransport）；所有包 tsc --noEmit 通过。
- [2026-03-20] omo 核心机制移植完成（.sisyphus → .agentdocs 改名）：(1) AgentDocs Task System（packages/agent-core/src/task-system/：types/store/scheduler/index，存储路径 .agentdocs/tasks/，blockedBy 依赖图 DFS 环检测，Kahn 拓扑排序，getReadyTasks 自动并行，状态迁移校验）；(2) keyword-detector Hook（hooks/keyword-detector.ts：KeywordDetectorImpl，检测 ultrawork/ulw/search/find/analyze/investigate 关键词，自动激活对应模式）；(3) /handoff 会话交接（slash-command/index.ts：HandoffDocument/buildHandoffDocument/formatHandoffMarkdown，生成结构化 Markdown 交接文档）；(4) 非交互式 -p 脚本模式（cli/non-interactive.ts：NonInteractiveRunnerImpl，text/json/stream-json 三种输出格式，quiet 模式，outputFile 写出，allowedTools 过滤）；(5) Skill-Embedded MCP OAuth 2.1（oauth/：PKCEChallenge/generatePKCEChallenge S256，OAuthClientImpl RFC8414发现+RFC7591动态注册+授权码换Token+refreshToken，InMemoryTokenStore 自动刷新+提前60s过期检测）；所有包 tsc --noEmit 通过，全量 pnpm build 通过。
- [2026-03-20] 低优先级功能全部完成：(1) 匿名遥测首次启动告知弹窗（shared-ui/TelemetryConsentDialog.tsx：glass-card 风格模态弹窗，允许/拒绝两级决策，底部设置跳转提示，tsc 通过）；(2) 多 Agent 可视化接口层（agent-core/src/agent-viz/：AgentVizBridgeImpl 多适配器注册/广播，ConsoleAgentVizAdapter TUI输出，WebSocketAgentVizAdapter 外部send注入，便捷方法 agentStarted/Thinking/ToolCall/ToolDone/Done/Error）；所有包 tsc --noEmit 通过。
- [2026-03-20] 中优先级功能全部完成：(1) Web Search 9种引擎（web-search.ts 新增 WebSearchConfig+searchWithConfig 路由，支持 tavily/exa/serper/searxng/bocha/zhipu/google/bing/duckduckgo）；(2) Settings 版本化迁移修正（types.ts 新增 backgroundColor/fontFamily/toolbarCollapsedByDefault/leftSidebarWidth/newSessionDefaultModel/promptRecommendationModels，version=2，manager.ts migrate() 版本递增补字段策略）；(3) ContextManager 补全 addFile/addUrl/addClipboard（fs.readFile/fetch/clipboard，tokenEstimate=content.length/4）；(4) PermissionManager yolo 模式（enableYolo/disableYolo/isYoloEnabled，mobile 设备抛错保护，check()短路返回 permanent）；(5) /init-deep 层级 AGENTS.md 注入（hooks/directory-agents-injector.ts：DirectoryAgentsInjectorImpl，findNearestAgentsFile/collectAllAgentsFiles/buildInjectionBlock，path.dirname 向上遍历）；(6) FileTreePanel 树形文件变更视图（shared-ui：树形/列表切换，状态图标，行数变化，diff/revert按钮，撤销所有）；所有包 tsc --noEmit 通过。
- [2026-03-20] Web/Desktop 功能对齐全部完成：Desktop secure-storage.ts（AES-GCM 256-bit 加密，Web Crypto API）；SettingsPage 接入 loadProviderConfig/saveProviderConfig 持久化；auto-update.ts 重构（checkForUpdate/downloadAndInstall/silentUpdateCheck/UpdateError 分类）；UpdateProgressDialog 升级（版本号+release notes+进度条）；UpdateErrorDialog 新增（错误类型/重试/技术详情）；Mobile SettingsScreen 补充 OTA 检查 UI；release-desktop.yml 修复 releaseDraft:false；tauri.conf.json 双通道 endpoints；eas-ota.yml 独立 OTA 推送工作流；rollout.yml 真实回滚执行+Sentry release tagging。
- [2026-03-20] Web UI 暗/亮主题系统完成：index.css 重构为 OKLCH CSS token（:root 暗色 + :root.light 亮色，color-scheme 声明）；App.tsx 新增 theme state（localStorage 持久化 + matchMedia 系统偏好检测）；Layout.tsx TopBar 新增太阳/月亮切换按钮，所有 hardcoded rgba 替换为 token；LoginPage.tsx glass-card 风格 + 主题切换按钮；tsc 零错误，vite dev 服务正常启动。
