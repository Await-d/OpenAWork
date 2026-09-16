# agentdocs 归档审计与 runtime 残留清理

> **日期**：2026-09-16 ｜ **状态**：已完成 ｜ **类型**：知识库维护（非业务代码）
> **说明**：本任务的目标即整理 `.agentdocs/` 自身，故完成时**直接落位于 `done/`**（创建即完成，不存在「先活跃后归档」的中间态）。

## Task Overview

对 `.agentdocs/` 的「方案是否完成 / 是否归档 / 归档后 index 是否同步」做一次全量审计，并清理已归档任务残留的 `runtime/` 目录。

## Current Analysis（审计发现）

| 项 | 审计前 | 审计后 |
| --- | --- | --- |
| `workflow/` 活跃方案 | 14（含 260916 收尾中） | 5 |
| `workflow/done/` 归档 | 76 | 84（含本文件） |
| `index.md` 登记为已完成的条目 | 9 | 16 |
| `runtime/` 残留目录 | 62 | 9 |
| index 悬空链接 | 10 | 0 |
| index 幽灵条目 | 1 | 0 |

**发现的 4 类问题**：

1. **已完成但未归档**（8 个仍留在 `workflow/` 根）。
2. **归档后未登记**：`index.md` 只登记了 9/76，绝大多数归档方案无可检索入口。
3. **幽灵条目**：`index.md` 曾把 `260814-migrate-opencode-llm-library` 标为「进行中 0/18」，但**该方案文件与 runtime 目录均不存在**（实际已并入 `250109-opencode-llm-full-migration`）。
4. **悬空链接 10 个**：index 指向已被清理的 `runtime/` 文件。

## Solution Design（判定规则）

**归档判据**：文档任务框全部勾选，或「未勾选项已有明确处置」（用户决定挂起 / 外部人工 gate / 已被后续方案取代）。
**不清算规则**：`runtime/` 为临时目录（`.gitignore`），归档后即可清理；但下列四类**必须保留**：

- **P1** 活跃方案（`workflow/*.md`）对应的 runtime 目录
- **P2** 近 60 分钟内被改动（**并发会话正在使用**）
- **P3** `index.md` 显式引用的目录
- **P4** 大体积 / 备份 / 演示类（转人工确认，不自动删）

## Implementation Plan（执行结果）

### 归档（8 个 → `done/`）
- [x] T-01 ✅ `260905-tool-context`
- [x] T-02 ✅ `260905-tool-context-optimization`
- [x] T-03 ✅ `260906-chat-order-followup`
- [x] T-04 ✅ `260814-session-recovery-enhancement`（代码已落地 6/6 文件，正文任务框未同步，已在文档顶部补记说明）
- [x] T-05 ✅ `260817-提交前收口`（过期快照，对应提交 `611a105e`，已在文档顶部补记说明）
- [x] T-06 ✅ `260914-grill-clarification-enhancement`（A 层由 260915 方案承接，B/C 层未立项）
- [x] T-07 ✅ `260915-浏览器预览功能增强`（未勾选 4 项系用户决定挂起、1 项人工视觉走查）
- [x] T-08 ✅ `260915-澄清完成自动切换编程模式`（已实现验证；代码变更仍在工作树待提交）

### index.md 修复
- [x] T-09 ✅ 补登记 6 条已完成方案 + 修正 2 条状态归位（🟡 → ✅ + 归档链接）
- [x] T-10 ✅ 删除幽灵条目 `260814-migrate-opencode-llm-library`（原位保留说明）
- [x] T-11 ✅ 修复全部 10 个悬空 runtime 链接（改为「已按 cleanup-policy 清理」的说明文本）
- [x] T-12 ✅ 章节更名 `当前进行中的任务` → `未完成与近期收口任务（明细）`
- [x] T-13 ✅ `更新记录` 与 `全局重要记忆` 各补一条

### runtime 清理
- [x] T-14 ✅ 删除 53 个残留目录（均为 8K 存根或已归档任务证据），清单见下
- [x] T-15 ✅ 保留 4 个受保护目录 + 5 个转人工确认目录

## 删除清单（53 个，2026-09-16）

