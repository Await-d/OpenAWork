# .agentdocs/workflow/260331-claude-code-五人并行开发方案.md

## Task Overview

基于已完成的 `Claude Code` 风格工具环境接入分析，为 OpenAWork 设计一份**五个人可以同时开发**的详细实施方案。目标不是立即编码，而是输出可执行的多人并行分工、依赖顺序、阶段验收、风险隔离与同步协议。

## Current Analysis

- 已有冻结结论：保留 OpenAWork canonical 小写工具不动，在 `services/agent-gateway` 增加 Claude Code 风格 compatibility surface。
- 已知关键接入边界：`tool-definitions.ts`（模型可见层）、`tool-sandbox.ts`（执行层）、`session-workspace-metadata.ts`/`routes/sessions.ts`（profile 持久化）、`session-tool-visibility.ts`/`routes/stream.ts`/`routes/capabilities.ts`（可见性与运行时一致性）。
- 已知关键风险：`/capabilities` 漂移、stream gating 与 sandbox 名称反解不一致、单 `toolName` 留痕导致 reference/canonical 混淆、低语义匹配工具不能伪兼容。
- 新增用户要求：**每个对话产生的文件变更记录和日志必须纳入方案，不作为后置优化项**。这意味着本次实施不仅要兼容工具 surface，还要保证每轮对话/请求都能关联到 durable file diffs 与 workflow/run logs。
- 当前要产出的内容需要支持多人并行开发，不只是列阶段，还要避免多人改同一文件、给出阻塞关系和合并顺序。

## Solution Design

- 以“单一 compatibility surface + 会话级 profile + 分阶段 rollout”为核心，按模块边界拆成五条可并行主线。
- 设计时优先遵守文件隔离：尽量保证每人主改一组文件，减少同文件冲突；对 unavoidable hotspot 单独定义串行合并窗口。
- 方案输出包含：五人职责、Phase 0/1/2、依赖 DAG、每日同步协议、测试矩阵、风险清单与集成顺序。

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: yes（明确要求五人同时开发） → +2
- Modules/systems/services: 3+（gateway tool surface / sandbox / session metadata / capabilities / tests / docs） → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes（需形成详细可执行方案文档） → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 该任务本质是多人并行实施计划设计，需要保留可回溯的分工、依赖、验收与同步规则，并协调五条独立工作流，适合走 full orchestration 的 workflow + runtime master plan。

## Implementation Plan

### Phase 1：上下文与先例搜集
- [x] T-01：汇总当前 Claude Code 工具环境接入方案的已确认边界与风险
- [x] T-02：提取仓库历史多人分工/工具迁移方案中的可复用结构
- [x] T-03：补充参考库/公开资料对 default/simple tool surface 的使用方式

### Phase 2：五人并行拆分设计
- [x] T-04：形成五条开发主线与文件所有权边界
- [x] T-05：形成 Phase 0/1/2 分阶段推进顺序与依赖 DAG
- [x] T-06：形成集成窗口、冲突规避策略与每日同步协议

### Phase 3：方案定稿
- [x] T-07：输出五人详细任务表、验收清单、风险清单与回归矩阵
- [x] T-08：同步 runtime master plan、回写 index 与 memory

## Notes

- 本工作流只产出计划，不修改运行时代码。
- 后续若进入实施，应以本方案为父计划，再为每位开发者/每个阶段创建执行工作流。

## 外部与内部依据摘要

### 已冻结的内部结论

- 现有推荐路线已冻结为：**保留 canonical 小写工具不动，在 `services/agent-gateway` 增加 Claude Code 风格 compatibility surface**。
- 关键热点文件已确认：`tool-definitions.ts`、`tool-sandbox.ts`、`routes/stream.ts`、`routes/capabilities.ts`、`session-tool-visibility.ts`、`session-workspace-metadata.ts`、`routes/sessions.ts`。
- 现有 durable 记录基础已确认存在：
  - `request-workflow-log-store.ts` → `request_workflow_logs`
  - `session-file-diff-store.ts` → `session_file_diffs`
  - `session-run-events.ts` → `session_run_events`
