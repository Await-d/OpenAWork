# .agentdocs/workflow/260420-net10-wave2-commands-execute迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补齐 `RUN-009`：commands execute 主线。
- 范围：仅覆盖 command catalog / execute route、rawInput / command args、流式 run event 输出、与 session runtime/permission resume 的最小接线，以及对应 `.NET` 集成测试与账本同步。
- 不做：questions 路由、general recovery/reconcile、workspace read/write 全面实现、外部集成面。

## Current Analysis
- `RUN-007` 最新 review 已明确：permissions route 契约本身已基本收口，但真正的 approve/reject resume 仍缺少 TS 级别的 tool-round continuation；根因是 `.NET` 还没有 `RUN-009` 的 commands execute substrate。
- 迁移总账中 `RUN-009` 本就是独立切片，目标是 command catalog、execution、stream output 对齐；这和当前 blocker 完全一致。
- 当前 `.NET` 已具备：
  - WS stream runtime / attach / stop / stop-active
  - `permission_requests` / `permission_decision_logs`
  - `session_run_events` durable write + broadcaster
  - `message_v2` / `part_v2` 权威消息层
- 当前缺口预计集中在：
  - commands route / request parsing
  - command execute → tool_result / run event / session state 接线
  - permission resume 与 command execute 的真实续跑接口
  - `.NET` integration tests 对齐 TS truth

## Solution Design
- 严格按 TS 真值收口最小闭环：
  1. command execute route / input schema
  2. command catalog / label/rawInput 解析
  3. execute 后的 stream run events / tool_result 写入
  4. 与 `RUN-007` 的 approved/reject resume 接口对接
  5. `.NET` 集成测试覆盖 execute / stream output / error path
- 第一版优先做 **能解锁 RUN-007 standalone permission resume** 的最小 commands execute 能力，不提前扩展到完整恢复/重放/外部集成。

## Complexity Assessment
- Atomic steps: 5+（TS 真值对照、.NET 落点设计、route/runtime 实现、tests、账本同步）→ +2
- Parallel streams: 是（TS 真值 / 测试真值 / .NET 落点可并行）→ +2
- Modules/systems/services: 3+（TS commands route、.NET Host/Application/Streaming、integration tests）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `RUN-009` 是当前唯一能真正解锁 `RUN-007` acceptance 的 runtime substrate，横跨 commands route、execution、stream output 与测试，需要完整 workflow/runtime/ledger 伴随推进。

## Implementation Plan

### Phase 1: 真值对照与边界锁定
- [x] T-01: 对照 TS commands execute 真值，锁定端点、请求/响应 shape、tool_result / run event 输出与错误语义 ✅
- [x] T-02: 盘点 `.NET` Host/Application/Streaming/Persistence 的现有落点，确认能最小解锁 RUN-007 的改动面 ✅

### Phase 2: RUN-009 主线
- [x] T-03: 实现 `.NET` commands execute 路由与最小执行链（当前已落 `GET /commands` + `POST /sessions/{id}/commands/execute` 最小 HTTP 子集，且 execute 只接受与 `/commands` 相同的公开子集，含 `slash-compact` / `slash-summarize` / `slash-handoff`） ✅
- [x] T-04: 将 execute 结果接到 stream runtime / message_v2 / session_run_events，并为 RUN-007 提供真实 resume substrate（当前通过 `InitialToolResult` + `tool_result` 事件把 standalone-session permissions resume 接回 runtime） ✅
- [x] T-05: 补 `.NET` 集成测试，覆盖 execute、error path 与 permissions resume 接线（当前已补 list/guards/compact/handoff、hidden command、invalid bash command/workdir、permissions resume 主线；`.NET` 真实运行验证仍待可执行环境补证） ✅

### Phase 3: 验证与记账
- [x] T-06: 更新总迁移账本与 runtime plan，同步 RUN-009 状态与验证边界 ✅

## Notes
- 本轮明确目标不是“做完整工具系统”，而是先把 commands execute 补到足以解除 RUN-007 的真 blocker。
- 若 TS 真值显示 commands execute 同时牵扯 task/tool child session，那本轮只吸收 standalone session 必需部分，其余记到后续切片。
- 当前已落地的最小子集：
  - `services/agent-gateway-dotnet/src/OpenAWork.Gateway.Host/Routes/CommandsRouteGroupExtensions.cs`
  - `services/agent-gateway-dotnet/src/OpenAWork.Gateway.Host/Program.cs`
  - `services/agent-gateway-dotnet/tests/OpenAWork.Gateway.IntegrationTests/CommandsEndpointTests.cs`
- 当前最小子集能力：
  - `GET /commands` 列表（仅暴露当前已实现的 server commands，并保留 client descriptors）
  - `POST /sessions/{id}/commands/execute`
  - `slash-compact` / `slash-summarize`：返回 compaction events/card，并写回 `lastCompaction*` metadata
  - `slash-handoff`：支持 warning/info 两条基本分支，且明确保持 text-only/minimal
  - execute 仅接受与 `/commands` 相同的公开 server subset；隐藏的未实现 server commands 统一返回 `Unsupported command`
- 当前 lightweight review 结论：最小 RUN-009 subset 在当前范围内已通过 blocker 级复核（route/auth/input semantics、compact 落库、handoff 分支无 blocker）。
- 当前新增的 continuation bridge：
  - `PermissionsRouteGroupExtensions` 已不再把 approve/reject resume 当成普通 message 重跑，而是会：
    1. 从 `request_payload_json` 解析 `toolCallId/rawInput/nextRound/requestData`
    2. approve 时通过 hardened bash bridge 执行最小允许命令（含固定 `/bin/bash` + 命令安全约束检查、基于 `WORKSPACE_ROOTS + WORKSPACE_ROOT` 的配置根与 session-root 回退的 workdir 校验、symlink 拒绝、输出截断与 generic error text），reject 时合成 error tool_result
    3. 把初始 `tool_result` 通过 `SessionStreamRuntimeRequest.InitialToolResult` 送入 runtime
    4. 在 `SessionStreamRuntimeService` 中先持久化 `tool` part + `toolResultContent`、发布 `tool_result` run event，再继续 completion
  - 当前这层 bridge 已通过 blocker 级轻量复核（standalone-session scope）。
- 当前仍待后续切片补齐的范围：
  - RUN-009 的完整 tool ecosystem 与 task child reconciliation 仍待后续切片；RUN-007 的 standalone-session continuation 与 owner-session `decision=permanent` materialization 已完成收口。
- `decision=permanent` 的 owner-session 最小 materialization 已在后续切片补齐；本工作流仍只负责 commands execute 最小 substrate，不覆盖 workspace permission enforcement 本体。
- 验证边界：当前环境缺少 `dotnet` 与 `csharp-ls`，因此 `.NET` build/test/manual QA 仍待后续可运行环境补证。
