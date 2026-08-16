# Team 路由安全与取消优化

## Task Overview

在已完成的 `light` 路由基础上，降低误判风险、确保路由超时真正取消底层 LLM，并固定 reception 只读工具边界。

## Current Analysis

- 当前未知输入在 LLM 格式错误/失败时可能默认进入 `light`。
- “改成生产值”“处理生产数据库”“排查线上故障”等动作信号覆盖不足。
- `routeByLlm` 的超时竞赛未把 AbortSignal 传给 `requestWorkflowLlmCompletion`，底层请求可能继续运行。
- reception 层已有 `read/web` 工具天花板，但缺少针对 light 路径的契约测试。

## Solution Design

1. 扩充高风险动作词并加入只读/动作冲突优先级。
2. 将无法安全判断的 malformed/rejection fallback 改为 `clarify`，仅明确只读输入 fallback 到 `light`。
3. 为路由 LLM 回调增加可选 AbortSignal，并传递至 workflow LLM 请求。
4. 验证 reception 只读工具集合不包含 write/shell/deploy 能力。

## Complexity Assessment

- `atomic_steps`: 4 → 0
- `parallel_streams`: yes → +2
- `modules_or_systems`: 3 → +1
- `long_step_over_5_min`: yes → +1
- `persisted_review_artifacts`: yes → +1
- `opencode_available`: no → 0
- **Total score**: 5
- **Chosen mode**: Full orchestration
- **Routing rationale**: 跨 router、workflow LLM caller、tool gate 测试和 agentdocs 证据；虽然可拆分，但共享路由契约与验证顺序要求本轮采用 Mode B 顺序执行，降低冲突。

## Implementation Plan

### Phase 1: 路由安全

- [x] T-01 ✅: 扩充高风险动作词，收紧 malformed/rejection fallback，并补充危险输入回归测试。
- [x] T-02 ✅: 让 `routeByLlm` 的 AbortSignal 进入 `requestWorkflowLlmCompletion`，补取消测试。

### Phase 2: 工具边界

- [x] T-03 ✅: 增加 reception 只读工具契约测试，确保 light 不获得写入/Shell 能力。

### Phase 3: 验证与同步

- [x] T-04 ✅: 运行目标测试、typecheck、build，生成报告并同步 index/workflow/master plan。

## Notes

- 不改变已完成的 light 直接回答链路和复杂任务 PM1 handoff 行为。
- 保留工作树中的其他用户改动，不执行任何回滚或清理。
- 验证记录：5 个目标测试文件 72/72 通过；typecheck/build exit 0；定向 ESLint 通过。
- Memory sync: completed；runtime 目录保留验证证据。
