# .agentdocs/workflow/260323-聊天界面-opencode能力集成方案.md

## 任务概览

目标是在 **OpenAWork 聊天界面** 内集成一批借鉴自官方 opencode 的高价值能力，但不复制 CLI 形态，也不在前端再造一套命令、权限、任务或工具系统。

本方案聚焦四类体验：

1. 聊天输入区内的命令/快捷操作（slash 命令面板、会话动作、上下文插入）
2. 聊天消息内的交互式卡片（审批、确认、表单、差异视图）
3. 右侧运行面板的结构化运行态（工具、计划、任务、子会话、压缩、审计）
4. 由 `agent-core + agent-gateway` 驱动的服务端能力模型（command/tool/task/permission/compaction）

## 当前分析

- Web 聊天界面已经具备三个关键挂载位：
  - `apps/web/src/pages/ChatPage.tsx` + `apps/web/src/components/chat/ChatComposer.tsx`：输入框、slash/@ 触发、附件与语音入口
  - `apps/web/src/components/chat/ChatPageSections.tsx` + `packages/shared-ui/src/GenerativeUI.tsx`：聊天消息内嵌交互 UI 渲染通道
  - `apps/web/src/pages/chat-stream-state.ts` + ChatPage 右侧 tabs：工具/计划/可视化/历史 等运行态视图
- 会话与上下文 UI 也已有现成承接面：`SessionSidebar`、`SessionContextMenu`、`FileEditorPanel`、`CommandPalette`、`packages/web-client/src/sessions.ts`
- 运行时底座已存在但尚未打通：
  - `packages/agent-core/src/tool-contract.ts`：ToolRegistry / ToolDefinition
  - `packages/agent-core/src/task-system/*`：任务图、依赖、落盘到 `.agentdocs/tasks`
  - `packages/agent-core/src/permission/index.ts` 与 `packages/agent-core/src/permissions/permission-manager.ts`：两套权限模型并存
  - `packages/agent-core/src/plugin/*`、`context/compact.ts`、`audit/*`、`slash-command/index.ts`
  - `services/agent-gateway/src/tool-sandbox.ts`：真实工具执行与审计落库
  - `services/agent-gateway/src/routes/stream.ts` + `stream-protocol.ts`：流式协议与 tool_call 解析，但当前仅声明 `web_search`，未形成统一 capability dispatch 闭环
- 官方 opencode 最值得借鉴的是“服务端真相源 + 多客户端聊天壳层”的结构，而不是 CLI 命令本身。

## 方案设计

### 核心原则

1. **服务端是真相源**：命令、工具、任务、权限、压缩语义都由 `agent-core + agent-gateway` 定义；前端只做触发、展示、确认。
2. **协议先行**：先统一 shared types / event schema / registry metadata，再接 Chat UI 的读路径与写路径。
3. **只读先行，写入后置**：先把 run panel、消息卡片、子会话状态渲染出来，再开放命令执行、审批回执、任务操作。
4. **不新增重复子系统**：前端禁止自建影子命令注册表、任务状态机、权限缓存；必须消费服务端返回的 registry / event / status。
5. **聊天产品优先**：所有能力都必须映射到 Chat UI 的三类承载位之一：输入区、消息卡片、右侧运行面板。

### 先冻结的收敛决策

1. **权限 SSOT**：以 `packages/agent-core/src/permission/index.ts` 作为最终交互式权限模型（request / reply / workspace 持久化）的权威来源；`packages/agent-core/src/permissions/permission-manager.ts` 中的 YOLO/记录语义在过渡期仅保留为兼容适配层，后续并回统一接口。
2. **任务与会话映射**：一个根会话对应一个任务图；child session 必须带 `parentSessionId + taskId` 关联字段，右侧任务面板、SessionSidebar 和 gateway 事件流都以此映射 task node 与子会话。
3. **命令入口统一**：`ChatComposer` 的 slash popup 与全局 `CommandPalette` 必须共用同一份服务端命令列表，只允许触发方式不同，不允许语义分叉。
4. **事件协议最小集**：Phase 1 必须先冻结 `message_delta`、`tool_call`、`tool_result`、`permission_asked`、`permission_replied`、`task_update`、`session_child`、`compaction`、`audit_ref` 九类运行事件，再进入 UI 改造。

### 真相源（SSOT）划分

| 能力域 | 真相源 | UI 承载位 | 说明 |
| --- | --- | --- | --- |
| 命令注册表 | `agent-core` registry + `gateway` API | ChatComposer slash popup / CommandPalette | 前端只取列表与描述，不做命令语义判断 |
| 工具执行 | `gateway` ToolSandbox | 右侧 tools tab + 消息卡片 | stream 事件统一回放 tool_call/tool_result |
| 权限审批 | `agent-core` 统一权限模型 + `gateway` reply API | 消息内 approval card + 全局待处理提示 | UI 只发 reply，不本地决策 |
| 任务/子会话 | `task-system` + session tree | SessionSidebar + 右侧 tasks/children tab | 任务图与子会话状态由服务端计算 |
| 压缩/交接 | `context compactor` + session metadata/audit | 系统消息 + history/overview tab | 前端只展示触发原因与结果摘要 |
| 审计 | `gateway` audit log | history tab / settings | 统一引用 runId/eventId，避免双写 |

### Chat UI 映射

- **输入区（ChatComposer）**：`/` 命令补全、`@` 上下文引用、轻量会话动作、后台运行入口
- **消息区（GenerativeUIRenderer）**：审批卡、确认卡、表单卡、代码差异卡、压缩/交接卡
- **右侧运行面板**：run timeline、tool cards、plan/tasks、child sessions、permission queue、compaction history、audit link

