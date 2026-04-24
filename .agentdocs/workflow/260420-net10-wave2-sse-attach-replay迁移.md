# .agentdocs/workflow/260420-net10-wave2-sse-attach-replay迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `PR-24 / RUN-005`：`/sessions/:id/stream/attach` 与 `/sessions/:id/stream/active` 的 SSE attach/replay 协议面。
- 范围：仅覆盖 active snapshot、`afterSeq` / `Last-Event-ID` 恢复、inactive terminal replay、active live attach、SSE envelope/keepalive，以及它们对已完成 `session_run_events / runtime_threads / RUN-004` 的消费。
- 不做：SSE `/stream/sse` 主请求入口、`/stream/stop-active`、permissions/questions/commands execute/recovery。

## Current Analysis
- TS 真值集中在：
  - `services/agent-gateway/src/routes/stream-routes-plugin.ts` 中 `/stream/active`、`/stream/attach`
  - `services/agent-gateway/src/run-event-envelope.ts`
  - `services/agent-gateway/src/session-run-events.ts`
  - `services/agent-gateway/src/session-runtime-thread-store.ts`
- attach 的真实语义不是 transcript replay，而是：
  1. `active` 先用 `getFreshSessionRuntimeThread()` + `getLatestSessionRunEventSeqByRequest()` 返回活跃快照；
  2. `attach` 先按 `Last-Event-ID ?? afterSeq` 回放 durable run events；
  3. 若目标 request 仍活跃，则再挂 live subscription，并把 replay 期间到达的 live 事件按 `seq` 缓冲冲刷；
  4. 若目标 request 已终态可 replay，则回放后直接结束。
- `.NET` 当前已有：
  - `ISessionRunEventStore`（含 `ListByRequestAfterSeqAsync` / `GetLatestSeqByRequestAsync`）
  - `ISessionRuntimeThreadStore`（含 `GetFreshAsync` / `HasFreshAsync`）
  - `RUN-004` 的 WS runtime 与 request registry
  - 但**完全没有** `/stream/active`、`/stream/attach`、SSE envelope、live attach broadcaster、bookend helper。

## Solution Design
- 第一阶段先补统一的 `RunEventEnvelope + Bookend` helper，严格对齐 TS 的 `terminal/replayable` 语义。
- 第二阶段补一个最小 `SessionRunEventBroadcaster`，供 `RUN-004` 和 `RUN-005` 共享：
  - `publish(sessionId, event, meta)`
  - `subscribe(sessionId, handler)`
- 第三阶段补两条 route：
  - `GET /sessions/{id}/stream/active`
  - `GET /sessions/{id}/stream/attach`
- attach 第一版严格按 TS 真值做，不扩展：
  - `Last-Event-ID` 优先于 query.afterSeq
  - inactive + terminal => replay then end
  - inactive + non-terminal => 409
  - active => replay + live subscribe + 10s keepalive

## Complexity Assessment
- Atomic steps: 5+（truth 对照、envelope helper、broadcaster、active/attach routes、tests、账本同步）→ +2
- Parallel streams: 是（route / broadcaster / tests 可并行）→ +2
- Modules/systems/services: 3+（TS route truth、.NET host/application、已完成 run event/runtime thread layers）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `RUN-005` 是 WS runtime 之后的紧邻主干，涉及协议面、live subscription 与恢复边界，必须持续记账并严格控制在 attach/active 语义内。

## Implementation Plan

### Phase 1: 真值对照与协议建模
- [x] T-01: 对照 TS `/stream/active` / `/stream/attach` / `run-event-envelope.ts`，锁定 active snapshot、bookend、attach replay 语义 ✅
- [x] T-02: 设计 `.NET` `RunEventEnvelope + Bookend` helper 与 `SessionRunEventBroadcaster` ✅

### Phase 2: Attach/Active 主线
- [x] T-03: 实现 `/sessions/:id/stream/active`，返回 active snapshot + latest durable seq ✅
- [x] T-04: 实现 `/sessions/:id/stream/attach`，支持 `Last-Event-ID ?? afterSeq`、inactive terminal replay、active live attach、keepalive ✅
- [x] T-05: 将 RUN-004 的 runtime event emit 接入 broadcaster，供 attach live 订阅复用 ✅

### Phase 3: 验证与记账
- [x] T-06: 补 attach/active 集成测试，覆盖 terminal replay、non-terminal 409、active replay+live buffer、Last-Event-ID 优先级 ✅
- [x] T-07: 更新总迁移账本中 `RUN-005` 状态与证据 ✅

## Notes
- 第一版不要碰 `/stream/stop-active`，也不要提前接 permissions/questions/commands execute。
- 已落地的 `.NET` 文件：
  - `src/OpenAWork.Gateway.Application/Abstractions/Streaming/ISessionRunEventBroadcaster.cs`
  - `src/OpenAWork.Gateway.Application/Features/Stream/SessionRunEventEnvelopeSupport.cs`
  - `src/OpenAWork.Gateway.Application/Features/Stream/SessionStreamRuntimeService.cs`
  - `src/OpenAWork.Gateway.Host/Routes/SessionStreamRouteGroupExtensions.cs`
  - `src/OpenAWork.Gateway.Infrastructure/Streaming/InMemorySessionRunEventBroadcaster.cs`
  - `tests/OpenAWork.Gateway.IntegrationTests/SessionStreamAttachTests.cs`
  - `tests/OpenAWork.Gateway.ScenarioVerification/SessionStreamAttachReplayVerificationTests.cs`
- 已复刻的关键语义：
  - `/sessions/{id}/stream/active` 返回 fresh runtime thread + `lastSeq`
  - `/sessions/{id}/stream/attach` 使用 query token 鉴权
  - cursor 优先级按 TS route 真值收口为 `Last-Event-ID ?? afterSeq`
  - inactive + terminal => durable replay 后结束
  - inactive + non-terminal => `409 Requested stream is no longer active`
  - active => 先 replay durable，再通过 request-scoped broadcaster 续接 live event，并保持按 `seq` 有序输出 + 10s keepalive
- 已补的 `.NET` 集成测试覆盖：
  - active snapshot + latest durable seq
  - inactive terminal attach replay
  - inactive non-terminal 409
  - `Last-Event-ID` 优先级覆盖 query `afterSeq`
  - active request replay + live broadcaster 顺序输出
- 已补的 `.NET` scenario verification 载体：
  - terminal durable replay 端到端场景：`tests/OpenAWork.Gateway.ScenarioVerification/SessionStreamAttachReplayVerificationTests.cs`
- 最新复核结论：针对这次 evidence update 的 goal / QA / code quality / security / context mining 全 PASS；新增 scenario 文件已被确认是“integration 之外的最小场景验证载体”，没有引入新的运行时代码或 scope 漂移。
- 验证边界：当前环境仍缺少 `dotnet` 与 `csharp-ls`，因此本轮只能收口到“代码主线完成 + workflow/runtime/ledger 已同步 + integration/scenario verification 文件已补 + `.NET` build/test/manual QA 待补证”。
- Memory sync: completed
