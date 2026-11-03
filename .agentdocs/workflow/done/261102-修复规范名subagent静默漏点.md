# 261102-修复规范名 subagent 静默漏点（G1 / G2 / #3 / #4 / #6）

> 本任务是 `261102-移除omo耦合与提示词替换` 的**遗留项独立立项**（该任务已归档到 `workflow/done/`）。
> **V4（最终）**：全部修复完成并通过独立核验。

## 一、定性总表（最终，逐条经实测校准）

| 编号 | 位置 | 可达性（**以"可观测差异"为准**） | 处置 |
| --- | --- | --- | --- |
| **G1** | `session/session-tool-visibility.ts` `resolveChannelToolKey()` 缺 `case 'subagent'` | **不可达**：`:408` `isTaskToolName()` 截获 + `:305`/`:317` 传字面量 `'task'` → 入参永远不是 `subagent` | **修**（防御性）+ 导出该函数以便断言 |
| **G2** | `channels/channel-capability-tool-groups.ts` `resolveChannelCapabilityToolGroup()` 缺 `case 'subagent'` | **可达**：`capabilities.ts:451` 用分组做能力**过滤**（`orchestration=false` 关不掉 `subagent`、`other=false` 误关）、`:182` 统计错位 | **修** |
| **#3** | `session/clarify-mode-tool-policy.ts` `CLARIFY_MODE_ALLOWED_TOOLS` 缺 `'subagent'` | **可达**（`:371` clarify 前置分支早于 `:408`）→ **本次唯一可达行为变更** | **修** + 行为变更登记 |
| **#4** | `tools/tool-output-truncator.ts` `TRUNCATABLE_TOOLS` 缺 `'subagent'` | **零可观测效果**：`DEFAULT_MAX_BYTES === UNIVERSAL_MAX_BYTES === 50 KiB`（`:35`/`:49`），且 `task`/`subagent` 均无 `TOOL_SPECIFIC_*` 覆盖 | **修**（前瞻性一致性） |
| **#6** | `apps/web/src/components/common/display/channel-capability-tool-groups.ts` `classifyCapabilityToolGroup()` 缺 `case 'subagent'` | **可达**（前端订阅草稿/注入分组归类） | **修**（1 处真缺口） |
| #5 | `routes/stream.ts:952` `TOOLS_REQUIRING_NON_EMPTY_ARGS` 缺 `subagent` | 可达但影响极低（空参守卫不触发） | **不修，仅登记**（并行 stream 分层重构在写该文件） |

## 二、行为变更（唯一一项，必须知情）

**#3 是本次唯一可达的行为变更**：澄清（clarify）模式下，委派工具的可见性由 `false → true`（`task` / `Agent` 一直为 `true`）。

- **可达链**：`isGatewayToolEnabledForSessionMetadata` 的 clarify 前置分支（`:371`）按**传入名**判定，早于 `:408` 的 task 分支 → 修复前 `subagent` 未登记 → 被判不可见。
- **实测**（双方独立）：`task => true`、`subagent => true`（修复前 `false`）、`Agent => true`、`read => true`、**`write => false`（保持拒绝）**。
- **依据**：白名单本就纳入 `task` / `Agent` → "澄清模式允许委派（只读调研）"是既有产品意图；本次是**消除同名工具的不一致**，非新增权限。
- **只读意图未放宽**（M3 严格核验）：HEAD 与当前白名单 `diff` **仅 `> 'subagent'` 一行**，无其它增删；含写语义的 `lsp_touch` 在 HEAD 中**即已存在**；`write`/`edit`/`patch`/`bash`/`create`/`delete`/`remove`/`rename`/`revert` 均不在白名单。
- **审批档位未变**：`subagent` 仍走 `isTaskToolEnabledForSessionMetadata` → 委派审批仍 **`task_run → ask`**。

## 三、修复清单（10 个文件）

