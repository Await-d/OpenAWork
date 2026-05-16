# Phase B 实施方案：Session 状态机 + Handoff 协议 + 五层骨架

## Task Overview

基于 Phase A 已完成的基础（constitution + SOUL + 7 层注入栈），实施 Phase B：把 session 升级为"工作对象"，建立 b/c/d/e-g 五层之间的结构化派发管道。**这是双思想第一次合体的 Phase**。

**前置依赖**：Phase A ✅ 已完成（constitution_md / agent_personas / 7 层注入栈 / memory 安全扫描 / ForceApply）

**关联文档**：
- `docs/team-architecture-spec-kit-borrowing-discussion.md` v3.11 §6.2
- `docs/team-interaction-flow-v3.11.md`
- `docs/team-page-layout-draft.md`

## Complexity Assessment

- Atomic steps: 15 → +2
- Parallel streams: 5（DB/handoff模块/scheduler/watcher/前端）→ +2
- Modules/systems: 4（gateway, web, packages, DB）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: +6
- **Chosen mode**: Full orchestration
- **Routing rationale**: Phase B 是"五层骨架成型"的核心 Phase，涉及 5 条并行工作流 + 15 个原子任务

## Current Analysis

### Phase B 精确范围（v3.11 锁定）

**做**：
1. DB：`sessions` 表扩展 `parent_session_id` / `handoff_state` / `role_layer` / `intent_state` / `last_heartbeat` 字段
2. DB：新建 `handoff_records` 表（完整 schema 见 team-interaction-flow-v3.11.md §8）
3. 后端：`services/agent-gateway/src/handoff/` 模块（createHandoff / claimHandoff / completeHandoff / cancelHandoff）
4. 后端：Watcher 守护进程（gateway 内嵌，100ms 轮询 pending handoff）
5. 后端：`BackgroundTaskScheduler` 接口 + `InProcessScheduler` MVP 实现（D40 9 个方法）
6. 后端：崩溃恢复逻辑（D51 心跳 + 超时 + 自动重试 1 次）
7. 后端：`/team-events` 独立 WS 通道（D4 子决策 3=B）
8. 后端：五层 session 创建 API（`/sessions?role_layer=reception` 等）
9. 后端：把现有 `interaction-agent rewrite` 重构为 b→c handoff
10. 后端：把现有 `team-leader dispatch` 重构为 d→e/f/g 多路 handoff
11. 前端：TeamStatusBar（顶部固定运行状态栏）
12. 前端：Session 树可视化（右侧面板任务 Tab）
13. 前端：/team-events WS 订阅 + TeamEventDispatcher + Zustand store 拆分
14. 前端：暂停/恢复/取消 UI（PauseConfirmDialog / ResumeStaleDialog）
15. 前端：底部抽屉层级对话查看器（LayerConversationDrawer + Tab 切换）

**不做**（Phase C 范围）：
- 完整 workflow 模板（c/d 暂时硬编码 prompt）
- dispatch_package 标准结构（先用裸文本试跑）
- spec/plan/tasks 产物链
- architecture review check 点

### Phase A 偏差对 Phase B 的影响

| Phase A 偏差 | Phase B 影响 |
|---|---|
| ensureColumn 替代 Drizzle migration | Phase B 继续用 ensureColumn 加字段 |
| team_force_apply_events 额外表 | 无影响 |
| teamWorkspaceId={null} | Phase B 需要解决：实现 workspace switcher 或改用 workspace path |

### 依赖分析（DAG）

```
Stream 1 (数据层)：
  T-01 sessions 表扩展 → T-02 handoff_records 表

Stream 2 (Handoff 模块)：
  T-01 + T-02 完成后 → T-03 handoff CRUD 模块
  T-03 完成后 → T-04 Watcher 守护进程
  T-03 完成后 → T-05 BackgroundTaskScheduler + InProcessScheduler
  T-04 完成后 → T-06 崩溃恢复逻辑

Stream 3 (API + 重构)：
  T-03 完成后 → T-07 /team-events WS 通道
  T-03 完成后 → T-08 五层 session 创建 API
  T-08 完成后 → T-09 重构 interaction-agent rewrite → b→c handoff
  T-08 完成后 → T-10 重构 team-leader dispatch → d→e/f/g handoff

Stream 4 (前端状态层)：
  T-07 完成后 → T-11 /team-events WS 订阅 + TeamEventDispatcher + store 拆分

Stream 5 (前端 UI)：
  T-11 完成后 → T-12 TeamStatusBar
  T-11 完成后 → T-13 Session 树可视化
  T-11 完成后 → T-14 暂停/恢复/取消 UI
  T-11 完成后 → T-15 底部抽屉层级对话查看器
```

