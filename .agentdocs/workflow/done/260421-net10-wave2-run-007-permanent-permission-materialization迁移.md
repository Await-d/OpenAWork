# .agentdocs/workflow/260421-net10-wave2-run-007-permanent-permission-materialization迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补 RUN-007 的最小子切片：**owner-session `decision=permanent` materialization**。
- 范围：仅覆盖 owner-session permission reply 中 `decision=permanent` 的最小持久化规则落地、后续判断接线、最小测试与账本同步。
- 不做：task-child permission lineage、shared session permanent reply、workspace rule UI、permission category 大改。

## Current Analysis
- 现有 owner-session permissions pause/reply/resume 最小闭环已经 accepted，但 `.NET` 仍把 `decision=permanent` 直接返回 unsupported。
- TS 真值已明确：`routes/permissions.ts` 在 `decision === 'permanent'` 时会调用 `persistWorkspacePermanentPermission(...)`，其持久化逻辑在 `workspace-safety.ts`，本质是按 workspace root 写入持久 permission config。
- 三路优先级探索一致认为：这比继续扩 RUN-009 命令面或回头做更大的 RUN-003 写侧更小、更直接补 parity。

## Solution Design
- 先做 **owner-session permanent permission 最小闭环**：
  1. 对齐 TS `persistWorkspacePermanentPermission(...)` 的最小数据形状与写盘语义
  2. 在 `.NET` owner-session permission reply 路由里支持 `decision=permanent`
  3. 复用现有 workspace root / session metadata 事实层，写入最小持久规则
  4. 补 `.NET` 集成测试与 `.agentdocs` 账本同步
- 这刀的核心不是重做整套 workspace permission framework，而是 **把当前唯一 still-open 的 RUN-007 parity gap 收掉**。

## Complexity Assessment
- Atomic steps: 5+（TS 真值、.NET 权限路由/持久化触点、写盘 helper、测试、账本同步）→ +2
- Parallel streams: 是（TS 真值 / .NET 触点 / parity tests 可并行）→ +2
- Modules/systems/services: 3+（TS route + workspace-safety、.NET route/persistence/tests、.agentdocs）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 虽然是一个很窄的 parity 缺口，但它同时触及 TS workspace-safety 真值、`.NET` 权限路由、最小持久规则落地和测试/账本同步，必须明确追踪边界与完成定义。

## Implementation Plan

### Phase 1: 真值与触点锁定
- [x] T-01: 读取 TS permanent permission 真值，锁定 workspace root 解析、规则写盘与 owner-session 语义 ✅
- [x] T-02: 盘点 `.NET` 权限路由 / session metadata / 持久化触点，确定最小改动集合 ✅

### Phase 2: Permanent materialization 最小闭环
- [x] T-03: 在 `.NET` owner-session permission reply 中实现 `decision=permanent`（已从 400 unsupported 改为 owner-session permanent approve 主线） ✅
- [x] T-04: 接上最小持久规则写入与后续命中判断（已写 `.openawork.permissions.json`，对齐 `permanentGrants + rules` 最小结构；当前范围仍只保证 materialization，不伪装 `.NET` 已接入 TS tool-sandbox 的命中判断） ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` 测试，覆盖 permanent 成功落地、规则文件写入、workspaceRoot 记录与 owner-session resume ✅
- [x] T-06: 回写总迁移账本、workflow 与 runtime plan，同步 RUN-007 子切片状态与验证边界 ✅

## Notes
- 当前选择的是 **RUN-007 最小 permanent materialization 子切片**，不是 full RUN-007 重做；approve/reject + owner-session resume 主线已 accepted，不再重做。
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，所以真实 `.NET` 编译/动态测试证据如仍无法执行，需要在文档中显式保留验证边界。
- 当前已落地的 `.NET` 触点：
  - `Host/Routes/PermissionsRouteGroupExtensions.cs`：owner-session `decision=permanent` 已从 400 unsupported 改为真实落地 `.openawork.permissions.json`
  - `Host/Routes/PermissionsRouteWorkspacePermissionConfigWriter.cs`：新增 workspace permission config writer，负责 multiroot 解析、原子写入与文件回滚
  - `tests/OpenAWork.Gateway.IntegrationTests/PermissionsEndpointTests.cs`：新增 permanent 成功写盘 + `workspaceRoot` 记录 + owner-session resume + complete failure rollback + multiroot 第二根目录恢复成功回归
- 当前切片边界：
  - 已对齐 TS `persistWorkspacePermanentPermission(...)` 的最小写盘语义（含 `always_json -> rules/permanentGrants`）
  - 尚未声称 `.NET` 已具备 TS `tool-sandbox` 那条 workspace persistent permission 命中短路，这一块仍留给后续更大的权限/runtime 切片

- 最终收口结论：
  - `PermissionsRouteGroupExtensions.cs` 已通过 helper 抽离降到 1500 行以下，并补齐 `CompletePermanentMaterializationAsync` 失败时的文件/DB 双回滚。
  - session metadata、workspace root 解析与 approved-bash workdir 已统一对齐到 `WORKSPACE_ROOTS + WORKSPACE_ROOT` 的多根目录语义。
  - 最终 review/work 的 goal / code quality / security / QA / context mining 全 PASS；当前仅剩 `.NET` build/test/manual QA 证据待可运行环境补齐。

Memory sync: completed