- 因此本次方案应走“**复用现有 durable stores + 补齐 profile/reference surface 接线**”，而不是重做日志/审计子系统。
- 已知关键风险：
  - `/capabilities` 与 stream 暴露面漂移
  - sandbox 名称反解与 stream gating 不一致
  - 低语义匹配工具伪兼容
  - 单字段 `toolName` 留痕导致排障混淆

### 公开资料可引用事实

- Claude Code 官方公开文档确认其是一个会**读代码、编辑文件、运行命令、调用工具**的 agentic coding tool。
- 官方 `settings` 文档公开示例直接使用 `Bash(...)`、`Read(...)` 作为权限规则，说明公开命名风格确实存在以 `Bash` / `Read` 为代表的工具名表述。
- 官方 `common workflows` 文档明确提到：
  - Plan Mode
  - AskUserQuestion
  - subagents / agent teams
  - worktrees / parallel sessions
 这些都能作为我们设计 `claude_code_simple / claude_code_default` profile 时的产品语义背景，但**不能替代本地参考库实现细节**。

### 历史方案可复用模板

- `260319-四开发者任务分配方案.md`：最适合复用为多人并行开发模板
- `260330-工具移植与格式加强复检.md`：适合复用为“工具面 + schema + 暴露面 + 测试矩阵”的验收模板
- `260331-claude-code-工具环境集成方案.md`：适合复用为本次五人计划的事实源与分阶段 rollout 依据

## 五人并行开发总览

| 开发者 | 负责层 | 主要文件/目录 | 主要目标 | 阶段任务数 |
|---|---|---|---|---|
| Dev-1 | Profile/Metadata 层 | `session-workspace-metadata.ts`, `routes/sessions.ts` | 会话级 `toolSurfaceProfile` 持久化与锁定策略 | 8 |
| Dev-2 | Tool Surface/Schema 层 | `tool-definitions.ts`, `routes/tools.ts`, 新增 `claude-code-tool-surface*.ts` | 对模型暴露 Claude Code 风格工具名与参数 schema | 9 |
| Dev-3 | Sandbox/Dispatch 层 | `tool-sandbox.ts`, 新增 `claude-code-input-adapters*.ts` | reference 名称/入参 → canonical 执行请求 | 9 |
| Dev-4 | Stream/Capabilities/Visibility 层 | `routes/stream.ts`, `routes/capabilities.ts`, `session-tool-visibility.ts`, `routes/stream-protocol.ts` | 确保“可见即可用”，profile 下游一致 | 9 |
| Dev-5 | Observability/FileDiff/Logs/Test 层 | `packages/shared/src/index.ts`, `tool-result-contract.ts`, `session-message-store.ts`, `request-workflow-log-store.ts`, `session-file-diff-store.ts`, `session-run-events.ts`, `src/__tests__`, verification/docs | 双名留痕、每对话文件变更记录、workflow/run logs、回放/测试、文档收口 | 12 |

**隔离原则**：同一阶段同一文件只允许一位开发者作为主负责人；所有跨文件协作优先通过新增中间模块实现，尽量避免多人同时改热点文件。

## 推荐文件所有权边界

### Dev-1：Profile 与 Session Metadata

**主文件**
- `services/agent-gateway/src/session-workspace-metadata.ts`
- `services/agent-gateway/src/routes/sessions.ts`
- `services/agent-gateway/src/__tests__/session-workspace-metadata.test.ts`
- `services/agent-gateway/src/__tests__/session-workspace-metadata-unrestricted.test.ts`
- `services/agent-gateway/src/__tests__/sessions.test.ts`（仅 metadata/profile 相关断言）

**Phase 1（立即开始）**
- [ ] D1-01 新增 `ToolSurfaceProfile` 类型与 schema 枚举：`openawork / claude_code_simple / claude_code_default`
- [ ] D1-02 扩展 `validateSessionMetadataPatch()` allowlist，允许 profile 字段
- [ ] D1-03 创建 legacy session 默认规则：无字段时默认 `openawork`
- [ ] D1-04 在 `POST /sessions` 路径接入 profile 持久化
- [ ] D1-05 在 `PATCH /sessions/:sessionId` 路径接入 profile 更新与校验