## Solution Design

### 技术方案

1. **Session 扩展**：用 Phase A 验证过的 `ensureColumn` 机制加字段
2. **handoff_records**：新建表，schema 完全按 v3.11 文档定义
3. **Handoff 模块**：新建 `services/agent-gateway/src/handoff/` 目录，含 `index.ts`（CRUD）+ `watcher.ts`（轮询）+ `scheduler.ts`（BackgroundTaskScheduler）
4. **Watcher**：gateway 启动时 `setInterval(100ms)` 轮询 pending handoff，claim + 创建子 session + 注入 payload
5. **InProcessScheduler**：实现 D40 的 9 个方法（schedule/getStatus/cancel/listActive/subscribe + pause/resume/pauseAll/resumeAll）
6. **崩溃恢复**：每个 running session 每 30s 写 `last_heartbeat`，watcher 检测 60s 超时 → 自动重试 1 次
7. **/team-events WS**：新建独立 WS 路由，统一信封格式 `{ type, taskId, layer, timestamp, payload }`
8. **重构**：把现有 `interaction-agent rewrite` 和 `team-leader dispatch` 的逻辑迁移到 handoff 协议
9. **前端**：TeamEventDispatcher 订阅 /team-events WS → 按 event.type 分发到 useTaskStore / useLayerStore / useNotificationStore

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| 重构 interaction-agent/team-leader 可能破坏现有功能 | 先实现新 handoff 路径，再逐步切换（feature flag） |
| Watcher 100ms 轮询对 SQLite 压力 | 监控查询耗时，必要时降频到 500ms |
| 前端 15 个新组件 bundle size | 按需加载（React.lazy）+ 只在 /team 路由加载 |
| teamWorkspaceId={null} 遗留问题 | T-08 中解决：五层 session 创建时绑定 workspace path |

## Implementation Plan

### Phase 1: 数据层（Stream 1）
- [x] T-01: sessions 表扩展（parent_session_id / handoff_state / role_layer / intent_state / last_heartbeat）
- [x] T-02: 新建 handoff_records 表（完整 schema + 索引）

### Phase 2: Handoff 核心模块（Stream 2，依赖 Phase 1）
- [x] T-03: `src/handoff/index.ts` — createHandoff / claimHandoff / completeHandoff / cancelHandoff CRUD
- [x] T-04: `src/handoff/watcher.ts` — Watcher 守护进程（100ms 轮询 + claim + 创建子 session）
- [x] T-05: `src/handoff/scheduler.ts` — BackgroundTaskScheduler 接口 + InProcessScheduler（9 个方法）
- [x] T-06: `src/handoff/recovery.ts` — 崩溃恢复（heartbeat 写入 + 超时检测 + 自动重试）

### Phase 3: API + 重构（Stream 3，依赖 Phase 2）
- [x] T-07: `/team-events` 独立 WS 路由 + 统一信封事件格式
- [x] T-08: 五层 session 创建 API（`POST /sessions` 扩展 role_layer / parent_session_id）
- [x] T-09: 重构 `interaction-agent rewrite` → b→c handoff（feature flag 切换）
- [x] T-10: 重构 `team-leader dispatch` → d→e/f/g 多路 handoff（feature flag 切换）

### Phase 4: 前端状态层（Stream 4，依赖 T-07）
- [x] T-11: /team-events WS 订阅 + TeamEventDispatcher + useTaskStore / useLayerStore / useNotificationStore

### Phase 5: 前端 UI（Stream 5，依赖 T-11）
- [x] T-12: TeamStatusBar（顶部固定：进度条 + 层级指示 + 一键暂停）
- [x] T-13: Session 树可视化（右侧面板任务 Tab 内嵌）
- [x] T-14: 暂停/恢复/取消 UI（PauseConfirmDialog + ResumeStaleDialog + 按钮）
- [x] T-15: 底部抽屉层级对话查看器（LayerConversationDrawer + LayerTabBar + Tab 切换）

