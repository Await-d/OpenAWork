# .agentdocs/workflow/260331-claude-code-工具环境集成方案.md

## Task Overview

对照 `temp/claude-code-sourcemap` 的默认工具环境，分析 OpenAWork 当前工具体系在工具命名、入参格式、Schema 暴露、启用逻辑与执行链路上的现状，并输出可行集成方案。当前阶段只做分析与方案冻结，不直接编码。

## Current Analysis

- 参考库已确认存在 `default` tool preset，默认工具来自 `restored-src/src/tools.ts` 的 `getAllBaseTools()`。
- OpenAWork 已有参考风格工具名对齐历史，但需要核对当前真实注册表、gateway 暴露层与执行层是否仍存在命名/参数形状漂移。
- 用户要求的输出不仅是“列出工具”，还包括：名称、入参格式、在我们系统中的接入方式、可行的实施路径。

## Solution Design

- 先定位 OpenAWork 工具定义、注册、Schema 导出与执行入口。
- 再对照参考库的默认工具名称、参数格式与 simple/default 两种暴露方式。
- 最后输出差异矩阵、推荐接入层、兼容策略与分阶段落地方案。

## Complexity Assessment

- Atomic steps: 4 → 0
- Parallel streams: yes → +2
- Modules/systems/services: 3+ → +1
- Long step (>5 min): no → 0
- Persisted review artifacts: no → 0
- OpenCode available: yes → -1
- **Total score**: 2
- **Chosen mode**: Lightweight
- **Routing rationale**: 该任务需要并行分析参考实现与本仓库多模块工具链路，但当前目标是方案收敛而非直接编码，实现上只需 workflow 文档承载分析与结论，无需 full orchestration runtime。

## Implementation Plan

### Phase 1: 现状与参考实现核查
- [x] T-01: 核查 OpenAWork 当前工具定义、注册与执行链路
- [x] T-02: 核查参考库默认工具的名称、参数格式与启用逻辑

### Phase 2: 方案收敛
- [x] T-03: 形成差异矩阵与可插入接入点
- [x] T-04: 输出推荐集成方案、兼容策略与实施顺序

## Notes

- 本任务输出以代码证据为主，外部公开文档仅作为交叉验证。
- 若后续进入编码阶段，应基于本方案单独开实施工作流。

### 已确认的 OpenAWork 接入链路

- `packages/agent-core/src/tool-contract.ts` 定义通用 `ToolDefinition` / `ToolRegistry`，负责 Zod 输入输出校验与执行调度。
- `services/agent-gateway/src/tool-definitions.ts` 的 `MODEL_VISIBLE_GATEWAY_TOOLS` 是当前**模型可见工具集合真相源**；`buildGatewayToolDefinitions()` 在这里把工具转成 LLM 可见 JSON Schema。
- `services/agent-gateway/src/tool-definitions.ts#buildParameters()` 是当前**参数格式真相源**；这里手写每个工具的 model-visible `parameters`。
- `services/agent-gateway/src/tool-sandbox.ts` 是当前**执行入口真相源**；工具名白名单、权限门控与运行时分发都在这里。
- `services/agent-gateway/src/session-tool-visibility.ts` 按 session metadata 做工具可见性过滤。
- `services/agent-gateway/src/routes/tool-name-compat.ts` 目前只处理旧内部名到当前 canonical 小写名的兼容，不覆盖 Claude Code 风格大写工具名。

### 已确认的参考库行为

