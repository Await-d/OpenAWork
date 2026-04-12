# Message V2 流式同步实施

## Task Overview

在 Team Stage 1-5 主线已完成的基础上，继续推进当前工作区中最明显的下一条主线：**message-v2 / stream-runtime / ChatPage / Layout 同步链**。本阶段目标是把新消息模型与流式运行时链路真正接到 gateway 与 web 主路径上，收口当前散落在 `message-v2-*`、`stream-runtime.ts`、`ChatPage.tsx`、`Layout.tsx` 周围的未完成改动。

## Current Analysis

- 当前工作区里与本主线最相关的剩余改动集中在：
  - `services/agent-gateway/src/message-store-v2.ts`
  - `services/agent-gateway/src/message-v2-adapter.ts`
  - `services/agent-gateway/src/message-v2-projectors.ts`
  - `services/agent-gateway/src/message-v2-schema.ts`
  - `services/agent-gateway/src/sync-event.ts`
  - `services/agent-gateway/src/routes/stream-runtime.ts`
  - `apps/web/src/pages/ChatPage.tsx`
  - `apps/web/src/components/Layout.tsx`
- 这是一条独立于 Team 阶段 1-5 的新主线，应单独建工作流，不混回已归档的 Team 文档里。
- 已完成的聚类 / 首刀评估结论：
  - 当前最值得继续的不是再开一条新 CI/文档主线，而是**收口 agent-gateway 的 message-v2 运行时闭环**
  - `ChatPage` / `Layout` 当前的回归失败与运行态漂移，更像是后端 V2 迁移尚未完成后的表层症状，而不是应该先从前端修补的根因
  - 因此第一刀必须先落在 gateway message-v2 / stream-runtime 的读写接缝，而不是先动 UI

## Solution Design

- 先收口 gateway 侧的 **V2 读写闭环**：
  1. 明确 V1/V2 当前谁是 authoritative write，谁是 authoritative read
  2. 找到 `stream-runtime.ts` / `session-run-events.ts` / projector 间最小可切换接缝
  3. 只在 gateway 闭环稳定后，再让 `ChatPage.tsx` / `Layout.tsx` 消费这条新主链
- 本阶段不碰：
  - 已归档的 Team 阶段 1-5 主线
  - 与 message-v2 无关的 stream 功能扩散
  - 与 Chat/Layout 无关的页面热点

## Complexity Assessment

- Atomic steps: 5+（gateway schema/store/projector/runtime + web surface + 验证 + git） → +2
- Parallel streams: yes（cluster/首刀评估可并行） → +2
- Modules/systems/services: 3+（gateway / web / shared message schema） → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是多模块联动的新主线，且当前工作区已存在未完成代码簇，需要独立工作流与运行态总表来约束实施边界。

## Implementation Plan

### Phase 1：切口确认
- [x] T-01：确认 message-v2 / stream-runtime / ChatPage 的最小实施切口 ✅
- [x] T-02：冻结第一刀提交边界与验证命令 ✅

### Phase 2：最小实现
- [x] T-03：实现 gateway 侧最小 message-v2 / sync/runtime 接线（runtime-safe V2 窄读口）✅
- [x] T-04：实现 web 侧最小消费链切换（recovery accessor 收口到 ChatPage / Layout）✅

### Phase 3：验证与提交
- [x] T-05：完成主线验证并创建原子提交 ✅

## Notes

- 本工作流是 Team 主线之后的下一条独立实施链，现已完成并归档。
- 已确定并完成的实现顺序：**gateway first，web second**。
- gateway 第一刀已完成：
  - `services/agent-gateway/src/message-v2-schema.ts`
  - `services/agent-gateway/src/message-store-v2.ts`
  - `services/agent-gateway/src/message-v2-projectors.ts`
  - `services/agent-gateway/src/sync-event.ts`
  - `services/agent-gateway/src/message-v2-adapter.ts`
  - `services/agent-gateway/src/routes/session-shared-read-routes.ts`
  - `services/agent-gateway/src/__tests__/session-shared-read-routes.test.ts`
- gateway 收口完成：
  - 新增 `services/agent-gateway/src/runtime-safe-message-merge.ts`
  - `services/agent-gateway/src/routes/sessions.ts` 现已把 runtime-safe V2 messages 补入 `/sessions/:id` detail 与 `/sessions/:id/recovery`
  - `services/agent-gateway/src/routes/session-shared-read-routes.ts` 改为与主读链共用 supplement-only merge 规则：**V1 保持 authoritative，V2 只补 runtime-safe 缺口，不覆盖同 ID 旧消息**
  - `services/agent-gateway/src/__tests__/session-todo-routes.test.ts` 新增 detail/recovery 对 V2 runtime-safe merge 的回归
  - `services/agent-gateway/src/__tests__/message-v2-adapter.test.ts`、`message-v2-store.test.ts` 已同步到当前品牌化 ID / tool state / transition 签名
- web 第二刀已完成：
  - 新增 `apps/web/src/pages/chat-page/recovery-read-model.ts`，统一 recovery transcript 与 pending interaction 的兼容读取
  - `apps/web/src/pages/ChatPage.tsx` 改为通过统一 accessor 读取 `messages / pendingPermissions / pendingQuestions`
  - `apps/web/src/components/Layout.tsx` 改为通过统一 accessor 读取待处理权限与问题，避免继续各自硬解 recovery 返回体
  - 已补 `apps/web/src/pages/chat-page/recovery-read-model.test.ts`
- 已验证通过：
  - `pnpm --filter @openAwork/web exec vitest run src/pages/chat-page/recovery-read-model.test.ts src/pages/chat-page/support.test.ts src/components/Layout.permissions.test.tsx src/components/Layout.questions.test.tsx`
  - `pnpm --filter @openAwork/web exec vitest run src/pages/ChatPage.test.tsx -t "hydrates shared message payloads returned by the session API|attaches to the active stream after refresh and keeps the recovered snapshot visible|keeps recovery guidance visible after attach completion until the backend snapshot catches up|keeps attach recovery events out of the transcript message list|reconstructs in-progress assistant output from persisted run events after a refresh"`
  - `pnpm --filter @openAwork/web build`
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/message-v2-adapter.test.ts src/__tests__/message-v2-store.test.ts src/__tests__/message-v2-sync-event.test.ts src/__tests__/session-shared-read-routes.test.ts src/__tests__/session-todo-routes.test.ts src/__tests__/session-run-events.test.ts`
  - `pnpm --filter @openAwork/agent-gateway typecheck`
- Memory sync: completed