## Parallel Execution Plan

**Wave 1（无依赖，立即）**：
- T-01 + T-02（数据层）

**Wave 2（依赖 Wave 1）**：
- T-03（handoff CRUD）

**Wave 3（依赖 Wave 2，可并行）**：
- T-04（Watcher）+ T-05（Scheduler）+ T-07（WS 通道）+ T-08（session API）

**Wave 4（依赖 Wave 3）**：
- T-06（崩溃恢复，依赖 T-04）
- T-09 + T-10（重构，依赖 T-08）
- T-11（前端状态层，依赖 T-07）

**Wave 5（依赖 Wave 4 T-11）**：
- T-12 + T-13 + T-14 + T-15（前端 UI，全部并行）

## 验收标准

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过（新增测试覆盖 T-03/T-04/T-05/T-06）
- [ ] 五层 session 树能正确生成（b→c→d→e/f/g parent_session_id 链）
- [ ] handoff 状态机正确流转（pending → claimed → running → completed/failed/cancelled）
- [ ] Watcher 能自动 claim pending handoff 并创建子 session
- [ ] 崩溃恢复：kill gateway 后重启，卡住的 session 被自动重试
- [ ] /team-events WS 能推送实时事件到前端
- [ ] 前端 TeamStatusBar 显示正确的任务进度
- [ ] 前端 Session 树正确渲染五层结构
- [ ] 暂停/恢复/取消功能端到端可用
- [ ] 现有功能（createThread / dispatch）通过 feature flag 无缝切换到新 handoff 路径

## Notes

- 估时：4-6 周（Phase B 是最复杂的 Phase，涉及核心编排逻辑）
- T-09/T-10（重构）是最高风险任务——必须用 feature flag 保护，确保可回滚
- T-11（前端状态层）是前端所有 UI 的前置——必须先完成 store 拆分
- Phase A 的 teamWorkspaceId={null} 问题在 T-08 中解决


---

## 实施记录（Wave 1 完成于 2026-05-15）

### Wave 1 范围

按"安全基础层先落地、高风险重构后做"的策略，本次只交付 5 个任务（T-01/02/03/05/07）。**未触动**任何现有 interaction-agent / team-leader / stream 流程，纯加法变更，可单独合入。

### 文件落点

**数据层（T-01/02）**：
- `services/agent-gateway/src/db.ts` — `migrate()` 末尾追加：
  - sessions 5 个新列：`team_parent_session_id` / `role_layer` / `handoff_state` / `intent_state` / `last_heartbeat`
  - 3 个 partial index（按 team_parent / handoff_state / role_layer）
  - 新建 `handoff_records` 表 + 4 个索引
- 命名说明：用 `team_parent_session_id` 而不是方案里写的 `parent_session_id`，因为 `sessions.parent_id` 已经被 V2 message-tree 占用（`message-v2-projectors.ts`、`tool-sandbox.ts`），两者语义不同必须区分。

**Handoff 核心（T-03/05）**：
- `services/agent-gateway/src/handoff/handoff-store.ts` — 状态机 CRUD：
  - `createHandoff` / `getHandoff` / `listPendingHandoffs` / `listHandoffsBySession`
  - `claimHandoff`（抢占式）/ `startHandoff` / `completeHandoff` / `failHandoff`（claimToken 校验）
  - `cancelHandoff`（用户主动）/ `reclaimAbandonedHandoffs`（崩溃恢复，待 T-06 调用）
- `services/agent-gateway/src/handoff/scheduler.ts` — `BackgroundTaskScheduler` 接口 + `InProcessScheduler` 实现：
  - 9 个 D40 方法（schedule / cancel / pause / resume / pauseAll / resumeAll / listActive / getStatus / subscribe）
  - 协作式 pause（abort signal）+ 全局 pauseAll 标志
  - 进程级单例 + `__resetBackgroundTaskSchedulerForTesting`

**事件总线 + WS（T-07）**：
- `services/agent-gateway/src/handoff/team-events-bus.ts` — in-process 发布订阅：
  - 信封：`{ type, taskId?, sessionId?, layer?, timestamp, payload, userId }`
  - 11 种 TeamEventType（handoff.* / session.heartbeat / scheduler.*）
  - 便利函数 `publishHandoffEvent` 把 HandoffRecord 转成标准信封