### Phase 对照关系

| Workflow Phase | Master Plan Phase | 说明 |
| --- | --- | --- |
| Phase 1：协议与注册表统一 | Phase B | 先冻结 shared schema、registry 与权限/任务映射 |
| Phase 2：只读 UI 接入 | Phase C | UI 只消费服务端列表与事件，不新增写路径 |
| Phase 3：命令闭环与审批 | Phase D | 命令执行与审批回执开始写入会话链路 |
| Phase 4：任务、子会话与压缩 | Phase D + E | 任务/子会话先闭环，压缩与审计随后产品化 |
| Phase 5：收尾与平台扩展 | Phase E | 平台矩阵、SDK/OpenAPI、MCP 控制面等收口 |

## Complexity Assessment

- Atomic steps: 7+ → +2
- Parallel streams: chat UI surface / runtime protocol / permission-task-session semantics → +2
- Modules/systems/services: web + shared-ui + web-client + agent-core + agent-gateway → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是一个跨 UI、网关、运行时语义和文档记忆的集成方案，必须同时跟踪边界、阶段依赖、验收口径与避免重复建设的约束。

## Implementation Plan

### Phase 0：实施启动（P0）
- [x] T-00 ✅：用户已批准按方案连续实施，当前进入 Phase 1（协议与注册表统一）

### Phase 1：协议与注册表统一（P0）
- [x] T-01 ✅：已落地服务端 `CommandDescriptor` 注册表与 `/commands` API，`CommandPalette` 与 slash popup 均改为消费同一列表
- [x] T-02 ✅：已在 `packages/shared` 增补 `CommandDescriptor`、`CommandExecutionResult`、`RunEvent`、`compaction/session_child/audit_ref` 等运行事件类型
- [x] T-03 ✅：已补 `docs/chat-runtime-ssot.md`，冻结 permission SSOT 与 task-system ↔ session tree 映射规则，并对齐到 gateway / web-client / ChatPage 的真实读写路径
- [x] T-04 ✅：`stream-protocol` 与 `ToolSandbox` 已对齐为 `web_search / lsp_diagnostics / lsp_touch` 同一能力面

### Phase 2：只读 UI 接入（P0）
- [x] T-05 ✅：ChatComposer slash popup 已消费服务端命令列表
- [x] T-06 ✅：全局 `CommandPalette` 已消费同一 registry 数据源
- [x] T-07 ✅：Chat 右侧面板现已统一接入当前 session 的 `children / tasks / pending permissions` 真实服务端数据源，并在历史/概览分区展示
- [x] T-08 ✅：消息渲染已支持 `status` / `compaction` 卡片类型

### Phase 3：命令闭环与审批（P1）
- [x] T-09 ✅：已新增 `POST /sessions/:sessionId/commands/execute`，并打通 `/压缩会话` 服务端执行闭环
- [x] T-10 ✅：已新增 permission requests / pending / reply API，并在 Chat Layout 中接入真实审批卡与回传
- [x] T-11 ✅：`/settings/permissions` 已改读真实 permission_requests 历史，而非 audit_logs 伪映射

### Phase 4：任务、子会话与压缩（P1）
- [x] T-12 ✅：已支持 `parentSessionId` 子会话创建、`/sessions/:id/children` 路由与 Sidebar “子会话”标记
- [x] T-13 ✅：`/sessions/:id/tasks` 已接 `agent-core task-system`，`/压缩会话` 会写入任务图，Chat 右侧面板可读任务状态
- [x] T-14 ✅：`compaction` 已作为服务端事件暴露到聊天命令执行结果与右侧历史/概览面板

### Phase 5：收尾与平台扩展（P2）
- [x] T-15 ✅：Chat 右侧 MCP 面板已复用 `shared-ui` 的 `MCPServerList`，Settings 保存 MCP 配置时已走真实持久化包装器
- [x] T-16 ✅：已补 `docs/chat-opencode-platform-matrix.md` 说明 Web/Desktop/Mobile 能力矩阵与降级关系
- [x] T-17 ✅：已补 `docs/chat-opencode-integration.openapi.yaml`，并通过 `packages/web-client` 客户端与定向测试形成 SDK/E2E 验收路径

## Acceptance Criteria

- 输入 `/` 时展示的命令项来自服务端统一 registry，而非页面硬编码
- 权限请求可以在聊天消息内完成批准/拒绝，刷新后状态不丢失
- 子会话/子任务在 SessionSidebar 或右侧面板中可见，并能跳转到对应上下文
- tool_call、command、permission、compaction、task 状态都能通过统一事件流回放
- 不出现第二套前端任务状态机、权限缓存或命令语义解析逻辑

## Notes

- 首轮集成目标是 **Chat UI + Gateway + agent-core**，明确排除 CLI parity、ACP、attach 等运行面复制。
- 建议先完成 Web + Desktop 共用路径，再决定移动端的只读降级与审批交互方式。
- 2026-03-23 实装进度：已完成服务端命令注册表、统一运行事件扩展、slash/CommandPalette 去硬编码、`/压缩会话` 服务端执行闭环、status 卡片渲染、子会话 metadata 入口与 Sidebar 标记。
- 2026-03-23 收尾补充：已完成 permission request/reply API、真实审批卡、task-system 会话路由、Chat MCP 通用组件复用、OpenAPI 契约文档与平台能力矩阵。
- 2026-03-24 收尾补丁：已补 `docs/chat-runtime-ssot.md` 冻结权限与任务/子会话语义；Chat 右侧面板现统一拉取当前 session 的 children/tasks/pending permissions，主方案剩余条目已清零。
