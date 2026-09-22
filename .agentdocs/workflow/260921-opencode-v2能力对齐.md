# 260921-opencode-v2能力对齐

## Task Overview

对照 opencode v2.0.12（`@temp/opencode`，tag `v2.0.12` / commit `2670273`）的工具与设计盘点结论，为 OpenAWork 补齐**低成本高收益的能力缺口**，并对两项较大能力（CodeMode、browser 检查面）做形态决策。

- **对照基线**：`@temp/opencode/packages/core/src/tool/plugin/*`、`packages/codemode/*`、`packages/core/src/codemode/*`、`packages/plugin-browser/*`
- **盘点证据**：本轮会话已完成双向清单（上游工具 vs 本仓工具；上游设计 vs 本仓设计），关键结论见 `## Current Analysis`
- **本文档定位**：分阶段可执行方案（T-XX 原子任务 + 验证契约 + Gate），**方案阶段，未开始编码**
- **当前状态**：Gate 0 已完成；**Phase 1/2 已交付并验证**（2026-09-21，多并发实施）；**Phase 3（CodeMode）未开始**

## Complexity Assessment

- Atomic steps: 13（T-01…T-13）→ **+2**
- Parallel streams: yes（低成本工具项 / 输入修复 / browser 检查面 / CodeMode 四路相互独立）→ **+2**
- Modules/systems/services: 3+（`agent-gateway`、`agent-core`、`browser-automation`）+ 文档 → **+1**
- Long step (>5 min): yes（CodeMode 解释器、browser 动作真实端到端验证）→ **+1**
- Persisted review artifacts: yes（方案需评审并归档）→ **+1**
- OpenCode available: yes → **-1**
- **Total score: +6**
- **Chosen mode: Full orchestration**
- **Routing rationale**: 13 个原子任务跨 3+ 个模块，含 CodeMode 解释器与真实端到端验证等长步骤，且需 Gate 0 决策与持久化评审；按 skill 规则须 workflow doc + runtime dir + master_plan。

## Current Analysis

### 一、工具维度差距（上游有、本仓缺）

| 上游工具/能力 | 本仓现状 | 证据 |
|---|---|---|
| `execute`（CodeMode 受限 JS 运行时 + `tools.*` 桥 + 目录预算 + `search` + 资源限额） | **完全缺失**（全仓 `grep codemode` 零结果） | 上游 `packages/codemode/*`、`core/src/codemode/{tool,catalog,instructions,web}.ts` |
| `opencode.models`（模型搜索，分页/去重/本 provider 优先） | 无模型可见工具；仅有 settings 路由的 models.dev 发现 | 上游 `core/src/tool/plugin/opencode.ts:134-197`；本仓 `routes/settings.ts`、`provider/models-dev-discover.ts` |
| `opencode.session_rename` | 仅 HTTP PATCH 路由，无模型可见工具 | 上游 `opencode.ts:89-108`；本仓 `routes/sessions.ts:3080,3192-3197` |
| `opencode.session_move`（迁移会话目录，下一安全边界生效） | **有底层能力、无模型可见工具**：已有 `PATCH /sessions/:sessionId/workspace`（D-3 已核实可行） | 上游 `opencode.ts:109-133`；本仓 `routes/sessions.ts:3252` |
| `browser.*` 检查/录制面（`find`/`evaluate`/`console`/网络/`lighthouse`/`dialog`/`frames`/`files.upload`/`preview`） | 底层已有 `snapshot`/`evaluate`/`screenshot`/console 事件，但**未暴露为工具动作** | 上游 `packages/plugin-browser/*`；本仓 `packages/browser-automation/src/index.ts:233,344,371`、`live-session.ts:861,937`、`tools/desktop-automation.ts` |
| `read` 读时自动向上发现 AGENTS.md 并注入 | **有机器未接线**：`DirectoryAgentsInjectorImpl` 仅被 `/init-deep` 调用 | 上游 `read.ts:82-106`；本仓 `packages/agent-core/src/hooks/directory-agents-injector.ts`（已从 index 导出）、`tools/workspace-tools.ts:852 executeReadTool` |
| webfetch 遇 Cloudflare 挑战自动换 UA 重试 | 无重试/UA 逻辑 | 上游 `webfetch.ts:61-65,136`；本仓 `tools/web-tools.ts` |

