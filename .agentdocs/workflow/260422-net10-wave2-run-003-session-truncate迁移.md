# .agentdocs/workflow/260422-net10-wave2-run-003-session-truncate迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补 RUN-003 的下一最小代码切片：**`POST /sessions/{id}/messages/truncate`**。
- 范围：仅覆盖 owner-session truncate 路由、最小 request/response contract、基于现有 `message_v2 / part_v2` 的截断行为、`.NET` 集成测试与 `.agentdocs` 账本同步。
- 不做：shared-session truncate、todos 读写、task cancel、messages import、child-session orchestration。

## Current Analysis
- 原先候选 `/sessions/{id}/todos` 看似只是读路由，但盘点后发现 `.NET` 侧完全没有 `session_todos` durable layer，因此它会把 entity/config/migration 一起拖进来，不再是最小卡。
- TS 真值里 `/sessions/{id}/messages/truncate` 本身很薄：owner 校验 + 输入校验 + 现有消息层 truncate helper + `{ messages }` 返回。
- `.NET` 已经有 `message_v2 / part_v2` 权威消息层、owner-session 路由主线与 `GET /sessions/{id}` 的消息投影，因此 truncate 比 todos 更小、更独立。

## Solution Design
- 先做 **`/sessions/{id}/messages/truncate` 最小闭环**：
  1. 对齐 TS truncate route 的最小 body 语义：`messageId`、`inclusive`、`messageText`
  2. 在 `.NET` 新增 route/query/contract
  3. 基于现有 `message_v2 / part_v2` 做只写不扩张的 truncate 行为
  4. 复用现有 session transcript 投影，返回 `{ messages }`
  5. 补 `.NET` 集成测试与账本同步

## Complexity Assessment
- Atomic steps: 5+（TS 真值、route/body contract、truncate helper/读回投影、tests、账本同步）→ +2
- Parallel streams: 是（TS 真值 / .NET 路由与 helper / tests 可并行）→ +2
- Modules/systems/services: 3+（TS sessions route、.NET Host/Application/Persistence、IntegrationTests + .agentdocs）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: truncate 虽是窄写面，但仍横跨 TS 真值、`.NET` route/body contract、消息层读写、测试与账本同步，需要单独 workflow + runtime 跟踪。

## Implementation Plan

### Phase 1: 真值与落点锁定
- [x] T-01: 读取 TS `/sessions/{id}/messages/truncate` route / contract 真值，锁定 body 与返回语义 ✅
- [x] T-02: 盘点 `.NET` message_v2 / part_v2 可复用读写路径，确定 truncate 最小改动集合 ✅

### Phase 2: `/sessions/{id}/messages/truncate` 最小闭环
- [x] T-03: 新增 `.NET` route/query/contract，暴露 `POST /sessions/{id}/messages/truncate` ✅
- [x] T-04: 实现 owner-session truncate 行为与返回消息投影（当前按 `messageId` 命中，必要时以 `messageText` 精确回退到 user/text message） ✅

### Phase 3: 验证与记账
- [ ] T-05: 补 `.NET` 集成测试，覆盖 auth、owner 校验、invalid input、inclusive 开关与结果投影（已新增 `SessionsTruncateTests.cs`，覆盖 401/400/404、inclusive 与 `messageText` fallback；待正式复核与环境边界记账）
- [ ] T-06: 更新总迁移账本与 workflow/runtime plan，同步 RUN-003 子切片状态与验证边界

## Notes
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，真实 `.NET` build/test/manual QA 证据如仍无法执行，需要在文档中显式保留验证边界。
- 本轮明确不触碰 shared-session truncate / import / todos / cancel；若实现中发现依赖这些能力，应立即收窄范围而不是顺手扩张。
- 当前最小 `.NET` 实现策略已经锁定：不复刻 legacy `messages_json` 截断，而是直接基于现有 `message_v2 / part_v2` 做删除与消息投影；若后续发现需要 legacy hydrate parity，再作为 RUN-003 的下一子切片继续收口。
