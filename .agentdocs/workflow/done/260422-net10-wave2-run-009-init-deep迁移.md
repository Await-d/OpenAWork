# .agentdocs/workflow/260422-net10-wave2-run-009-init-deep迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补 RUN-009 的下一最小子切片：**`/init-deep` server command**。
- 范围：仅覆盖 `/commands` 公开 `slash-init-deep`、`/sessions/{id}/commands/execute` 执行 `init_deep`、现有 Instructions 文件汇总注入、最小 card / metadata 回写、`.NET` 集成测试与账本同步。
- 不做：`/start-work`、`/refactor`、Ralph/ULW loops、task-child auto-resume、完整 command ecosystem 扩展。

## Current Analysis
- RUN-007 已完成，当前继续推进 Wave 2 时，RUN-005 的最小剩余面主要是 `.NET` scenario verification / build-test / manual QA 证据，而非新代码能力。
- RUN-009 当前最小 commands execute 子集已完成：`.NET` 已提供 `GET /commands`、`POST /sessions/{id}/commands/execute`、`slash-compact` / `slash-summarize` / `slash-handoff` 与 standalone-session continuation bridge。
- 当前最适合继续推进的，是从 hidden server commands 中挑一个**最孤立、最少 runtime 前置**的命令落地；Metis 裁决建议选择 `/init-deep`，因为它比 `/start-work`、`/refactor`、loop family 更容易在 1 次迭代内闭环。

## Solution Design
- 先做 **`/init-deep` 最小闭环**：
  1. 对齐 TS `slash-init-deep` 的最小 descriptor / execute 语义
  2. 在 `.NET` `/commands` 中公开该 server command
  3. 在 `.NET` execute 路由内接上最小 Instructions 汇总注入逻辑，不扩到 loop/runtime
  4. 回写最小 command card / metadata
  5. 补 `.NET` 集成测试与 `.agentdocs` 账本同步
- 这刀的核心不是“补全所有 commands”，而是 **在现有 commands execute substrate 上再完成一个独立 server command 子切片**。

## Complexity Assessment
- Atomic steps: 5+（TS 真值、.NET 路由/服务接线、文件写入逻辑、测试、账本同步）→ +2
- Parallel streams: 是（TS 真值 / .NET 接线 / 测试可并行）→ +2
- Modules/systems/services: 3+（TS commands truth、.NET Host/Application/Tests、.agentdocs）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `/init-deep` 虽然是单个 command，但仍横跨 TS 真值、`.NET` 命令路由、Instructions 汇总逻辑、测试与账本同步；为了避免与上一轮 RUN-009 最小子集混账，需要单独 workflow + runtime 追踪。

## Implementation Plan

### Phase 1: 真值与接线点锁定
- [x] T-01: 读取 TS `/init-deep` descriptor / execute 真值，锁定输入输出、文件写入语义与幂等边界 ✅
- [x] T-02: 盘点 `.NET` commands execute 当前接线点，确定 `/init-deep` 最小改动集合 ✅

### Phase 2: `/init-deep` 最小闭环
- [x] T-03: 在 `.NET` `/commands` 公开 `slash-init-deep` 并接入 execute 分发 ✅
- [x] T-04: 实现最小 Instructions context 注入、audit_ref、command card 与 metadata 回写（当前按 workspace root scope 汇总现有 Instructions 文件） ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` 集成测试，覆盖 descriptor 暴露、execute 成功、幂等/护栏路径（已新增 list 可见、workspace-root scope execute 正向、empty-context 护栏回归；直接静态 QA 通过，`.NET` build-test 仍受环境限制） ✅
- [x] T-06: 更新总迁移账本与 workflow / runtime plan，同步 RUN-009 子切片状态与验证边界 ✅

## Notes
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，所以真实 `.NET` 编译/动态测试证据如仍无法执行，需要在文档中显式保留验证边界。
- 本轮明确不触碰 `/start-work`、`/refactor`、Ralph/ULW loops；如实现中发现依赖这些能力，应立即收窄范围而不是顺手扩张。
- 旧的 RUN-009 最小 commands execute 子集 workflow 已归档到 `workflow/done/260420-net10-wave2-commands-execute迁移.md`；本文件只追踪 `/init-deep` 这张后续子切片。
- 当前 TS 真值的关键纠偏：`/init-deep` 真实行为不是“生成 AGENTS.md 文件”，而是把现有 Instructions 文件汇总进 `initDeepContext` metadata，并返回 status card + audit_ref；`.NET` 当前按 workspace root scope 对齐这一主语义。
- 最终复核结论：goal / code quality / security / context mining 全 PASS；QA 子代理两次遭遇平台级 `server_error`，已改由直接静态 QA 接管并通过。

Memory sync: completed