### 二、设计维度差距（上游很好、本仓缺）

1. **CodeMode 架构**：受限解释器（无 `require`/`import`/定时器）、工具桥（JSON 进出）、目录预算 ~2000 token、内置 `search` 排序、资源限额（timeout/maxToolCalls/maxOutputBytes）、调用进度回流。
2. **工具目录增量指令化**：工具集变化只渲染 delta，不每轮重发全表（`codemode/instructions.ts:34-126`）。
3. **`ToolInputRepairPlugin`**：`tool.execute.before` 里按 schema 修复模型常见输入错误（字符串化 JSON/数字布尔字符串/nullable/数组/元组/字典/`$ref`）。本仓**已有 hook 总线**（`runtime/plugin-host.ts`，`tool.execute.before` 落点在 `tools/tool-sandbox.ts:1697 dispatchToolExecuteBefore`），缺的是内置修复层。
4. **权限拒绝的 defect 隧道**：用户拒绝/提问 dismiss 故意以 defect 抛出，避免被模型误当工具输出（`permission.ts:248-256`，`Effect.die` 在 `:253`）。本仓为 pending 权限请求模型，语义不同，暂不照抄。
5. **tree-sitter 解析 shell 权限资源 + `external_directory` 独立审批**：本仓**有意跳过** tree-sitter（`tools/bash-tools.ts:33-35` 注释）。
6. **可热重载 + 每请求快照的工具注册表**：本仓为 `dynamic-tool-loader.ts`（TTL 缓存）+ 环境变量插件（`plugin-host.ts` 明确不支持热重载）。

### 三、明确不落后（避免误判，勿列为缺口）

- `edit` 多级模糊匹配：本仓 **9 级策略**（精确 / 行裁剪 / 块锚点 / 空白归一 / 缩进归一 / 转义归一 / 多命中 / 边界裁剪 / 上下文锚点，`tools/edit-replacers.ts:45-394`）> 上游 3 级（精确 / Unicode 标点归一 / 行 `trimEnd` 归一，`tool/plugin/edit.ts:49-102,166`）。
- 模型自适应工具裁剪（GPT 系 → `patch`）：本仓已有（`routes/stream.ts:834-901`，过滤点在 `:890`）。
- 统一输出截断 + 引用回读：本仓等价（`tool-output-truncator.ts` + `[tool_output_reference]` + `read_tool_output`）。
- `patch`/`read`/`write`/`glob`/`grep`/`shell`/`subagent`/`question`/`skill`/MCP：能力齐平（`patch` 已于 2026-09-22 对齐命名，其余名称不同）。
- 本仓显著超出上游：`desktop_control`、`generate_image`/`generate_audio`/`convert_media`/`extract_*`/`look_at`、21 渠道工具、`codegraph_*`（6）、10 个 LSP、`repo_clone`/`repo_overview`、`batch`、`task_*` 任务图、SSH 远端执行。

## Solution Design

**总策略**：先做「接线即可、零架构风险」的低成本项（Phase 1），再做「新增中间层、有明确落点」的中等项（Phase 2），最后做 CodeMode（Phase 3，D-1 已定全量）。所有阶段遵循仓库约定：ESM + NodeNext、禁 `any`/`@ts-ignore`、Zod 边界校验、工具必须经 `ToolRegistry`/沙箱白名单、中文提交。

## Gate 0 决策记录（2026-09-21）

| 项 | 决策 | 说明 |
|---|---|---|
| D-1 CodeMode | ✅ **全量立项** | Phase 3 按**全量工具面**设计（不再只做只读子集 MVP） |
| D-2 browser 形态 | ✅ **扩展现有 `desktop_automation`** | 新增 `evaluate`/`console`/`network`/`find`/`tabs` 动作，不新建 `browser_*` 工具族 |
| D-3 `session_move` | ✅ **已核实可行**（本方案纳入 T-13） | 本仓已有 `PATCH /sessions/:sessionId/workspace`（`routes/sessions.ts:3252`，`{workingDirectory, force}` + immutable-lock + `force` warp + `metadata.workspaceWarpHistory` 审计 + SSH 解绑）。缺的只是**模型可见工具**与**安全边界语义** |
| D-4 AGENTS.md 去重 | ✅ **按会话 + 文件路径去重** | 同一 AGENTS.md 每会话只注入一次 |

