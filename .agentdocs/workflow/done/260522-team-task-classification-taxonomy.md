# Team 任务分类与提示词画像

> 创建时间：2026-05-22
> 状态：完成

## Task Overview

为 Team / dispatch 链路增加任务分类画像，让 executor / reviewer 的提示词能按任务类型与表面领域更精确地收敛。

## Current Analysis

当前 `dispatch_package` 只有 `role + toolsets + taskMarkers`，executor / reviewer 的执行提示词仍偏泛化。需要在不增加角色爆炸的前提下，引入最小分类：`kind + surface`。

## Solution Design

- 增加 `taskProfile`：`kind`（build/fix/refactor/review/docs）+ `surface`（ui/backend/workflow/data/integration/cross-cutting）
- 在 `dispatch-package` 中根据任务标题/上下文自动推断
- 在 executor / reviewer prompt 中注入对应的提示词片段
- 保持 `roleLayer` 仅负责路由和权限，不承载分类语义

## Complexity Assessment
- Atomic steps: 4 → 0
- Parallel streams: no → 0
- Modules/systems/services: 3 → +1
- Long step (>5 min): no → 0
- Persisted review artifacts: no → 0
- OpenCode available: yes → -1
- **Total score**: 0
- **Chosen mode**: Lightweight
- **Routing rationale**: 需要改 3 个左右的后端点位与少量测试，但不需要 runtime 目录或大规模编排。

## Implementation Plan

### Phase 1: 分类画像
- [ ] T-01: 新增 taskProfile 类型、schema 和推断逻辑
- [ ] T-02: 让 dispatch_package / buildDispatchPackages 携带 taskProfile

### Phase 2: 提示词注入
- [ ] T-03: executor / reviewer prompt 读取 taskProfile 并拼接分类片段

### Phase 3: 验证
- [ ] T-04: 为分类推断与派发载荷补单元测试

## Notes

- Memory sync: completed
