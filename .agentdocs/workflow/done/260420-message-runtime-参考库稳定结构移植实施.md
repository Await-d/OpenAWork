# .agentdocs/workflow/260420-message-runtime-参考库稳定结构移植实施.md

## Task Overview
- 目标：按参考库 `temp/opencode` 当前稳定的消息发送、历史读取、工具读取与工具状态语义，继续把 OpenAWork 的 message/runtime 链路移植到更稳定的结构。
- 范围：`services/agent-gateway` 为主，必要时覆盖 `packages/shared`、`packages/web-client`、`apps/web` 的兼容消费面。
- 成果要求：不仅是方案，而是继续落地实现，直到 sender/read model/tool state 与参考库的稳定模型更接近，并通过相应测试/verification。

## Current Analysis
- 上一轮已完成三阶段最小收口：
  - `tool_result` content-first + canonical metadata truth
  - normalized conversation IR + 主流上游构造接入
  - request lineage helper + compaction marker codec
- 但用户反馈当前“每次发送的结构都有变化”，说明仍存在以下风险：
  - sender/read model 的 canonical 边界仍不够像参考库，兼容 wrapper 过多
  - tool state / tool result 在 gateway、replay、display、upstream build 之间仍可能发生结构漂移
  - request/replay/历史读取的稳定性仍更像“本地收口”，还不是“参考库式稳定结构”

## Solution Design
- 原则：优先对齐参考库的稳定结构，而不是继续在 OpenAWork 本地抽象上打补丁。
- 执行主轴：
  1. 重新钉死参考库的 canonical sender/read/tool-state 结构
  2. 映射 OpenAWork 当前偏差点，挑出最值得继续移植的结构
  3. 实现 sender/read model/tool state 的下一轮迁移
  4. 用 shared/web-client/apps/web 的协议矩阵守住兼容边界

## Complexity Assessment
- Atomic steps: 5+（参考库 canonical 钉死、当前偏差映射、sender/read 移植、tool state 收口、协议兼容验证）→ +2
- Parallel streams: 是（本仓结构、参考库结构、外部官方模式可并行）→ +2
- Modules/systems/services: 3+（gateway、shared/web-client、apps/web）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是上一轮收口后的第二轮深移植，必须把参考库结构、当前偏差、实施顺序和验证矩阵持续落在 `.agentdocs` 中，避免结构迁移过程中再次漂移。

## Implementation Plan

### Phase 1: 参考库 canonical 结构重新钉死
- [x] T-01: 重新确定参考库发送结构的 canonical 入口与稳定模型 ✅
- [x] T-02: 重新确定参考库历史读取/重建与 tool state/tool result 的 canonical 入口与稳定模型 ✅

### Phase 2: 当前偏差点映射
- [x] T-03: 盘点 OpenAWork 当前 sender/read model/tool state 的核心偏差点 ✅
- [x] T-04: 确定最小但真正“像参考库”的下一轮移植切口 ✅

### Phase 3: 继续实施迁移
- [x] T-05: 实施消息发送结构的继续对齐 ✅
- [x] T-06: 实施历史读取/重建结构的继续对齐 ✅
- [x] T-07: 实施工具读取/工具状态语义的继续对齐 ✅

### Phase 4: 兼容与回归
- [x] T-08: 校准 shared/web-client/apps/web 兼容消费面 ✅
- [x] T-09: 完成验证矩阵、风险记录与归档 ✅

## Notes
- Can split? 可以，至少可拆成三条流：参考库结构钉死、本仓偏差点钉死、外部/官方模式参考。
- Should split? 应该拆。拆分能让“参考库稳定模型”与“本仓实现偏差”分别收敛，降低误迁移风险。
- Dependency order:
  - T-01/T-02 → T-03/T-04
  - T-04 → T-05/T-06/T-07
  - T-05/T-06/T-07 → T-08 → T-09
- 当前用户已经明确批准进入实现，不再停留在纯方案阶段。
- 参考库 canonical 重新钉死结果：
  - sender：稳定边界是“先 canonical message/request context，再 sender adapter”，不是 provider body 本身。
  - reader：稳定边界是 request context builder，再进入发送层，而不是由发送入口自己读 session 并拼上下文。
  - tool state/tool result：稳定边界是工具状态机 + 工具调用/结果成对重建；当前本轮只重新钉死语义，还未完全迁到 UI/读取侧。
