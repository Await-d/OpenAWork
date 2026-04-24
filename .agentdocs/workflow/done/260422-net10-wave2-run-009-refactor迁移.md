# .agentdocs/workflow/260422-net10-wave2-run-009-refactor迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补 RUN-009 的下一最小代码切片：**`/refactor` server command**。
- 范围：仅覆盖 `/commands` 公开 `slash-refactor`、`/sessions/{id}/commands/execute` 执行 `refactor`、最小 task/card/metadata 回写、`.NET` 集成测试与 `.agentdocs` 账本同步。
- 不做：`/start-work`、Ralph/ULW loops、worktree orchestration、LSP 真正重构执行、task-child auto-resume。

## Current Analysis
- RUN-005 当前只剩环境级 `.NET` build/test/manual QA 证据缺口；RUN-002 最小搜索子切片已完成。
- RUN-008 的剩余面已经踩进 `PROD-005 / shared session` 前置，不再独立。
- RUN-009 当前虽已有 `compact/handoff/init-deep`，但 `/refactor` 仍是描述符存在、`.NET` 未公开/未执行的明确代码缺口。
- 背景盘点结论：`/refactor` 比 `/start-work` 更小、更独立，也不被 `PROD-005/shared-session` 或 `DATA-014` 前置阻塞。

## Solution Design
- 先做 **`/refactor` 最小闭环**：
  1. 对齐 TS `slash-refactor` 的 descriptor / execute 真值
  2. 在 `.NET` `/commands` 中公开该 server command
  3. 在 `.NET` execute 路由内接上最小 refactor card / task / metadata 逻辑
  4. 补 `.NET` 集成测试与账本同步
- 这刀的核心不是“做真正代码重构”，而是 **把 `/refactor` 从隐藏未实现状态提升为最小可执行 server command**。

## Complexity Assessment
- Atomic steps: 5+（TS 真值、descriptor/execute 接线、task/card/metadata、tests、账本同步）→ +2
- Parallel streams: 是（TS 真值 / .NET 接线 / tests 可并行）→ +2
- Modules/systems/services: 3+（TS commands、.NET Host/Application/Tests、.agentdocs）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `/refactor` 是独立 server-command 子切片，涉及 TS 真值、`.NET` commands route、任务/卡片回写、测试与账本同步，需要单独 workflow + runtime 跟踪。

## Implementation Plan

### Phase 1: 真值与接线点锁定
- [x] T-01: 读取 TS `/refactor` descriptor / execute 真值，锁定最小输入输出与 metadata 语义 ✅
- [x] T-02: 盘点 `.NET` commands execute 现有接线点，确定 `/refactor` 最小改动集合 ✅

### Phase 2: `/refactor` 最小闭环
- [x] T-03: 在 `.NET` `/commands` 公开 `slash-refactor` 并接入 execute 分发 ✅
- [x] T-04: 实现最小 task/card/metadata 回写（当前返回 `task_update`、写入 `refactorStartedAt/refactorStrategy/refactorScope/refactorTarget/refactorTaskId`，不扩到真实 LSP 重构执行） ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` 集成测试，覆盖 list 可见、execute 正向、最小输入校验与隐藏命令边界（已补 `CommandsEndpointTests` 与 `ToolsAndCapabilitiesEndpointTests`，最终 follow-up 的 goal / QA / code quality / security / context mining 全 PASS） ✅
- [x] T-06: 更新总迁移账本与 workflow/runtime plan，同步 RUN-009 子切片状态与验证边界 ✅

## Notes
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，真实 `.NET` build/test/manual QA 证据如仍无法执行，需要在文档中显式保留验证边界。
- 本轮明确不触碰 `/start-work`、Ralph/ULW loops；若实现中发现依赖这些能力，应立即收窄范围而不是顺手扩张。
- 当前最小 `.NET` 实现策略已经锁定：`/refactor` 只做 descriptor 暴露、execute 分发、`task_update` 事件与 session metadata/card 回写，不宣称已具备真实 LSP 重构执行能力。
- 第一轮正式复核指出唯一 blocker：`.NET` `rawInput` 解析不支持完整 `/refactor ...`、引号 positional 参数与 `--key=value`。当前已补 slash-command 风格 tokenizer/arg extraction，并把正向回归升级成真实客户端输入格式。
- 第二轮 follow-up QA/context 又补出一个全局发现面 blocker：`/capabilities` 仍暴露了 `slash-start-work` 与 loop family。当前已把 capabilities command catalog 收敛到和 `/commands` 一致的已实现公开子集，并补了 `/refactor` 可见、`/start-work` 不可见的能力目录回归。
- 最终复核结论：goal / QA / code quality / security / context mining 全 PASS；当前子切片已完成，剩余仍待后续切片补齐的是 `/start-work`、loop family 与更完整 command ecosystem，而不是 `/refactor` 本身。

Memory sync: completed
