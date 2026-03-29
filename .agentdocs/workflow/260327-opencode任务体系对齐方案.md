# .agentdocs/workflow/260327-opencode任务体系对齐方案.md

## 任务概览

目标是对照 `temp/opencode` 当前任务体系的真实实现，调整 OpenAWork 里与任务相关的整条链路：任务/子任务创建、子任务使用何种 agent 执行、子任务完成后的回调与主线程结果接收、以及主界面对各子代理运行状态的可见性。

## 当前分析

- 当前仓库已经具备 `task` 工具、child session、task graph、任务树层级投影与 Chat 右侧任务展示，但 `.agentdocs/index.md` 现存记忆明确指出：`task` 目前只是“真实 child session + task graph 入口”，尚未补齐完整自动子代理执行生命周期。
- 已完成的 `260324-子任务层级实现方案` 说明：现状采用“子会话树 + 任务树 + 依赖图”三层并存模型，前端可展示层级，但不等于已具备完整的子代理执行、回调回收与运行态联动。
- 用户本次要求不是继续做静态层级展示，而是要按 `temp/opencode` 的使用方式收敛到完整闭环，因此必须同时核查参考仓库与当前仓库的事件、状态、线程/会话关系和 UI 读路径。

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 当前仓库任务链路 / 事件回调状态流 / opencode 参考实现 → +2
- Modules/systems/services: agent-core + shared + agent-gateway + web → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是一次跨任务模型、运行时事件、前端运行态和参考实现对标的联动改造；若不保留显式计划和逐步验证，很容易再次把子会话、子任务、依赖和子代理生命周期混成一层语义。

## Implementation Plan

### Phase 1：参考实现与现状对照
- [x] T-01：已梳理 OpenAWork 当前任务创建、子任务/子代理、回调与 UI 展示链路
- [x] T-02：已梳理 `temp/opencode` 中对应的任务模型、agent 选择与结果回传机制
- [x] T-03：已冻结需要对齐的数据结构、事件语义和 UI 投影差距

### Phase 2：执行链路改造
- [x] T-04：已调整服务端/核心层任务创建与子任务 agent 选择逻辑
- [x] T-05：已补齐子任务执行完成后向主线程回传结果与状态的链路
- [x] T-06：已更新共享类型与任务事件投影，保证前端拿到一致语义

### Phase 3：前端运行态与验证
- [x] T-07：已更新主界面对各子代理运行状态、结果与层级的展示
- [x] T-08：已补齐或更新定向测试与回归用例
- [x] T-09：已完成 diagnostics、typecheck、相关测试和构建验证

## Notes

- 本工作流创建于 2026-03-27，用于跟踪 `temp/opencode` 任务体系对齐的完整闭环改造。
- 当前优先级最高的是先冻结“谁负责创建子任务、谁决定 agent、谁接收回调、谁投影给 UI”这四个权责边界，再落实现。
- 2026-03-27 对齐结论：`temp/opencode` 的关键不是把 child session 单纯挂到任务树上，而是让 task 工具真正决定 delegated agent、把 child session 句柄与运行状态回写给父线程，并让 UI 能持续看见子代理状态。OpenAWork 本轮据此补齐了 delegated system prompt、父会话 tool_result 替换/回传、task_update 结果载荷与主界面 agent/result 展示。
- 2026-03-27 Oracle 复核后的补强：父流结束后若 child session 晚于实时流完成，父会话现在仍可通过 `/sessions/:sessionId/tasks` 轮询读回 delegated child task 的终态。实现方式是让父会话任务投影显式包含 descendant child session 关联的 task，从而把实时事件降级为“加速刷新”，而不是唯一真相来源。
- 2026-03-27 本轮关键实现：
  - `services/agent-gateway/src/task-agent-resolution.ts`：新增 delegated agent 解析，按 `subagent_type/category` 解析 agent，并生成 delegated system prompt
  - `services/agent-gateway/src/tool-sandbox.ts`：task 工具现会真正把 delegated system prompt 注入子会话；支持 richer task output；child 完成后会更新父会话 tool_result 与 task_update；child session `state_status` 会同步 running/paused/idle
  - `services/agent-gateway/src/routes/stream.ts`：子会话后续请求可从 session metadata 读取 delegated system prompt
  - `services/agent-gateway/src/routes/sessions.ts` + `routes/session-task-projection.ts`：父会话任务投影现会包含 descendant child session 对应 task，保证轮询可回读 delegated child task 的终态
  - `packages/shared/src/index.ts`：`task_update` 事件扩展 `assignedAgent/result/errorMessage` 等字段
  - `apps/web/src/pages/ChatPage.tsx`、`chat-stream-state.ts`、`chat-page/sub-agent-run-list.tsx`、`chat-page/right-panel-sections.tsx`、`chat-page/support.ts`：主界面能展示子代理身份、任务结果摘要与错误摘要
- 2026-03-27 验证结果：
  - `pnpm --filter @openAwork/agent-gateway test` ✅
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session-task-projection.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/tool-definitions.test.ts src/__tests__/start-work-subtasks.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec tsx src/verification/verify-session-task-routes.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec tsx src/verification/verify-task-permission-reply.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec tsx src/verification/verify-task-tool-auto-run.ts` ✅
  - `pnpm --filter @openAwork/web exec vitest run src/pages/chat-stream-state.test.ts src/pages/ChatPage.test.tsx src/pages/chat-page/right-panel-sections.test.tsx src/pages/chat-page/support.test.ts` ✅
  - `pnpm typecheck` ✅
  - `pnpm --filter @openAwork/agent-gateway build` ✅
  - `pnpm --filter @openAwork/web build` ✅
- 2026-03-27 全量 Web 测试仍有 3 个非本次改动文件中的既有失败：`src/pages/ChannelsPage.test.tsx` 2 个、`src/components/Layout.permissions.test.tsx` 1 个。本轮未修改对应页面/组件，已用聊天链路定向测试补足本任务证据。
