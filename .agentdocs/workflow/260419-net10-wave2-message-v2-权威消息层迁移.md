# .agentdocs/workflow/260419-net10-wave2-message-v2-权威消息层迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `PR-15 / DATA-003 + DATA-004`：`message_v2` 与 `part_v2` 权威消息层。
- 范围：仅覆盖 `message_v2` / `part_v2` 的持久化模型、最小 append/read/update/delete helper，以及它们对 `sessions` 的基础依赖。
- 不做：`event_log / event_sequences`、stream runtime、run events、snapshot/file-diff、commands execute。

## Current Analysis
- 迁移总账明确 `PR-15` 是 `PR-13` 之后的下一张串行主干：先补 `message_v2 / part_v2`，再进入 `event_log` / `run_events` / stream。
- TS 真值主要集中在：
  - `services/agent-gateway/src/db.ts` 中 `message_v2 / part_v2` schema 与 V1→V2 migration 段
  - `services/agent-gateway/src/message-v2-schema.ts`
  - `services/agent-gateway/src/message-store-v2.ts`
  - `services/agent-gateway/src/message-v2-adapter.ts`
- `.NET` 侧当前没有任何 `MessageV2Record` / `PartV2Record`、对应 configuration/store/helper/tests，属于从零起步。

## Solution Design
- 先在 `.NET` 中补 `message_v2` 与 `part_v2` 两张表、配置、双 provider migrations 与 snapshot。
- 应用层优先交付最小 store/helper：
  - append/update/delete/get/list `message_v2`
  - append/update/delete/get/list `part_v2`
  - read model：按 `message_id` 聚合 `parts`
- contracts/route 先不扩散到外部 HTTP 面；本轮完成定义是 **权威消息层 round-trip 可用**，为后续 `event_log / run_events / stream` 铺路。

## Complexity Assessment
- Atomic steps: 5+（schema 对照、entity/migration、store/helper、tests、账本同步）→ +2
- Parallel streams: 是（schema/adapter 真值对照与 `.NET` store 设计可并行）→ +2
- Modules/systems/services: 3+（TS gateway、.NET persistence/application、sessions 主表依赖）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `message_v2 / part_v2` 是 Wave 2 主干第二刀，跨 schema、store、测试与后续 runtime 依赖，必须持续记账并严控范围。

## Implementation Plan

### Phase 1: 真值对照与数据模型
- [x] T-01: 对照 TS `db.ts`、`message-v2-schema.ts`、`message-store-v2.ts`，锁定 `message_v2 / part_v2` 的最小字段、索引与排序语义 ✅
- [x] T-02: 新增 `MessageV2Record` / `PartV2Record`、配置、`GatewayDbContext` 挂接与双 provider migrations ✅

### Phase 2: 最小权威消息层
- [x] T-03: 新增 `.NET` store/helper，覆盖 message/part 的 append/read/update/delete 与 message→parts 聚合读模型 ✅
- [x] T-04: 评估并对齐 `message-v2-adapter.ts` 中当前最小必需的转换/排序规则 ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` round-trip tests，覆盖 append/read/update/delete、message→parts 聚合、session 级顺序 ✅
- [x] T-06: 更新总迁移账本中 `DATA-003`、`DATA-004` 状态与证据 ✅

## Notes
- 本轮不把 `event_log` 和 projector 机制提前做进来；只要权威消息层 schema/store 稳定，就为 `PR-16/17` 留出干净前置。
- `message_v2` 与 `part_v2` 的读取顺序是关键契约：message 按 `(time_created, id)`，part 按 `(message_id, id)` 或 `(time_created, id)`，必须从第一版就锁住。
- 当前已落地的 `.NET` 文件：
  - `src/OpenAWork.Gateway.Persistence.EFCore/Entities/MessageV2Record.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Entities/PartV2Record.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Configurations/MessageV2RecordConfiguration.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Configurations/PartV2RecordConfiguration.cs`
  - `src/OpenAWork.Gateway.Application/Abstractions/Persistence/IMessageV2Store.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Stores/MessageV2Store.cs`
  - `src/OpenAWork.Gateway.Persistence.Sqlite/Migrations/20260419204000_AddMessageV2.cs`
  - `src/OpenAWork.Gateway.Persistence.PostgreSql/Migrations/20260419204000_AddMessageV2.cs`
  - `tests/OpenAWork.Gateway.IntegrationTests/MessageV2StoreTests.cs`
- 当前已补的可运行证据：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/message-v2-store.test.ts src/__tests__/message-v2-adapter.test.ts src/__tests__/message-v2-sync-event.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/message-v2-store.test.ts src/__tests__/message-v2-adapter.test.ts src/__tests__/message-v2-sync-event.test.ts src/__tests__/session-workspace-metadata.test.ts` ✅
  - `pnpm --filter @openAwork/web-client exec vitest run src/__tests__/sessions-client.test.ts` ✅
- 当前 `.NET` store 已实现的最小语义：
  - `insert/update/delete/get/list` message
  - `insert/update/delete/get/list` part
  - `updatePartDelta`
  - `listMessagesWithParts`
  - duplicate `messageId/partId` 的幂等 upsert
  - request-scope helper：`get by requestId` / `list by request scope` / `update status by request scope` / `delete by request scope`
- 当前已补的跨层闭环：
  - `GET /sessions/{id}` 已从空 `messages` 升级为真实 `message_v2 + part_v2` transcript 聚合读模型
  - 已覆盖 text part、completed tool、pending tool、snapshot-only message 跳过、reasoning part、`modified_files_summary` 等投影测试
- 后续根据 focused review 补的收口修复：
  - `UpdatePartDeltaAsync` 已改为 `JsonNode` 路径，避免字符串字段因 `JsonElement` 反序列化而丢失原值。
  - canonical `toolResultContent` 读取已改为直接校验 `type == "tool_result"` 后 clone `JsonElement`，避免在 session detail 中退化成简化 tool_result。
  - request-scope helper 不再使用 `limit 100` 的截断列表，改为全量扫描当前 session/user 消息。
  - request-scope helper 中 `roles` 语义已对齐 TS：`null => 不过滤`，`[] => 匹配 none`。
  - 已新增回归测试，覆盖 100+ 消息下的 request-scope 命中与 `Array.Empty<string>()` no-op。
- 当前环境限制：
  - `dotnet` / `csharp-ls` 缺失，`.NET` 真实 build/test/manual QA 仍待补证
  - `.NET` 环境级 QA 仍因 `dotnet` 缺失而无法执行
- focused review 结果：目标符合度 PASS、代码质量 PASS、安全复核 PASS、上下文遗漏 PASS；唯一未闭环项仍是环境级 QA（当前机器缺少 `dotnet`）。
- Memory sync: completed
