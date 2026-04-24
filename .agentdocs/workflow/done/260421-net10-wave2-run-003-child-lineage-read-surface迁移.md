# .agentdocs/workflow/260421-net10-wave2-run-003-child-lineage-read-surface迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补 RUN-003 的最小子切片：**child lineage / children-tasks 读面**。
- 范围：仅覆盖 `/sessions` 相关读模型中与 child session / parent-child lineage / children-tasks 摘要暴露相关的最小 `.NET` route/query/read-model/test/账本 改动。
- 不做：child session 创建/调度写面、完整 todos/import/truncate、完整 task graph 写回、完整 RUN-003 全量控制面。

## Current Analysis
- 现在已经有两个关键前置：
  - `DATA-014`：`task_parent_auto_resume_contexts` durable layer 已落地，并用 `version_token` 封住并发误删 race。
  - 最小 `RUN-010`：child terminal/stale/expired pending interaction → auto-resume parent session 的 runtime 主线已落地。
- 下一刀最自然的不是继续扩恢复面，而是把这些 parent-child / child session 结果**暴露到 `/sessions` 读面**，让 `.NET` 具备最小 child lineage 可见性。
- 这一刀必须刻意收窄，只做读面：避免把完整 child write-side orchestration、todos/import/truncate 与 full task graph 一起卷进来。

## Solution Design
- 先做 **read-side 最小闭环**，不碰 child 写面：
  1. 对齐 TS `/sessions` 中 child lineage / children-tasks 的最小 response 形状
  2. 复用现有 session metadata + DATA-014 / RUN-010 已落地的 parent-child 语义
  3. 在 `.NET` `/sessions` 读模型中补 children/task 摘要暴露
  4. 补 `.NET` integration tests 与 `.agentdocs` 账本同步
- 这刀的核心不是“创建 child session”，而是 **把已经存在的 child lineage/runtime 结果稳定读出来**。

## Complexity Assessment
- Atomic steps: 5+（TS 真值、.NET 触点、读模型改动、测试、账本同步）→ +2
- Parallel streams: 是（TS 真值 / .NET 触点 / parity tests 可并行）→ +2
- Modules/systems/services: 3+（TS route truth、.NET route/query/read-model/tests、.agentdocs）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 虽然是读面子切片，但它横跨 TS route 真值、`.NET` session read-model、测试与账本同步，而且需要在 RUN-003 总项里精确切出最小可交付范围，不适合直接散改。

## Implementation Plan

### Phase 1: 真值与触点锁定
- [x] T-01: 读取 TS 最小 RUN-003 child lineage / children-tasks 真值，锁定 response 形状与 helper 语义 ✅
- [x] T-02: 盘点 `.NET` route/query/read-model/test 触点，确定最小改动集合 ✅

### Phase 2: Read-side 最小闭环
- [x] T-03: 在 `.NET` `/sessions` 读模型中补 child lineage / children-tasks 最小暴露（已新增 `GetSessionChildrenQuery` / `GetSessionTasksQuery` 与对应 route/contracts） ✅
- [x] T-04: 复用现有 metadata/runtime 结果，补最小 parent-child 摘要映射（当前通过 session metadata + DATA-014 context + latest assistant summary 派生 child task summary） ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` 测试，覆盖 child lineage / children-tasks 关键读面场景（已新增 `/children` lineage 读面与 `/tasks` child-summary/error-state 回归） ✅
- [x] T-06: 回写总迁移账本、workflow 与 runtime plan，同步 RUN-003 子切片状态与验证边界 ✅

## Notes
- 当前选择的是 **RUN-003 最小读面子切片**，不是 full RUN-003；todos/import/truncate 与 child write-side orchestration 继续后置。
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，所以真实 `.NET` 编译/动态测试证据如仍无法执行，需要在文档中显式保留验证边界。
- 已锁定的 TS 最小真值：`routes/sessions.ts`（`/sessions/:id/children` + `/sessions/:id/tasks`）、`session-task-projection.ts`、`session-route-helpers.ts`；当前只跟 `/children` 与 `/tasks` 两个读面，不扩到 `/recovery`。
- 当前 `.NET` 采取的是 **更小但真实可用** 的 mirror：children 走 descendant session public shape，tasks 走 child-session 派生 task summary；由于尚无 TS 那套 task graph store，这刀不伪装完整 AgentTaskGraph，而是复用 session metadata + DATA-014 context + latest assistant summary 暴露最小字段集。
- 当前已落地的 `.NET` 触点：
  - `Contracts/Sessions/SessionResponses.cs`：新增 `SessionChildResponse`、`SessionChildrenResponse`、`SessionTaskResponse`、`SessionTasksResponse`
  - `Features/Sessions/SessionRequests.cs`：新增 `GetSessionChildrenQuery` / `GetSessionTasksQuery` 与 child lineage/task summary 读模型 helper
  - `Host/Routes/SessionsRouteGroupExtensions.cs`：新增 `GET /sessions/{sessionId}/children` 与 `GET /sessions/{sessionId}/tasks`
  - `tests/OpenAWork.Gateway.IntegrationTests/SessionsEndpointTests.cs`：新增 children lineage / tasks summary / idle assistant error→failed 回归
- 实现后复核状态：
  - 初次 review-work 暴露的唯一 blocker 是 `SessionRequests.cs` 中 `selectedChildren` 的非法 lambda 语法，导致编译级失败。
  - 修复后以目标 / QA / 代码质量三条窄复核收束，当前最小 RUN-003 读面子切片无剩余 blocker。
  - 真实 `dotnet` 编译/动态测试证据仍待可运行环境补齐。

Memory sync: completed
