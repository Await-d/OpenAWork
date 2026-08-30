# 自动压缩上下文挡位与聊天统计刷新

## Task Overview
为模型配置增加自动压缩上下文挡位（自动、272K、400K、1M、自定义），使后端实际使用有效窗口与压缩阈值/目标预算，并让聊天输入框下方的 Token、窗口和百分比统计在设置保存后立即刷新。

## Current Analysis
- 模型目录已有原始 `contextWindow`，但设置中的压缩比例字段尚未接入网关运行时。
- 自动压缩、工具输出截断和流式溢出判断仍存在固定预算或环境变量覆盖。
- 聊天统计由当前模型选项构造，需确认状态更新后没有旧缓存阻断重算。
- 压缩摘要长度不可严格保证，因此目标值语义采用“目标回落约为”，并将预算安全地接入保留上下文/工具输出路径。

## Solution Design
- 新增独立 `contextWindowOverride?: number`，保留模型原始能力并计算有效窗口。
- 有效窗口按模型能力、用户挡位、运行时发现值和环境覆盖取最小值。
- 将 `autoCompactThresholdRatio` 接入实际触发；目标比例接入近期上下文和工具输出预算。
- 设置 UI 使用快捷挡位选择，保留兼容字段但隐藏未完整支持的自由目标比例编辑。
- 保存模型后沿用现有 providers 状态更新，让 `activeModelOption`、`ComposerStatsData` 和上下文快照同步重算；必要时补充显式刷新依赖。

## Complexity Assessment
- Atomic steps: 6 → +2
- Parallel streams: yes (backend and frontend investigations/implementation) → +2
- Modules/systems/services: 4+ → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: no → 0
- **Total score**: 7
- **Chosen mode**: Full orchestration
- **Routing rationale**: 跨共享类型、网关压缩链路、设置 UI 和聊天统计，后端与前端可并行推进，需持久化工作流和分阶段验证。

## Implementation Plan

### Phase 1: 运行时模型与压缩链路
- [x] T-01: 明确模型配置、有效上下文窗口和压缩预算接口
- [x] T-02: 接入网关路由、自动压缩阈值与目标预算
- [x] T-03: 为后端逻辑补充回归测试

### Phase 2: 设置与聊天统计
- [x] T-04: 实现上下文挡位设置与保存
- [x] T-05: 接通聊天统计实时刷新
- [x] T-06: 前端类型、测试与视觉 QA

### Phase 3: 收口
- [x] T-07: 运行 targeted tests、typecheck、lint/format 并复核最终 diff
- [x] T-08: 同步 durable memory，归档工作流

## Validation Evidence

- 类型检查：`@openAwork/web-client`、`@openAwork/web`、`@openAwork/shared-ui` 均通过。
- 前端测试：模型设置、统计栏、UnifiedComposer、上下文用量 4 个文件共 12 项通过；web-client settings 19 项通过。
- 后端测试：网关压缩/Provider/设置相关 5 个文件共 35 项通过；agent-core catalog 18 项通过。
- 构建与规则：`pnpm --filter @openAwork/web build` 成功；定向 ESLint、`lint:rules`、Prettier 和 `git diff --check` 通过。构建保留既有 chunk size 与动态导入提示。
- 真实浏览器：Playwright 在 375px、768px、1280px 下打开聊天输入框模型设置，验证自动/272K/400K/1M、自定义 500000、Enter 提交及 Tab 焦点；统计即时显示 `上下文 234/500.0K`、`窗口 500.0K`，无页面错误。
- 截图证据：`.omo/evidence/auto-compaction-fresh-dialog-{375,768,1280}.png`、`.omo/evidence/auto-compaction-fresh-custom-{375,768,1280}.png`。
- 独立视觉审查：`.omo/evidence/auto-compaction-gate-review.md`，功能/设计完整性审查通过；视觉/CJK 审查通过，无阻断项。

## Notes
- 保留用户已有未提交改动，不执行回滚或清理。
- 真实供应商分段价格不由本次上下文挡位伪造；如需 272K/400K/1M 不同价格，后续应新增价格阶梯模型。
- Memory sync: completed（已将有效上下文窗口与聊天快捷挡位决策同步到 `.agentdocs/index.md`）。