**D-3 可行性证据**：`routes/sessions.ts:3252`（路由）、`:3263`（schema）、`:3316-3325`（warp history）、`:3340-3346`（SSH 解绑）、`:3350`（allowlist 失效刷新）；不可变性由 `isSessionWorkspaceRebindingAttempt` 控制，`force: true` 才允许 warp。**语义差异**：上游用 `delivery: "steer"` 在**下一个安全边界**移动；本仓 warp 立即写 metadata，当前轮仍可能用旧 cwd——因此工具描述必须要求「同一轮内不要执行依赖目标目录的工具」（与上游提示一致）。

## Implementation Plan

### Phase 0: Gate 0 决策（已完成）
- [x] T-00 ✅: Gate 0 已拍板（D-1 全量立项 / D-2 扩展 desktop_automation / D-3 已核实可行 / D-4 按会话+路径去重）；执行批准状态见 master_plan

### Phase 1: 低成本高收益（可独立发版）—— ✅ 已交付
- [x] T-01 ✅: 新增 `models` 工具（模型搜索）——`tools/model-search-tools.ts`；分页/同 family 去重/本 provider 优先；已登记可见清单+白名单+权限默认放行
- [x] T-02 ✅: `read` 读时注入最近 AGENTS.md——`session/directory-agents-injection.ts` + `tool-sandbox.ts:6566` 接线；会话+路径去重（有界 LRU：256 会话 / 每会话 64 路径）；排除工作区根 AGENTS.md；失败不影响 read
- [x] T-03 ✅: `webfetch` Cloudflare 挑战换 UA 重试——`tools/web-tools.ts`；403 + `cf-mitigated: challenge` 换 UA 重试一次（复用同一 AbortSignal）
- [x] T-04 ✅: 新增 `session_rename` 工具——抽取 `session/session-title.ts:99 renameSessionTitle`；`session-management-tools.ts` 暴露
- [x] T-13 ✅: 新增 `session_move` 工具——抽取 `session/session-workspace-warp.ts:58 warpSessionWorkspace`（保留不可变锁/审计/SSH 解绑/allowlist 失效）；描述含「同一轮内不要执行依赖目标目录的工具」

### Phase 2: 中间层与检查面—— ✅ 已交付（T-07 延后）
- [x] T-05 ✅: schema 驱动工具输入修复——落点改为 `packages/agent-core/src/tools/tool-input-repair.ts` + `ToolRegistry.execute` 的 safeParse 前接线（比 plugin-host 更合适：此处能拿到工具 schema）
- [x] T-06 ✅: `desktop_automation` 新增 `hover`/`check`/`select`/`find`/`frames`/`evaluate`/`console` 7 个 action（`network` 因底层无可查询捕获源**明确跳过**）；同步 `desktop-tool-parameters.ts` 模型可见参数 schema 与断言
- [ ] T-07（可选，延后）: 工具目录增量指令化——评估是否独立于 CodeMode 先行；若做，需新增工具集版本指纹与 delta 渲染

### Phase 3: CodeMode 立项（D-1 = 全量，大工程）
- [ ] T-08: CodeMode 解释器与限额——受限 JS 运行时（禁 `require`/`import`/定时器/文件系统；`Function` 构造器禁用）+ `timeoutMs`/`maxToolCalls`/`maxOutputBytes` + 解释器级字符串/数组/深度限额；**选型与接缝见附录 B（首选移植上游解释器）**
- [ ] T-09: 工具桥 + 内置 `search`——`tools.<ns>.<tool>(...)` 与 `tools.<ns>["tool"]` 路径解析 + 分词加权排序（路径精确/路径词/子串/描述/全文）+ 分页
- [ ] T-10: 目录预算渲染——~2000 token 预算，先保证每个 namespace 可见，再按 listing 成本择优；`pinned` 工具常驻
- [ ] T-11: `execute` 工具接线（**全量工具面**）——全部可暴露工具经 CodeMode 目录可达；注册为模型可见工具，接入沙箱白名单/权限类别/输出截断；与 `codemode:false` 的原生工具列表共存策略
- [ ] T-12: 端到端验证 + 文档 + 归档