```
260416-team-创建实施方案                          260419-net10-wave2-message-v2-权威消息层迁移
260416-team-创建流程设计分析                      260419-net10-wave2-run-events-运行线程迁移
260417-net10-settings-第二批只读迁移              260419-net10-wave2-sessions-基础crud迁移
260417-net10-settings-首批只读迁移                260419-permission-第五阶段兼容面退役评估
260417-net10-网关框架搭建实施方案                 260419-permission-第六阶段公开导出收缩
260418-permission-第三阶段内核收口                260420-message-runtime-assistant-trace-协议下沉实施
260418-permission-第二阶段协议收口                260420-message-runtime-compaction-结构收口实施
260418-permission-第四阶段收尾评估                260420-message-runtime-前端运行时协议收口实施
260418-permission-统一使用方式改造                260420-message-runtime-参考库稳定结构移植实施
260419-net10-wave1-workflows-控制面迁移           260420-message-runtime-对话存储与上游格式收敛方案
260419-net10-wave2-event-log-溯源层迁移           260420-net10-wave2-commands-execute迁移
260420-net10-wave2-pending-interactions-持久化迁移 260420-net10-wave2-permissions-pause-resume迁移
260420-net10-wave2-sse-attach-replay迁移           260420-net10-wave2-stop-active迁移
260420-net10-wave2-ws-stream-runtime迁移           260422-net10-wave2-run-003-session-todos迁移
260422-net10-wave2-run-003-session-truncate迁移    260422-net10-wave2-run-009-init-deep迁移
260421-net10-wave2-data-014-...迁移                260421-net10-wave2-run-003-...迁移
260421-net10-wave2-run-007-...迁移                 260421-net10-wave2-run-008-...迁移
260421-net10-wave2-run-010-...迁移                 260422-gpt-image2-集成方案
260422-net10-wave2-run-002-sessions-search迁移     260422-net10-wave2-run-009-refactor迁移
260704-companion-linkage-enhancement               260704-complete-active-workflows
260704-telemetry-consent                           260706-desktop-control-plugin-integration
260708-opencowork-tooling-integration-plan         260709-资源能力集成使用方案
260715-composer-input-history-recall               260723-mobile-pen-visual-alignment
260723-team-lifecycle-hard-contract-tools          260725-team-layer-todo-workbench
260813-chat-right-panel-completion                 260814-session-recovery-enhancement
260905-tool-context                                260905-tool-context-optimization
260914-grill-clarification-enhancement
```
（完整机器可读清单曾输出至 `/tmp/opencode/agentdocs-runtime-cleanup-260916.txt`，属临时文件）

## 保留项

**P1/P2/P3 直接保留（4 个）**：

| 目录 | 保留理由 |
| --- | --- |
| `260706-fusion-layout-t1-s2-refactor` | 对应方案仍活跃（头部标注「进行中，F4 仅剩移动端侧面板适配」） |
| `260915-浏览器预览功能增强` | `index.md` 显式引用其 `master_plan.md` |
| `260915-终端-vscode-能力对齐` | `index.md` 显式引用其 `final_output.md` 与**冻结契约 `contract.md`** |
| `260916-终端面板-vscode布局对齐` | 归档审计期间**另一并发会话正在使用**（近 60 分钟改动） |

**P4 转人工确认（5 个，共 76M，未删）**：
`260704-composer-optimization-visual`(216K) · `260704-global-layout-backup-213631`(776K) · `260704-layout-redesign-demo`(116K) · `260705-layout-component-fusion`(22M) · `260707-fusion-layout-visual-qa`(53M)

> 后两者为历史视觉 QA 截图，前者含 `tracked-layout.diff` 布局文件备份——**删除前建议先确认是否还需回查**。

## Notes

- **并发写入防护**：审计期间另一会话正实时归档 `260916-终端面板-vscode布局对齐` 并改写 `index.md`。处置：不动该任务任何文件；对 `index.md` 采用「最后读 + 唯一字符串锚点替换 + 改完复验」，**不做整文件覆写**。
- **未纳入本次范围**（仍在活跃，不予归档）：`250109-opencode-llm-full-migration`（5 项外部/人工 gate 未取得）、`250815-opencode-llm-effect-native-final`（仅剩 N-12 外部 gate）、`260704-opencode-ui-layout-borrow-plan`（13 项标注未实施/阻塞）、`260706-fusion-layout-t1-s2-refactor`（头部标注进行中）、`260814-team-communication-enhancement`（4 项协作模式未落地）。
- **未纳入本次范围**（技术债）：`done/` 内约 16 个历史文档仍含已推迟的未勾选项，属归档时点的真实遗留，不回填。
- **验证**：`index.md` 全部相对链接可达性扫描 **0 悬空**；`workflow/` 根 5 个、`done/` 84 个、`runtime/` 9 个计数一致。
- Memory sync: completed（结论已写入 `index.md` 的「全局重要记忆」与「更新记录」）。
