# .agentdocs/workflow/260419-net10-wave2-event-log-溯源层迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `PR-16 / DATA-005 + DATA-006`：`event_log` 与 `event_sequences` 溯源层。
- 范围：仅覆盖 `event_log / event_sequences` 的持久化模型、最小 append/read/next-seq helper、幂等/排序语义，以及它们对已完成 `message_v2 / part_v2` 的前置衔接。
- 不做：`run_events`、stream runtime、恢复/重放服务、commands execute。

## Current Analysis
- 迁移总账明确 `PR-16` 是 `PR-15` 之后的下一张串行主干：先补 `event_log / event_sequences`，再进入 `session_run_events / runtime_threads / stream`。
- TS 真值当前至少可确认来自：
  - `services/agent-gateway/src/db.ts` 中 `event_log / event_sequences` schema
  - `services/agent-gateway/src/sync-event.ts`
  - 相关 projector / verification / tests（待 explore 结果进一步补全）
- `.NET` 侧当前没有任何 `EventLogRecord` / `EventSequenceRecord`、对应 config/store/helper/tests，仍处于空白。

## Solution Design
- 先在 `.NET` 中补 `event_log` 与 `event_sequences` 两张表、配置、双 provider migrations 与 snapshot。
- 应用层优先交付最小 store/helper：
  - append event
  - allocate / increment sequence
  - 按 aggregate 读取事件流
  - 幂等/排序保障（至少对 `(aggregate_id, seq)`）
- contracts/route 先不外露到 HTTP；本轮完成定义是 **溯源层 round-trip 可用**，为 `run_events / stream / replay` 铺路。

## Complexity Assessment
- Atomic steps: 5+（schema 对照、entity/migration、store/helper、tests、账本同步）→ +2
- Parallel streams: 是（schema/adapter 真值对照与 `.NET` store 设计可并行）→ +2
- Modules/systems/services: 3+（TS gateway、.NET persistence/application、message_v2 前置依赖）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `event_log / event_sequences` 是 Wave 2 主干第三刀，直接影响后续 replay/stream/run_events 的顺序语义，必须持续记账并严控范围。

## Implementation Plan

### Phase 1: 真值对照与数据模型
- [x] T-01: 对照 TS `db.ts`、`sync-event.ts` 与相关 tests，锁定 `event_log / event_sequences` 的最小字段、索引与 seq 语义 ✅
- [x] T-02: 新增 `EventLogRecord` / `EventSequenceRecord`、配置、`GatewayDbContext` 挂接与双 provider migrations ✅

### Phase 2: 最小溯源层
- [x] T-03: 新增 `.NET` store/helper，覆盖 append/read/next-seq 与 aggregate 级排序读取 ✅
- [x] T-04: 对齐 TS `sync-event` 的最小幂等/排序约束，不把 projector/runtime 机制提前做进来 ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` round-trip tests，覆盖 sequence 分配、event append、aggregate 级读取顺序 ✅
- [x] T-06: 更新总迁移账本中 `DATA-005`、`DATA-006` 状态与证据 ✅

## Notes
- 本轮只做溯源层，不把 `session_run_events`、runtime thread 或 stream transport 提前做进来。
- 若 TS 真值里 `event_sequences` 对 aggregate scope 有特殊 key 规则，本轮必须从第一版就对齐，否则后续 replay 顺序会漂。
- 当前已落地的 `.NET` 文件：
  - `src/OpenAWork.Gateway.Persistence.EFCore/Entities/EventLogRecord.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Entities/EventSequenceRecord.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Configurations/EventLogRecordConfiguration.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Configurations/EventSequenceRecordConfiguration.cs`
  - `src/OpenAWork.Gateway.Application/Abstractions/Persistence/ISyncEventStore.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Stores/SyncEventStore.cs`
  - `src/OpenAWork.Gateway.Persistence.Sqlite/Migrations/20260419215500_AddSyncEvents.cs`
  - `src/OpenAWork.Gateway.Persistence.PostgreSql/Migrations/20260419215500_AddSyncEvents.cs`
  - `tests/OpenAWork.Gateway.IntegrationTests/SyncEventStoreTests.cs`
- 当前已补的可运行证据：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/message-v2-sync-event.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway run test:message-v2` ✅ `projection`；`deep` 仍需 `DEEP_CONVERSATION_API_BASE` 环境变量
- 当前环境限制：
  - `dotnet` / `csharp-ls` 缺失，`.NET` 真实 build/test/manual QA 仍待补证
- 后续根据 focused review 补的收口修复：
  - `event_log(aggregate_id, seq)` 已升级为唯一约束，避免并发 append 下 replay 顺序歧义。
  - `SyncEventStore.AppendEventAsync` 已改为 serializable transaction + 原子 `event_sequences` 分配 seq，并在冲突时重试；duplicate `eventId` 仍返回 persisted=false 的 no-op 语义。
  - `SyncEventStoreTests` 的 round-trip 断言已加强到跨 scope replay，并校验 `type / version / data / timestamp`。
  - TS `services/agent-gateway/src/db.ts` / `sync-event.ts` 运行时路径也已同步修复：`event_log(aggregate_id, seq)` 改为唯一约束，`emitEvent()` 改为事务内原子分配 seq，`sqliteTransaction()` 升级为 `BEGIN IMMEDIATE`。
  - `src/__tests__/message-v2-sync-event.test.ts` 已补 seq mock 与 per-aggregate 递增断言；修复后 `message-v2-sync-event / store / adapter` 与 `verify-message-v2-event-projection.ts` 均重新通过。
- focused review 结果：目标符合度 PASS、代码质量 PASS、安全复核 PASS、上下文遗漏 PASS；唯一未闭环项仍是环境级 QA（当前机器缺少 `dotnet`）。
- Memory sync: completed
