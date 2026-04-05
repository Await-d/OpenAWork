# 260405 Chat Live 触发优化实施

## Task Overview

在 chat 恢复链 CI 分层已落地的基础上，继续优化 `chat-recovery-live` 的触发策略：只有 chat 恢复相关改动时才跑真实 live E2E，避免无关改动浪费 CI 成本。

## Current Analysis

- 当前 `chat-recovery-live` 已被拆成独立慢门，但仍是所有 push 都跑。
- 最合适的下一步不是再加新门禁，而是让 live gate 只在相关路径变动时触发。

## Solution Design

- 新增一个轻量 scope job，用路径过滤判断是否需要跑 `chat-recovery-live`；
- 保持 `chat-recovery-fast` 作为稳定 fast gate 不变；
- 只让 `chat-recovery-live` 对 chat 恢复相关目录与脚本变动敏感。

## Complexity Assessment

- Atomic steps: 3–4 → 0
- Parallel streams: workflow 结构 + path filter + 验证 + 归档 → +2
- Modules/systems/services: GitHub Actions + web/gateway/package scripts → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 4
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是对现有门禁结构的工程化优化，需要更新 workflow、验证并记录设计边界。

## Implementation Plan

### Phase 1：门禁触发优化
- [ ] T-01：新增路径感知 scope job
- [ ] T-02：让 live gate 仅在相关改动时触发

### Phase 2：验证与归档
- [ ] T-03：验证 workflow 语法与现有命令不受影响
- [ ] T-04：同步归档与 memory

## Notes

- 本次不改变 fast/live 分层本身，只优化 live gate 的触发条件。
