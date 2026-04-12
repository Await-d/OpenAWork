# AgentDocs 索引

## 活跃工作流

- [260410-团队页统一开发主计划](./workflow/260410-团队页统一开发主计划.md) — TeamPage 当前唯一入口文档：2026-04-12 起主线已调整为先冻结 Team / Personal / Shared 三域边界，再恢复页面与网关实现
- [260412-Team详细任务实施方案](./workflow/260412-Team详细任务实施方案.md) — 把 Team 重整进一步细化为实施阶段、模块批次、第一批受影响文件、前端状态替换顺序、风险点与验证策略
- [260405-opencode-ohmy-openawork分层整合方案](./workflow/260405-opencode-ohmy-openawork分层整合方案.md) — 面向 OpenAWork 的 opencode × oh-my-opencode 组合参考分层方案：明确内核层、增强层、发送链路与分阶段实施顺序
- [260404-t02-artifact实时预览实施](./workflow/260404-t02-artifact实时预览实施.md) — T-02 正式实施工作流：聚焦 Artifact 实时预览、可编辑产物、版本化与流式提取主链
- [260404-t01-跨会话记忆系统实施](./workflow/260404-t01-跨会话记忆系统实施.md) — T-01 正式实施工作流：包含 complexity assessment、success criteria、测试计划、依赖 DAG 与运行时 master plan
- [260401-buddy-伴侣功能集成方案](./workflow/260401-buddy-伴侣功能集成方案.md) — 面向 OpenAWork 的 buddy / companion 能力集成方案，聚焦能力裁剪、跨端挂点、状态模型、实验开关与分阶段 rollout（方案已冻结，全部 19 项待实施）
- [260331-claude-code-工具环境并行实施](./workflow/260331-claude-code-工具环境并行实施.md) — 按五人并行方案正式启动 Claude Code 风格工具环境接入实施（基础工具已完成，profile/surface/sandbox/stream/observability 层待实施）
- [260331-claude-code-五人并行开发方案](./workflow/260331-claude-code-五人并行开发方案.md) — 五条主线详细实施计划、依赖 DAG 与阶段验收策略（规划完成，Dev-1~Dev-5 共 47 项开发任务待执行）
- [260330-agent-gateway云端部署方案](./workflow/260330-agent-gateway云端部署方案.md) — 将 agent-gateway 升级为可独立云端部署的生产级服务（Mobile 端已完成，服务端基础设施/安全/Desktop/Web/文档共 14 项待实施）
- [260404-竞品差异化功能方案](./workflow/260404-竞品差异化功能方案.md) — ✅ 已完成全部 12 个竞品差异化功能详细技术方案（P0×3 + P1×4 + P2×5），含完整数据模型、API 设计、前端组件、实施阶段和验证矩阵

## 归档工作流（已完成）

