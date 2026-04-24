# .agentdocs/workflow/260421-net10-wave2-data-014-task-parent-auto-resume-contexts迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `DATA-014`：`task_parent_auto_resume_contexts` durable layer。
- 范围：仅覆盖 schema / EF Core entity / configuration / DbContext 注册 / store 接口与实现 / 双 provider migrations / 最小 `.NET` 集成测试 / `.agentdocs` 账本同步。
- 不做：child session route、parent auto-resume 调度执行链、RUN-010 reconcile、workspace permanent-rule materialization。

## Current Analysis
- `.NET` 当前的 `RUN-007 / RUN-009` 已在 standalone-session scope 达到 acceptance：公开命令子集、permissions resume 与 minimal tool-result continuation bridge 已收口。
- 账本与架构记忆都明确：后续真实 blocker 不再是继续扩 `/commands` 公开面，而是 **task-child lineage / parent-child auto-resume** 缺 durable model；这正对应 `DATA-014`。
- TS 真值已经存在：
  - `services/agent-gateway/src/db.ts`：`task_parent_auto_resume_contexts` 表
  - `services/agent-gateway/src/task-parent-auto-resume.ts`：`upsert / consume / clear / schedule`
- 总账已把 `PR-20 / DATA-014` 的最小 `.NET` 落点写成：`Entities/TaskParentAutoResumeContextRecord.cs` + `store` + `IntegrationTests/AutoResumeStoreTests.cs`。

## Solution Design
- 先做 **durable persistence slice**，不混入 route/runtime 行为：
  1. 对齐 TS 表结构与主键/外键/清理语义
  2. 在 `.NET` 落 `record + configuration + DbContext`
  3. 提供最小 store：`upsert / consume / clear`
  4. 生成 SQLite / PostgreSQL 双 provider migration
  5. 补最小 store integration tests，验证落库、单次消费、清理与 user/session 作用域
- 当前切片只交付“数据层前置闭环”，把真正的 parent auto-resume 调度与 child reconciliation 继续留给后续 `RUN-010`。

## Complexity Assessment
- Atomic steps: 5+（TS 真值对照、.NET persistence pattern 对照、entity/store/migration、tests、账本同步）→ +2
- Parallel streams: 是（TS 真值 / .NET persistence 模式 / 账本更新可并行）→ +2
- Modules/systems/services: 3+（TS db/store truth、.NET Persistence/Application、integration tests + .agentdocs）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `DATA-014` 横跨 TS schema 真值、.NET durable persistence、双 provider migration、集成测试与账本同步，且是后续 task-child auto-resume / reconcile 的硬前置，不适合在无 workflow 的情况下直接散改。

## Implementation Plan

### Phase 1: 真值与持久化模式锁定
- [x] T-01: 读取 TS `task_parent_auto_resume_contexts` schema/store 真值，锁定字段、主键/外键与 consume/clear 语义 ✅
- [x] T-02: 盘点 `.NET` 现有 persistence pattern，确认可直接镜像的 entity/store/test 模板（当前采用 `QuestionRequest*` 的 typed info/store 风格 + `SessionRuntimeThread*` 的单主键 upsert/clear 风格） ✅

### Phase 2: DATA-014 durable layer
- [x] T-03: 实现 `.NET` entity/configuration/DbContext/store 接口与实现（已新增 `TaskParentAutoResumeContextRecord` / configuration / store / interface，并完成 provider 注册） ✅
- [x] T-04: 生成 SQLite / PostgreSQL 双 provider migrations（已补 `20260421093000_AddTaskParentAutoResumeContexts` + 双 provider `ModelSnapshot`） ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` store/integration tests，覆盖 upsert/consume/clear 与单次消费语义（已新增 `AutoResumeStoreTests.cs`；真实执行证据仍受当前环境缺少 `dotnet` 限制） ✅
- [x] T-06: 回写总迁移账本、workflow 与 runtime plan，同步 DATA-014 状态与验证边界 ✅

## Notes
- 本轮目标是把 `DATA-014` 从“账本中的硬前置”落到真实 durable model，不提前混入 `RUN-003` child session route 或 `RUN-010` runtime reconcile。
- 如果实现过程中发现 `.NET` 侧缺少可复用的 store pattern，优先镜像 `permission_requests / question_requests` 那一层最小持久化切片，而不是自创抽象。
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，所以 `.NET` 编译/测试证据如仍无法执行，需要在文档中显式保留验证边界。
- 已确认的 TS 真值约束：
  - schema：`child_session_id` 为主键，外键指向 `sessions/users`，`request_data_json` 为必填 JSON 文本
  - store：仅需 `upsert / consume(delete-on-read) / clear`
  - 回归要求：`requestData` round-trip 不能丢 `agentId`、`upstreamRetryMaxRetries` 等字段
- 当前 `.NET` 已新增的最小落点：
  - `Application/Abstractions/Persistence/ITaskParentAutoResumeContextStore.cs`
  - `Persistence.EFCore/Entities/TaskParentAutoResumeContextRecord.cs`
  - `Persistence.EFCore/Configurations/TaskParentAutoResumeContextRecordConfiguration.cs`
  - `Persistence.EFCore/Stores/TaskParentAutoResumeContextStore.cs`
  - `tests/OpenAWork.Gateway.IntegrationTests/AutoResumeStoreTests.cs`
  - SQLite / PostgreSQL 双 provider `AddTaskParentAutoResumeContexts` migrations + `ModelSnapshot`
- 实现后复核状态：
  - 5 路 review-work 中，目标核验 / 安全 / 上下文 / 代码质量均通过；QA 初次静态复核仅指出 `AutoResumeStoreTests.cs` 未显式证明 wrong-parent consume miss 与 wrong-user clear 的非破坏性。
  - 已补强 `AutoResumeStoreTests.cs`：wrong-parent miss 后正确 parent 仍可 consume；wrong-user clear 后正确 user 仍可 consume；correct-user clear 后 consume 返回 null。
  - 补强后的窄复核（目标 / QA / 代码质量）均通过，当前切片无剩余 blocker；动态 `.NET` 执行证据仍待可运行环境补齐。

Memory sync: completed