- `temp/claude-code-sourcemap/restored-src/src/tools.ts` 只有一个 `default` preset，工具集来自 `getAllBaseTools()`。
- `CLAUDE_CODE_SIMPLE` 会切到简化工具集，公开资料至少可确认 Bash + Edit；本地参考源码还显示 simple 模式主工具为 `BashTool + FileReadTool + FileEditTool`。
- 参考库默认工具名是首字母大写/驼峰风格，如 `Bash`、`Read`、`Edit`、`Write`、`Glob`、`Grep`、`WebFetch`、`WebSearch`、`TodoWrite`、`TaskCreate`、`TaskGet`、`TaskList`、`TaskUpdate`、`Skill`、`AskUserQuestion`。
- 参考库的默认环境不是一份纯静态名单，还叠加了 feature/env gating（如 `ENABLE_LSP_TOOL`、`CLAUDE_CODE_SIMPLE`、`isTodoV2Enabled()`、`isWorktreeModeEnabled()`、`USER_TYPE === 'ant'` 等）；OpenAWork 若要借鉴其“环境使用方式”，应建模为 **surface + gate**，而不是只复制工具数组。

### 关键差异（方案阶段继续细化）

- **仅命名/字段差异，适合做 adapter**：
  - `Read`: 参考为 `file_path`，当前为 `path/filePath`
  - `Edit`: 参考为 `file_path/old_string/new_string/replace_all`，当前为 `filePath/oldString/newString/replaceAll`
  - `Write`: 参考为 `file_path/content`，当前为 `path|filePath + content`
  - `Glob`: 两边都接近 `{ pattern, path? }`
  - `Grep`: 两边都以 `{ pattern, path? }` 为主，但参考支持更丰富的 rg 风格参数（`glob/type/-A/-B/-C/-n/-i/offset/multiline`）

- **存在语义差异，不能只做 rename**：
  - `WebFetch`: 参考入参是 `{ url, prompt }`，当前是 `{ url, format, timeout }`
  - `WebSearch`: 参考是 `{ query, allowed_domains?, blocked_domains? }`，当前是 provider 聚合搜索 `{ query, maxResults?, provider?, apiKey?, baseUrl? }`
  - `AskUserQuestion`: 参考为 `multiSelect/preview/annotations` 体系，当前为更简化的 `multiple` 问答结构
  - `Skill`: 参考入参是 `{ skill, args? }`，当前是 `{ name }`
  - `TaskCreate/Get/List/Update`: 参考是独立 CRUD 工具（如 `taskId`、`activeForm`），当前 canonical 为 `task_create/task_get/task_list/task_update`，字段名与输出结构均不同
  - `Agent`: 参考有独立 `Agent` 工具，当前更接近的是 `task` / `call_omo_agent` 两套体系

### 初步插入点判断

- **推荐插入层**：`services/agent-gateway/src/tool-definitions.ts` + `tool-sandbox.ts` 之间新增“reference environment adapter”最稳。
- **不推荐**直接改 `packages/agent-core/src/tool-contract.ts` 或大范围重命名现有 canonical 工具：这会影响现有 gateway、前端、stream、权限、测试与兼容层。

### 新发现的约束

- `services/agent-gateway/src/routes/stream.ts` 的 `getEnabledTools()` + `filterEnabledGatewayToolsForSession()` 已具备“按 session 过滤工具可见性”的天然接入位，适合后续做 session-scoped tool environment。
- 但 `services/agent-gateway/src/session-workspace-metadata.ts` 的 `sessionMetadataPatchSchema` 当前是严格 allowlist，不包含 `toolEnvironment` / `toolSurface` 一类字段；如果方案采用会话级环境切换，必须同步扩展 metadata patch/schema。
- `services/agent-gateway/src/routes/sessions.ts` 在创建会话和 PATCH 会话 metadata 两条写路径都会调用 `validateSessionMetadataPatch()`；因此会话级环境切换若落在 metadata，create/patch 两条路都必须同步支持，不能只改读取侧。
- `/capabilities` 目前直接消费 `buildGatewayToolDefinitions()` 结果构建可调用工具目录；因此一旦新增 reference surface，`routes/capabilities.ts` 也需要跟着支持按 session 返回对应环境下的工具名，否则 UI 展示会与真实模型可见工具集漂移。

### 受影响回归面（已核对）

