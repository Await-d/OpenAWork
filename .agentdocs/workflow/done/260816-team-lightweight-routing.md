# Team 简单任务轻量路由优化

## Task Overview

将 Team 页面中的简单了解、解释、查看、只读检索任务从完整的
`reception → pm1 → pm2 → executor/reviewer` 链路中分流，保留开发、修复、重构、架构和高风险任务的完整协作链路。

## Current Analysis

- reception 的 `user_input` 当前统一进入自动路由；知识问答和解释类输入被规则明确判为 `orchestrate`。
- LLM 路由格式错误或超时也默认 `orchestrate`，形成过度升级的安全兜底。
- interaction-agent 提示词要求把模糊需求拆解为子任务；PM1 固定生成 spec/plan/tasks，watcher 再固定创建 PM2。
- `packages/agent-core/src/context/routing.ts` 的 R0-R3 当前未接入 Team reception 主路径，不能直接解决该问题。
- 本轮最小实施范围：新增只读轻量路由决策，并在 reception 直接回答；不改完整开发链路，不切换尚未完整接线的 workflow-driven runner。

## Solution Design

1. 在 reception router 中增加 `light` 决策：解释、了解、查看、检索、对比等只读意图走轻量路径；明确修改/执行/部署/高风险意图继续走 `orchestrate`。
2. 将 LLM 分类协议扩展为 `LIGHT`，并把格式错误/超时兜底改为风险敏感：没有明确修改意图时走 `light`，已有修改信号时走 `orchestrate`。
3. reception orchestrator 对 `light` 复用 reception 内部 stream 直接回答，跳过 auto-init、意图改写和 PM1 handoff。
4. 增加路由、编排和入口回归测试，验证轻量任务不创建 handoff，复杂任务保持原链路。

## Complexity Assessment

- `atomic_steps`: 6
- `parallel_streams`: yes
- `modules_or_systems`: 4
- `long_step_over_5_min`: yes
- `persisted_review_artifacts`: yes
- `opencode_available`: no
- `total_score`: 7
- `chosen_mode`: Full orchestration
- `routing_rationale`: 任务跨 gateway router、reception orchestrator、handoff 测试和 agentdocs 运行证据；路由契约先行，执行与验证分阶段完成。

## Implementation Plan

### Phase 1: 路由契约

- [x] T-01 ✅: 增加 `light` 路由决策、只读规则和风险敏感 LLM 兜底；更新 router 测试。

### Phase 2: 轻量执行路径

- [x] T-02 ✅: 在 reception orchestrator 中实现 `light` 直接回答分支；增加无 handoff 回归测试。
- [x] T-03 ✅: 补充 inbound/集成边界测试，确认复杂开发输入仍创建 PM1 handoff。

### Phase 3: 验证与同步

- [x] T-04 ✅: 运行 router、orchestrator、Team inbound、b-c 集成测试和 TypeScript 校验。
- [x] T-05 ✅: 执行精确输入探针与 diff 审查，记录简单任务层级数量和复杂任务不变证据。
- [x] T-06 ✅: 生成 runtime final output，同步 workflow/index 状态并记录可复用架构决策。

## Notes

- 不直接启用现有 `workflow-driven-runner`：当前主路径没有传递 `workflowId`，runner 也只负责模板解析和下游 handoff 创建，尚非完整执行替代品。
- 现有工作区存在大量用户未提交改动；所有实现只触及本计划列出的文件，禁止回滚或清理无关改动。
- 轻量路径默认留在 reception，后续如需项目级只读 worker，应另建明确的 read-only workflow 和工具权限契约。
- 验证记录：目标测试 4 files / 57 tests 通过；gateway typecheck/build exit 0；目标文件 diff check 与 ESLint 通过。
- Memory sync: completed；runtime 目录保留用于复核，未删除用户可查的测试与探针证据。