**源（4 修改）**：`session/session-tool-visibility.ts`（补 `case 'subagent'` + `export resolveChannelToolKey`）、`channels/channel-capability-tool-groups.ts`（补 `case 'subagent'` → `orchestration`）、`session/clarify-mode-tool-policy.ts`（白名单补 `'subagent'`）、`tools/tool-output-truncator.ts`（`TRUNCATABLE_TOOLS` 补 `'subagent'`）、`apps/web/.../common/display/channel-capability-tool-groups.ts`（前端补 `case 'subagent'`）。

**测试（3 修改 + 2 新增）**：`__tests__/session/session-tool-visibility.test.ts`（+6 用例）、`__tests__/session/clarify-mode-tool-policy.test.ts`（修改）、`__tests__/tools/tool-output-truncator.test.ts`（修改）、`__tests__/channels/channel-capability-tool-groups.test.ts`（新建）、`apps/web/.../channel-capability-tool-groups.test.ts`（新建）。

**断言有效性**（独立复演 HEAD 版实现）：

| 断言 | 修复前 | 性质 |
| --- | --- | --- |
| `resolveChannelToolKey('subagent') === 'task'` | `null` → **必失败** | 真回归保护 |
| `resolveChannelCapabilityToolGroup('subagent') === 'orchestration'` | `'other'` → **必失败** | 真回归保护 |
| `CLARIFY_MODE_ALLOWED_TOOLS` 的 `subagent` 用例 | `false` → **必失败** | 真回归保护 |
| `TRUNCATABLE_TOOLS` 的 `subagent` 等价性用例 | 前后都通过 | **前瞻性不变量**（诚实标注，非回归证明） |

## 四、门禁（差集口径，含时点）

```
[20:08] 网关 4 文件 vitest                              → exit 0（79 tests passed）
[20:08] apps/web 该文件 vitest                          → exit 0（5 tests passed）
[20:09] bun run --filter @openAwork/agent-gateway typecheck → exit 0
[20:09] cd apps/web && bunx tsc --noEmit -p tsconfig.json  → exit 0
[20:10] eslint <8 网关文件>                              → exit 0
[20:10] prettier --check <10 文件>                       → exit 0
```

## 五、独立核验结论（`gates-verifier`，不复用实施者自测）

- **G1**：不可达性成立（`:408` 截获 + `:305`/`:317` 硬编码）；**零行为变化 9/9 逐格一致**；并用 `git diff HEAD` 证明 `:305`/`:317` **未被改动** → 入参只能是 `'task'` → 端到端**不可能**变化（不可变性推理，比"跑一遍"更严谨）；键解析等价，`Agent`/`Skill`/`batch` → `null` **未误改**。
- **G2**：修复 + 可达影响链核实；已撤回其早前"纯归类/展示"的误判。
- **#3**：方向 `false → true` 确认；只读意图未放宽（见 §二）。
- **#4**：确认为**零可观测效果**（与实施者独立得出同一结论）。
- **#6**：**前后端全量逐条对齐（59 label / 13 分组）→ 差异 0 处**；并**自我更正**了此前"3 处漂移"的误报（原表按 `case` 标签抽取，漏掉前端 pre-switch `if` 链）。
- **导出立场**：`export resolveChannelToolKey` 判定**可接受、无需替代方案**（公共入口被截获，不导出则该不变量无法被任何断言保护；纯函数无副作用）。

## 六、关键方法论（3 条，均已写入项目记忆）

1. **"可达性"必须以"可观测差异"为准，而不是"集合/配置的文本差异"**。本任务两次踩坑：G1（公共入口截获 → 端到端无差异）、#4（两个上限常量相等且无 override → 零效果）。**先跑输入→输出，再谈缺陷等级**。
2. **比对两份实现要用"行为等价法"**（逐 label 比较两函数返回值），不要比 `case` 标签集合 —— 否则 `switch` vs `if` 的组织差异会被误报为缺失（#6 的 `repo_clone`/`repo_overview` 即此）。
3. **自报门禁必须带"命令 + 退出码 + 时点"**。本轮一次 `TS2345` 曾被误判为"自报不实"，实为并发采样时点差（实施方 19:55 落地、核验方 19:4x 采样）；**先查 mtime 再下结论**。