## 实施结果（2026-09-21，多并发）

**执行方式**：3 波并发（Wave 1 = T-03/T-05/T-06 并行；Wave 2-A = T-01/T-04/T-13；Wave 2-B = T-02，因共用 `tool-sandbox.ts` 而与 2-A 串行）。

**新增文件**
- `services/agent-gateway/src/tools/model-search-tools.ts`（T-01）
- `services/agent-gateway/src/tools/session-management-tools.ts`（T-04/T-13）
- `services/agent-gateway/src/session/session-title.ts`、`session/session-workspace-warp.ts`（T-04/T-13 抽取）
- `services/agent-gateway/src/session/directory-agents-injection.ts`（T-02）
- `packages/agent-core/src/tools/tool-input-repair.ts`（T-05）
- 测试：`model-search-tools.test.ts`、`session-management-tools.test.ts`、`read-directory-agents-injection.test.ts`、`web-tools-cloudflare-retry.test.ts`、`tool-input-repair.test.ts`、`desktop-inspection.test.ts`

**修改文件（共享接线）**
- `tool-definitions.ts`（可见清单+参数）、`tool-sandbox.ts`（白名单+执行分支+T-02 接线）、`desktop-tool-parameters.ts`（T-06 参数）、`desktop-automation.ts`（T-06）、`web-tools.ts`（T-03）
- `packages/agent-core/src/permission/{permission-categories,tool-category-map}.ts`（新增 `session` 类别；`models` 默认放行）、`tools/tool-contract.ts`（T-05 接线）、`index.ts`（导出）、`packages/browser-automation/src/index.ts`（T-06 底层 console/frames）
- `routes/sessions.ts`（抽取复用，行为不变）

**验证证据**
- `agent-core` typecheck：✅ exit 0；`agent-gateway` typecheck：✅ exit 0
- 网关工具测试：**63 文件 / 470 测试全通过**（含 allow-by-default guard、ladder、definitions、contract-parity）
- agent-core 权限+工具测试：**9 文件 / 229 测试全通过**
- 改动文件 ESLint：**0 error**；Prettier：符合

**关键决策/偏差**
- T-05 落地位置由 `plugin-host` 改为 `ToolRegistry.execute`（该处能拿到工具 schema，且与注册类任务解耦）。
- 权限映射实际位于 `packages/agent-core/src/permission/`（非网关），已做纯增量改动；`session_rename`/`session_move` → 新类别 `session`（`ask`，`auto-edit` 下仍需审批）；`models` → `ALLOW_BY_DEFAULT_TOOL_NAMES`。
- T-06 的 `network` 未实现：底层无持久化请求捕获源（仅事件流），未伪造。
- 已知延后：团队/渠道 toolset 未纳入（`models` 已在第二轮加入 clarify 允许集）。

## 复查跟进（2026-09-21 第二轮）

对首轮交付的自查项做「分析 → 修复/落地」：