- 当前偏差映射结果：
  - OpenAWork 主流 sender 已走 normalized IR，但 `compaction-llm.ts` / `workflow-llm.ts` 之前仍直接吃旧 sender 结构。
  - `runModelRound()` 之前自己承担 request context 读取职责，不像参考库的 `loadRequestContextMessages()`。
  - tool state 在存储层有稳定状态机，但读取/显示层仍存在“把 pending/running 压扁”为错误态的风险。
- 本轮已落地迁移：
  - `compaction-llm.ts` 改成基于 `normalizedMessages` 构造非流式请求。
  - `session-compaction.ts` 改成把 `prepared.normalizedMessages` 传给 compaction LLM。
  - `routes/workflow-llm.ts` 改成用 `normalizedMessages` 而不是旧 `messages`。
  - `session-message-store.ts` 新增 `loadRequestContextConversation()`，把 session + metadata → canonical request context 的读取入口稳定下来。
  - `routes/stream-model-round.ts` 改成通过 `loadRequestContextConversation()` 获取最终 request context，不再自己拼读取逻辑。
  - 新增 `services/agent-gateway/src/tool-state-read-model.ts`，把 `ToolPart.state` → fallback `tool_result` / UIMessagePart 的读取规则集中起来。
  - `message-v2-adapter.ts` 现在会用统一 helper 生成 fallback `tool_result`：
    - `pending` → `pending_approval`，并保留 `pendingPermissionRequestId`
    - `error + interrupted output` → `interrupted_output`
    - `completed` / `error` 继续按 canonical 结果落地
  - `message-store-v2.ts` 的 `toModelMessages()` 现在也走同一份 helper，不再本地散写 pending/running/completed/error 的读侧映射。
- 本轮修改文件：
  - `services/agent-gateway/src/compaction-llm.ts`
  - `services/agent-gateway/src/session-compaction.ts`
  - `services/agent-gateway/src/routes/workflow-llm.ts`
  - `services/agent-gateway/src/session-message-store.ts`
  - `services/agent-gateway/src/routes/stream-model-round.ts`
  - `services/agent-gateway/src/__tests__/stream-model-round.test.ts`
  - `services/agent-gateway/src/tool-state-read-model.ts`
  - `services/agent-gateway/src/message-store-v2.ts`
  - `services/agent-gateway/src/message-v2-adapter.ts`
  - `services/agent-gateway/src/__tests__/message-v2-adapter.test.ts`
- 本轮验证证据：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/workflow-llm.test.ts src/__tests__/session-compaction.test.ts src/__tests__/stream-protocol.unit.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session-message-store.test.ts src/__tests__/stream-model-round.test.ts src/__tests__/workflow-llm.test.ts src/__tests__/session-compaction.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/message-v2-adapter.test.ts src/__tests__/session-message-store.test.ts src/__tests__/message-v2-store.test.ts src/__tests__/stream-model-round.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway build` ✅
  - `pnpm --filter @openAwork/agent-gateway test` ✅（`verify-message-v2-deep-conversation` 仍按缺真实 API 环境变量时 skip）

## Compatibility Decision
- 本轮已完成 shared/web-client/apps/web 的兼容校准：
  - `packages/shared-ui` 与 `apps/web` 当前稳定消费的展示状态字面量仍是 `running / paused / completed / failed`
  - 因此前端协议层 **暂不引入新的 tool status 字面量**
  - 本轮只迁移 gateway 内部的 tool state read-model，不改 `assistant_trace` / tool card status 协议
- 这意味着参考库的“稳定工具状态机”已被迁移到 gateway 内部读取层，但前端仍通过既有状态映射消费，兼容边界保持稳定。

## Completion
- T-01 ~ T-09 已全部完成。
- 本轮已完成：
  - sender canonical 继续对齐
  - request context canonical reader 落地
  - tool state read-model helper 落地
  - 整包构建与验收回归通过