- `services/agent-gateway/src/routes/team-events.ts` — `GET /team-events` WS：
  - JWT 鉴权、按 userId 过滤、ping/pong 心跳
- `services/agent-gateway/src/routes/team-handoffs.ts` — 只读 REST + cancel：
  - `GET /team/handoffs/:handoffId`
  - `GET /team/sessions/:sessionId/handoffs`
  - `POST /team/handoffs/:handoffId/cancel`（**唯一的写端点**，让用户能在 UI 中止 handoff）

**注册入口**：
- `services/agent-gateway/src/index.ts` — `app.register(teamEventsRoutes)` + `app.register(teamHandoffsRoutes)`

### 测试

- `services/agent-gateway/src/__tests__/handoff-store.test.ts` — 14 条用例，覆盖 6 种过渡 + 并发互斥 + 跨用户隔离 + 崩溃恢复（含超过 maxRetry 自动 fail）
- `services/agent-gateway/src/__tests__/handoff-scheduler.test.ts` — 11 条用例，覆盖 9 个方法 + pauseAll/resumeAll 联动 + 监听器异常隔离
- `services/agent-gateway/src/__tests__/team-events-bus.test.ts` — 3 条用例，覆盖发布/订阅/异常隔离
- `services/agent-gateway/src/__tests__/team-handoffs-routes.test.ts` — 6 条用例，覆盖 GET/cancel + 跨用户 404 + 终止态 409

合计 **34 条新增测试**，全部通过。

### 验证结果

- `pnpm --filter @openAwork/agent-gateway typecheck`：✅
- `pnpm --filter @openAwork/agent-gateway lint`：✅ 0 errors
- `pnpm --filter @openAwork/agent-gateway test:unit`：✅ **842 / 842**（Phase A 808 + Phase B 34）
- 全仓 `pnpm typecheck`：apps/web 中 `use-artifacts-workspace.ts` 缺少 `fetchJson` 导入（**用户当前未提交的本地修改，与 Phase B 无关**）

### Wave 1 设计取舍

1. **`team_parent_session_id` 而非 `parent_session_id`**：避免与 V2 message-tree 父子语义冲突。本次没有动现有 `parent_id` 的任何使用点，零回归风险。
2. **lazy-create 表已统一回 `migrate()`**：Phase A 的 `team_force_apply_events` 之前是懒创建，复查时已挪进 migrate；Phase B 的 `handoff_records` 直接进 migrate 不重蹈覆辙。
3. **只读 REST + cancel 写入**：cancel 是从 UI 中止派发的最小必需写入端点；create/claim/complete 等过程性写入要等 T-09/T-10 重构 interaction-agent / team-leader 时才暴露给业务流。这样 Wave 1 是"零行为变化"的纯能力增量。
4. **事件总线 in-process 单例**：multi-gateway 场景的 Redis 扇出留到 Phase C；当前单 gateway 进程的浏览器多 tab 通过 userId 过滤已经够用。

### Wave 2 切入条件（待你下一次决定）

| 任务 | 估时 | 风险 | 前置 |
|---|---|---|---|
| T-04 Watcher（100ms 轮询 → claim → 创建子 session） | 1-2 天 | 中（涉及 setInterval 守护，要做 graceful shutdown） | T-03/05 已就位 |
| T-08 五层 session 创建 API（`POST /sessions` 扩 role_layer/parent_session_id） | 1 天 | 中（影响现有 `POST /sessions` 行为） | T-01 已就位 |
| T-06 崩溃恢复（heartbeat 写入 + 超时检测） | 1 天 | 中（需要在 stream-runtime 心跳点接入） | T-04 |
| T-09/T-10 重构 interaction-agent / team-leader → handoff（feature flag） | 3-5 天 | **高**（plan 明确点名最高风险） | T-04/T-08 |

建议下一波先做 T-04 + T-08（让 handoff 真正能"派发出"子 session），再单独一波做 T-06（崩溃恢复），最后单独一波带 feature flag 做 T-09/T-10。前端 5 个 UI 等后端 happy path 闭环再开做更稳。