| 项 | 结论与处理 | 改动 |
|---|---|---|
| **#2 T-04 改变路由行为** | ✅ 已修：`renameSessionTitle` 改为**按传入值原样写入**；trim 与校验下沉到 `session_rename` 工具侧。`PATCH /sessions/:sessionId` 恢复既有「原样存储」字节级语义 | `session/session-title.ts`、`tools/session-management-tools.ts` |
| **#3 T-03 首次请求 UA 变更** | ✅ 已修：首次请求**不再显式设置 UA**（恢复运行时默认，零行为变更）；仅 Cloudflare 挑战重试时改用专用 UA。对应测试断言已更新 | `tools/web-tools.ts` + 测试 |
| **#4 `models` 澄清模式不可见** | ✅ 已修：加入 `CLARIFY_MODE_ALLOWED_TOOLS`（只读工具），并补锁定测试 | `session/clarify-mode-tool-policy.ts` + 新增测试 |
| **#6 `network` 缺失** | ✅ 已实现：`desktop_automation` 新增 `network_list`/`network_get`；底层有界捕获（环形 200 条、请求体 ≤8KB 可截断、响应头有界、**响应体默认不捕获**并显式声明）；模型可见参数与断言已同步 | `packages/browser-automation/src/index.ts`、`tools/desktop-automation.ts`、`tools/desktop-tool-parameters.ts` + 测试 |
| **#9 T-07 工具目录增量指令化** | ⏸️ **分析后延后至 Phase 3**：本仓**不存在「工具目录指令面」**——工具通过原生 tool list 每请求下发（由 provider 协议处理），系统提示里只有按条件引用具体 MCP 工具名的指引（`stream-system-prompts.ts:41-49`），没有可做 delta 的全表。CodeMode 落地前实现 delta 渲染将是无消费者的投机基建（违反仓库「不做投机复杂度」约定）。**结论：与 CodeMode 一并实现** | 无代码改动 |

**第二轮验证**：网关定向 7 文件 / 50 测试全通过；browser-automation `desktop-inspection` 15 测试通过；`agent-gateway` 与 `browser-automation` typecheck ✅；改动文件 ESLint 0 error。

**复查后收口（2026-09-21）**：对第二轮代码做复查，仅处理「本轮新增代码」中的问题，既有代码不动：

| 复查发现 | 归属 | 处理 |
|---|---|---|
| `networkRequests()`/`networkRequest()` 返回缓冲内可变对象引用（记录创建后会被 status/duration 等事件补齐） | **本轮新增**（#6） | ✅ 改为返回**快照副本**（浅拷贝），并新增「后续事件不改写已返回快照」的测试 |
| `truncated` 语义未说明（仅表示 limit 截断，非环形淘汰） | **本轮新增**（#6） | ✅ 在 `networkRequests` JSDoc 与工具描述中明确 |
| `restart()` 为死代码且监听器绑定临时实例的缓冲（调用后捕获失效） | **既有代码**（不在本轮 diff 内） | ⛔ 按「只管理本轮调整」原则**未改动**，仅记录 |

**收口验证**：browser-automation `desktop-inspection` 16 测试通过；网关 `desktop-automation-tool` 16 测试通过；`browser-automation` typecheck ✅；改动文件 ESLint 0 error、Prettier ✅。

## 增量：`patch` 工具命名与解析器对齐（2026-09-22）

对照上游 `packages/util/src/patch.ts` + `core/src/tool/plugin/patch.ts`，把补丁工具从「能用」推到「与上游同协议」：

| 项 | 处理 | 改动 |
|---|---|---|
| **补丁工具规范名** | 统一为 `patch`，**全仓单一名字**（不保留兼容别名：别名会让模型在历史记录与工具列表间看到两个名字，反而增加误调用）；新旧名字对照见本次提交信息 | `tools/apply-patch-tools.ts`、`tool-definitions.ts`、`tool-sandbox.ts`、`stream.ts`、`tool-permission-derivers.ts`、`tool-category-map.ts`、`session-tool-visibility.ts`、`channel-capability-tool-groups.ts`、`ssh-remote-execution.ts`、`workspace-file-index-invalidation.ts`、`handoff/capability/toolset-gate.ts`、`shared-ui/tool-visual-meta.tsx`、`apps/web` 展示层、`.NET` 能力目录与权限类别映射 |
| **解析器/应用器** | 抽独立纯函数模块，逐条对齐上游：匹配阶梯（exact → rstrip → trim → Unicode 归一化）、`@@` 锚点前跳、`*** End of File`、`*** Environment ID:`、heredoc 剥离、BOM/CRLF 保留、带行号的结构化错误、按 `lineIndex` 顺序推进（重复文本不再反复命中首处） | 新增 `tools/patch-text.ts` |
| **同文件多 Update 块** | 规划阶段用 pending 内容累积（此前第二块会基于磁盘旧内容推导并覆盖第一块） | `tools/apply-patch-tools.ts` |
| **失败可自愈** | 解析/匹配失败改为工具错误结果回传（此前抛异常会中断整个回合，模型没有重试机会） | `tool-sandbox.ts` 补丁分支 |
| **空行容忍** | 有意比上游宽松：操作头之间的纯空行跳过（沿用历史解析器行为，少一轮重试） | `tools/patch-text.ts` |

