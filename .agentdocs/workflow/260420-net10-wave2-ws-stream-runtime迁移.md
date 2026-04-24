# .agentdocs/workflow/260420-net10-wave2-ws-stream-runtime迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `PR-23 / RUN-004`：把现有 WS stream skeleton 升级为真实 session-scoped runtime。
- 范围：仅覆盖 `GET /sessions/:id/stream` websocket 入口、session ownership / auth、request schema 校验、single-flight / request replay 保护、runtime thread 心跳、durable run event 写入与实时 chunk 推送。
- 不做：SSE `/stream/sse`、`/stream/attach`、`/stream/active`、`/stream/stop-active`、`Last-Event-ID`/cursor/afterSeq replay、permissions/questions/commands execute/recovery。

## Current Analysis
- 迁移总账明确 `PR-23` 目标是把 WS skeleton 升级为真实 stream runtime，并且它严格依赖 `sessions`、`message_v2`、`event_log`、`session_run_events`、`session_runtime_threads` 这四张已完成的数据切片。
- TS 真值主线在：
  - `services/agent-gateway/src/routes/stream-routes-plugin.ts`（WS 入口、鉴权、冲突处理）
  - `services/agent-gateway/src/routes/stream.ts`（`handleStreamRequest()` runtime 调度）
  - `services/agent-gateway/src/routes/stream-model-round.ts`（最小 model round）
  - `services/agent-gateway/src/stream-cancellation.ts`（in-flight/request stop 语义）
- `.NET` 侧已有 `/stream/sse`、`/stream/ws` skeleton，但缺少真正的 `/sessions/:id/stream` session-scoped runtime 路由、in-flight registry、runtime coordinator、chunk 推送与 stop 语义。

## Solution Design
- 先在 `.NET` 中补一个最小 `SessionStreamRuntimeService`：
  - 校验 session ownership
  - request schema 解析（先覆盖最小字段：`message`、`clientRequestId`、`providerId`、`model`、`webSearchEnabled`、`thinkingEnabled`）
  - request single-flight / session single-flight
  - session `state_status=running/idle`
  - runtime thread `upsert/touch/clear`
  - 将 run events durable 写入 `ISessionRunEventStore`，并实时推给当前 WS 客户端
- 先做最小 upstream loop：
  - 如果命中已持久化 assistant replay，则直接返回 WS chunk
  - 否则走一轮最小 upstream stream（先复用现有 `.NET` LLM client / service 能力）
  - route 成功闭环标准是“能开始、能持续写 chunk、能结束、能 stop、能拒绝并发”。
- 明确把 `/stream/attach`、SSE replay、permissions/questions 恢复链留到 `RUN-005/007/008`。

## Complexity Assessment
- Atomic steps: 5+（真值对照、route/service、registry、state/thread、tests、账本同步）→ +2
- Parallel streams: 是（WS route/runtime 与 stop/single-flight tests 可并行）→ +2
- Modules/systems/services: 3+（TS gateway runtime、.NET host/application、已完成 data layers）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `RUN-004` 是 Wave 2 runtime 主干起点，涉及 route、runtime、state、durable events 与后续 replay 边界，必须持续记账并严格控 scope。

## Implementation Plan

### Phase 1: 真值对照与最小闭环定义
- [x] T-01: 对照 TS `stream-routes-plugin.ts` / `stream.ts` / `stream-model-round.ts`，锁定 WS 最小 runtime 闭环与 RUN-005 边界 ✅
- [x] T-02: 梳理现有 `.NET` stream skeleton、LLM client、state/thread stores 与缺失 service 清单 ✅

### Phase 2: WS runtime 主线
- [x] T-03: 新增 `/sessions/:id/stream` route、request parser 与 session ownership/auth 校验 ✅
- [x] T-04: 新增 runtime coordinator：single-flight、runtime thread heartbeat、durable run event 写入、当前 WS chunk 推送 ✅
- [x] T-05: 新增 `/stream/stop` 最小语义与 in-flight request registry 清理 ✅

### Phase 3: 验证与记账
- [x] T-06: 补 WS runtime tests，覆盖 happy path、single-flight 409、stop、runtime thread 收敛 ✅
- [ ] T-07: 更新总迁移账本中 `RUN-004` 状态与证据

## Notes
- 本轮先不要求 `attach` / `SSE` / `active`，但 runtime service 的事件写入和 stop 语义必须与后续 `RUN-005/006` 兼容。
- 若当前 `.NET` LLM client 不足以支持完整流式协议，可先用最小 adaptor 在 runtime service 内部做桥接，但不能把协议差异掩盖成“后续再说”。
- 当前已落地的 `.NET` 文件：
  - `src/OpenAWork.Gateway.Application/Abstractions/Streaming/ISessionStreamRequestRegistry.cs`
  - `src/OpenAWork.Gateway.Application/Abstractions/Streaming/ISessionStreamRuntimeService.cs`
  - `src/OpenAWork.Gateway.Infrastructure/Streaming/InMemorySessionStreamRequestRegistry.cs`
  - `src/OpenAWork.Gateway.Application/Features/Stream/SessionStreamRuntimeService.cs`
  - `src/OpenAWork.Gateway.Host/Routes/SessionStreamRouteGroupExtensions.cs`
  - `tests/OpenAWork.Gateway.IntegrationTests/SessionStreamRuntimeTests.cs`
- 当前已补的最小行为：
  - query token 鉴权 + session ownership 校验
  - 同 request replay / 同 session single-flight 冲突
  - runtime thread upsert/touch/clear
  - user/assistant message durable 写入
  - `text_delta / done / error` run event durable 写入与当前 WS 推送
  - `/sessions/:id/stream/stop` 取消当前 request
- 后续根据自检补的收口修复：
  - `ISessionStreamRequestRegistry` 已升级为原子注册/完成模型，不再先 `HandleAsync` 再注册，避免 same-session 并发请求绕过 single-flight。
  - `stop` 语义已改为等待 in-flight request 完整收尾后再返回 `stopped=true`，避免 200 返回时 session/thread 仍未清理。
  - WS route 每条消息都会创建独立 DI scope 来解析 `ISessionStreamRuntimeService`，避免多个后台任务共享同一个 scoped `GatewayDbContext`。
  - replay 语义已升级为：优先 replay durable run events；若 durable 最新 bookend 为 `cancelled` / `error`，则 fresh rerun，并清理 stale run events + assistant/tool messages。
  - V2 transcript fallback 已升级：same-request replay 不再只回放 `text`，还会回放 `tool_call_delta` / `tool_result` / `assistant_event` 等最小可见项。
  - stop / auth / ownership 边界已补测试：无 Bearer → 401，非 owner → 404，invalid query token → WS 握手失败。
  - runtime heartbeat task 现在会被显式 await，并吞掉预期取消，避免 stop/completion 后留下未观察的取消异常。
- 当前已补的可运行证据：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/stream-replay.test.ts src/__tests__/stream-attach-route.test.ts src/__tests__/session-run-events.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec tsx src/verification/verify-stream-replay-bookend.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec tsx src/verification/verify-stream-attach-recovery.ts` ✅
- 当前已补的集成测试覆盖：
  - WS happy path
  - same-request in-flight wait-and-replay
  - same-request durable replay（含 tool_call/tool_result、assistant_event）
  - same-request fresh rerun after error / cancelled
  - same-session conflict 409
  - stop cancel 与 stop 返回后立即 rerun
  - invalid JSON / invalid schema
  - stop 401 / non-owner 404 / invalid query token handshake failure