- `services/agent-gateway/src/__tests__/tool-definitions.test.ts`
- `services/agent-gateway/src/__tests__/tool-name-compat.test.ts`
- `services/agent-gateway/src/__tests__/session-tool-visibility.test.ts`
- `services/agent-gateway/src/__tests__/capabilities*.test.ts`
- `services/agent-gateway/src/__tests__/stream-protocol.unit.test.ts`

这些测试说明：一旦引入 reference surface，不只是改 schema，还会波及 stream、capabilities、tool-name gating 与 session 级过滤的行为断言。

### 留痕与可观测性约束

- `services/agent-gateway/src/tool-result-contract.ts`、`session-message-store.ts` 当前只留存单一 `toolName`。
- 如果后续采用“对外 reference 名称 / 内部 canonical 名称”双层模型，建议在 run event / tool result metadata 中增加 canonical 名字留痕，或至少约定统一以 model-visible 名字入库、在执行上下文旁路保留 canonical 名字；否则调试与审计时会失去别名映射上下文。

## 差异矩阵（当前版本）

| 参考库工具 | OpenAWork 当前可对接对象 | 当前入参 | 参考入参/风格 | 兼容级别 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `Bash` | `bash` | `{ command, timeout?, workdir? }` | `{ command, timeout?, description?, run_in_background? }` | 中 | 名称不同；缺 `description`、`run_in_background` |
| `Read` | `read` | `{ path?, filePath? }` | `{ file_path, offset?, limit?, pages? }` | 中低 | 不只是字段名差异；参考支持分段/多媒体/PDF 页面 |
| `Edit` | `edit` | `{ filePath, oldString, newString, replaceAll? }` | `{ file_path, old_string, new_string, replace_all? }` | 高 | 典型字段适配场景 |
| `Write` | `write` | `{ path?, filePath?, content }` | `{ file_path, content }` | 高 | 典型字段适配场景 |
| `Glob` | `glob` | `{ pattern, path? }` | `{ pattern, path? }` | 高 | 几乎可直连，仅名称差异 |
| `Grep` | `grep` | `{ pattern, path?, include?, output_mode?, head_limit? }` | `{ pattern, path?, glob?, type?, -A/-B/-C, -n, -i, head_limit, offset, multiline }` | 中 | 当前能力是参考子集 |
| `WebFetch` | `webfetch` | `{ url, format?, timeout? }` | `{ url, prompt }` | 低 | 语义不等价；不能只改字段名 |
| `WebSearch` | `websearch` | `{ query, ...provider相关能力 }` | `{ query, allowed_domains?, blocked_domains? }` | 中低 | 都是 web search，但筛选与结果形状不同 |
| `TodoWrite` | `todowrite` | `{ todos }` | `{ todos }` | 高 | 形状接近，仅名称差异 |
| `TaskCreate` | `task_create` | `{ subject, description?, blockedBy?, blocks?, metadata?, parentID? }` | `{ subject, description, activeForm?, metadata? }` | 中 | 字段接近，但状态/输出不同 |
| `TaskGet` | `task_get` | `{ id }` | `{ taskId }` | 高 | 适合做字段适配 |
| `TaskList` | `task_list` | `{}` | `{}` | 高 | 主要是名称与输出格式差异 |
| `TaskUpdate` | `task_update` | `{ id, subject?, description?, status?, addBlocks?, addBlockedBy?, owner?, metadata? }` | `{ taskId, subject?, description?, activeForm?, status?, addBlocks?, addBlockedBy?, owner?, metadata? }` | 中高 | 字段相近，需补 `taskId -> id` 与 `activeForm` 策略 |
| `Skill` | `skill` | `{ name }` | `{ skill, args? }` | 中低 | 名称与参数语义不同 |
| `AskUserQuestion` | `question` | `{ questions:[{ question, header, multiple?, options:[{ label, description }] }] }` | `{ questions:[{ question, header, multiSelect?, options:[{ label, description, preview? }] }], annotations? }` | 低 | 参考功能更强；当前是简化版 |
| `Agent` | `task` / `call_omo_agent` | `task` 偏编排；`call_omo_agent` 为 `{ description, prompt, subagent_type, run_in_background, session_id? }` | `Agent` 支持 `{ description, prompt, subagent_type?, model?, run_in_background?, name?, team_name?, mode?, isolation?, cwd? }` | 低 | 不能简单映射到单一现有工具 |
| `EnterPlanMode` | 无直接等价模型工具 | 当前无模型可见等价项 | `{}` | 低 | 若要兼容需新增 surface wrapper |
| `ExitPlanMode` | 无直接等价模型工具 | 当前无模型可见等价项 | `{ plan? / 特定流程 }` | 低 | 同上 |

