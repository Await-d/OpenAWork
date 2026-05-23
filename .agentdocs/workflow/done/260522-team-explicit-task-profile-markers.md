# Team PM1 显式任务画像标记

> 创建时间：2026-05-22
> 状态：完成

## Task Overview

让 PM1 生成的 `tasks.md` 显式写出 `[KIND:...] [SURFACE:...]` 标记，PM2 解析时优先使用显式标记，缺失时回退到自动推断。

## Current Analysis

上一轮已在 `dispatch_package` 中引入 `taskProfile(kind + surface)`，但分类主要依赖任务标题和上下文推断。为了提升准确性，PM1 产出的任务清单应直接携带画像标记。

## Solution Design

- 更新 `TASKS_TEMPLATE` 与 `TASKS_SYSTEM_INSTRUCTION`，要求每个任务包含 `[KIND:<value>] [SURFACE:<value>]`
- 扩展 `parseTaskLine()`，兼容旧 `[P] [USx]`，并剥离画像标记后保留纯任务标题
- `buildDispatchPackages()` 优先使用显式画像，缺失时继续 `inferTaskProfile()`

## Complexity Assessment
- Atomic steps: 4 → 0
- Parallel streams: no → 0
- Modules/systems/services: 3 → +1
- Long step (>5 min): no → 0
- Persisted review artifacts: no → 0
- OpenCode available: yes → -1
- **Total score**: 0
- **Chosen mode**: Lightweight
- **Routing rationale**: 小范围后端模板与解析改造，适合轻量执行并用单元测试回归。

## Implementation Plan

- [x] T-01: 更新 PM1 tasks 模板与输出要求 ✅
- [x] T-02: 扩展 parseTaskLine 显式画像解析 ✅
- [x] T-03: buildDispatchPackages 优先读取显式画像 ✅
- [x] T-04: 补充单测与验证 ✅

## Notes

- Memory sync: completed
