# OpenCode 上下文剪枝语义对齐

## Task Overview

修复聊天会话上下文长期停留在约 50K token 的问题，使工具结果剪枝与完整压缩时机对齐 OpenCode，并保留完整工具输出的可检索能力。

## Current Analysis

Gateway 把全部工具输出限制为 48,000 字符，并在消息投影和 native upstream 两层重复裁剪。目标会话的稳定前缀约 32K–37K token，加上约 12K token 的工具预算后长期停在 45K–50K；数据库证据显示完整会话压缩为 0 次，因此根因不是反复摘要，也不只是前端统计。

## Solution Design

采用 OpenCode 的延迟剪枝语义：保护最近约 40K 工具 token，只有更老的可回收工具结果超过 20K token 才剪枝，并跳过当前用户轮次。正常请求取消固定 48K 字符总预算；完整压缩根据最终 `system + messages + tools` 请求估算，在模型窗口减去输出/buffer 后触发。保留图片安全限制、完整输出持久化、`read_tool_output` 引用和 overflow 恢复。

## Complexity Assessment

- Atomic steps: 8 → +2
- Parallel streams: yes → +2
- Modules/systems/services: 4 → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: no → 0
- **Total score**: 7
- **Chosen mode**: Full orchestration
- **Routing rationale**: 剪枝、消息投影、native upstream 和完整压缩阈值相互影响，必须用分阶段 TDD 和持久化验证证据控制回归风险。

## Implementation Plan

### Phase 1: 契约与 Red 证据
- [x] T-01 ✅: 建立 OpenCode 对齐的失败测试，覆盖 40K 保护区、20K 回收门槛、当前轮保护和超过 50K 的正常请求
- [x] T-02 ✅: 建立最终请求预算与 cache token 不重复计数的失败测试

### Phase 2: 剪枝实现
- [x] T-03 ✅: 实现 token 级延迟工具剪枝并移除按数量剪枝主逻辑
- [x] T-04 ✅: 对接具体工具 part 的 compacted 持久化与模型投影

### Phase 3: 请求门禁与完整压缩
- [x] T-05 ✅: 移除正常 native 请求的固定 48K 二次裁剪
- [x] T-06 ✅: 基于最终 Provider 请求整体估算触发完整压缩

### Phase 4: 验证与收口
- [x] T-07 ✅: 运行定向测试、Gateway typecheck/build、格式和 diff 检查
- [x] T-08 ✅: 对目标会话做只读重放验证并完成文档、记忆和归档同步

## Notes

- 用户已明确授权实施修复。
- 使用 Mode B 顺序执行；依赖链较强，顺序阶段验证比并行写同一压缩链路更安全。
- 不写入或重跑活跃会话 `4f2219d9-7923-43ee-ac98-e3cc647ac4ce`。
- 保留工作树中其他任务的未提交改动，尤其聊天流恢复和 UI 文件。
- Memory sync: completed
- runtime 保留：包含 Red/Green、回归和目标会话只读证据，暂不执行证据删除。
