# .agentdocs/workflow/260417-net10-settings-第二批只读迁移.md

## Task Overview
- 目标：在已完成的 JWT + `/settings/model-prices` + `/settings/workers` 基础上，继续迁移第二批低风险只读 settings 接口：`/settings/mcp-status`、`/settings/upstream-retry`、`/settings/compaction`、`/settings/file-patterns`。
- 不做：`providers`、`active-selection`、`mcp-servers` 写接口、其它高耦合 settings 或 runtime 路由。

## Current Analysis
- 第二批四个接口都仍然依赖 `user_settings` 单表或纯 helper 默认值，没有 session/runtime/channels/team/workspace 耦合。
- `.NET` 侧已经具备 JWT、当前用户、`user_settings` 读模型、双 provider migration、旧库 baseline 兼容。
- 这批只需要继续扩 Application 查询与 Host 路由组，不需要新增新的核心基础设施。

## Solution Design
- `mcp-status`：读取 `mcp_servers`，按 TS 规则规范化为 `{ id, name, type, status: 'unknown', enabled }[]`。
- `upstream-retry`：读取 `upstream_retry_policy_v1`，对齐默认 `maxRetries=3`。
- `compaction`：读取 `compaction_policy_v1`，对齐默认 `{ auto: true, prune: true, recentMessagesKept: 6 }`。
- `file-patterns`：读取 `file_patterns`，返回字符串数组。

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: 否 → +0
- Modules/systems/services: 3+ → +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 4
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是连续迁移阶段的第二批实现，需要新的 workflow、runtime 状态和验证证据闭环。

## Implementation Plan

### Phase 0 — 路由语义对齐
- [x] T-00: 对齐四个目标接口的 TS 返回形状与默认值 ✅

### Phase 1 — 查询与路由实现
- [x] T-10: 实现 `GET /settings/mcp-status` ✅
- [x] T-11: 实现 `GET /settings/upstream-retry` ✅
- [x] T-12: 实现 `GET /settings/compaction` ✅
- [x] T-13: 实现 `GET /settings/file-patterns` ✅

### Phase 2 — 验证
- [x] T-20: 补 integration tests ✅
- [x] T-21: 执行 build / test / manual QA ✅

## Implementation Outcome
- 已新增 `.NET` 路由：
  - `GET /settings/mcp-status`
  - `GET /settings/upstream-retry`
  - `GET /settings/compaction`
  - `GET /settings/file-patterns`
- 已新增 settings 契约与查询处理器，对齐 TS 默认值与返回形状。
- 已为旧 skeleton SQLite 库补 baseline 自愈逻辑，使本地已有 `request_workflow_logs` 的库可无缝迁移并启动。

## Verification Evidence
- `dotnet build "OpenAWork.Gateway.DotNet.sln"` ✅
- `dotnet test "OpenAWork.Gateway.DotNet.sln"` ✅（3 unit + 1 scenario + 8 integration）
- `lsp_diagnostics services/agent-gateway-dotnet` ✅（0 errors）
- 手动 QA ✅
  - `/settings/mcp-status` → `{"servers":[]}`
  - `/settings/upstream-retry` → `{"maxRetries":3}`
  - `/settings/compaction` → `{"auto":true,"prune":true,"recentMessagesKept":6,"reserved":null}`
  - `/settings/file-patterns` → `{"patterns":[]}`

## Notes
- 下一批优先考虑更靠近 settings 但稍高一档的接口：`active-selection`、`providers`、`mcp-servers` 读写中的只读部分。

## Acceptance Criteria
- 四个路由均要求 JWT bearer。
- `mcp-status` 在无配置时返回空 `servers`，有配置时返回规范化结构。
- `upstream-retry` / `compaction` 在无配置时返回与 TS helper 相同的默认值。
- `file-patterns` 返回字符串数组。
- build / test / lsp / 手动 QA 全部通过。