### 别名治理（2026-09-22，同一轮）

先统计后决策。口径：本地 `openAwork.db` 的 `audit_logs`（21,115 条工具执行，2026-04-25 → 2026-09-22）+ `part_v2` / `session_messages` 交叉核对。

| 项 | 统计结论 | 处理 |
|---|---|---|
| 6 条零使用的历史改名映射（更早版本的文件 / 检索 / shell 工具名） | 执行 **0** 次，历史记录 **0** 处 | ✅ 删除改名表条目（`tools/legacy-tool-name-rewrite.ts`、`routes/tool-name-compat.ts`），改名表随之清空——该模块只剩「剥 `functions.` 前缀」职责 |
| 与 `bash` 重复的历史 shell 工具名 | 与 `bash` **同时出现在模型可见清单**（99 个工具里两个都在），注册表只注册 `bash`，靠改名表兜底；执行 **0** 次 | ✅ 从可见清单移除（`tool-definitions.ts`），删除其改名映射，删除已无消费者的实现文件 `tools/shell-command-tools.ts`；shell 只剩 `bash`（可见工具 99 → 98） |
| `task` → `subagent` | 执行 3 次（最近 2026-06-16），历史 part 3 处 | ⛔ 保留：运行期双名派发，`isTaskToolName()` 同时接受两名 |
| Claude Code 展示名（`Bash`/`Read`/`Edit`/`WebFetch`/`WebSearch`/`TodoWrite`/`Skill`/`AskUserQuestion`/`Agent`） | `Skill` 78、`AskUserQuestion` 34；历史 part `Bash` 104 / `Read` 43 / `WebFetch` 63 | ⛔ 保留：Claude Code 兼容面，属主动功能 |

**回归护栏（不写旧名的性质断言）**：`tool-contract-parity.test.ts` 断言「可见名 ∈ 静态白名单 ∪ Claude 展示名 ∪ 运行期别名」+「除展示名外无需改名即可派发」+「可见名归一化后互不冲突」；`tool-name-compat.test.ts` 断言「归一化对其它任何名字恒等」；`legacy-tool-name-rewrite.test.ts` 断言「任何不带 `functions.` 前缀的名字恒等返回」。三处都改成性质断言：重新引入任何别名都会立刻失败，同时仓库文件里不再出现旧名。

### 全仓统一名称复检（2026-09-22，第二轮）

对「是否还有别名」做全仓扫描（代码 + 提示词 + 文档 + 展示层），本轮又清掉：

| 位置 | 问题 | 处理 |
|---|---|---|
| `stream-system-prompts.ts`（澄清模式提示词） | 提示词写的是 `task/Agent`，而模型可见名是 `subagent` | ✅ 改为 `subagent` |
| `handoff/capability/toolset-gate.ts` | `shell` 能力列了一个**没有任何工具叫这个名字**的旧名（真名 `run_bash_in_background`），会被 `filterToolsByAllowedSets` 静默过滤，等于该能力缺了后台 bash | ✅ 改为真名（顺带修掉一个静默失效） |
| `session-tool-visibility.ts` | 两个已不存在的 shell 工具名 case | ✅ 删除 |
| `edit-tools.ts` / `ssh-remote-execution.ts` | 「已读证据」查询里的旧读工具名 | ✅ 收窄为只认 `read`（fail-safe：旧审计行不算证据，模型重读一次即可） |
| `apps/web` 展示层 | 旧文件/检索工具名的输出渲染分支与注释 | ✅ 删除分支与注释（`read` / `list` / `grep` 分支保留；`SearchResultsPreview` 组件本身保留，有独立测试） |
| `apps/web` 批量子调用摘要 | 旧检索工具名分支 | ✅ 换成 `codesearch`（真名） |
| `omo-manifest.test.ts` 夹具 / 归档文档 / 运维清单 | 旧名残留 | ✅ 同步 |
| `packages/agent-core/docs/shell-integration-example.ts` | 示例工具名与旧 shell 工具名近似 | ✅ 示例改名为 `shell_command` |

