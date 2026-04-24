# .agentdocs/workflow/260421-net10-wave2-run-010-task-child-runtime-reconcile迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补 RUN-010 的最小子切片：**task-child runtime reconcile + parent auto-resume**。
- 范围：仅覆盖 child session stale/timeout/final 状态回收、consume `task_parent_auto_resume_contexts`、更新父任务图/父会话 runtime 状态、调度 parent auto-resume 所需的最小 `.NET` runtime/service/test/账本 改动。
- 不做：`restore preview/apply`、`session_snapshots` / `session_file_diffs` / `session_file_backups`、完整 `/sessions/:id/recovery`、完整 RUN-003 children/tasks 路由面。

## Current Analysis
- DATA-014 已把 `task_parent_auto_resume_contexts` durable layer 落地并通过静态复核；现在真正被解锁的不是 full RUN-010，而是更小的 **task-child reconcile + parent auto-resume** 子链路。
- 三路探索给出的共同结论：
  - RUN-003 的 child lineage 读面也被 DATA-014 间接解锁，但它更偏公开路由读面，不如 task-child runtime reconcile 直接消费 DATA-014 的 durable context。
  - full RUN-010 仍被 `session_snapshots / file_diffs / file_backups` 等恢复面挡住，但最小的 child stale/timeout/final reconcile 并不依赖那些数据层。
  - TS 真值集中在：
    - `services/agent-gateway/src/task-parent-auto-resume.ts`
    - `services/agent-gateway/src/tool-sandbox.ts`
    - `services/agent-gateway/src/session-runtime-reconciler.ts`
    - `services/agent-gateway/src/session-runtime-state.ts`
    - `services/agent-gateway/src/routes/stream-runtime.ts`

## Solution Design
- 先做 **runtime reconcile 最小闭环**，不扩恢复面：
  1. 对齐 TS child task stale/timeout/final reconcile 真值
  2. 复用 DATA-014 store，在 child terminal / reset / timeout 时 consume 或 clear auto-resume context
  3. 更新父任务图与父会话 runtime state 的最小读写链路
  4. 在必要分支调度 parent auto-resume
  5. 补 `.NET` integration/scenario tests 与 `.agentdocs` 账本同步
- 这刀的核心不是“更多持久化”，而是 **把 DATA-014 补好的 durable context 接回 runtime 主线**。

## Complexity Assessment
- Atomic steps: 5+（TS 真值对照、.NET runtime 触点对照、service/runtime 改动、tests、账本同步）→ +2
- Parallel streams: 是（TS 真值 / .NET 触点 / parity tests 可并行）→ +2
- Modules/systems/services: 3+（TS runtime truth、.NET runtime/services/tests、.agentdocs）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是一个跨 TS runtime 真值、.NET runtime/service、测试与账本同步的多模块切片，且直接承接 DATA-014，必须显式记录依赖边界与阶段进度，避免误把 full RUN-010 或 RUN-003 混进来。

## Implementation Plan

### Phase 1: 真值与触点锁定
- [x] T-01: 读取 TS 最小 RUN-010 子切片真值，锁定 stale/timeout/final reconcile 与 parent auto-resume 的最小行为 ✅
- [x] T-02: 盘点 `.NET` runtime / state / route / test 触点，确定最小改动集合 ✅

### Phase 2: Runtime reconcile 最小闭环
- [x] T-03: 在 `.NET` 实现 child task runtime reconcile + auto-resume context consume/clear（已新增 `ISessionRuntimeReconciler` / `SessionRuntimeReconciler`，并接上 `SessionStreamRuntimeService`） ✅
- [x] T-04: 补 parent auto-resume 调度/状态更新的最小接线（已通过 reconciler + heartbeat 扫描接上 parent session busy 判定与 background resume） ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` 测试，覆盖 child stale/timeout/final reconcile 与 parent auto-resume 关键场景（已新增 `SessionRuntimeReconcilerTests.cs`，覆盖 success / busy-retry / expired-permission-timeout） ✅
- [x] T-06: 回写总迁移账本、workflow 与 runtime plan，同步 RUN-010 子切片状态与验证边界 ✅

## Notes
- 当前选择的是 **RUN-010 最小子切片**，不是 full RUN-010；`restore preview/apply` 与 snapshot/diff/backups 继续后置。
- 当前选择也不是 RUN-003 `/children` 读面，因为本刀优先消费 DATA-014 新落下的 durable context，并把它接回 runtime 主线；RUN-003 可作为这刀完成后的后备承接。
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，所以真实 `.NET` 编译/动态测试证据如仍无法执行，需要在文档中显式保留验证边界。
- 已锁定的 TS 真值：`session-runtime-reconciler.ts`、`task-parent-auto-resume.ts`、`tool-sandbox.ts`、`stream-runtime.ts`；最小 parity 测试真值：`session-runtime-reconciler.test.ts`、`task-parent-auto-resume.test.ts`、`verify-task-parent-auto-resume.ts`、`verify-task-tool-auto-run.ts`。
- 当前 `.NET` 采取的是 **更小但真实可用** 的 mirror：优先实现 child terminal/stale/expired pending interaction → consume DATA-014 context → auto-resume parent session；不伪装成已经拥有 TS 的 parent task graph / task_update 全套能力。
- 实现后复核状态：
  - 初次 5 路 review-work 暴露了两类真实 blocker：
    1. 过期互动分支没有先停止 active child request；
    2. DATA-014 `ConsumeAsync` 仍是“先查后删”的非原子路径。
  - 第一轮修复后，进一步复核又暴露两条更细的 correctness gap：
    1. timeout 分支需要按真实 registry 的 wait-for-completion 语义修正，避免 child cancelled 收尾提前清空 context；
    2. 仅用秒级 `UpdatedAt` 作为 compare-delete 版本号不足，必须引入独立 `VersionToken`。
  - 当前最终状态：
    - timeout 分支已改成“先写 `terminalReason=timeout`，再 stop active request，由 runtime cancelled 收尾透传 timeout 语义”；
    - DATA-014 已新增内部 `version_token` 唯一索引，`ConsumeAsync` 改为按 `(child_session_id, version_token)` compare-delete；
    - `SessionRuntimeReconcilerTests.cs` 与 `AutoResumeStoreTests.cs` 已补 success / busy-retry / expired-permission-timeout / concurrent consume / same-second retry token rotation 回归；
    - 目标 / QA / 代码质量的最终窄复核均已通过；当前最小 RUN-010 子切片无剩余 blocker；真实 `dotnet` 编译/动态测试证据仍待可运行环境补齐。

Memory sync: completed