- [260405-仓库级稳定性收口](./workflow/done/260405-仓库级稳定性收口.md) — 已完成从 Buddy 链路扩展到仓库级验证闭环：根级 `pnpm typecheck` 与 `pnpm test` 全通过
- [260405-chat-pr触发与恢复read-model实施](./workflow/done/260405-chat-pr触发与恢复read-model实施.md) — 已完成 chat 恢复链的下一轮收口：高风险 PR 自动触发 live gate，且 Web 主恢复链正式切到 `GET /sessions/:id/recovery` 聚合读取
- [260405-buddy-语音参数与默认回退](./workflow/done/260405-buddy-语音参数与默认回退.md) — 已完成 Buddy-Agent 绑定的最后一层补全：绑定级语音参数生效，未绑定 Agent 统一回退到同一个默认 Buddy 人格
- [260405-buddy-agent-绑定](./workflow/done/260405-buddy-agent-绑定.md) — 已完成 Buddy 与 Agent 的稳定绑定：Settings 管理映射，Chat 与 request-scoped companion prompt 按当前 effective agent 自动切换 persona / species / behavior
- [260405-huddy-伴侣图标动画迁移](./workflow/done/260405-huddy-伴侣图标动画迁移.md) — 已完成 `temp/claude-code-sourcemap` buddy 视觉层的 Web 迁移：当前 companion hero 与 18 种 companion 图鉴均已在 Settings 中可视化展示并带 idle / pet 动画
- [260405-huddy-伴侣功能实际完成](./workflow/done/260405-huddy-伴侣功能实际完成.md) — 已完成 buddy / companion 的实际功能收口：gateway deterministic profile、request-scoped prompt 注入、`/buddy` composer 触发、Chat 面板控制与 Settings Buddy tab
- [260404-子代理超时调整方案](./workflow/done/260404-子代理超时调整方案.md) — 已完成 child session 首响应 timeout、request-scope race 清理、`terminalReason/effectiveDeadline` 投影、Web/Mobile timeout 可见性、DAG `executionTimeoutMs/approvalTimeoutMs` 与 gateway approval timeout 主链
- [260405-chat-ci分层门禁实施](./workflow/done/260405-chat-ci分层门禁实施.md) — 已完成 chat 恢复链的 CI 分层：required fast gate + push-only live gate，并补齐 fast Web E2E 自启动 preview
- [260405-chat-真实端到端负向边界验证实施](./workflow/done/260405-chat-真实端到端负向边界验证实施.md) — 已完成真实 gateway 驱动的负向边界浏览器 E2E：permission reject 与 question dismiss 都能稳定收口到 idle 语义
- [260405-chat-真实端到端暂停恢复验证实施](./workflow/done/260405-chat-真实端到端暂停恢复验证实施.md) — 已完成真实 gateway 驱动的 paused/resumed 浏览器 E2E：question_asked 等待回答、刷新保留 paused、真实回答恢复并最终完成
- [260405-chat-真实端到端停止验证实施](./workflow/done/260405-chat-真实端到端停止验证实施.md) — 已完成真实 gateway 驱动的刷新后停止验证，并修复 `useGatewayClient` active handle 不触发重渲染的状态漂移问题
- [260404-chat-真实端到端验收实施](./workflow/done/260404-chat-真实端到端验收实施.md) — 已完成真实 gateway 驱动的 Chat 刷新恢复浏览器 E2E：real web + real gateway + mock upstream，覆盖发送、刷新、attach 恢复与最终消息落定
- [260404-chat-浏览器续流最终落定实施](./workflow/done/260404-chat-浏览器续流最终落定实施.md) — 已完成刷新恢复最终落定验收分层：浏览器层保留恢复体验，最终消息落定转由 `ChatPage` 回归稳定覆盖
- [260404-chat-浏览器续流验收实施](./workflow/done/260404-chat-浏览器续流验收实施.md) — 已完成 Chat 刷新恢复的浏览器层验收：新增 Playwright 用例验证恢复中的流内容、运行态提示与停止控制
- [260404-chat-续流验收强化](./workflow/done/260404-chat-续流验收强化.md) — 已完成 Chat attach 恢复的 gateway 级自动化验收接线：新增 `verify-stream-attach-recovery.ts` 并纳入 `test:durable`
- [260404-chat-真正续流phase2b实施](./workflow/done/260404-chat-真正续流phase2b实施.md) — 已完成 Chat Phase 2B 竞态收口：attach 路径采用 buffer-live-then-replay，收紧 replay/live 窗口并通过 gateway 回归验证
- [260404-chat-真正续流phase2a实施](./workflow/done/260404-chat-真正续流phase2a实施.md) — 已完成 Chat Phase 2A 真正续流实施：active-stream handshake、attach-only SSE、Web attach-first 恢复、Oracle 修正与全链路验证
- [260404-chat-真正续流resume协议设计](./workflow/done/260404-chat-真正续流resume协议设计.md) — 已完成 Chat 从“快照恢复展示”演进到“真正 resume / reattach 协议”的二阶段技术设计，明确 attach-only SSE、`clientRequestId + seq` cursor、前端恢复顺序与验证矩阵
- [260405-lsp-多server选择与eslint-biome实施](./workflow/done/260405-lsp-多server选择与eslint-biome实施.md) — 已完成 richer LSP 的最后结构缺口收口：gateway-side 现已支持多 server 命中、supplemental lint server 与 diagnostics 聚合，并正式对齐 `eslint` / `biome`
- [260404-lsp-language-server-coverage-bash-实施](./workflow/done/260404-lsp-language-server-coverage-bash-实施.md) — 已完成 richer LSP 的下一条 coverage 扩展：gateway-side 现已补齐 `bash-language-server start`，在不扩散到 fish/powershell/shellcheck/shfmt 的前提下，让既有 LSP 工具对 `.sh/.bash/.zsh` 真正可用
- [260404-lsp-language-server-coverage-docker-生态第二阶段实施](./workflow/done/260404-lsp-language-server-coverage-docker-生态第二阶段实施.md) — 已完成 richer LSP 的 Docker 生态第二阶段 coverage：gateway-side 现已补齐 Compose / Bake 的 `docker-language-server start --stdio` 接入，并通过受控 basename 匹配避免误吞全部 YAML/HCL
- [260404-lsp-language-server-coverage-dockerfile-实施](./workflow/done/260404-lsp-language-server-coverage-dockerfile-实施.md) — 已完成 richer LSP 的下一条 coverage 扩展：gateway-side 现已补齐 `docker-language-server start --stdio`，并通过 filename-based server matching 让既有 LSP 工具对 Dockerfile 真正可用
- [260404-lsp-language-server-coverage-yaml-实施](./workflow/done/260404-lsp-language-server-coverage-yaml-实施.md) — 已完成 richer LSP 的下一条 coverage 扩展：gateway-side 现已补齐 `yaml-language-server`，在不扩散到 eslint/docker/bash 或 YAML schema-store 深配置的前提下，让既有 LSP 工具对 YAML 真正可用
- [260404-lsp-language-server-coverage-第二轮实施](./workflow/done/260404-lsp-language-server-coverage-第二轮实施.md) — 已完成 richer LSP 的第二轮 coverage 扩展：gateway-side 现已补齐 `vscode-json-language-server`、`vscode-html-language-server`、`vscode-css-language-server`，在不扩散到 eslint/yaml/docker/bash 的前提下，让既有 LSP 工具对 JSON / HTML / CSS 真正可用
- [260404-lsp-language-server-coverage-扩展实施](./workflow/done/260404-lsp-language-server-coverage-扩展实施.md) — 已完成 richer LSP 的下一条 coverage 扩展：gateway-side 现已补齐 `rust-analyzer`，在不扩散到 eslint/biome 等非目标 server 的前提下，让既有 LSP 工具对 Rust 真正可用
- [260404-lsp-call-hierarchy-分阶段实施](./workflow/done/260404-lsp-call-hierarchy-分阶段实施.md) — 已完成 richer LSP 的下一条 follow-up：`lsp_call_hierarchy` 作为单工具高层封装已补齐 lsp-client 协议层、agent-core contract、gateway tool surface、sandbox、session visibility、prompt guidance 与 verification
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

