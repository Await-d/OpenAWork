# .agentdocs/workflow/260420-net10-wave2-permissions-pause-resume迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `RUN-007`：permissions pause / reply / resume 主线。
- 范围：仅覆盖 permission request create / reply、过期冲突、session ownership / auth、run event 发布、session state 更新，以及 approved / reject 的最小恢复链。
- 不做：questions reply/resume、commands execute、general recovery/reconcile、额外 permission 管理面。

## Current Analysis
- `DATA-012 / DATA-013` durable layer 已落地，`permission_requests` / `question_requests` 已可作为 pending interaction 真相源。
- 迁移总账中 `RUN-007` 明确依赖 `DATA-012` 与 `RUN-004`，说明这张切片必须把 permission pause/reply/resume 接回 runtime 主线。
- 当前 `.NET` 已具备：
  - sessions ownership / auth 基础
  - WS stream runtime / stop / attach / active / stop-active
  - `session_run_events` durable write + broadcaster
  - `permission_requests` durable store
- 当前缺口大概率集中在：
  - Host permissions routes
  - Application resume helper / pending request materialization
  - 过期检查、publish permission replied event、session state 更新
  - `.NET` integration tests 对齐 TS truth

## Solution Design
- 严格按 TS 真值复刻最小主线：
  1. create permission request
  2. reply permission request
  3. pending expiry conflict
  4. publish permission replied event
  5. update persisted session state
  6. approved / reject 的最小 resume hook
- 第一版不引入 questions、commands execute 或 general recovery 复用抽象；优先在已有 stream/session/persistence 模式里做最小正确接线。

## Complexity Assessment
- Atomic steps: 5+（TS 真值对照、.NET 落点设计、route/runtime 实现、tests、账本同步）→ +2
- Parallel streams: 是（TS 真值 / 测试真值 / .NET 落点可并行）→ +2
- Modules/systems/services: 3+（TS permissions routes、.NET Host/Application/Streaming、integration tests）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `RUN-007` 横跨 permissions route、durable pending requests、run event 与 session state 更新，是一张完整 runtime 切片，必须边实现边同步 `.agentdocs` 与总迁移账本。

## Implementation Plan

### Phase 1: 真值对照与边界锁定
- [x] T-01: 对照 TS permissions pause/reply/resume 真值，锁定端点、请求/响应 shape、状态迁移与恢复语义 ✅
- [x] T-02: 盘点 `.NET` Host/Application/Streaming/Persistence 的现有落点，确认最小改动面 ✅

### Phase 2: RUN-007 主线
- [x] T-03: 实现 `.NET` permissions create/reply 与过期冲突主线 ✅
- [x] T-04: 实现 run event 发布、session state 更新与 approved/reject 最小恢复链 ✅
- [x] T-05: 补 `.NET` 集成测试，覆盖 create/reply/expired/event/state/resume 最小场景 ✅

### Phase 3: 验证与记账
- [x] T-06: 更新总迁移账本与 runtime plan，同步 RUN-007 状态与验证边界 ✅

## Notes
- 本轮优先复用既有 `session_run_events`、`permission_requests`、session state helper 与 WS runtime，而不是引入新的 orchestration service。
- 若 TS 真值显示 reject 有 continue-on-deny 分支，则第一版也必须决定是否纳入；不能静默忽略。
- 已落地的 `.NET` 文件：
  - `services/agent-gateway-dotnet/src/OpenAWork.Gateway.Host/Routes/PermissionsRouteGroupExtensions.cs`
  - `services/agent-gateway-dotnet/src/OpenAWork.Gateway.Host/Program.cs`
  - `services/agent-gateway-dotnet/tests/OpenAWork.Gateway.IntegrationTests/PermissionsEndpointTests.cs`
- 已复刻的关键语义：
  - `GET /sessions/{id}/permissions/pending`
  - `POST /sessions/{id}/permissions/requests`
  - `POST /sessions/{id}/permissions/reply`
  - create 时落 pending request、发布 `permission_asked`、并把 session 置为 `paused`
  - reply 时支持 expired `409`、reject cascade、`permission_replied` 事件发布、session 状态更新
  - approved / continue-on-deny 走最小 runtime continuation：基于 `request_payload_json` 解析 `toolCallId/rawInput/nextRound/requestData`，先生成 authoritative `tool_result`，再继续接入现有 `ISessionStreamRuntimeService.HandleAsync`
- 已补的 `.NET` 集成测试覆盖：
  - create + list pending + `permission_asked`
  - expired reply → `409 Permission request expired`
  - approve reply → background resume → `text_delta/done`
  - reject cascade
  - continue-on-deny
  - 401 / 404 / 400 护栏
- 已补的 TS 真值验证：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/permissions-routes.request-binding.test.ts src/__tests__/session-runtime-reconciler.test.ts src/__tests__/session-runtime-state.test.ts src/__tests__/session-permission-events.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec tsx src/verification/verify-permissions-routes.ts` ✅
- 当前明确边界：
  - RUN-007 已在 standalone-session scope 完成收口；task child session 的父任务收敛继续留给 `DATA-014 / RUN-010` 等后续切片。
- owner-session `decision=permanent` 的最小 materialization 已在后续子切片完成并并入 RUN-007 closeout；本工作流本身仍不额外声明 full workspace permission enforcement parity。
- 当前 review 结论（更新）：
  - route 契约、decision log、state transition、null omission、400 issues arrays 均已收口。
  - 后续补齐 `RUN-009` 的最小 continuation bridge 后，standalone-session 路径已不再 plain-rerun 原请求，而是会先产生 authoritative `tool_result`，再继续 runtime completion。
  - blocker 级复核最终结论：**在 standalone-session scope 内，RUN-007 已完成收口**；剩余未覆盖面集中在 task child reconciliation 与完整 workspace persistent-permission enforcement，这些继续留给后续切片。
- 当前补充证据：
  - permissions reply 现在会从 `request_payload_json` 解析 `toolCallId/rawInput/nextRound/requestData`
- approve 路径会生成 hardened 的最小 `bash` 执行结果：已补齐固定 `/bin/bash` + 命令安全约束检查（当前为黑名单约束而非独立 allowlist）、基于 `WORKSPACE_ROOTS + WORKSPACE_ROOT` 的配置根与 session-root 回退的 workdir 校验、symlink 拒绝、输出截断与 generic error text；reject 路径会生成 error `tool_result`
  - runtime 会先持久化 `tool` part 的 `metadata.toolResultContent`、发 `tool_result` run event，再继续 completion
  - `PermissionsEndpointTests.cs` 已补对 approve / continue-on-deny 两条路径的 `tool_result` 断言
- 当前 blocker-level 结论：standalone-session 路径已经从 plain rerun 升级为 `tool_result` 驱动的 continuation，owner-session `decision=permanent` materialization、session metadata multiroot 与 approved-bash multiroot workdir 也已完成对齐；最终 review/work 的 goal / code quality / security / QA / context mining 全 PASS。
- 验证边界：当前环境仍缺少 `dotnet` 与 `csharp-ls`，因此本轮收口证据为“代码主线完成 + TS 真值测试/verification 已重跑 + 最终 review/work clear pass + `.NET` build/test/manual QA 待补证”。
- Memory sync: completed