## 七、遗留（不纳入本任务）

| 项 | 内容 | 建议 |
| --- | --- | --- |
| #5 | `routes/stream.ts:952` `TOOLS_REQUIRING_NON_EMPTY_ARGS` 缺 `subagent` | 等并行 stream 分层重构合入后一并收敛 |
| 架构 | **同一分组规则在前后端各有一份实现**（`resolveChannelCapabilityToolGroup` vs `classifyCapabilityToolGroup`），本轮修复前仅 `subagent` 一处归类不一致 | **单独立项**做实现统一（两份存在有意取舍面：前端认展示名、后端认运行时名） |

## 八、过程失误留痕（双向，供后来人参考）

| 失误 | 责任方 | 内容 |
| --- | --- | --- |
| G1 定性过高 | **协调者** | 在 `261102-移除omo耦合与提示词替换` 的 F3 §3 与 `index.md` 写成「fail-closed 功能丧失」，并据此设计"行为变更知情条款"；后被 M3 自我更正 + 协调者复核推翻 |
| G2 定性过低 | M3 | 称 G2 为"纯归类/展示"；协调者核实 `capabilities.ts:451` 的过滤用途后更正为"可达" |
| #4 定性过高 | **协调者** | 称"可达·轻微降级"；实施者实测两个上限常量相等且无 override → 零可观测效果 |
| 未验证即断言 | **协调者** | 在核实命令返回前宣称"M3 漂移表我独立核实成立"，并据此把 G-08 扩展为"补 3 处"；若执行会在 switch 里产生两个**死 case**（pre-switch `if` 先返回）→ 已立即撤销 |
| 比对方法缺陷 | M3 | 漂移表按 `case` 标签抽取，漏掉前端 pre-switch `if` 链中的两个 `label ===` 等值判断 → 误报 2 处；已改用行为等价法并自我更正 |
| 自引入问题 | M2 | `matrixMetadata` helper 的 `boolean \| undefined` 联合导致 `TS2345`（`typecheck exit 2`），自行发现并修复；**主动披露** |

## 九、备注

- 行号会漂移，**以符号名定位**（`resolveChannelToolKey` / `resolveChannelCapabilityToolGroup` / `CLARIFY_MODE_ALLOWED_TOOLS` / `TRUNCATABLE_TOOLS`）。
- `routes/stream.ts:952` 是本任务唯一"已识别、暂不修复"项，原因见 §七。
- 本任务与 `261102-移除omo耦合与提示词替换` 同源：都源于"工具规范名 `subagent` 收敛"后遗留的"按历史别名登记"习惯。

## 十、后续收敛（2026-11-02 追加，归档后）

§七 遗留项 **#5 已收敛**（当时因并行 stream 分层重构在写 `routes/stream.ts` 而登记不修）：

- **前提**：并行重构已停（`routes/`、`channels/` 近 20 分钟无写盘；`stream.ts` mtime 停在 **19:06**）；
- **动作**：`stream.ts:952` 的 `TOOLS_REQUIRING_NON_EMPTY_ARGS` 补 `'subagent'`（与 `'task'` 并置 + 注释）；`__tests__/routes/stream-error-contracts.test.ts` 新增一条守卫断言（**补登记前会失败**，属真回归保护，与 #4 的"前瞻性不变量"性质不同）；
- **门禁**：`stream-error-contracts` **19 passed**、gateway `typecheck` **exit 0**、prettier / eslint **exit 0**；
- **证据**：`runtime/261102-修复规范名subagent静默漏点/results/followup-05-arg-guard.md`。

至此 `261102` 系列发现的 **6 处**规范名登记漏点全部落地（5 处修复 + 本处收敛），**无剩余待修项**。§七 的架构遗留（前后端分组规则重复实现）仍建议单独立项。