- [2026-04-10] TeamPage 向多 Agent 编排演进时，优先采用 **Team Instance / Mission Run 作为主对象 + 复用 session/task/workflow/run-events 真相源**；执行角色必须与权限成员分开建模，避免再造第二套任务系统。
- [2026-04-10] 对标 SpectrAI 做团队页演进时，采用 **upstream-native first / merge-first**：OpenAWork 已有上游能力的部分只做并轨、投影和产品化，不做功能整迁或模块级照搬。
- [2026-04-10] TeamPage 的产品收束方向采用 **强对齐参考 + Web 先行 + 工作区一级总控大盘 + 统一交互代理**：主区按参考库式多 Tab 展开，人工消息默认先进入交互代理做需求改写，再进入团队运行链路。
- [2026-04-10] TeamPage 合并设计 v1 采用 **工作区卡片 → Team Instance / Mission Run → 参考库式多 Tab 总控视图**：首期 Web 端必须并轨运行事件、任务投影、子会话树、共享会话、审批问答、Workflow 模板、Agent 目录与 Artifacts。
- [2026-04-10] `interaction-agent` 在 TeamPage v1 中是**统一人工入口**：所有人工消息默认先经过该代理，仅负责需求理解与改写，不在首期承担完整拆解、汇总或审批守门。
- [2026-04-10] TeamPage 两人并行实施时，优先按 **TeamPage 体验/交互壳层（Dev-A） vs Team Runtime 读模型/事件脊柱（Dev-B）** 拆分，而不是按 Tab 平均分工；热点文件实行 owner 独占，先冻结 DTO，再按 Window A/B/C 固定集成。
- [2026-04-10] TeamPage 在视觉布局上可强对齐参考库，但**任务动画必须替换为系统内 Buddy/Hubby 动画表现层**；参考库原任务动画不复用，Buddy/Hubby 仅承担任务状态与交互代理的辅助动态表达，不替代 DAG/时间线主视图。
- [2026-04-10] TeamPage 开发阶段只保留一份 **统一开发主计划** 作为开发者入口：以“背景与冻结结论 → 设计冻结稿 → 开发可执行顺序 → 双人分工与验收”组织，旧的对标/设计/并行文档只作为附录依据，不再并列作为主入口。
- [2026-04-11] `interaction-agent` 的结构化改写结果在 MVP 阶段优先采用 **Web 本地 artifact + Team Runtime 读模型注入**：继续保留时间线三段消息作为审计流，但结构化 rewrite 结果先进入 `总览/产物` 投影，不为此提前扩 backend 持久化协议。
- [2026-04-11] Team Runtime 布局重构优先采用 **紧凑顶栏 + 左侧导航 + 中央主工作区 + 右侧细节轨 + 底部状态条** 的控制台骨架；不要再回到 page-header + oversized hero + tabs-first 的普通页面组织方式。
- [2026-04-11] Team Runtime 的第二轮布局逼近继续遵循 **Activity Rail + MainPanelHeader + 单一 Detail Rail Host**：中心主区保留持续控制台 chrome，右侧改为切换式细节轨，而不是多张独立卡片长期同时展开。
- [2026-04-11] Team Runtime 当前高保真壳层以 **Activity Rail + RuntimeSidebar + RuntimeMainPanel + RuntimeDetailRail + Footer Status** 为稳定骨架；中等宽度下也优先保持 Detail Rail 偏右固定，而不是退化成主区下方堆叠。
- [2026-04-11] Team Runtime 的 pane 语义继续对齐参考库：左右 pane 现在支持显式折叠，并可在非单栏模式下拖拽调整宽度；后续若再继续深化，应在此骨架上迭代，而不是退回静态整页网格。
- [2026-04-11] TeamPage 当前阶段以 **1111111.png 官方 Agent Teams 办公室页 mock 还原优先**：先完成左侧模板栏、顶部团队条、办公室像素画布与底部状态栏的高保真页面，再决定如何把真实 Team Runtime 数据链重新接回。
- [2026-04-11] 办公室页继续优先吸收官方 `ActivityBar / StatusBar / SessionItem` 的表面语义：激活指示条、选中卡片左边条、底栏视图按钮组等细节应继续参考官方 layout 组件，而不是回到通用工作台样式。
- [2026-04-11] Agent Teams 办公室页的其它顶部 tab 也已进入 mock 迁移阶段：`对话 / 任务 / 消息 / 状态总览 / 评审` 不再是统一占位卡，而是带页面结构的 mock 面板，后续功能回接应在这些面板骨架上进行。
- [2026-04-11] Agent Teams 办公室页继续优先对齐可见细节：`Leader` 徽标、绿色状态勾、模板区标题图标、`POWER_BAR` 小标注、以及角色主/次/三级标签层级都应按官方截图继续压近。
- [2026-04-11] 用户已确认当前阶段**保留 OpenAWork 外层壳**；接下来只继续对齐 TeamPage 内部 Agent Teams 页面，不再单独拆出 `/team` 的独立外框。
- [2026-04-12] Team 领域边界重新冻结为 **Team / Personal / Shared 三域分离**：`TeamWorkspace` 必须成为一级根对象；`workingDirectory`、`sharedSession`、普通 `session` 只能作为桥接或属性来源，不能继续充当 Team 的真相源；办公室视图只做展示，不承担管理语义。
- [2026-04-12] 引入 multica 理念时，优先吸收 **agent 作为正式队友、控制面/执行面分离、任务驱动、workspace 硬边界、thread/task 双轨、技能复利** 六条原则；但不照搬其 issue/board 外壳，也不重建一套平行 daemon 主链。
- [2026-04-12] A-01 证据化梳理已确认：当前 Team 实现本质上是 **普通 `sessions` + `shared-with-me` + `metadata_json(workingDirectory / parentSessionId)` 派生图** 的聚合视图；后续迁移必须先切 `teamWorkspaceId` 主锚点，再切 Team-owned 写入/读模型。
- [2026-04-12] A-02 已冻结 Team 最小对象图：`TeamWorkspace` 是唯一一级根边界，`TeamInstance / MissionRun` 保留为 Team 控制面一等对象；`sessionId / sharedSession / workspacePath / workingDirectory` 均不得再作为 Team 根对象。
- [2026-04-12] A-03 已冻结能力分层：auth、stream、runtime、telemetry、artifacts、template 底座继续复用；`sharedSession / selectedSharedSessionId / workspacePath / createSessionsClient` 在 Team 页面中仅可作为 bridge 输入，不得再承担 Team 主语义。
- [2026-04-12] A-04 已冻结办公室视图边界：办公室页只读消费 Team snapshot 与轻量 UI 状态，不承担成员/权限管理、创建入口或 shared-session 主流程；缺失数据时必须扩 Team snapshot/subdomain state，而不是回绑普通 session。
- [2026-04-12] B-01 已冻结主路由模型：`/team` 只保留 TeamWorkspace 列表/入口壳，`/team/:teamWorkspaceId` 是唯一 Team 主锚点；任何旧 shared-session 入口都只能重定向到 workspace 路由或 bridge 面板。
- [2026-04-12] B-02 已冻结顶层状态替换规则：`activeTeamWorkspaceId / activeTeamThreadId / teamWorkspaceSnapshotState` 接管 Team 主容器；`selectedSharedSessionId / selectedSharedSession / sharedSessions` 全部降级到 bridge/detail 层，`workspacePath` 不再充当 Team 身份键。
- [2026-04-12] B-03 已冻结 Team 子域 ownership：`teamWorkspaceSnapshotState` 只承载聚合摘要，thread/task/artifact/review/template/member 各自拥有 canonical state owner；`runtimeTaskGroups`、shared-session detail、普通 session messages 只能保留兼容期投影角色。
- [2026-04-12] C-01 已冻结 Team 独立创建路径：当前 `/sessions.create` 仍是 Team UI 借用的普通 session 创建链，`/team/tasks`、`/team/messages` 仍只是 user-scoped 平面写入，`/team/session-shares` 仍是 bridge 关系创建；后续 create contract 必须统一收敛到 TeamWorkspace / TeamThread / TeamTask / TeamTemplate / TeamThreadMessage 的 Team-owned 路径。
- [2026-04-12] C-02 已冻结 Team 对象分层：`TeamTask`、`TeamMessage` 继续作为 Team-owned 真表对象；`TeamArtifact`、`TeamReview` 当前阶段先以 Team-owned aggregation object 落地，底层复用 session artifact / shared-session / workspace review 投影，不立即新增 Team 专属真表。
- [2026-04-05] Chat 刷新恢复链的当前读模型收敛为 **gateway `GET /sessions/:id/recovery` + Web recovery-first hydration**：`session / ratings / activeStream / children / tasks / todoLanes / pendingPermissions / pendingQuestions` 通过单次 read model 提供给 ChatPage/Layout；当 remote recovery poll（running/paused）活跃时，不再叠加 sidebar fan-out 轮询，本地 streaming 期间才保留即时子资源轮询以补 task/tool runtime overlay。
- [2026-04-05] Timeout 主链采用 **gateway-first + `failed + terminalReason=timeout`**：child session 统一投影 `terminalReason/effectiveDeadline`，并通过 stale reconcile/首次 `/sessions/:id/tasks` 回读保证第一次读就看到最新 timeout metadata。
- [2026-04-05] DAG 节点超时采用 **`AbortSignal + Promise.race`**：`executionTimeoutMs` 只约束单次 attempt，approval timeout 通过 `human_approval_required.autoResolveMs` 驱动节点失败，保持与 child session timeout 分层而不混用。
- [2026-04-05] Chat 恢复链的 CI 采用 **required fast gate + push-only live gate**：fast 层承接 gateway targeted checks + web targeted regressions + lightweight browser recovery，live 层只在 push 上跑真实 web/gateway/mock upstream 全链路，避免 PR 门禁过重。
- [2026-04-05] 真实权限暂停恢复的端到端验证采用 **custom provider + chat_completions tool_call mock upstream**：这样能稳定驱动 `permission_asked → paused → /permissions/reply → resumeApprovedPermissionRequest → completed`，而不与 openai/responses 默认协议路径相互干扰。
- [2026-04-05] 真实提问暂停恢复的端到端验证同样采用 **custom provider + chat_completions tool_call mock upstream**：以 canonical `question` tool call 触发 `question_asked → paused → /questions/reply → resumeAnsweredQuestionRequest → completed`，前端最小新增点保持在 questions client + Layout prompt + ChatPage refresh bridge。
- [2026-04-05] `useGatewayClient` 中的 active request 句柄不能只存在 ref；凡是会影响 stopCapability / UI 控制态的运行句柄，必须同步进 React state，避免刷新恢复后出现“内部句柄已失效，但界面仍显示 precise stop”的 stale control UI。
- [2026-04-04] Chat attach 路径在 Phase 2B 收敛为 **buffer-live-then-replay**：先订阅、在 replay 期间缓冲匹配 request 的 live 事件，再按 `seq` 去重并顺序冲刷；不额外引入前端协议变更，优先在 gateway attach route 内部消掉 replay→subscribe 的竞态窗口。
- [2026-04-04] T-06 的首批搜索收口采用 **SQLite FTS5 + gateway `/sessions/search` + Layout Cmd+K 动态结果注入**：先把会话全文搜索与统一命令面板打通，保留标签系统、suggestions、向量检索到后续迭代，而不是一开始就引入更重的检索栈。
- [2026-04-04] T-03 的首批产品化收口采用 **复用现有会话文件快照 + 工作区改动审阅链路**：以 `SessionsPage` 详情页中的 `restore/preview`、`restore/apply` 与 `FileChangeReviewPanel` 作为 MVP 主入口，先满足“预览 + 接受/还原/应用”闭环，再决定是否后续扩展到聊天主线程中的 proposal 模型。
- [2026-04-05] T-04 的首批产品化收口采用 **复用 `session_run_events` + ChatPage 右侧 `viz` tab**：以 `AgentDAGGraph + AgentVizPanel + run-event 投影` 作为 MVP 时间线主入口，先满足“执行路径 + 活动事件 + 子代理/权限状态可视化”，DAG 实时布局、性能图和更细粒度 span 继续后续扩展。
- [2026-04-05] T-05 的首批产品化收口采用 **聊天顶部上下文 meter + 右侧概览中的上下文窗口面板 + 立即压缩会话动作**：先满足“看得见当前占用、看得见上下文来源、点得动压缩”，而 Pin/Remove/压缩 dry-run 等更细粒度管理继续后续迭代。
- [2026-04-05] T-07 的首批产品化收口采用 **assistant 消息上的显式 👍/👎 反馈 + gateway `message_ratings` 持久化**：先把“质量信号本身”接通到会话级消息，再把原因分类、质量报告和自适应模型/代理降权留到后续阶段，而不是一开始就引入完整评分系统。
- [2026-04-05] T-09 第二阶段的最小实体化继续采用 **workspacePath = project 键 + Chat 主流程保存入口**：先用 `agent_profiles` 真表、`/agent-profiles` CRUD 和 `useSessions.newSession()` 的 workspace-profile 覆盖，把 profile 从 session metadata 提升为可复用资源；完整的 profile 列表页、比较视图和批量继承策略继续后续扩展。
- [2026-04-05] T-09 第三阶段继续采用 **Settings 页里的轻量 Profile 管理区块**：先把现有 `agent_profiles` 以只读列表 + 删除入口暴露出来，并提示从 Chat 主流程保存当前配置为项目配置；完整的 profile 编辑器、比较视图和批量应用继续后续扩展。
- [2026-04-05] T-10 当前按 MVP 记账为 **既有恢复链显式验收完成**：`session_run_events`、attach/replay、权限/提问暂停恢复、运行状态条、停止控制与浏览器刷新恢复已经形成端到端链路；这一阶段先不额外新造 Checkpoint UI，而是把现有恢复能力通过 gateway/web/browser 三级验证收实。
- [2026-04-05] T-10 第二阶段的最小外显继续采用 **运行状态条 + 右侧概览恢复策略区块**：先把 paused/running 状态、待审批/待回答数量、最近 checkpoint/压缩摘要和“查看恢复策略”入口显式暴露给用户，而不是先引入独立 Checkpoint 页面。
- [2026-04-05] T-11 的首批产品化收口采用 **站内通知收件箱 + 关键异步事件落库**：先把 `permission_asked`、`question_asked`、`task_update(done/failed)` 这些真正需要用户返回处理的事件写入 `notifications`，并在 Web 顶栏铃铛里展示与已读跳转；桌面系统通知、Web Push、多渠道投递与偏好矩阵继续后续扩展。
- [2026-04-05] T-11 第二阶段继续采用 **站内通知中心 + 浏览器 Notification API 的双轨交付**：标签页可见时优先靠站内通知中心，标签页不可见时对新未读通知触发 `new Notification(...)`；完整的通知偏好矩阵、Web Push 注册和多渠道投递继续后续扩展。
- [2026-04-05] T-11 第三阶段继续采用 **站内通知常驻 + 浏览器提醒可配置**：`notification_preferences` 只控制页面隐藏时的浏览器通知，不影响站内通知中心留痕；浏览器权限必须在设置页显式申请，且当偏好加载失败时浏览器提醒默认 fail-closed。当前最小矩阵只开放 `web × {permission_asked, question_asked, task_update}`，先解决异步噪音控制，再把 DND、多渠道投递与 delivery log 留到后续扩展。
- [2026-04-05] Buddy / Companion 收口优先采用 **gateway 作为 settings/profile 真相源 + request-scoped prompt injection + Web composer `/buddy` 客户端触发**：前端只消费 `/settings/companion` 返回并控制展示/开关，palette 扩展与 mobile phase 延后，避免再次退化成只有 UI 壳层的半成品。
- [2026-04-05] 当需求从“有一个 active companion”升级为“全部伴侣可视化”时，优先采用 **共享 visual renderer + Settings 图鉴**：active companion 与全物种 gallery 共用同一套 sprite/frame/pet/bubble 渲染逻辑，避免一处像源仓、一处停留在临时实现。
- [2026-04-05] 在 companion 基础迁移之后继续完善时，优先补 **rarity color + deterministic stats + 当前物种高亮 + `/buddy` trigger 强调** 这类高价值身份语义，而不是继续横向扩功能面；这样能显著提升 roster 感与点名反馈，但不会把实现重新扩散成新功能项目。
- [2026-04-05] Buddy 与 Agent 建立绑定时，优先采用 **`/settings/companion` 作为 bindings 唯一真相源 + 会话只提供 effective agent**：全局 preferences 保持全局，bindings 只负责 persona/visual 配置，Chat 与 prompt 在运行时按当前 agent 解析，不把绑定表回写进 session metadata。
- [2026-04-05] 当 Buddy-Agent 绑定继续深化时，优先扩展为 **外观 + 行为 override**（如 `behaviorTone / injectionMode / verbosity`），而不是把全局 preferences 拆碎；这样既能给不同 Agent 独立人格，又不会破坏用户总开关和设备级偏好。
- [2026-04-05] Agent 专属 Buddy 语音参数应继续走 **binding override > 全局 preferences > 默认值** 的三层解析，并让未绑定 Agent 统一回退到 `userEmail` 的默认 Buddy persona；不要再按 `userEmail:agentId` 为每个未绑定 Agent 生成不同默认人格。
- [2026-04-05] 当局部功能已完成但 broader suite 仍不稳时，优先按 **测试夹具漂移 / 时序脆弱 / 环境依赖缺口 / 真实实现回归** 四类来分类收敛；对原生依赖（如 `better-sqlite3`）优先在测试中引入可控 mock，避免把 CI 稳定性绑死在本地 native binding。
- [2026-04-04] T-08/T-12 的首批产品化收口采用 **先开放真实 Web 入口，再复用既有 gateway route + shared-ui 组件做 MVP**：`/workflows` 先接模板库 + 画布 + 模板保存/删除，`/team` 先接成员/任务/消息协作工作台；深层执行、审批和共享权限继续在后续迭代扩展，而不是等全量能力齐备才开放入口。
- [2026-04-05] T-12 第二阶段的最小深化继续采用 **session_shares 真表 + TeamPage 共享会话区块**：先把成员/任务/消息协作扩展到“按成员共享具体会话 + view/comment/operate 权限级别”，而不是一开始就做完整 presence/共享编辑/广播房间。
- [2026-04-05] T-12 第三阶段继续采用 **共享权限即时可编辑 + 审计流可见**：在 `session_shares` 之上先补 `PATCH /team/session-shares/:id` 与 `team_audit_logs`，让 TeamPage 既能直接改 `view/comment/operate`，又能看到新增/调整/取消共享的轨迹；presence、共享编辑和审批流继续后续扩展。
- [2026-04-05] T-12 第三阶段补审查后收口：**no-op 权限更新必须保留原始 `updatedAt`，失败表单必须保留用户输入**。否则协作页会出现假的“最近同步时间”，或在 share/member/task/message 创建失败时把用户刚选好的上下文直接清空。
- [2026-04-05] T-12 的共享记录语义继续收口为 **session-scoped durable + workspace-aware projection**：`session_shares` 本身仍按 `session_id` 持久化，但对外 list/create/update 返回值必须从 `sessions.metadata_json.workingDirectory` 派生 `workspacePath`，并在 TeamPage 的记录卡片与会话选择器里显式展示，避免同名会话跨工作区时不可区分。
- [2026-04-05] 只做 workspace-aware projection 还不够，`GET /team/session-shares` 的 SQL 也必须显式选出 `sess.metadata_json AS session_metadata_json`；否则 create/update 返回值虽然有 `workspacePath`，但刷新后的列表会丢失该字段，重新退化成同名会话不可区分。
- [2026-04-05] T-12 的下一层最小真实授权闭环采用 **专用共享读取入口，而不是直接放开 owner 的主 sessions 路由**：先用 `JWT.email ↔ team_members.email` 映射出共享成员，再通过 `GET /sessions/shared-with-me` 与 `GET /sessions/shared-with-me/:sessionId` 提供真实只读访问；这样 `view/comment/operate` 至少先获得稳定的可读边界，再继续把评论/操作能力分层下放。
- [2026-04-05] 共享只读访问的 route-level 覆盖应优先通过**独立 route 模块 + mock-based 网关测试**补齐，而不是依赖大而重的全路由集成测试；当前 `session-shared-read-routes.ts` + `session-shared-read-routes.test.ts` 就是这条收口后的模式。
- [2026-04-05] 共享只读详情返回体必须保证 `share.stateStatus` 与 `session.state_status` 一致；如果详情先做 runtime reconcile，而摘要仍返回旧状态，会在同一响应里制造语义漂移。
- [2026-04-05] `comment` 权限的最小真实闭环采用 **专用共享评论链**：用 `shared_session_comments` 承载共享会话评论，`view` 只能读评论，`comment / operate` 才能写；不要把共享评论混进全局 team message 板，否则权限边界会变糊。
- [2026-04-05] 共享评论创建的 POST 返回体应尽量回读 durable `created_at`，并显式覆盖 `view` 读评论、`operate` 写评论这两个边界；否则会留下时间格式漂移和权限覆盖面不足的隐患。
- [2026-04-05] `operate` 权限的最小真实闭环采用 **共享入口内处理待审批/待回答交互**：不要直接放开 owner 的完整 Chat 写链；先让 `operate` 在 `/sessions/shared-with-me/:sessionId` 的上下文里处理 `pendingPermissions / pendingQuestions`，既能提供真实操作能力，又能保持授权边界清晰。
- [2026-04-05] 共享入口里的 `pendingPermissions / pendingQuestions` 在返回前必须先做 expire 清理，并显式覆盖 `comment` 403 / `operate` 可执行的 route-level 回归；否则 operate 用户会看到已过期请求，且权限边界容易在后续回归中漂移。
- [2026-04-05] 团队协作的共享链必须带 actor 审计：仅记录“发生了什么”不够，`shared_comment_created / shared_permission_replied / shared_question_replied` 这类动作都要把 `actor_email` 写进 `team_audit_logs`，并在 TeamPage 审计流里直接展示执行人。
- [2026-04-05] actor 审计的回归不能只靠 audit list 结果间接证明，owner 侧 `share_created / share_permission_updated / share_deleted` 也要在 route 测试里直接断言 `actorEmail / actorUserId` 已落库。
- [2026-04-06] presence/shared viewing 的最小真实闭环采用 **shared detail + heartbeat**：共享详情直接返回最近查看者列表，选中共享会话后通过 `POST /sessions/shared-with-me/:sessionId/presence` 刷新 `lastSeenAt`，TeamPage 则展示在线/最近查看者。先把 shared viewing 做实，再考虑更重的 shared editing。
- [2026-04-06] shared presence 读取前必须清理已撤销共享关系的旧 viewer 记录，并在首次进入共享详情时立即合并 heartbeat 结果；否则会出现“被取消共享的人仍在最近查看者里”以及“刚进入但自己不立刻出现”的语义错误。
- [2026-04-04] Chat 真正续流的二阶段演进采用 **attach-only SSE + request-scoped `RunEventCursor(clientRequestId, seq)`**：现有 `/stream` 与 `/stream/sse` 继续只负责“发起新请求”，刷新/重连后的 resume 通过独立 attach 通道完成；一阶段 `session.runEvents` 快照恢复展示保留为降级兜底层，而不是被替换掉。
- [2026-04-04] OpenAWork 的 call hierarchy 对外 surface 采用 **单个高层读工具 `lsp_call_hierarchy`**，内部再编排 `prepareCallHierarchy / incomingCalls / outgoingCalls` 三步协议；不要把协议镜像步骤直接暴露给模型，以免 `CallHierarchyItem.data` 这类 opaque payload 在多轮中被错误传递。
- [2026-04-04] OpenAWork richer LSP 当前正式支持面已扩展为 **definition / implementation / references / symbols / prepareRename / rename / hover / call hierarchy / diagnostics / touch**；其中更多 language server coverage 扩展与 status/event/UI diagnostics 继续延后到独立工作流。

