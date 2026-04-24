# .agentdocs/workflow/260419-net10-wave1-agents-控制面迁移.md

## Task Overview
- 目标：在现有 `.NET 10 gateway` Wave 1 控制面基础上，补齐 `/agents` 管理面迁移。
- 范围：只覆盖 `/agents` 的 list/create/update/delete/reset/reset-all，以及与其直接相关的契约、读写存储和集成测试。
- 不做：`/workflows`、desktop sidecar 切换、CI/Docker 收口、Wave 2 session/runtime 内核。

## Current Analysis
- `.agentdocs/workflow/260418-net10-网关功能迁移清单图.md` 仍将 `CTRL-014` 标记为 `⬜ 未开始`，而 `auth/settings/tools/capabilities/usage` 已在当前工作树中基本落地。
- TS 真值位于 `services/agent-gateway/src/routes/agents.ts` 与 `services/agent-gateway/src/agent-catalog.ts`，核心行为不是普通 CRUD，而是：
  - builtin/custom agent 双来源聚合；
  - `user_settings.agent_catalog` 持久化；
  - builtin agent 只允许模型配置更新；
  - `agent_preferences` 作为 legacy fallback 兼容源。
- builtin agent 默认体还依赖 `packages/shared/src/index.ts` 的 `REFERENCE_AGENT_ROLE_METADATA`，以及 `services/agent-gateway/src/reference-frozen/{agent,model}-snapshot.ts` 的冻结快照，不能只靠路由名猜响应。
- `.NET` 侧现有 `user_settings` 读写抽象已存在，可复用，无需新增表；这让 `/agents` 成为当前最合适的单切片迁移点。

## Solution Design
- 在 `.NET` 侧新增独立的 managed agent 应用层服务，复刻 TS 的 catalog 解析、builtin 默认体组装、custom agent CRUD 与 reset 规则。
- 路由保持与 TS 一致：
  - `GET /agents`
  - `POST /agents`
  - `PUT /agents/:agentId`
  - `DELETE /agents/:agentId`
  - `POST /agents/:agentId/reset`
  - `POST /agents/reset-all`
- 存储继续复用 `user_settings`，主键为 `agent_catalog`，并兼容读取 legacy `agent_preferences`。
- builtin agent 默认体直接在 `.NET` 侧显式维护冻结静态表，避免运行时跨语言读取 TS 文件。

## Complexity Assessment
- Atomic steps: 3–4（对照 TS 真值、实现 catalog/service 与路由、补集成测试、更新迁移账本）→ +0
- Parallel streams: 否 → +0
- Modules/systems/services: 3+（TS gateway、.NET application/host、shared reference metadata）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 2
- **Chosen mode**: Lightweight
- **Routing rationale**: 本轮明确收口到单一控制面切片，不引入 runtime/master_plan 编排；保留 workflow 文档即可支撑实现、验证与状态同步。

## Implementation Plan

### Phase 1: 对照与建模
- [x] T-01: 提炼 TS `/agents` 的返回 shape、约束、错误语义与持久化格式 ✅
- [x] T-02: 在 `.NET` 中建立 managed agent contracts / catalog service / builtin snapshot ✅

### Phase 2: 路由与行为落地
- [x] T-03: 实现 `/agents` 六个端点与请求校验、错误映射 ✅
- [x] T-04: 复刻 builtin/custom agent 的 update/reset/remove 规则 ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `Usage/Auth` 风格一致的 integration tests ✅
- [x] T-06: 回写 net10 迁移总账中的 `CTRL-014` 状态、证据与备注 ✅

## Notes
- 已新增 `.NET` `/agents` 路由链路与 integration tests：
  - `src/OpenAWork.Gateway.Contracts/Agents/ManagedAgentResponse.cs`
  - `src/OpenAWork.Gateway.Application/Features/Agents/*`
  - `src/OpenAWork.Gateway.Host/Routes/AgentsRouteGroupExtensions.cs`
  - `tests/OpenAWork.Gateway.IntegrationTests/AgentsEndpointTests.cs`
- 后续又补了两类收口修复：
  - `.NET` `/agents` 对齐 TS 运行时真值：builtin 默认体不再返回 `color`，`agentId` 非法时的 `issues` envelope 改为贴近 TS/Zod 语义。
  - `apps/web/src/pages/AgentsPage.tsx` 的 builtin save 改为只提交 `model / variant / fallbackModels`，避免旧 TS backend 与新 `.NET` backend 都因 builtin 固定字段被提交而返回 400。
- 已补的本地可运行验证：
  - `pnpm --filter @openAwork/web exec vitest run src/pages/AgentsPage.test.tsx` ✅
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/agents-routes.test.ts` ✅
- 已补的 .NET 环境验证入口（待有 `dotnet` 环境时执行）：
  - 一键脚本：`services/agent-gateway-dotnet/scripts/verify-local.sh [RID] [PORT]`
  - 等价命令清单：
    1. `dotnet restore "services/agent-gateway-dotnet/OpenAWork.Gateway.DotNet.sln"`
    2. `dotnet build "services/agent-gateway-dotnet/OpenAWork.Gateway.DotNet.sln" -c Debug --no-restore`
    3. `dotnet test "services/agent-gateway-dotnet/tests/OpenAWork.Gateway.UnitTests/OpenAWork.Gateway.UnitTests.csproj" -c Debug --no-build`
    4. `dotnet test "services/agent-gateway-dotnet/tests/OpenAWork.Gateway.IntegrationTests/OpenAWork.Gateway.IntegrationTests.csproj" -c Debug --no-build`
    5. `dotnet test "services/agent-gateway-dotnet/tests/OpenAWork.Gateway.ScenarioVerification/OpenAWork.Gateway.ScenarioVerification.csproj" -c Debug --no-build`
    6. `services/agent-gateway-dotnet/scripts/smoke-sidecar.sh linux-x64 5060`
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，尚未补上真实 .NET build/test 证据；因此本切片应视为“代码与跨栈兼容已收口、.NET 运行时验证待补齐”，不能直接宣称 `CTRL-014` 已完成。
- Memory sync: completed