## Oracle 最终裁定后的推荐方案

### 结论

- **保留现有 canonical 小写工具名不动**，例如 `bash/read/edit/write/glob/grep/...`。
- 在 `services/agent-gateway` 增加一层 **Claude Code 兼容 surface**，负责：
  - 对外暴露参考风格工具名（如 `Bash/Read/Edit/...`）
  - 对外暴露参考风格参数形状
  - 在进入 sandbox 前将 reference 名称/入参转换为 OpenAWork canonical 请求
- 使用 **session-scoped profile** 控制启用：
  - `openawork`
  - `claude_code_simple`
  - `claude_code_default`
- 对**低语义匹配工具**先不做假兼容：优先隐藏，或明确返回“当前 profile 暂不支持”，不要静默降级。

### A. 直接复用执行层，仅新增 reference surface

- 保留 OpenAWork canonical 工具：`bash/read/edit/write/glob/grep/...`
- 新增 reference model-visible 名称：`Bash/Read/Edit/Write/Glob/Grep/...`
- 在 gateway schema 暴露层做 **name + input adapter**
- 在 sandbox 执行层做 **reference name -> canonical tool + 参数归一化**

### B. 不建议的方案

- 不建议把 canonical 工具整体重命名成 Claude Code 风格
- 不建议直接把参考库整套 schema 覆盖到现有 `tool-definitions.ts`
- 不建议先只做名字兼容、忽略参数和语义差异；这会导致模型 schema 与真实执行能力漂移

### C. 最可能的分阶段实施顺序

1. 扩展 `session-workspace-metadata.ts`，增加 `toolSurfaceProfile`（或同义字段），并让 `routes/sessions.ts` 的 create/patch 两条写路径都通过校验
2. 新建统一 adapter 模块，维护 `{ presentedName, canonicalName, inputAdapter, exposurePolicy }` 映射表
3. 在 `tool-definitions.ts` 引入 surface-aware builder，按 profile 输出不同 model-visible schema
4. 在 stream 下发工具前做 **出站适配**，在进入 `tool-sandbox.ts` 前做 **入站适配**
5. `/capabilities` 复用同一个 tool-surface resolver，保证“可见即可用”
6. 为 `tool_result/run_event` 增加 canonical 名字留痕，或至少约定 profile 锁定，避免单字段 `toolName` 带来的排障歧义
7. 分三期上线：
   - **P1**：`claude_code_simple` + High 兼容工具
   - **P2**：`claude_code_default` + Medium 兼容工具
   - **P3**：Low 语义工具逐项补齐或正式声明不支持

### 发布与回归要求

- 合同测试：`tool-definitions.test.ts`
- 名称兼容测试：`tool-name-compat.test.ts`
- session 过滤测试：`session-tool-visibility.test.ts`
- 能力目录一致性：`capabilities*.test.ts`
- stream 工具调用链：`stream-protocol.unit.test.ts` 及相关回放/执行测试

## Final Recommendation Summary

- **最佳架构边界**：`tool-definitions.ts`（模型可见层）+ `tool-sandbox.ts`（执行适配入口）
- **canonical 保持不变**：不要重命名现有 OpenAWork 工具
- **兼容方式**：reference surface + adapter，而不是全局替换
- **会话级启用**：用 metadata profile 控制，不影响现有默认行为
- **语义不等价项策略**：不做静默伪兼容，先隐藏/显式不支持，再分阶段补齐

Memory sync: completed
