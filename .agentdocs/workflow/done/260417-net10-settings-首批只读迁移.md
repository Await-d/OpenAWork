# .agentdocs/workflow/260417-net10-settings-首批只读迁移.md

## Task Overview
- 目标：在现有 `.NET 10 gateway skeleton` 基础上继续推进第一批低风险迁移，只做最小 JWT 鉴权基础，以及 `/settings/model-prices`、`/settings/workers` 两个只读接口。
- 不做：`providers`、`capabilities`、`permissions`、`questions`、`workspace`、`team`、stream runtime 迁移。

## Current Analysis
- `services/agent-gateway-dotnet/` 已完成 Host / Application / Domain / Infrastructure / Persistence 骨架、双 provider migrations、树结构 workflow log、sidecar publish/smoke。
- 当前 .NET Host 只有 `/health`、`/stream/sse`、`/stream/ws`；还没有 JWT、当前用户上下文、`user_settings` 读模型。
- TS `settings.ts` 中 `GET /settings/model-prices` 是最简单的鉴权后只读常量接口；`GET /settings/workers` 是最简单的单表读取接口。

## Solution Design
- 先补最小 JWT bearer 验证，不实现完整 login/refresh/logout。
- 增加 `ICurrentUser` 与 `IUserSettingsReader`，让 Application 层可以在不直接依赖 HttpContext / EF 的前提下读取用户 settings。
- 只新增 `user_settings` 持久化模型，不把 `users` / `refresh_tokens` / 完整 auth 流程带进这一批。
- 路由只新增：
  - `GET /settings/model-prices`
  - `GET /settings/workers`

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: 否 → +0
- Modules/systems/services: 3+ → +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 4
- **Chosen mode**: Full orchestration
- **Routing rationale**: 虽然切片小，但已经进入正式开发阶段，需要新的 workflow、runtime 状态板和验收证据闭环。

## Implementation Plan

### Phase 0 — 基础约束
- [x] T-00: 补最小 JWT bearer 鉴权骨架与当前用户访问器 ✅
- [x] T-01: 增加 `user_settings` 读模型与仓储抽象 ✅

### Phase 1 — 首批路由
- [x] T-10: 迁移 `GET /settings/model-prices` ✅
- [x] T-11: 迁移 `GET /settings/workers` ✅

### Phase 2 — 验证
- [x] T-20: 为两个 settings 路由补集成/场景验证 ✅
- [x] T-21: 执行 build / test / 手动 QA（真实 JWT + curl） ✅

## Implementation Outcome
- 已落地最小 JWT bearer 验证与 `RequireAuthorization()` 路由保护。
- 已落地 `users` / `user_settings` 读模型、仓储与双 provider 迁移。
- 已新增 `.NET` 路由：
  - `GET /settings/model-prices`
  - `GET /settings/workers`
- 已补旧 skeleton 本地 SQLite 库的 migration baseline 兼容，避免已有 `request_workflow_logs` 旧库阻塞启动。

## Verification Evidence
- `dotnet build "OpenAWork.Gateway.DotNet.sln"` ✅
- `dotnet test "OpenAWork.Gateway.DotNet.sln"` ✅（3 unit + 1 scenario + 4 integration）
- `lsp_diagnostics services/agent-gateway-dotnet` ✅（0 errors）
- 手动 QA ✅
  - 未带 token 访问 `/settings/model-prices` 返回 `401 Unauthorized`
  - 带 token 访问 `/settings/model-prices` 返回内置价格列表
  - 带 token 访问 `/settings/workers` 在无数据时返回 `{"workers":[]}`
  - 本地旧 skeleton SQLite 库可被 baseline 并继续应用新 migration 后正常启动

## Acceptance Criteria
- 受保护的 `.NET` settings 路由要求 JWT bearer，通过后可返回数据。
- `/settings/model-prices` 返回与 TS 路由等价的模型价格清单。
- `/settings/workers` 能按 `sub` 读取 `user_settings(workers)`，无值时返回空数组。
- build / test / lsp / 手动 QA 全部通过。

## Notes
- 这是首批低风险切片；完成后再考虑 `mcp-status`、`upstream-retry`、`compaction`、`file-patterns`。