**Phase 2（依赖 Phase 1 通过）**
- [ ] D1-06 定义 profile 锁定策略：首次启用后会话内不允许随意切换，防止历史留痕混淆
- [ ] D1-07 为 sessions 响应补齐 profile 回显与向后兼容行为
- [ ] D1-08 完成 metadata / sessions 路由单测与边界用例

### Dev-2：Tool Surface 与 Schema 暴露

**主文件**
- `services/agent-gateway/src/tool-definitions.ts`
- `services/agent-gateway/src/routes/tools.ts`
- 新增：`services/agent-gateway/src/claude-code-tool-surface.ts`
- 新增：`services/agent-gateway/src/claude-code-tool-surface-profiles.ts`
- `services/agent-gateway/src/__tests__/tool-definitions.test.ts`
- `services/agent-gateway/src/__tests__/stream-protocol.unit.test.ts`（仅 schema/definition 断言）

**Phase 1（立即开始）**
- [ ] D2-01 抽出单一 compatibility surface registry：`presentedName / canonicalName / exposurePolicy`
- [ ] D2-02 抽出 profile resolver：`openawork / claude_code_simple / claude_code_default`
- [ ] D2-03 定义 P1 高兼容工具的对外 schema：`Edit/Write/Glob/TodoWrite/TaskGet/TaskList`
- [ ] D2-04 定义 P2 中兼容工具的对外 schema：`Bash/Grep/TaskCreate/TaskUpdate`
- [ ] D2-05 将低语义工具显式标记为 `hidden` 或 `unsupported_shim`

**Phase 2（依赖 Dev-1 profile 类型冻结）**
- [ ] D2-06 让 `buildGatewayToolDefinitions()` 支持按 profile 输出工具集合
- [ ] D2-07 `/tools/definitions` 支持 profile-aware 返回
- [ ] D2-08 更新 `tool-definitions` 合同测试与 schema 快照
- [ ] D2-09 提供给 Dev-4 的统一 resolver API，避免 stream 与 capabilities 各自实现一份

### Dev-3：Sandbox 与 Canonical Dispatch

**主文件**
- `services/agent-gateway/src/tool-sandbox.ts`
- 新增：`services/agent-gateway/src/claude-code-input-adapters.ts`
- 新增：`services/agent-gateway/src/claude-code-tool-dispatch.ts`
- `services/agent-gateway/src/__tests__/interactive-bash-tools.test.ts`
- `services/agent-gateway/src/__tests__/task-tool-guardrails.test.ts`（若适配影响 task/agent guard）

**Phase 1（立即开始）**
- [ ] D3-01 先在 `tool-sandbox.ts` 抽出 reference→canonical 转换入口，降低后续大文件冲突
- [ ] D3-02 实现高兼容工具 input adapter：`Edit/Write/Glob/TodoWrite/TaskGet/TaskList`
- [ ] D3-03 实现中兼容工具 input adapter：`Bash/Grep/TaskCreate/TaskUpdate`
- [ ] D3-04 为低语义工具实现统一 unsupported 错误格式，禁止静默降级

**Phase 2（依赖 Dev-2 surface registry）**
- [ ] D3-05 在 dispatch 前完成 `presentedName -> canonicalName` 反解
- [ ] D3-06 保证权限判定、channel policy、tool whitelist 全部基于 canonical 名称执行
- [ ] D3-07 如果需要，新增 reference adapter 专用错误码/错误消息
- [ ] D3-08 保证写类工具执行结果可携带足够的 canonical/reference/request 元信息，供 Dev-5 持久化 file diffs
- [ ] D3-09 增补 sandbox 侧回归测试
- [ ] D3-10 输出 caveat：哪些 reference 字段当前被拒绝、哪些被支持为子集

### Dev-4：Stream / Capabilities / Visibility 一致性

**主文件**
- `services/agent-gateway/src/routes/stream.ts`
- `services/agent-gateway/src/routes/stream-protocol.ts`
- `services/agent-gateway/src/routes/capabilities.ts`
- `services/agent-gateway/src/session-tool-visibility.ts`
- `services/agent-gateway/src/__tests__/capabilities.test.ts`
- `services/agent-gateway/src/__tests__/capabilities-context.test.ts`
- `services/agent-gateway/src/__tests__/capabilities-routes.test.ts`
- `services/agent-gateway/src/__tests__/session-tool-visibility.test.ts`

