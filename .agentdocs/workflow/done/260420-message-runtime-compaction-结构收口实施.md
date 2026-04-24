# .agentdocs/workflow/260420-message-runtime-compaction-结构收口实施.md

## Task Overview
- 目标：继续处理剩余差异中最高优先级的 `compaction` 结构问题，把 marker / summary inject-restore / request context / replay 的多层协议进一步收口。
- 范围：以 `services/agent-gateway` 为主，必要时补 shared/web-client/apps/web 的兼容边界说明，但本轮优先做后端结构收口。
- 非目标：不做无边界重写，不直接改前端展示协议，不一次性推翻 marker 机制。

## Current Analysis
- 当前 sender/read/tool-state 主链已经基本稳定，但 `compaction` 仍然同时依赖：
  - marker message
  - summary 注入/还原
  - metadataJson 中的 `persistedMemory`
  - covered boundary 回退
  - replay/request context 前的再组装
- 这意味着 compaction 仍然不是单一结构，而是多层协议协作，最容易造成 replay 与 request context 的结构漂移。

## Solution Design
- 目标不是删除 marker，而是把 **compaction boundary / summary source / request context rewrite** 收口到尽量少的 helper/入口。
- 预期方向：
  1. 重新钉死 compaction 的 canonical boundary 与 summary source
  2. 收口 request context 中的 compaction 注入逻辑
  3. 校准 replay/read model 对 marker/synthetic summary 的读取边界
  4. 用最小回归集验证不破坏长对话、attach/replay、shared read

## Complexity Assessment
- Atomic steps: 5+（boundary/source 钉死、request context 收口、replay 校准、验证矩阵、兼容约束）→ +2
- Parallel streams: 是（本仓结构、参考模式、replay/request context 可并行）→ +2
- Modules/systems/services: 3+（gateway、shared/web-client、apps/web）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: compaction 当前仍是多层协议协作，必须持久化记录边界、风险与验证矩阵，避免下一轮改动再次把 sender/read/replay 分叉。

## Implementation Plan

### Phase 1: compaction canonical 边界重新钉死
- [x] T-01: 重新确定 compaction marker / summary / persistedMemory 的 canonical source 与 boundary ✅
- [x] T-02: 盘点 request context/replay/shared read 中所有 compaction 重写点 ✅

### Phase 2: 最小结构收口
- [x] T-03: 实施 request context 中 compaction 结构的继续收口 ✅
- [x] T-04: 实施 replay/read model 中 marker/synthetic summary 的边界收口 ✅

### Phase 3: 验证与归档
- [x] T-05: 跑 compaction/stream/replay 相关定向回归 ✅
- [x] T-06: 跑 agent-gateway build + 全量 test 并同步 agentdocs ✅

## Notes
- Can split? 可以，至少可拆成两条流：A) compaction canonical source/boundary；B) request context/replay/read model 的消费点。
- Should split? 应该拆。这样可以把“事实源收口”和“消费边界收口”分别验证，降低爆炸半径。
- Dependency order:
  - T-01/T-02 → T-03/T-04
  - T-03/T-04 → T-05 → T-06
- 当前用户已明确要求继续执行，不停留在分析层。
- canonical 结论：
  - compaction boundary 的 primary truth 是 transcript/message 历史里的最新 marker；
  - `metadataJson` 里的 `lastCompactionLlmSummary` / `compactionMemory` 只作为 legacy fallback；
  - request context / prepared conversation / compaction driver 应共享同一份 resolved compaction context，而不是各自判断 marker/fallback。
- 本轮已落地的最小收口：
  - `session-message-store.ts` 新增 `resolveCompactionContext()`，统一解析 marker / summary / persistedMemory / summarySource。
  - `buildPreparedUpstreamConversation()` 改为内部使用 `resolveCompactionContext()`；`compactSummaryInjected` 现在只在 metadata fallback 真正注入时为 `true`。
  - `loadRequestContextConversation()` 改为使用同一份 compaction context 规则，不再自己做 marker/fallback 判断。
  - `session-compaction.ts` 在构建 compaction LLM 输入时，改为走 `buildPreparedUpstreamConversation(..., { metadataJson })`，不再手写 markerPresent 分支。
  - request context 主线已明确变成：marker 优先、metadata 仅 fallback。
- 本轮修改文件：
  - `services/agent-gateway/src/session-message-store.ts`
  - `services/agent-gateway/src/session-compaction.ts`
  - `services/agent-gateway/src/__tests__/session-message-store.test.ts`
- 本轮验证证据：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session-message-store.test.ts src/__tests__/session-compaction.test.ts src/__tests__/stream-model-round.test.ts src/__tests__/stream-replay.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway build` ✅
  - `pnpm --filter @openAwork/agent-gateway test` ✅（`verify-message-v2-deep-conversation` 仍按缺真实 API 环境变量时 skip）

## Completion
- T-01 ~ T-06 已全部完成。
- 这轮 compaction 收口已经把“marker 优先、metadata 仅 fallback”的规则固定到 canonical request-context 主线。