- [2026-04-04] gateway-side language server coverage 采用 **incremental parity**：先将 Tauri 侧已验证的 `rust-analyzer` 最小引入 `packages/lsp-client/src/server.ts` / `ALL_SERVERS`，随后在补齐多 server 选择/聚合底座后再对齐 `eslint` / `biome`，避免在单 server 架构下把语义 server 与 lint server 互相挤掉。

- [2026-04-04] gateway-side language server coverage 第二轮继续采用 **low-noise extracted servers**：优先引入 `vscode-json-language-server`、`vscode-html-language-server`、`vscode-css-language-server` 这类与前端/配置文件高频场景直接相关、且不强绑定额外 lint 诊断语义的 server；随后在 260405 多 server 底座完成后再接入 `vscode-eslint-language-server` 与 `biome`。

- [2026-04-04] YAML coverage 继续采用 **standalone server-only** 策略：只接入 `yaml-language-server --stdio` 的 gateway-side parity，不顺带启用 schema-store、CRD store 或额外 telemetry 流转，以避免把单纯 coverage 扩展放大成网络/配置策略工程。

- [2026-04-04] Docker 生态 coverage 采用 **受控 basename 匹配 + 统一 `docker-language-server start --stdio`**：`Dockerfile`、Compose、Bake 都不应依赖泛化的扩展名吞吐；对 Dockerfile/Compose/Bake 需先 basename 命中，再回退扩展名，避免 Compose 被 YAML 抢占、Bake 被全量 HCL 误吞。