**Phase 1（可与 Dev-1/2/3 并行开始，先做接口抽取）**
- [ ] D4-01 新增 shared resolver：stream 与 capabilities 必须共用同一份 visible tools 计算逻辑
- [ ] D4-02 将 `filterEnabledGatewayToolsForSession()` 的输入改造成面向 canonical+profile 的双层过滤接口
- [ ] D4-03 预留 channel policy 与 webSearchEnabled 在 profile 下的兼容路径

**Phase 2（依赖 Dev-1 + Dev-2 + Dev-3）**
- [ ] D4-04 在 `routes/stream.ts` 中按 session profile 下发正确的 tools surface
- [ ] D4-05 在 `routes/capabilities.ts` 中复用同一 resolver，保证“展示可用 = 运行可用”
- [ ] D4-06 在 `stream-protocol.ts` / `stream-model-round` 中保持 tool call name 一致
- [ ] D4-07 保证每轮对话/请求的 `clientRequestId`、run events 与工具调用链可用于关联 file diffs / workflow logs
- [ ] D4-08 更新 session-tool-visibility 相关单测
- [ ] D4-09 更新 capabilities 相关单测与上下文拼装断言
- [ ] D4-10 补充 drift 回归：不同 profile 下 `/capabilities` 与 stream tool list 完全一致

### Dev-5：Observability / FileDiff / Logs / Shared Types / Tests / Docs

**主文件**
- `packages/shared/src/index.ts`
- `services/agent-gateway/src/tool-result-contract.ts`
- `services/agent-gateway/src/session-message-store.ts`
- `services/agent-gateway/src/request-workflow-log-store.ts`
- `services/agent-gateway/src/session-file-diff-store.ts`
- `services/agent-gateway/src/session-run-events.ts`
- `services/agent-gateway/src/__tests__/tool-result-contract.test.ts`
- `services/agent-gateway/src/__tests__/request-workflow-log-store.test.ts`
- `services/agent-gateway/src/__tests__/session-file-diff-store.test.ts`
- `services/agent-gateway/src/__tests__/session-run-events.test.ts`
- `services/agent-gateway/src/verification/verify-openai-responses.ts`（如需）
- 新增：`docs/claude-code-tool-surface.md`（建议）

**Phase 1（立即开始）**
- [ ] D5-01 设计双名留痕字段：`presentedToolName / canonicalToolName / toolSurfaceProfile / adapterVersion`
- [ ] D5-02 在 shared types 中扩展 `tool_call/tool_result/RunEvent` 需要的可选字段
- [ ] D5-03 让 `buildToolResultContent()` 与 `buildToolResultRunEvent()` 支持可观测性字段
- [ ] D5-04 设计“每个对话/请求”的日志与文件变更关联模型：至少统一 `sessionId + clientRequestId/requestId + toolCallId`

**Phase 2（依赖 Dev-3/4 接口稳定）**
- [ ] D5-05 更新 `request-workflow-log-store.ts`，确保 reference profile 下的请求日志仍能按对话/请求准确归档
- [ ] D5-06 更新 `session-file-diff-store.ts`，确保每次对话产生的文件变更能保留 request/profile/tool 维度关联
- [ ] D5-07 更新 `session-run-events.ts` 与 `session-message-store.ts` 的持久化/回放/引用逻辑
- [ ] D5-08 增补 `tool-result-contract` / file-diff / workflow-log / run-events 测试与 replay 断言
- [ ] D5-09 补充端到端/verification 级回归：至少覆盖 `openawork / claude_code_simple / claude_code_default` 下“对话→工具→文件变更→日志”闭环
- [ ] D5-10 编写工具兼容矩阵文档：High / Medium / Low
- [ ] D5-11 编写开发者接入文档：如何给新工具增加 reference surface，并保证 file diff / log 接线完整
- [ ] D5-12 编写 rollout/checklist：P1/P2/P3 上线检查项 + 日志/文件变更核对项
- [ ] D5-13 做最终集成 smoke test 与发布建议

## 分阶段推进顺序

### Phase 0：契约冻结（0.5 天）

