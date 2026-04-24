# .agentdocs/workflow/260420-net10-wave2-stop-active迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `PR-25 / RUN-006`：`/sessions/:id/stream/stop-active` 的 stop-any-active-request 控制面。
- 范围：仅覆盖 active request 查询、stop-active route、session ownership / auth、等待 in-flight 清理完成后的返回语义，以及对应的 `.NET` 集成测试与迁移账本同步。
- 不做：`/stream/active`、`/stream/attach`、permissions/questions/commands execute/recovery。

## Current Analysis
- 迁移总账已把 `RUN-006` 收窄为 **仅 stop-active**；`active` 已在 `RUN-005` 落地。
- TS 真值预计集中在：
  - `services/agent-gateway/src/routes/stream-routes-plugin.ts` 的 `POST /sessions/:id/stream/stop-active`
  - `services/agent-gateway/src/routes/stream-cancellation.ts`
  - 相邻 `stream` tests / verification 对 stop 语义的约束
- `.NET` 当前已有：
  - `ISessionStreamRequestRegistry.GetAnyForSession()`
  - `ISessionStreamRequestRegistry.StopAsync()`
  - `RUN-004` 的 `/sessions/{id}/stream/stop`
  - `RUN-005` 的 `/sessions/{id}/stream/active`
- 当前缺口应主要在 Host route 与“按 session 停止当前 active request”的 registry 接口整合，而不是数据层。

## Solution Design
- 保持最小改动：
  1. 复用现有 query bearer auth / session ownership 检查模式；
  2. 在 registry 层复用 `GetAnyForSession()` 找到当前 active request；
  3. 通过已有 `StopAsync()` 触发取消，并保持与现有 `/stream/stop` 一致的“等待收尾完成后再返回”语义；
  4. route 返回最小 shape：`{ stopped: boolean }`。
- 第一版不新增额外持久化和复杂服务抽象；如果现有 registry 能直接承接，就不引入新 application service。

## Complexity Assessment
- Atomic steps: 5+（真值对照、route 设计、registry 复用、tests、账本同步）→ +2
- Parallel streams: 是（TS 真值/测试对照可并行）→ +2
- Modules/systems/services: 3+（TS stream truth、.NET Host/Streaming、integration tests）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `RUN-006` 是 Wave 2 stream 控制面的紧邻切片，虽然功能小，但仍需严格对齐 stop 语义、补测试并持续同步 `.agentdocs` 与总迁移账本。

## Implementation Plan

### Phase 1: 真值对照与边界收紧
- [x] T-01: 对照 TS `stop-active` 真值与测试，确认返回 shape、等待收尾语义与 ownership/auth 边界 ✅
- [x] T-02: 盘点 `.NET` 现有 registry / stream routes 可复用点，锁定最小改动面 ✅

### Phase 2: RUN-006 主线
- [x] T-03: 实现 `.NET` `/sessions/{id}/stream/stop-active` ✅
- [x] T-04: 补 `.NET` 集成测试，覆盖 active request stop、无 active 返回 false、auth / ownership 边界 ✅

### Phase 3: 验证与记账
- [x] T-05: 更新总迁移账本与 runtime plan，同步 RUN-006 状态与验证边界 ✅

## Final Review Status
- 第一轮正式收口复核暴露的唯一 blocker：`ISessionStreamRequestRegistry.RegisterOrGetConflict()` 不是 session 级原子注册，导致同一 session 可能出现多个 active request，进而让 `stop-active` 只能 best-effort。
- 已完成的修复：
  - `InMemorySessionStreamRequestRegistry` 改为按 session 加锁，保证 `check + register/remove` 原子化；
  - `SessionStreamRuntimeService.HandleAsync()` 把 persisted replay 路径移入 `try/finally`，确保 replay 成功返回时也会 `requestRegistry.Complete(...)` 释放 slot；
  - 新增 `SessionStreamRequestRegistryTests.RegisterOrGetConflict_ShouldAllowOnlyOneActiveRequestPerSession` 与 `SessionStreamRuntimeTests.WebSocketStream_ShouldReleaseRegistryAfterReplayBeforeNextRequest` 两条回归测试。
- 最新结论：RUN-006 的真值终检与 .NET 终检均通过，当前最小 stop-active 切片无剩余 blocker；真实 `dotnet` build/test/manual QA 证据仍待可运行环境补齐。

Memory sync: completed

## Notes
- 本轮优先复用 `ISessionStreamRequestRegistry`，避免为单一 stop-active 再造一层服务。
- 若 TS 真值显示 stop-active 只是 stop 当前 active request，而不是 stop 所有 request，则 `.NET` 也必须保持单请求语义。
- 已落地的 `.NET` 文件：
  - `services/agent-gateway-dotnet/src/OpenAWork.Gateway.Application/Abstractions/Streaming/ISessionStreamRequestRegistry.cs`
  - `services/agent-gateway-dotnet/src/OpenAWork.Gateway.Infrastructure/Streaming/InMemorySessionStreamRequestRegistry.cs`
  - `services/agent-gateway-dotnet/src/OpenAWork.Gateway.Host/Routes/SessionStreamRouteGroupExtensions.cs`
  - `services/agent-gateway-dotnet/tests/OpenAWork.Gateway.IntegrationTests/SessionStreamRuntimeTests.cs`
- 已复刻的关键语义：
  - `POST /sessions/{id}/stream/stop-active`
  - 已认证且拥有该 session 的用户才能 stop-active
  - session 不存在或非 owner => `404 { error: "Session not found" }`
  - 有活动请求 => `200 { stopped: true }`
  - 无活动请求 => `200 { stopped: false }`
  - 返回前等待 in-flight request 收尾完成，因此 stop-active 返回后可以立即发起新请求
  - stop / stop-active 的等待逻辑现已统一收口到 registry：通过 `StopAsync()` / `StopAnyAsync()` 等待 completion，但忽略底层取消/失败状态，和 TS 的 `.catch(() => undefined)` 对齐
- 已补的 `.NET` 集成测试覆盖：
  - active request stop
  - no-active 返回 false
  - 返回后立即 rerun
  - unauthorized / non-owner 边界
- 已补的 TS 真值验证：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/stream-stop-route.test.ts src/__tests__/stream-cancellation.test.ts` ✅
- 已补的只读复核：
  - RUN-006 follow-up code review clear pass（路由语义、接口一致性、测试覆盖均无 blocker）
- 验证边界：当前环境仍缺少 `dotnet` 与 `csharp-ls`，所以本轮仍只能收口到“代码主线完成 + TS 真值测试已重跑 + `.NET` build/test/manual QA 待补证”。
