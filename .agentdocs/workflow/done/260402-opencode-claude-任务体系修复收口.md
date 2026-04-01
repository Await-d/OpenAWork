# .agentdocs/workflow/260402-opencode-claude-任务体系修复收口.md

## Task Overview
基于 `260402-opencode-claude-任务体系完成度核查` 的结论，对 OpenCode/Claude 任务体系当前工作树中的关键未闭环项进行修复，并把类型检查、构建、相关单测与 verification 收口到可验证通过状态。

## Current Analysis
- 审计已确认并非“未实现”，而是“主体结构已在，但关键合同与验证链路未完全闭环”。
- 当前硬失败集中在三类：
  1. `@openAwork/shared` 与 `services/agent-gateway` 之间的类型/合同断裂；
  2. `stream replay / bookend` 对 `interaction_wait` 的 durable replay 不符合当前设计与 verification 预期；
  3. `session-runtime-state` 的返回结构变更后，单测未同步更新，导致完整 `pnpm run test` 失败。
- 目标不是扩展新能力，而是把现有 fusion-native 主线从“部分可用”修到“关键门禁全绿”。

## Solution Design
- Phase 1 先修 shared/gateway 合同，恢复 typecheck/build。
- Phase 2 再修 replay/bookend 判定与 stream replay 逻辑，使 verification 与设计一致。
- Phase 3 收口 runtime state 测试/结果结构，并跑相关测试矩阵。
- 全程以最小改动为原则，优先修合同与回放边界，不扩写新 surface。

## Complexity Assessment
- Atomic steps: 5+（建方案、修 shared 合同、修 gateway 类型、修 replay、修测试、跑验证） → +2
- Parallel streams: 是（类型合同、replay/bookend、runtime state 可并行分析） → +2
- Modules/systems/services: 3+（`.agentdocs`、`packages/shared`、`packages/agent-core`、`services/agent-gateway`） → +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是（需要形成修复方案与验收记录） → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是跨 shared/agent-core/gateway 的多缺口修复，需要计划、分阶段执行与验证留痕，不能直接在工作树里零散补丁式修改。

## Implementation Plan

### Phase 1: 合同与边界收口
- [x] T-01: 确认 shared 当前实际导出与 gateway 期望导出的差异 ✅
- [x] T-02: 补齐或对齐 shared/gateway 所需的 fusion-native 类型合同，恢复 typecheck/build ✅

### Phase 2: 回放链路修复
- [x] T-03: 修复 `stream.ts` 的 durable replay 判定，使 `interaction_wait` 可直接 replay、`tool_handoff` 继续走 upstream ✅
- [x] T-04: 跑通 `verify-stream-replay-bookend.ts` 与相关 stream/replay 测试 ✅

### Phase 3: runtime state 与验证闭环
- [x] T-05: 修复 `session-runtime-state` 实现或测试漂移，恢复完整测试一致性 ✅
- [x] T-06: 运行 typecheck/build/关键 test/verification，并记录最终结果 ✅

## Notes
- 本次修复范围聚焦审计确认的硬失败；不主动扩展新 feature。
- 验证通过标准：`pnpm run typecheck`、`pnpm run build`、`pnpm exec tsx src/verification/verify-stream-replay-bookend.ts`、`pnpm run test` 至少相关失败项全部消除。
- 已完成修复：
  - `packages/shared/src/index.ts`：补齐 `TaskOwnership / TaskEntityRecord / TaskRunRecord / InteractionRecord / PlanTransitionRecord / SessionContextRecord / RunEventCursor / RunEventBookend / EventEnvelope / RunEventEnvelope` 导出。
  - `services/agent-gateway/src/routes/stream-protocol.ts` 与 `routes/tools.ts`：修复 tool definitions profile helper 的签名漂移。
  - `services/agent-gateway/src/routes/stream.ts`：replay gating 改为基于最新 durable event 的 `bookend.replayable`。
  - `services/agent-gateway/src/__tests__/session-runtime-state.test.ts`：断言对齐现有 `sessionContext` 返回结构。
- 已验证通过：
  - `pnpm run build`（packages/shared）
  - `pnpm run typecheck`（packages/shared）
  - `pnpm run typecheck`（packages/agent-core）
  - `pnpm run typecheck`（services/agent-gateway）
  - `pnpm run build`（services/agent-gateway）
  - `pnpm exec tsx src/verification/verify-stream-replay-bookend.ts`
  - `pnpm exec vitest run src/__tests__/session-runtime-state.test.ts`
  - `pnpm run test:unit`（隐含于 `pnpm run test` 前半段，现已全绿）
- 额外发现：`pnpm run test` 在进入 `test:verification -> test:responses` 时仍被 usage 链路现有失败阻塞：`verify-openai-responses.ts` 报 `text scenario usage persistence expected input_tokens=1 but received 0`。该问题与本次任务体系修复直接修改的文件无交集，且当前工作树本身存在独立 usage 相关改动，应作为后续单独修复项处理。
- Memory sync: completed