**所有人共同参与，但不开始大规模改代码**

冻结内容：
- profile 名称：`openawork / claude_code_simple / claude_code_default`
- 高/中/低兼容工具清单
- reference surface registry 字段结构
- observability 字段结构
- 每对话 durable 记录关联键：`sessionId + clientRequestId/requestId + toolCallId`
- 会话级 profile 锁定策略

**产出物**
- 一页接口约定（可放在本 workflow Notes 或后续 docs）
- 热点文件 owner 清单

### Phase 1：无阻塞并行开发（1–2 天）

可以立即并行开始：
- Dev-1 metadata/profile 持久化
- Dev-2 surface registry + schema builder
- Dev-3 sandbox adapter 入口抽取 + 高兼容工具适配
- Dev-4 resolver 抽取 + visibility 接口整理
- Dev-5 shared observability type 设计 + 文件变更/日志关联模型 + 测试骨架

### Phase 2：集成与对齐（1–2 天）

依赖关系：
- Dev-2 依赖 Dev-1 的 profile 类型冻结
- Dev-3 依赖 Dev-2 的 surface registry 定稿
- Dev-4 依赖 Dev-1/2/3 的 profile + schema + dispatch 接口稳定
- Dev-5 依赖 Dev-3/4 的最终 tool call/result 流转形式

### Phase 3：回归与 rollout（0.5–1 天）

- Dev-5 主导全量验证
- Dev-4 验证 `/capabilities` 与 stream consistency
- Dev-3 验证 canonical dispatch + permissions
- Dev-2 验证 schema/definition 快照
- Dev-1 验证 profile persistence + session 行为
- 全体联合验证：**每个对话是否都能追溯到对应文件变更记录与 request/workflow/run logs**

## 依赖 DAG

```text
Dev-1 Phase 1 ─┬─> Dev-2 Phase 2 ─┬─> Dev-3 Phase 2 ─┬─> Dev-4 Phase 2 ─┬─> Dev-5 Phase 2
               │                  │                  │                  │
               │                  └──────────────────┘                  │
               └─────────────────────────────────────────────────────────┘

Dev-2 Phase 1 ────────────────────────┐
Dev-3 Phase 1 ────────────────────────┼─> Phase 2 integration
Dev-4 Phase 1 ────────────────────────┘

Dev-5 Phase 1 先做类型/测试骨架，最终依赖 Dev-3/4 的真实流转格式完成收口。
```

## 合并窗口与冲突规避策略

### Hotspot 文件（禁止多人同阶段直接并行修改）

- `services/agent-gateway/src/tool-definitions.ts`
- `services/agent-gateway/src/tool-sandbox.ts`
- `services/agent-gateway/src/routes/stream.ts`
- `services/agent-gateway/src/routes/capabilities.ts`
- `packages/shared/src/index.ts`

### 规避策略

1. **新增文件优先**：优先新增 `claude-code-*` 模块，最后只在热点文件接一层薄入口。
2. **Owner 独占**：热点文件每个阶段只允许一人主改，其他人只能通过新增模块协作。
3. **薄接入原则**：
   - `tool-definitions.ts` 只负责调用新的 surface builder
   - `tool-sandbox.ts` 只负责调用新的 input adapter / dispatch resolver
   - `stream.ts` / `capabilities.ts` 只负责调用 shared visible-tools resolver
4. **集成顺序固定**：
   - Window A：Dev-1 + Dev-2
   - Window B：Dev-3
   - Window C：Dev-4
   - Window D：Dev-5 + 全体回归

## 回归矩阵

### 必跑测试

- `services/agent-gateway/src/__tests__/tool-definitions.test.ts`
- `services/agent-gateway/src/__tests__/stream-protocol.unit.test.ts`
- `services/agent-gateway/src/__tests__/session-tool-visibility.test.ts`
- `services/agent-gateway/src/__tests__/session-workspace-metadata.test.ts`
- `services/agent-gateway/src/__tests__/session-workspace-metadata-unrestricted.test.ts`
- `services/agent-gateway/src/__tests__/capabilities.test.ts`
- `services/agent-gateway/src/__tests__/capabilities-context.test.ts`
- `services/agent-gateway/src/__tests__/capabilities-routes.test.ts`
- `services/agent-gateway/src/__tests__/sessions.test.ts`
- `services/agent-gateway/src/__tests__/tool-result-contract.test.ts`