- [2026-04-04] Bash coverage 继续采用 **shellscript-only** 策略：只接入 `bash-language-server start` 的 gateway-side parity，覆盖 `.sh/.bash/.zsh`，不把 `fish`、`powershell`、shellcheck、shfmt 或更深的 lint/format 配置一并带入。

- [2026-04-05] JS/TS 生态下的 lint parity 采用 **primary semantic server + supplemental lint server**：`typescript` 继续负责 hover/definition/rename 等语义能力，`eslint` / `biome` 通过 `role/slot/priority` 进入 supplemental 路径，同槽只保留最高优先级 linter，并在 `diagnostics()` 中聚合多 client 结果而非相互覆盖。

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

- [2026-04-05] child session 首响应超时若只删 `session_run_events` 而不删同一 request-scope 的 assistant/tool messages、file diffs、request snapshot，重试成功后仍会残留旧 attempt 的晚到内容。
- [2026-04-05] approval timeout 不能只靠 reconcile；如果 permission/question 的 reply 路由不在处理前先强制执行 `expires_at` 过期语义，已过期请求仍可能被 approve / answer，直接绕过 timeout 语义。
- [2026-04-05] 做真实负向边界 E2E 时，`question dismiss` 不应强行断言问题文本彻底消失；question 本身可能继续作为 transcript/tool card 历史保留。更可靠的 idle 收口断言是：等待态 prompt 消失、提交入口消失、`会话等待处理` 不再出现，并出现 dismiss 结果事件文案。
- [2026-04-05] 做 CI 分层时，不能把 `@openAwork/web test` 粗暴塞进通用 `jobs.test` 当作 chat fast gate；当前仓库仍有与 chat 恢复链无关的 web 历史失败，会把门禁目标污染掉。另一个易漏点是 fast Web E2E 必须自给自足启动 preview/server，不能假设 `localhost:5173` 已存在。
- [2026-04-05] 用 mock upstream 驱动真实 paused/resumed E2E 时，若先按“原始 user prompt”分支匹配，再判断 request 中是否已包含 `tool` 结果消息，批准后的 resumed 请求会被误判成初始 tool-call 请求，表现为重复 `permission_asked` 或永远无法完成。
- [2026-04-05] `question_asked` 这类等待回答型暂停并不会像 attach 一样依赖 active stream 才能恢复；刷新后真正保活的是 `sessions.state_status='paused' + question_requests.status='pending' + 历史 assistant/tool 卡片`，所以浏览器 E2E 应围绕“等待态仍可见 + 回答后 resumed 完成”来断言，而不是强绑 active attach UI。
- [2026-04-05] 刷新恢复链上，若 active request 只保存在 hook ref 中而不驱动 React state，真实浏览器里会出现 stale stop UI：页面还显示“可直接停止”，但点击后既不发 stop 请求，也只会报“控制句柄已失效”。
- [2026-04-05] 做真实 gateway 驱动的流式浏览器 E2E 时，mock upstream 只要 SSE 分隔符少一个空行，就会在 gateway 里表现成 `PARSE_ERROR: Failed to parse upstream stream chunk`；这类问题看起来像前端或 attach 故障，实际是上游流格式不合法。
- [2026-04-04] 想把 Chat attach 的所有细节一次性塞进 Playwright 浏览器层时，最容易踩到 EventSource 与 reload 的时序不稳定；更可靠的做法是：浏览器层验“恢复体验”，`ChatPage` 回归验“最终消息落定”，gateway verification / hook tests 继续兜底协议细节。
- [2026-04-04] 浏览器层验证 Chat 续流时，不要把所有 attach 协议细节都压进 Playwright 对 EventSource 的 mock；更稳定的做法是：浏览器层断言用户可见恢复体验，attach wire / cursor / replay 次序交给 gateway verification、hook tests 和 route tests 兜底。
- [2026-04-04] Chat attach 恢复若只有 route unit test 和前端回归，没有一条真实 Fastify + in-memory DB 的 verification，很容易把“协议层能跑”误判成“gateway 验收已覆盖”；当前已用 `verify-stream-attach-recovery.ts` 把它纳入 `test:durable`。
- [2026-04-04] attach 路径若采用“先 replay 后 subscribe”，会在两步之间留下真实漏事件窗口；但改成 buffer-live-then-replay 后，又必须确保 `listSessionRunEventsByRequestAfterSeq` 按 `seq` 升序返回，否则去重+冲刷逻辑会把低序号回放误判为已送达。
- [2026-04-04] 给会话搜索补 FTS 时，不能只索引 `session_messages` 现存行就认为完成：像 `/sessions/import` 这类只写 `sessions.messages_json` 的 legacy/imported 会话，如果搜索前不做惰性水合，就会出现“会话可见但全文搜索命中为空”的假失败。
- [2026-04-05] 做消息质量反馈时，不能把 `编辑重试 / 重试 / 新分支重试` 这些纠错动作自动等价成显式好坏评；它们更像隐式信号，应该和用户直接点的 👍/👎 分开存储，否则后续自适应会把“用户想继续探索”误判成“回答质量差”。
- [2026-04-05] 做项目级 Agent 配置的手动 QA 时，浏览器会话一旦丢失 auth 或 session detail 请求 401，就会把“配置未恢复”伪装成产品 bug；这类链路至少要同时保留自动化回归和 API 级验证，避免把认证噪音误判成配置持久化失败。
- [2026-04-04] 做竞品差异化能力时，最容易出现“后端表 / 路由 / shared-ui 组件都在，于是误判功能已完成”的假闭环；如果 `apps/web/src/App.tsx` 仍把 `/workflows`、`/team` 之类入口直接 `Navigate` 回 `/chat`，用户实际上依然无法使用该能力。
- [2026-04-04] attach-only SSE 落地时，服务端与浏览器事件模型必须严格对齐：如果服务端显式写 `event: run`，客户端就不能只靠 `EventSource.onmessage`；同时 `afterSeq` 不能盲用服务端 `lastSeq`，应优先使用客户端已见 seq，否则快照→attach 窗口会漏增量。
- [2026-04-04] 给 Chat 加真正续流时，不能把 attach 逻辑直接塞进现有 `/sessions/:id/stream/sse` 这类“创建请求”路由；该路由天然携带 `message/clientRequestId` 创建语义，重连时会有重复发送风险。正确做法是新增 attach-only 通道，并把 cursor 真相源固定在 `session_run_events(session_id + client_request_id + seq)` 上。
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
