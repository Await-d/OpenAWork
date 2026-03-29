# .agentdocs/workflow/260327-opencode任务体系对齐方案.md

## 任务概览

目标是对照 `temp/opencode` 当前任务体系的真实实现，调整 OpenAWork 里与任务相关的整条链路：任务/子任务创建、子任务使用何种 agent 执行、子任务完成后的回调与主线程结果接收、以及主界面对各子代理运行状态的可见性。

## 当前分析

- 当前仓库已经具备 `task` 工具、child session、task graph、任务树层级投影与 Chat 右侧任务展示，但 `.agentdocs/index.md` 现存记忆明确指出：`task` 目前只是“真实 child session + task graph 入口”，尚未补齐完整自动子代理执行生命周期。
- 已完成的 `260324-子任务层级实现方案` 说明：现状采用“子会话树 + 任务树 + 依赖图”三层并存模型，前端可展示层级，但不等于已具备完整的子代理执行、回调回收与运行态联动。
- 用户本次要求不是继续做静态层级展示，而是要按 `temp/opencode` 的使用方式收敛到完整闭环，因此必须同时核查参考仓库与当前仓库的事件、状态、线程/会话关系和 UI 读路径。

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 当前仓库任务链路 / 事件回调状态流 / opencode 参考实现 → +2
- Modules/systems/services: agent-core + shared + agent-gateway + web → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是一次跨任务模型、运行时事件、前端运行态和参考实现对标的联动改造；若不保留显式计划和逐步验证，很容易再次把子会话、子任务、依赖和子代理生命周期混成一层语义。

## Implementation Plan

### Phase 1：参考实现与现状对照
- [ ] T-01：梳理 OpenAWork 当前任务创建、子任务/子代理、回调与 UI 展示链路
- [ ] T-02：梳理 `temp/opencode` 中对应的任务模型、agent 选择与结果回传机制
- [ ] T-03：冻结需要对齐的数据结构、事件语义和 UI 投影差距

### Phase 2：执行链路改造
- [ ] T-04：调整服务端/核心层任务创建与子任务 agent 选择逻辑
- [ ] T-05：补齐子任务执行完成后向主线程回传结果与状态的链路
- [ ] T-06：更新共享类型与任务事件投影，保证前端拿到一致语义

### Phase 3：前端运行态与验证
- [ ] T-07：更新主界面对各子代理运行状态、结果与层级的展示
- [ ] T-08：补齐或更新定向测试与回归用例
- [ ] T-09：完成 diagnostics、typecheck、相关测试和构建验证

## Notes

- 本工作流创建于 2026-03-27，用于跟踪 `temp/opencode` 任务体系对齐的完整闭环改造。
- 当前优先级最高的是先冻结“谁负责创建子任务、谁决定 agent、谁接收回调、谁投影给 UI”这四个权责边界，再落实现。
