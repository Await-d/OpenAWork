# Buddy / Agent 绑定实施

## Task Overview
让不同 Buddy 能与不同 Agent 建立稳定绑定：Settings 中可管理绑定，Chat 中根据当前 effective agent 自动切换 Buddy persona / species / visual identity，同时不破坏用户现有的全局 companion 开关与语音/动效偏好。

## Current Analysis
- 当前 Agent 选择主链位于 Chat 会话 metadata：`agentId` 跟随手动选择或 dialogue mode 默认 Agent，在前端 ChatPage 中持久化并传给 gateway stream。
- 当前 Buddy 真相源位于 `/settings/companion`，返回全局 preferences 与单个派生 profile；本轮前尚无“按 agent 区分 Buddy”的数据模型。
- 用户真正要的是“Settings 管理 Agent → Buddy 映射，Chat 和 prompt 自动跟随当前 effective agent”，而不是每个会话手工挑 Buddy。

## Solution Design
- 在 companion settings 真相源中增加 `bindings`：`agentId -> { species, themeVariant, displayName, behaviorTone, injectionMode, verbosity }`。
- 保持全局 preferences 仍是全局的；bindings 只提供 persona / visual / behavior override。
- gateway `/settings/companion` 支持 `?agentId=` 查询并返回 agent-aware profile。
- `ChatPage` 将 `effectiveAgentId` 传给 `CompanionStage`，stream / stream-runtime 也按当前 agent 解析 companion prompt。
- Settings Buddy tab 新增 Agent 绑定面板，使用现有 `/agents` 客户端管理可绑定 Agent 列表。

## Complexity Assessment
- 原子步骤：6 个核心步骤（数据模型 / gateway route / profile 解析 / Chat 接线 / Settings UI / 验证） → +2
- 并行流：Agent 链追踪、Buddy 设置链追踪、架构评审可并行 → +2
- 模块/系统/服务：`services/agent-gateway` + `apps/web` + `packages/shared` + `.agentdocs` → +1
- 单步 >5min：前后端数据模型与回归验证超过 5 分钟 → +1
- 持久化审查产物：需同步 workflow / runtime / index → +1
- OpenCode 可用：→ -1
- **总分：6**
- **选定模式：Full orchestration**
- **路由理由：这是跨 settings 真相源、Chat 会话 agent 解析和 UI 配置入口的真实能力扩展，需要保存结构决策与验证证据。**

## Success Criteria
- `/settings/companion` 支持持久化 Buddy-Agent 绑定关系。
- 当前会话生效 Agent 变化时，Buddy persona / species / visual identity 会跟着切换。
- Settings 中可以管理至少一组 Agent → Buddy 绑定，而未绑定 Agent 保持默认回退。
- 不破坏全局 companion 总开关、注入模式、语音/动效偏好。
- 相关测试、LSP、包级 typecheck 与构建通过。

## Implementation Plan

### Phase 1: 模型冻结
- [x] T-01: 记录 workflow / runtime / index，并冻结“绑定关系放在 companion settings、当前会话只负责提供 effective agent”
- [x] T-02: 设计并落地 Buddy-Agent binding schema 与 profile 解析策略

### Phase 2: 前后端接线
- [x] T-03: gateway `/settings/companion` 支持绑定关系读写与 profile 按 agent 解析
- [x] T-04: Web hook / Chat companion 根据 effective agent 消费绑定后的 Buddy

### Phase 3: UI 配置与验证
- [x] T-05: Settings Buddy tab 增加 Agent 绑定管理与图鉴联动
- [x] T-06: 补齐测试、诊断、typecheck、build，并完成 AgentDocs 收口

## Verification Notes
- 通过：`pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/settings-companion-routes.test.ts src/__tests__/companion-settings.test.ts src/__tests__/session-workspace-metadata.test.ts`
- 通过：`pnpm --filter @openAwork/web exec vitest run src/components/chat/companion/use-buddy-voice-preferences.test.tsx src/pages/settings/companion-tab-content.test.tsx src/components/chat/companion/companion-stage.test.tsx`
- 通过：`pnpm --filter @openAwork/agent-gateway build`
- 通过：`pnpm --filter @openAwork/web typecheck`
- 通过：`pnpm --filter @openAwork/web build`
- 通过：`pnpm --filter @openAwork/shared build`
- 通过：相关修改文件 `lsp_diagnostics` 零 error
- Oracle 复核结论：**已完成**；Settings 作为 bindings 真相源、Chat 与 prompt 按 effective agent 切换 Buddy 的链路已闭环，无阻塞性缺口。
- Oracle 二次复核结论：**已完成**；当前 Buddy-Agent 绑定已从“外观绑定”扩展为“人格/行为绑定”，没有阻塞性缺口。
- 全量回归补充：
  - `pnpm --filter @openAwork/web test` 仅剩与本次无关的既有失败：`FileEditorPanel.test.tsx`、`chat-page/golden-transcript.test.ts`
  - `pnpm --filter @openAwork/agent-gateway test` 仍有与本次无关的既有失败：`settings-providers.test.ts`、`session-run-events.test.ts`、`session-todo-routes.test.ts`、`stream-agent-resolution.test.ts`

## Notes
- 本轮目标是“Agent → Buddy 稳定映射”，不是把每个会话都做成独立 Buddy 编辑器。
- 已额外完成：绑定级 `behaviorTone / injectionMode / verbosity` override；Settings 可配置，prompt 与 Chat companion 同时生效。
- Memory sync: completed
