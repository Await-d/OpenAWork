# .agentdocs/workflow/260419-net10-wave2-run-events-运行线程迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `PR-17 / DATA-007 + DATA-008`：`session_run_events` 与 `session_runtime_threads`。
- 范围：仅覆盖 run event durable log、per-request seq、assistant-event mirror 兼容位、runtime thread heartbeat/stale 判定与最小 store/helper/tests。
- 不做：WS/SSE route、attach replay、commands execute、恢复/协调服务。

## Current Analysis
- 迁移总账明确 `PR-17` 是 `PR-16` 之后的下一张主干：先建立 `session_run_events` 与 `session_runtime_threads`，再进入 `RUN-004/005` 的真实 WS/SSE stream。
- TS 真值主要来自：
  - `services/agent-gateway/src/db.ts`
  - `services/agent-gateway/src/session-run-events.ts`
  - `services/agent-gateway/src/session-runtime-thread-store.ts`
  - `services/agent-gateway/src/routes/stream-routes-plugin.ts`
  - 相关 verification/tests（待继续补读）
- `.NET` 侧当前没有 `SessionRunEventRecord` / `SessionRuntimeThreadRecord`、对应 config/store/helper/tests，仍处于空白。

## Solution Design
- 先在 `.NET` 中补两张表、配置、双 provider migrations 与 snapshot。
- 应用层优先交付最小 store/helper：
  - `session_run_events`：persist/list/by-request/list-after-seq/latest-seq/delete-by-request
  - `session_runtime_threads`：upsert/touch/clear/getFresh/hasFresh
- 先不接 HTTP route；本轮完成定义是 **run event durable layer + runtime thread freshness layer** 可 round-trip，为 `RUN-004/005` 直接铺路。

## Complexity Assessment
- Atomic steps: 5+（schema 对照、entity/migration、store/helper、tests、账本同步）→ +2
- Parallel streams: 是（run events durable layer 与 runtime thread freshness layer 可并行）→ +2
- Modules/systems/services: 3+（TS gateway、.NET persistence/application、sessions/message_v2/event_log 前置依赖）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `session_run_events / session_runtime_threads` 是 stream 主线的直接前置层，需要持续记账并严控范围，避免把 route/runtime 提前混进来。

## Implementation Plan

### Phase 1: 真值对照与数据模型
- [x] T-01: 对照 TS `db.ts`、`session-run-events.ts`、`session-runtime-thread-store.ts`、`stream-routes-plugin.ts`，锁定最小字段、索引与 seq/stale 语义 ✅
- [x] T-02: 新增 `SessionRunEventRecord` / `SessionRuntimeThreadRecord`、配置、`GatewayDbContext` 挂接与双 provider migrations ✅

### Phase 2: 最小运行态数据层
- [x] T-03: 新增 `.NET` run event store/helper，覆盖 persist/list/by-request/after-seq/latest-seq/delete-by-request ✅
- [x] T-04: 新增 `.NET` runtime thread store/helper，覆盖 upsert/touch/clear/getFresh/hasFresh ✅

### Phase 3: 验证与记账
- [x] T-05: 补 round-trip tests，覆盖 request seq、assistant-event mirror 兼容位、heartbeat/stale 判定 ✅
- [x] T-06: 更新总迁移账本中 `DATA-007`、`DATA-008` 状态与证据 ✅

## Notes
- `session_run_events` 本轮只负责 durable log 与最小 replay helper，不把 WS/SSE attach route 提前做进来。
- `assistant-event` 的 message 镜像如果实现成本过高，可先在 store 层为后续 route 留兼容钩子，但必须明确记录未覆盖项。
- 当前已落地的 `.NET` 文件：
  - `src/OpenAWork.Gateway.Persistence.EFCore/Entities/SessionRunEventRecord.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Entities/SessionRuntimeThreadRecord.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Configurations/SessionRunEventRecordConfiguration.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Configurations/SessionRuntimeThreadRecordConfiguration.cs`
  - `src/OpenAWork.Gateway.Application/Abstractions/Persistence/ISessionRunEventStore.cs`
  - `src/OpenAWork.Gateway.Application/Abstractions/Persistence/ISessionRuntimeThreadStore.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Stores/SessionRunEventStore.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Stores/SessionRuntimeThreadStore.cs`
  - `src/OpenAWork.Gateway.Persistence.Sqlite/Migrations/20260419223500_AddRunEventsAndRuntimeThreads.cs`
  - `src/OpenAWork.Gateway.Persistence.PostgreSql/Migrations/20260419223500_AddRunEventsAndRuntimeThreads.cs`
  - `src/OpenAWork.Gateway.Application/Features/Sessions/SessionRequests.cs`（`GET /sessions/{id}` 已接 durable `runEvents`）
  - `tests/OpenAWork.Gateway.IntegrationTests/SessionRunEventStoreTests.cs`
  - `tests/OpenAWork.Gateway.IntegrationTests/SessionRuntimeThreadStoreTests.cs`
- 当前已补的跨层闭环：
  - `GET /sessions/{id}` 已不再返回空 `runEvents`；现在会读取真实 `session_run_events` durable 数据
  - `SessionRunEventStore` 已补 assistant-event 镜像兼容位：displayable run event 会写入 `message_v2` 助手事件卡片，permission/question 不镜像
- 当前已补的可运行证据：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session-run-events.test.ts` ✅
- 当前已根据 focused review 补的收口修复：
  - `SessionRunEventStore.PersistAsync` 现在会在 `(session_id, client_request_id)` 维度自动分配递增 `seq`，不再依赖调用方手工传入。
  - `ListByRequestAfterSeqAsync` 已从返回裸 `PayloadJson` 改为返回 `{ seq, event }`，更贴近 TS `PersistedSessionRunEvent`。
  - 两个 provider 的 `GatewayDbContextModelSnapshot` 已移除重复的 `SessionRunEventRecord` 定义块，保持快照自洽。
- focused review 结果：目标符合度 PASS、代码质量 PASS、安全复核 PASS、上下文遗漏 PASS；唯一未闭环项仍是环境级 QA（当前机器缺少 `dotnet`）。
- 补充验证：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/stream-replay.test.ts src/__tests__/stream-attach-route.test.ts src/__tests__/session-run-events.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec tsx src/verification/verify-stream-replay-bookend.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec tsx src/verification/verify-stream-attach-recovery.ts` ✅
- Memory sync: completed
