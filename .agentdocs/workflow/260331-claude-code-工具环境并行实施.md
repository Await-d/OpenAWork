# .agentdocs/workflow/260331-claude-code-工具环境并行实施.md

## Task Overview

基于已冻结的五人并行开发方案，正式启动 Claude Code 风格工具环境接入实施。执行约束：不使用任何 git 回滚操作；主聊天线程不直接修改运行时代码；所有代码修改由并行子开发流完成；每个小功能完成后必须复查、验证并立即 git 提交。

新增全局执行约束：
- 所有需要参考的 Claude Code 信息，统一直接从本地仓库 `/home/await/project/OpenAWork/temp/claude-code-sourcemap` 获取，**禁止子代理通过网络抓取作为参考源**。
- 任一子代理失败后，必须优先沿用原 `session_id` 续跑对话修复，**禁止新开无上下文任务替代**。

## Current Analysis

- 已有明确架构边界：保留 canonical 小写工具不动，在 gateway 增加 compatibility surface。
- 已有五人并行分工：Profile/Metadata、Tool Surface、Sandbox、Stream/Capabilities、Observability/FileDiff/Logs。
- 已有 durable 基础：`request_workflow_logs`、`session_file_diffs`、`session_run_events`。
- 当前实施策略应优先选择**Phase 1 可独立编译/提交的低冲突小功能**，避免一开始进入热点文件冲突。
- 路线已进一步收敛：基础工具保持 OpenCode-first；非基础工具按 Claude-first 分批切入。当前首批样板已切到 `Skill` 与 `AskUserQuestion`。

## Solution Design

- 采用“并行子开发流 + 严格文件所有权 + 小功能粒度提交”推进。
- 第一轮优先启动互不冲突的子任务：metadata/profile、surface registry、新 adapter 模块、observability 类型骨架。
- 主线程负责：结果收集、复查、测试、git 提交、更新 workflow/master plan。

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: yes（明确并行开发） → +2
- Modules/systems/services: 3+ → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 当前任务已经从规划切入真实实施，需要协调多个并行子开发流、分阶段验证、逐项提交与文档同步，必须使用 full orchestration。

## Implementation Plan

### Phase 1：第一轮低冲突并行开发
- [ ] T-01：Dev-1 实现 `toolSurfaceProfile` metadata/schema 与 session 路由接线
- [ ] T-02：Dev-2 创建 Claude Code compatibility surface registry/profile 模块
- [ ] T-03：Dev-3 创建 reference→canonical input adapter / dispatch 骨架模块
- [ ] T-04：Dev-5 扩展 shared observability 类型与 durable 关联键骨架

### Phase 2：收口与小功能提交
- [ ] T-05：逐项复查 Dev-1 结果并提交
- [ ] T-06：逐项复查 Dev-2 结果并提交
- [ ] T-07：逐项复查 Dev-3 结果并提交
- [ ] T-08：逐项复查 Dev-5 结果并提交

### Phase 3：第二轮集成开发
- [ ] T-09：接通 tool-definitions + tools/definitions profile-aware surface
- [ ] T-10：接通 sandbox canonical dispatch 与 unsupported shim
- [ ] T-11：接通 stream/capabilities/visibility 一致性
- [ ] T-12：接通对话级 file diff / workflow log / run events 闭环

## Notes

- 禁止任何 `git reset` / `git revert` / `git checkout --` / `git restore` / `git clean -fd`。
- 每个小功能必须先复查再提交；若验证失败，继续修复，不允许用回滚掩盖问题。
- 所有运行时代码修改由子开发流完成，主线程仅做协调、验证与 git 操作。
- 所有子开发流在需要参考 Claude Code 工具行为、名称或入参格式时，只能读取本地 `temp/claude-code-sourcemap`，不得使用网络资料。
- 子开发流失败恢复策略：保留上下文，沿用原 `session_id` 续跑，先检查上次是否已有部分落地，再继续修复。
- 当前已切回主线程直接实施；子代理路线终止，不再继续扩散并行子会话。
- 当前执行策略：基础工具保持 OpenCode-first，非基础工具按 Claude-first 逐把推进。已完成：`Skill`、`AskUserQuestion`、`Agent`、`EnterPlanMode`、`ExitPlanMode`；`WebFetch`、`WebSearch` 已冻结为保留现有合同。
- 当前 PlanMode 采用最小可信闭环：`EnterPlanMode` 通过 session metadata 打开 `planMode=true`；`ExitPlanMode` 复用 `question_requests` 进行用户审批，并在批准后关闭 `planMode` 再继续恢复会话。
- 后端联动验证已补齐到路由层：`questions` 路由现在有显式回归用例，覆盖 `ExitPlanMode` 审批回答后对 `planMode` 的切换，以及 `resumeAnsweredQuestionRequest()` 的恢复调用。
- PlanMode 后端 gating 已补齐：对 `createdByTool='task'` 的子会话以及 channel 会话，`EnterPlanMode/ExitPlanMode` 在 capability 过滤和 sandbox 执行两层都被明确禁用，避免误暴露和绕过调用。
- Agent 后端 gating 现也补齐到同一层级：`Agent` 在 task-created 子会话与 channel 会话中都会被 capability 过滤和 sandbox 运行时同时限制，防止嵌套子代理链在不受支持的会话上下文里继续扩散。
- 后端运行态回归已延伸到 delete/recovery 与 pending interaction：`session-delete-recovery` 显式覆盖 `question_requests` 清理路径，`session-runtime-state` 显式覆盖 pending ExitPlanMode question 视为 paused 交互；`session-workspace-routes` 也已把待删除会话上的 pending question 示例更新为 `ExitPlanMode` 记录。
- stream 恢复链的一致性也已补齐：permission/question resume payload 现在会携带 observability，`stream-runtime` 在补写 `tool_result` / `run_event` 时会保留 `presentedToolName/canonicalToolName/toolSurfaceProfile`，不再在恢复执行时丢失 Claude-first 工具语义。