### 建议补充的 verification / smoke

- `@openAwork/agent-gateway build`
- `@openAwork/agent-gateway test`
- 定向 stream tool loop 验证（至少覆盖三个 profile）
- 定向 capabilities vs stream 一致性验证
- 定向 history/replay 验证（防止 dual-name 破坏回放）

## 风险清单

1. **能力目录漂移**：`/capabilities` 先显示了 `Bash`，但 stream 实际没下发 → 由 Dev-4 统一 resolver 兜底。
2. **权限链错位**：reference 名称直接进权限判断 → Dev-3 必须先反解成 canonical 名称再鉴权。
3. **profile 中途切换导致历史混乱**：已运行过 reference surface 的会话再切换 profile → Dev-1 锁定策略解决。
4. **低语义工具伪兼容**：`WebFetch/WebSearch/Agent/AskUserQuestion` 静默丢字段 → Dev-2/3 统一 unsupported shim。
5. **热点文件冲突**：多人同时改 `tool-sandbox.ts` / `stream.ts` → 用新增模块 + owner 独占规避。
6. **留痕不可追溯**：只有单一 `toolName` → Dev-5 增加 presented/canonical/profile 留痕字段。
7. **对话与文件差异断链**：工具改了文件，但 `session_file_diffs` 无法和该轮对话/请求对上 → 必须统一 `requestId/clientRequestId` 关联键。
8. **日志存在但不可用**：`request_workflow_logs`、`session_run_events`、`session_file_diffs` 各自落库，但 profile/reference 名称未写入或写法不一致 → 回放与排障将失真。

## 对话级文件变更与日志集成要求（新增硬性要求）

以下四项作为本次实施**强制验收**：

1. **每个对话/请求必须有 durable workflow log**
   - 事实源：`request_workflow_logs`
   - 关联维度：`request_id`、`session_id`、HTTP path/method/status

2. **每个产生写入的对话/请求必须有 durable file diff**
   - 事实源：`session_file_diffs`
   - 关联维度至少补齐到：`session_id + request_id/clientRequestId + tool_name/profile`

3. **每个对话/请求必须可回放 run events**
   - 事实源：`session_run_events`
   - 关联维度：`session_id + client_request_id + seq`

4. **三者必须可串联回同一轮对话**
   - 至少能回答：
     - 这轮对话用了什么工具？
     - 工具以 reference 名称还是 canonical 名称出现？
     - 改了哪些文件？
     - 哪些 diff 属于哪个 request/toolCall？
     - 对应 workflow / run event 是什么？

## 每日同步协议

### 每天开始前

- 先同步 owner 文件是否有变动
- 确认上一窗口合并是否完成
- 确认本日依赖项是否已达成

### 每天结束前

- 每位开发者更新本文件对应任务状态
- 在 PR/分支备注中记录：
  - 影响文件
  - 是否引入新 schema/字段
  - 是否需要下游同步
  - 已跑测试

### 集成窗口同步格式

```text
[Dev-X]
- 完成项：...
- 影响文件：...
- 下游阻塞解除：...
- 未完成风险：...
- 已验证：...
```

## 开始条件

- **立即开始**：Dev-1 / Dev-2 / Dev-3 / Dev-4 / Dev-5 的 Phase 1
- **等待 Dev-1**：任何涉及 profile 常量定名的最终接线
- **等待 Dev-2**：Dev-3 medium adapter、Dev-4 stream/capabilities surface 接线
- **等待 Dev-3**：Dev-4 runtime execute path 一致性验证、Dev-5 dual-name replay 验证
- **等待 Dev-4**：Dev-5 capabilities/stream consistency 验证

## 最终推荐执行顺序

1. 先冻结接口与 owner（Phase 0）
2. 五人同时开 Phase 1
3. 按 Window A/B/C/D 合并
4. P1 仅上 `claude_code_simple + High`
5. P2 再上 `claude_code_default + Medium`
6. P3 才补 Low 语义工具或正式声明不支持
