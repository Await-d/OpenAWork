# .agentdocs/workflow/260420-net10-wave2-pending-interactions-持久化迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `DATA-012 / DATA-013`：`permission_requests` 与 `question_requests` 的持久化模型。
- 范围：仅覆盖表结构、EF Core entities/configurations、store/read-write helper、双 provider migration 与最小持久化测试。
- 不做：permissions/questions route、resume hooks、commands execute、recovery。

## Current Analysis
- 迁移总账明确 `RUN-007 / RUN-008` 依赖 `DATA-012 / DATA-013`，所以这刀必须先把 pending request 的 durable layer 打平。
- 当前 `.NET` 侧已有 `sessions`、`message_v2`、`session_run_events`、`session_runtime_threads`，但还没有 permission/question pending request 的实体与 store。
- TS 真值预计集中在：
  - `services/agent-gateway/src/db.ts`
  - `services/agent-gateway/src/routes/permissions.ts`
  - `services/agent-gateway/src/routes/questions.ts`
  - 相邻测试与 runtime helper
- 本轮的关键不是 route，而是先锁定：主键、lookup 方式、过期字段、状态字段、session/request 关联字段，以及后续 resume 所需的最小持久化语义。

## Solution Design
- 优先从 TS 真值反推两张表的最小 authority model：
  - `permission_requests`
  - `question_requests`
- `.NET` 侧按现有 persistence pattern 落地：
  1. EF Core entities + configurations
  2. `GatewayDbContext` 注册
  3. 对应 store abstraction + EFCore store
  4. 双 provider migrations / snapshots
  5. 持久化 round-trip 测试
- 本轮不提前做 route，也不猜 resume 行为，只把后续 `RUN-007 / RUN-008` 必需的数据基础补齐。

## Complexity Assessment
- Atomic steps: 5+（真值对照、schema 建模、entity/config/store、migration、tests、账本同步）→ +2
- Parallel streams: 是（真值/测试对照可并行）→ +2
- Modules/systems/services: 3+（TS persistence truth、.NET persistence layer、integration tests/migrations）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是 Wave 2 runtime 主干的前置数据切片，涉及 schema、store、migrations、tests 与迁移账本，必须持续记账并严格按数据层收口。

## Implementation Plan

### Phase 1: 真值对照与 schema 锁定
- [x] T-01: 对照 TS `permission_requests` / `question_requests` 真值，确认字段、lookup、expires/status 语义 ✅
- [x] T-02: 设计 `.NET` entities/configurations/store abstraction，锁定最小数据闭环 ✅

### Phase 2: Persistence 主线
- [x] T-03: 实现 `.NET` entities/configurations/dbcontext/store ✅
- [x] T-04: 补双 provider migrations / snapshots ✅
- [x] T-05: 补 `.NET` 持久化测试，覆盖 create/read/update/expire/lookup 最小语义 ✅

### Phase 3: 验证与记账
- [x] T-06: 更新总迁移账本与 runtime plan，同步 DATA-012 / DATA-013 状态与验证边界 ✅

## Notes
- 这轮只做 durable layer，不把 route / resume / permission decision 语义提前揉进来。
- 若 TS 真值显示两张表共享大量字段，也优先复用现有 persistence pattern，而不是为了“优雅”引入新的抽象层。
- 已落地的 `.NET` 文件：
  - `src/OpenAWork.Gateway.Persistence.EFCore/Entities/PermissionRequestRecord.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Entities/QuestionRequestRecord.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Configurations/PermissionRequestRecordConfiguration.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Configurations/QuestionRequestRecordConfiguration.cs`
  - `src/OpenAWork.Gateway.Application/Abstractions/Persistence/IPermissionRequestStore.cs`
  - `src/OpenAWork.Gateway.Application/Abstractions/Persistence/IQuestionRequestStore.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Stores/PermissionRequestStore.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/Stores/QuestionRequestStore.cs`
  - `src/OpenAWork.Gateway.Persistence.EFCore/GatewayDbContext.cs`
  - `src/OpenAWork.Gateway.Persistence.Sqlite/Migrations/20260420164000_AddPendingInteractionRequests.cs`
  - `src/OpenAWork.Gateway.Persistence.PostgreSql/Migrations/20260420164000_AddPendingInteractionRequests.cs`
  - `tests/OpenAWork.Gateway.IntegrationTests/PendingInteractionStoreTests.cs`
- 已复刻的关键 durable 语义：
  - `permission_requests`：`request_payload_json`、`always_json`、`expires_at(ms)`、`pending/approved/rejected/consumed`
  - `question_requests`：`user_id`、`questions_json`、`answer_json`、`request_payload_json`、`expires_at(ms)`、`pending/answered/dismissed`
  - pending lookup：permission 走 `session + toolName + scope`；question 走 `session + title`
  - 过期收敛：permission → `rejected + decision=reject`；question → `dismissed + answer_json=null`
  - reply/update 仅允许当前 `pending` 记录继续迁移状态
- 已补的 `.NET` 持久化测试覆盖：
  - create/get/list pending
  - latest pending lookup
  - payload update
  - resolution update
  - expire 收敛
  - permission `consumed`
  - resolved 后 update 返回 false / latest pending 归零
- 已补的 TS 真值验证：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/permissions-routes.request-binding.test.ts src/__tests__/questions-routes.plan-mode.test.ts` ✅
- 已补的只读复核：
  - pending durable layer code review clear pass（无 blocker）
- 验证边界：当前环境仍缺少 `dotnet` 与 `csharp-ls`，因此本轮只能收口到“代码主线完成 + TS 真值测试已重跑 + `.NET` build/test/manual QA 待补证”。
- Memory sync: completed
