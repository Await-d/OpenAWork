# .agentdocs/workflow/260422-net10-wave2-run-002-sessions-search迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补 RUN-002 的最小代码切片：**`/sessions/search` 读闭环**。
- 范围：仅覆盖 `GET /sessions/search`、`q + limit` 查询参数、最小搜索读模型、结果排序/limit、`.NET` 集成测试与 `.agentdocs` 账本同步。
- 不做：durable FTS / snippet / bm25 完整复刻、legacy `session_messages` hydrate、children/tasks/todos/import/truncate、shared session 搜索。

## Current Analysis
- RUN-005 当前只剩环境级 `.NET` build/test/manual QA 证据缺口，不再是下一张代码切片。
- RUN-008 剩余面已经踩进 `PROD-005 / shared session` 前置，不再独立。
- RUN-002 当前在总账里还是 `⬜ 未开始`，但前置依赖已经齐：
  - `RUN-001` 的 sessions CRUD 已落地
  - `DATA-003 / DATA-004` 的 `message_v2 / part_v2` 权威消息层已落地
- TS 真值的 `/sessions/search` 很薄，只接收 `q + limit`，返回固定 `results[]` shape；这使它适合作为下一张最小代码闭环。

## Solution Design
- 先做 **最小 `/sessions/search` 闭环**：
  1. 在 `.NET` 新增 `GET /sessions/search`
  2. 只接受 `q` 与 `limit`
  3. 基于现有 `sessions + message_v2 + part_v2` 做只读搜索投影
  4. 最小支持 `text` 与 `modified_files_summary` 文本抽取
  5. 返回 web-client 已固定的 `results[]` shape
  6. 先以“匹配后按时间倒序”实现排序，不扩张到完整 durable FTS/index parity

## Complexity Assessment
- Atomic steps: 5+（TS 真值核对、route/query/contracts、搜索读模型、tests、账本同步）→ +2
- Parallel streams: 是（TS 真值 / .NET 路由与读模型 / tests 可并行）→ +2
- Modules/systems/services: 3+（TS sessions route、.NET Host/Application/Persistence、IntegrationTests + .agentdocs）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: RUN-002 横跨 TS route truth、`.NET` sessions route、搜索读模型、测试与账本同步；虽然范围小，但仍是多模块切片，需要单独 workflow + runtime 跟踪。

## Implementation Plan

### Phase 1: 真值与路由边界锁定
- [x] T-01: 读取 TS `/sessions/search` route、contract 与 tests，锁定 query/response 最小语义 ✅
- [x] T-02: 盘点 `.NET` sessions 路由与 `message_v2 / part_v2` 可复用读模型，确定最小改动集合 ✅

### Phase 2: `/sessions/search` 最小闭环
- [x] T-03: 新增 `.NET` route/query/contract，暴露 `GET /sessions/search` ✅
- [x] T-04: 实现最小搜索读模型与结果排序/limit（当前按 `message_v2 + part_v2` 聚合、匹配后按 `createdAtMs DESC` 返回） ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` 集成测试，覆盖 auth、输入校验、命中 text / modified_files_summary、limit 与用户隔离（已新增 `SessionsSearchTests.cs`；正式复核的 goal / QA / code quality / security / context mining 全 PASS） ✅
- [x] T-06: 更新总迁移账本与 workflow/runtime plan，同步 RUN-002 状态与验证边界 ✅

## Notes
- 当前切片明确不追求 full FTS parity；若实现中发现 durable index / snippet / bm25 是强前置，应及时在文档中收窄，不顺手扩张。
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，真实 `.NET` build/test/manual QA 证据如仍无法执行，需要在文档中显式保留验证边界。
- 当前最小 `.NET` 实现策略已经锁定：不复刻 TS 的 `session_messages_fts` / `bm25` / `snippet(...)` 表层，而是直接基于现有 `sessions + message_v2 + part_v2` 做读模型搜索；如果后续需要 durable FTS parity，再作为 RUN-002 的下一子切片继续收口。
- 当前 slice 的最终结论：最小 `/sessions/search` 读闭环已完成，当前结果只应被表述为“RUN-002 的最小搜索子切片已完成”，不能等同于整个 RUN-002 全量完成。

Memory sync: completed
