# .agentdocs/workflow/260327-非git目录review状态修复.md

## Task Overview

修复 `/workspace/review/status` 在目标路径不是 Git 仓库时返回 500 的问题，避免 Web 侧边栏 `WorkspaceGitBadge` 因工作区不在仓库中而持续报错。

## Current Analysis

- 当前报错来自 `SidebarHelpers.tsx` 发起的 `/workspace/review/status?path=...` 请求。
- 服务端返回 500，错误消息显示底层直接执行 `git status --porcelain -u`，而目标目录并非 Git 仓库。
- 需要确认前端对“非 Git 仓库”状态的预期展示，并在服务端将该场景从异常转为可消费的正常状态。

## Solution Design

- 梳理前端 `WorkspaceGitBadge` 的数据契约与空状态表现。
- 检查 workspace 路由对 Git 命令失败的处理方式，复用现有容错约定或补齐统一返回。
- 为非 Git 目录返回稳定的成功响应，避免控制台 500；必要时补充测试覆盖该边界场景。
- 以 LSP、相关测试、类型检查验证修复没有引入回归。

## Complexity Assessment

- Atomic steps: 4 → 0
- Parallel streams: yes → +2
- Modules/systems/services: 3 → +1
- Long step (>5 min): no → 0
- Persisted review artifacts: no → 0
- OpenCode available: yes → -1
- **Total score**: 2
- **Chosen mode**: Lightweight
- **Routing rationale**: 这是一个有明确报错和目标接口的小范围缺陷修复，但涉及前端消费、后端路由和测试验证三部分，适合保留轻量工作流记录后直接落地。

## Implementation Plan

### Phase 1: 上下文与契约确认
- [x] T-01: 确认前端 `WorkspaceGitBadge` 调用链与状态数据结构
- [x] T-02: 确认 `/workspace/review/status` 后端实现与异常处理方式

### Phase 2: 修复与验证
- [x] T-03: 实现非 Git 目录容错并补充/更新测试
- [x] T-04: 运行诊断、测试与类型检查，确认控制台 500 不再出现

## Notes

- 目标不是吞掉所有 Git 错误，而是把“目录不是 Git 仓库”降级为可预期状态；其他真实失败仍应保留可观测性。
- 实际修复落在 `services/agent-gateway/src/workspace-review.ts`，由 helper 层统一处理“非 Git 仓库”边界，避免 `/workspace/review/status` 与 `workspaceReviewStatusTool` 语义漂移。
- 验证结果：`workspace-review.test.ts` 4/4 通过；修改文件 LSP 诊断为 0；全仓 `pnpm typecheck` 通过。
- `pnpm --filter @openAwork/agent-gateway build` 仍被 `src/apply-patch-tools.ts` 中既有的 `before` 字段类型错误阻塞，与本次修复无关。
- Memory sync: completed