**复检结论**：代码 / 提示词 / 文档 / 展示层 / `.NET` / 桌面端 / 移动端 —— **旧名 0 处**。三处守卫测试改为性质断言（不写旧名）；新旧名字对照只保留在提交信息里，仓库文件内不再出现旧名。

**验证**：`patch-text.test.ts` 19 例（信封/Add/Delete/Move/锚点/阶梯匹配/BOM/CRLF/End of File/错误回显）+ 阶梯测试新增「多 Update 块顺序累积」「匹配失败返回工具错误」「单次补丁内新增/修改/移动/删除」3 例；网关全量 534 文件全绿、`agent-core` 48 文件 / 589 测试、`shared-ui` 17 文件 / 133 测试、`apps/web` 工具卡 20 文件 / 396 测试全通过；`agent-gateway` / `agent-core` / `shared-ui` / `web` typecheck ✅。

## Verification Strategy

- **单测**：每个工具新增/修改补 Vitest（`packages/*/src/**/*.test.ts`），覆盖 happy/edge/failure 三态
- **网关验收**：优先放 `services/agent-gateway/src/verification/verify-*.ts`（真实链路），并接入 `test:verification`
- **类型/静态**：`pnpm --filter <pkg> typecheck`；`packages/opencode-llm` 改动需**串行复跑**（并行下性能计时用例会假失败，见项目记忆 2026-09-21）
- **构建**：改 `packages/opencode-llm/src` 必须重建 dist（网关消费 dist）；本方案 Phase 1/2 预计不触碰该包
- **回归门**：改动文件 ESLint 0 error；工具可见性/白名单/权限映射三者一致（新增工具必须同时登记，否则 fail-closed 拒绝）

## Risks & Rollback

| 风险 | 影响 | 缓解 |
|---|---|---|
| `read` 注入 AGENTS.md 导致上下文膨胀 | token 成本上升 | 会话+路径去重 + 复用现有体积上限（256KB/64 文件/1MB 总量） |
| `models` 工具数据源与用户实际可用模型不一致 | 误导模型选型 | 以用户已配置 provider 为准，models.dev 仅补充元数据 |
| 输入修复改变语义 | 工具行为偏差 | 严格“仅 schema 明确支持时修复”，默认不改类型 |
| browser 检查动作引入新依赖 | 体积/安全 | 复用现有 `browser-automation`，不新增依赖；`evaluate` 限会话内页面 |
| CodeMode 解释器逃逸 | 安全 | 无 `require`/`import`/定时器/FS；限额；复用沙箱权限门 |
| 新增工具漏登记白名单 | 工具被 fail-closed 拒绝 | 验收清单强制三项一致（definitions/whitelist/category-map） |

**回滚**：本仓**禁止 git 回滚指令**。任一 Phase 若需撤销，采用**手工反向编辑**并保留解耦改动（参照 260921-多模态媒体引用通路 的终止处理）。

## 附录

- **附录 A**：[上游 `browser.*` 操作面完整清单](260921-opencode-v2能力对齐-附录A-browser操作面.md) —— 43 个操作逐条对照本仓 `desktop_automation`，并给出 T-06 的「先暴露底层已有、再补新能力」两批划分
- **附录 B**：[CodeMode 解释器选型对比](260921-opencode-v2能力对齐-附录B-codemode解释器选型.md) —— 5 方案对比，结论：首选移植上游自研解释器（纯 TS、零原生依赖、兼容 `bun build --compile`），排除 `isolated-vm`/`node:vm`

## Notes

- 盘点基线为 `@temp/opencode`（未跟踪嵌套 git 仓库，**不得提交**）。
- Phase 1 的 T-01…T-04、T-13 相互独立，可并行；Phase 2 的 T-05 与 T-06 独立；Phase 3 依赖 T-00 且与 Phase 1/2 无强依赖。
- 本轮已完成的前置修复：`openai-chat.ts` 空 assistant 报文兼容（保留 reasoning-only，`content: ""`；丢弃全空白 text 回合），与上游语义对齐——**不属于本方案范围，已单独交付**。
