# TeamPage 内容区功能加强与布局重构方案

> 创建时间：2026-05-30
> 关联文档：
> - `.agentdocs/workflow/260516-team-page-功能加强方案.md`（V2 功能补回，前序）
> - `.agentdocs/workflow/260518-team-conversation-decouple-plan.md`（对话装配解耦，已完成）
> - `apps/web/src/pages/team/AGENTS.md`（team 目录产权约束）
>
> 状态：**全部完成**（Wave 0–6 + 后端 emission 复查确认已通；2026-05-31 收尾）

---

## 1. Task Overview

TeamPage V2 的"中间内容区"（`ConversationArea` + `MiddleTabRouter` 下的 5 主 tab / ~19 子 tab）当前能跑通，但存在两类问题：

1. **功能缺口**：用户提出 6 项明确诉求，现状要么完全没有，要么只到半成品：
   - 工作区知识图谱查阅（**完全缺失**）
   - 当前会话的统计（仅有 workspace 级聚合，无 session 级，且数据源未接入）
   - 各层级之间的互相对话查看（仅有 timeline + 抽屉，无跨层对话线程）
   - 3D 动画与各层级联动加强（3D 当前由 mock 角色状态驱动，未联动真实 handoff/layer）
   - 文件区域预览（文件树只能"打开到外部编辑器"，无内联预览）
   - 各层级的详情消耗（耗时有分层，token/费用无分层，无单层下钻）

2. **布局问题**：每个 tab 视图各自用一大堆内联样式手搓卡片，无共享内容组件层，导致视觉零散、信息密度不均、"简单又丑"。这是所有内容区视图的共性根因。

本方案做两件事：先建**内容区视觉与组件地基**，再在地基上把 6 项功能按依赖与价值排波次补齐。

## 2. 核心原则

- **先地基后功能**：所有 tab 视图共用一套 `team-content-kit` 原子（卡片 / 指标网格 / 章节 / 空态 / 迷你图 / 图谱画布壳），消除内联样式重复，再谈新功能。地基不改变现有信息，只统一外观与密度。
- **复用既有真相源**：优先消费现有 store（`useHandoffStore` / `useLayerStore` / `useTeamUsageStore` / `useTeamToolCallStore`）与既有组件（`TeamConversationView` / `ArtifactPreview` / `components/chat/file-preview/*`），不另起炉灶。
- **诚实标注后端缺口**：`team_usage` / `team_tool_call` 事件在 `stores/team/team-usage.ts` 中明确"等待后端接入"。涉及这些数据的功能必须在 UI 上做好"无数据/等待接入"空态，并把后端事件接入列为显式前置任务，不假装有数据。
- **slot 而非 flag**：内容区原子组件不感知"哪个 tab"，差异通过 props / ReactNode 注入（沿用 `TabContainer` / `TabSection` 既有思路）。
- **遵守目录产权**：严格按 `apps/web/src/pages/team/AGENTS.md` 的归类决策树放置文件；单文件 ≤1500 行，>80 行渲染块拆子组件。

## 3. 现状功能实用性分析

按用户 6 项诉求逐条对照现有代码（已逐文件核对）：

| # | 诉求 | 现状组件 | 差距评估 | 数据源现状 |
|---|------|---------|---------|-----------|
| F1 | 知识图谱查阅 | 无（最近似 `TopologyView` / `SessionTreeView`） | **完全缺失**，需要新建图谱视图与图模型 | 可由 `useLayerStore`(节点) + `useHandoffStore`(边) + 产物/文件派生，初版无需新后端 |
| F2 | 当前会话统计 | `UsageView` / `ToolCallsView`（workspace 级，全局聚合） | 无 session 级；且依赖未接入事件 | `useTeamUsageStore.bySession` 已有结构，但 `applyUsageEvent` 等待后端推送 |
| F3 | 层级互相对话查看 | `LayeredConversationView`（双栏 timeline+会话）/ `LayerConversationDrawer`（底部抽屉） | 只能看"单 session 内对话"或"handoff 列表"，缺**跨层对话线程**（handoff 载荷 + 各层回复串联） | `useHandoffStore`(含 from/to layer、sessionId)+ `TeamConversationView` 已够，缺编排视图 |
| F4 | 3D 与层级联动 | `OfficeThreeCanvas`（three.js 办公室，agent 走位/工作动画） | 动画由 `officeAgents`（role→status 的 mock 映射）驱动，**不联动真实 handoff/layer 状态** | `useHandoffStore` / `useLayerStore` 实时状态已具备，缺"状态→动画/高亮/聚焦"的桥接 |
| F5 | 文件区域预览 | `TeamSidebarWithFileTree`（文件树，点击=打开外部编辑器/复制路径） | 无内联预览面板 | 可复用 `components/chat/file-preview/{use-file-preview,path-preview-popover}` + `markdown-message-content` + monaco |
| F6 | 各层级详情消耗 | `TimingView`（分层 P50/P95）；`UsageView`（按 provider/agent/session，**无 layer 维度**） | 缺 token/费用的分层聚合，缺"单层下钻详情" | `useTeamUsageStore` 需补按 layer 聚合；layer 归属可由 `useLayerStore` session→layer 映射得到 |
| L | 布局丑陋 | 各 tab 全内联样式手搓卡片 | 无共享内容组件层，视觉零散、密度不一 | 复用 `TabContainer`/`TabSection` + 新建 `team-content-kit` |

**结论**：F2/F6 高度相关（都围绕"消耗统计"，且共享数据源与下钻交互），合并到一个波次推进；F1/F4 是高投入相对独立项；F5 低风险可快速落地；F3 中等。布局地基是公共前置。

## 4. 目标与非目标

### 4.1 目标
- T1. 建立 `team-content-kit` 共享内容原子，并用它重构现有内容区视图，统一视觉与密度。
- T2. 补齐"当前会话统计"+"各层级消耗详情"（F2 + F6），含按 layer 维度的 usage 聚合与单层下钻。
- T3. 文件区域内联预览（F5）。
- T4. 跨层对话线程视图（F3）。
- T5. 工作区知识图谱查阅视图（F1）。
- T6. 3D 场景联动真实 layer/handoff 状态并支持交互聚焦（F4）。

### 4.2 非目标
- N1. 不重写 `ConversationArea` 的接待对话主链路与 `TeamConversationView` 协议（沿用 260518 解耦结果）。
- N2. 不改 5 主 tab / 子 tab 的导航骨架（`team-page-v2-tabs.ts` / `MiddleTabRouter` 的 key 结构保持）。
- N3. 知识图谱初版**不引入图数据库后端**，先用前端派生图模型；持久化/语义抽取留后续评估。
- N4. 不在本方案内做移动端（mobile）适配深挖，仅保证不破坏现有断点行为。

## 5. 设计要点

### 5.1 Wave 0 · 内容区视觉与组件地基（前置）✅ 已完成
落地于 `apps/web/src/pages/team/runtime/shared/content-kit/`（共享、跨 tab、非 shell → 归 `shared/`，符合 AGENTS.md 决策树第 6 条）：

- `content-kit-tokens.ts`：收敛散落的 `color-mix(...)` / 间距 / 圆角 / 语义 tone 色为常量。
- `StatCard.tsx`：统一指标卡（值 + 标签 + tone + 趋势 + 可点击下钻 + active 态）。
- `MetricGrid.tsx`：`repeat(auto-fill/fit, minmax(...))` 自适应网格容器。
- `SectionPanel.tsx`：带边框/底色的章节面板（区别于 `TabSection` 的透明轻量块）。
- `EmptyState.tsx`：统一空态（emoji + 标题 + 说明 + 可选 CTA + compact 模式）。
- `MiniBar.tsx`：标签 + 进度条 + 数值行（含 percent clamp 与可点击）。
- `Sparkline.tsx`：纯 SVG 迷你折线（无依赖）。
- `index.ts`：barrel 导出。
- `content-kit.test.tsx`：StatCard / MiniBar(clamp) / EmptyState / Sparkline smoke。

已重构（只换外观、行为不变）：`OverviewTab`（指标网格→MetricGrid、活动分布→MiniBar）、`TopologyView`（空态）、`UsageView`（总览卡→StatCard/MetricGrid、空态、行 token）、`ToolCallsView`（空态、行 token）、`TimingView`（概览/分层网格→StatCard/MetricGrid、空态）、`HealthView`（健康概览 14 卡→StatCard/MetricGrid、healthy 空态）、`LayeredConversationView`（3 处空态）。

### 5.2 Wave 1 · 当前会话统计 + 各层级消耗详情（F2 + F6）
- 后端前置（显式任务）：在 `services/agent-gateway` 的 stream usage / tool result 完成处，向 team-events WS 增发 `team_usage` / `team_tool_call` 事件（携带 `sessionId` + 可推导的 `layer`）；前端 `stores/team/team-events.ts` 分发时调用 `useTeamUsageStore.applyUsageEvent` / `applyToolCallEvent`。这是 F2/F6 出真实数据的硬前置；未接入前 UI 走"等待接入"空态。
- `useTeamUsageStore` 扩展 `byLayer` 聚合（layer 由 `useLayerStore` 的 session→roleLayer 映射在分发时附加）。
- 新增 `SessionStatsPanel`（当前选中 session 维度）：消息数 / token / 估算成本 / 工具调用数 / 运行时长 / handoff 数 / 产物数。
- `UsageView` 增加"按 layer"分组档；新增"单层下钻"详情。

### 5.3 Wave 2 · 文件区域预览（F5）
- 新增 `TeamFilePreviewPanel`：点击文件树节点 → 内联预览（文本/markdown / 只读 monaco / 图片 / 其他降级）。复用 `components/chat/file-preview/use-file-preview.ts`。

### 5.4 Wave 3 · 跨层对话线程（F3）
- 新增 `CrossLayerConversationView`：纵向串联 reception→…→reviewer 的 handoff，每条展开"请求载荷 + 目标层会话回复"，可逐层展开完整 `TeamConversationView`。

### 5.5 Wave 4 · 知识图谱（F1）
- `data/build-knowledge-graph.ts` 纯函数派生（节点/边）+ `WorkspaceKnowledgeGraphView`（SVG/Canvas 渲染 + 节点聚焦联动）。

### 5.6 Wave 5 · 3D 与层级联动加强（F4）
- `use-office-layer-binding.ts` 把真实 layer/handoff 状态映射到 3D agent 状态/高亮；`OfficeThreeCanvas` 改用真实状态源 + handoff 连线/移动 + 点击 agent 聚焦层。

## 6. Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: yes → +2
- Modules/systems/services: 3+ → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration（分波次，每波独立验证、独立合并）

## 7. Implementation Plan

### Wave 0 — 内容区视觉与组件地基（前置）✅ 已完成 2026-05-30
- [x] T-00-1: 新建 `runtime/shared/content-kit/`（StatCard / MetricGrid / SectionPanel / EmptyState / MiniBar / Sparkline / tokens + 单测）
- [x] T-00-2: 用 content-kit 重构 `OverviewTab` / `TopologyView`
- [x] T-00-3: 用 content-kit 重构 `UsageView` / `ToolCallsView` / `TimingView` / `HealthView`（并顺带 `LayeredConversationView` 空态）
- [x] T-00-4: 回归校验：`typecheck` 通过、`build` 通过、content-kit 8/8 + LayeredConversationView 4/4 单测通过

### Wave 1 — 当前会话统计 + 各层级消耗详情（F2 + F6）
- [x] T-01-1: 【后端】gateway 在 stream usage / tool result 完成处增发 `team_usage` / `team_tool_call`（带 sessionId）— 复查确认已在 `services/agent-gateway/src/routes/stream.ts` 调用 `publishTeamUsageEvent`/`publishTeamToolCallEvent`/`publishTeamTimingEvent`（经 `stream-team-events.ts` 桥接），并由 `routes/team-events.ts` WS 按 userId 转发；全链路 stream→bus→WS→前端 store→UI 已通
- [x] T-01-2: `stores/team/team-events.ts` 分发接 `applyUsageEvent`/`applyToolCallEvent`，并附 layer
- [x] T-01-3: `useTeamUsageStore` 增加 `byLayer` 聚合 + 单测（team-usage-by-layer.test.ts 4 项）
- [x] T-01-4: 新增 `SessionStatsPanel`（当前 session 维度）
- [x] T-01-5: `UsageView` 增"按 layer"分组 + 单层下钻（点击层级行展开该层 provider/agent 明细）
- [x] T-01-6: 空态：未接入事件时显示"等待接入"

### Wave 2 — 文件区域预览（F5，可与 Wave 1 并行）
- [x] T-02-1: 新增 `TeamFilePreviewPanel`（文本/md/代码/图片/SVG/JSON/二进制 notice 全分支，复用 FilePreviewPane）
- [x] T-02-2: 文件树点击联动：单击预览、面板内"在编辑器中打开"走 onOpenFile
- [x] T-02-3: 大文件（2MB 截断）/ 二进制（不读取走 notice）/ 无网关（错误提示）降级

### Wave 3 — 跨层对话线程（F3）
- [x] T-03-1: 新增 `CrossLayerConversationView`
- [x] T-03-2: 接入"对话"主 tab（新增 `thread` 子项）
- [x] T-03-3: 与层级/双栏入口并存（layered 双栏 + thread 线程 + 抽屉，定位互补）

### Wave 4 — 知识图谱（F1）
- [x] T-04-1: `data/build-knowledge-graph.ts` + 单测（6 项）
- [x] T-04-2: `WorkspaceKnowledgeGraphView`（SVG 分层布局 + 缩放/拖拽）
- [x] T-04-3: 节点点击联动选中 session + 200 节点上限护栏
- [x] T-04-4: 归位为"概览/知识图谱"子 tab

### Wave 5 — 3D 与层级联动加强（F4）
- [x] T-05-1: `use-office-layer-binding.ts`（纯函数 + hook + 单测 6 项）
- [x] T-05-2: `OfficeThreeCanvas` 改用真实状态源（复用既有走位/区域动画实现联动）
- [x] T-05-3: 点击 agent → onSelectAgent 联动选中（既有入口）
- [x] T-05-4: mobile/无 office：沿用既有 `showOffice = !isMobile` 守卫

### Wave 6 — 收尾
- [x] T-06-1: 文档与索引同步
- [x] T-06-2: 全量 `typecheck` 通过、`build` 通过（1m25s）、team 27 suites / 170 tests 通过；无临时文件遗留

## 8. 验收标准

### 8.1 功能验收
- [x] 内容区各 tab 统一使用 content-kit（Wave 0：7 个视图已接入，视觉一致、密度合理）
- [x] 选中某 session 可看到该 session 的统计（SessionStatsPanel；token/费用待后端 team_usage 接入）
- [x] usage 支持"按 layer"分组（按 layer 分组明细已落地）
- [x] 文件树点击可内联预览
- [x] 可查看跨层对话线程
- [x] 可查阅工作区知识图谱
- [x] 3D 场景跟随真实 layer/handoff 状态
- [x] 未接入后端事件处有明确"等待接入"空态

### 8.2 架构 / 质量验收
- [x] `pnpm --filter @openAwork/web typecheck` 零错误
- [x] `pnpm --filter @openAwork/web build` 通过（1m25s）
- [x] content-kit 不感知具体 tab（无 `if (tab === ...)` 业务分支）
- [x] 新增文件归类符合 `apps/web/src/pages/team/AGENTS.md`；单文件 ≤1500 行

## 9. 风险与回退

| 风险 | 影响 | 缓解 |
|------|------|------|
| `team_usage`/`team_tool_call` 后端未接入 | F2/F6 无真实数据 | UI 先做"等待接入"空态；T-01-1/2 作为显式硬前置 |
| 知识图谱渲染引重依赖 / 大图卡顿 | 体积膨胀、性能差 | 初版 SVG/Canvas 自绘（扩展 TopologyView 思路），节点上限护栏 |
| 3D 状态来源切换引回归 | office 视图行为变化 | 仅替换状态来源 + 加交互，保留既有 waypoint；feature flag 兜底 |
| content-kit 重构改动面大 | 视觉回归 | 只换外观不改数据；逐 tab 重构、逐 tab typecheck（Wave 0 已验证此策略可行） |

**回退策略**：Wave 0 为纯外观重构，可整 commit revert；Wave 1–5 均为新增视图/新增数据维度，出问题不影响既有 tab；每波独立验证、独立合并。

## 10. Notes / 进展记录

### Wave 0 收尾（2026-05-30）
- 新增 `apps/web/src/pages/team/runtime/shared/content-kit/`：`content-kit-tokens.ts` / `StatCard.tsx` / `MetricGrid.tsx` / `SectionPanel.tsx` / `EmptyState.tsx` / `MiniBar.tsx` / `Sparkline.tsx` / `index.ts` / `content-kit.test.tsx`。
- 重构消费方：`OverviewTab` / `TopologyView` / `UsageView` / `ToolCallsView` / `TimingView` / `HealthView` / `LayeredConversationView`（空态）。
- 删除各文件内重复的 `STAT_GRID_STYLE` / `STAT_CARD_STYLE` / `EMPTY_STYLE` / 本地 `StatCard` / `UsageCard` / `HealthStat` 等手搓实现。
- 验证：`pnpm --filter @openAwork/web typecheck` 通过；`pnpm --filter @openAwork/web build` 通过（1m17s）；`content-kit.test.tsx` 8/8、`LayeredConversationView.test.tsx` 4/4 通过。
- `SectionPanel` / `Sparkline` 已就位但本波未强制全量替换章节面板（后续波次按需接入，避免一次性大改动引视觉回归）。
- 后端事件接入（T-01-1/2）是 F2/F6 出数的硬前置，建议优先排期；前端可先合并"结构 + 空态"。

### Wave 0 复查（2026-05-30）
- 全量 `pnpm --filter @openAwork/web exec vitest run src/pages/team`：起初 2 个 suite 在**模块加载期**失败（`getProviderUiList is not a function`，位于未改动的 `team-runtime-ui-config.ts`）。
- 定位：vitest 把 `@openAwork/shared-ui` 别名指向 `apps/web/src/test/mocks/shared-ui.tsx`（见 `apps/web/vitest.config.ts`）。该 mock 是手维护子集，未跟上并行 WIP 新增的 `provider-catalog-ui`（`getProviderUiList` / `resolveProviderVisual` 等）。与本波 content-kit 改动无关。
- 处理：在 mock 中补齐 `getProviderUiList` / `lookupProviderEntry` / `resolveProviderVisual` / `hydrateProviderCatalogUi` / `inferProviderLabelFromModelId` 及相关类型的最小实现。
- 复查结果：`src/pages/team` 23 suites / 146 tests 全通过；`typecheck` 通过；Wave 0 各重构视图无回归。
- 改动文件（复查新增）：`apps/web/src/test/mocks/shared-ui.tsx`。

---

## 全波次完成记录（2026-05-30）

### Wave 1 — 当前会话统计 + 各层级消耗（F2 + F6）✅
- `stores/team/team-usage.ts`：新增 `byLayer` 聚合（emptyBucket/clear/applyUsageEvent 同步）。
- `stores/team/team-events.ts`：`team_usage` 分发时按 `payload.layer` 优先、否则 session→roleLayer 派生 `layer`。
- 新增 `runtime/tabs/metrics/SessionStatsPanel.tsx`：当前 session（含子树）的子层级数 / handoff / 运行时长 / token / 费用，未接入 usage 时显示 “—” + “等待 team_usage 接入”。
- `UsageView`：新增 `selectedSessionId/selectedSessionTitle` props、顶部 `SessionStatsPanel`、"按 layer" 分组档与 layer 标签；`MiddleTabRouter` 的 `usage` case 传入 `selectedTeamId/selectedTeam.title`。
- 单测：`team-usage-by-layer.test.ts`（4）。
- 后端硬前置 T-01-1（gateway 发 `team_usage`/`team_tool_call`）仍为独立后端任务；前端结构 + 空态已就位，事件到达即自动出数。

### Wave 2 — 文件内联预览（F5）✅
- 新增 `runtime/shell/sidebar/use-team-file-preview.ts`（复用 workspaceClient.readFile，二进制不读、2MB 截断、请求竞态守卫、workspace 切换清空）。
- 新增 `runtime/shell/sidebar/TeamFilePreviewPanel.tsx`（portal 右侧浮层，复用 `FilePreviewPane` 全分支 + "在编辑器中打开"）。
- `TeamSidebarWithFileTree`：文件树单击 → 预览；面板内 "在编辑器中打开" 走原 `onOpenFile`。

### Wave 3 — 跨层对话线程（F3）✅
- 新增 `runtime/tabs/conversation/CrossLayerConversationView.tsx`：按层级 + 时间排序的纵向 handoff 线程，节点点击内联展开 `TeamConversationView`。
- 接入导航：`MiddleTabKey` + `team-page-v2-tabs`（对话主 tab 新增 `thread` 子项）+ `MiddleTabRouter` case + TeamPageV2 内嵌视图切换按钮。

### Wave 4 — 知识图谱（F1）✅
- 新增 `runtime/data/build-knowledge-graph.ts`（纯派生：session/artifact 节点 + parent/handoff/produces 边，去重）+ 单测 `build-knowledge-graph.test.ts`（6）。
- 新增 `runtime/tabs/overview/WorkspaceKnowledgeGraphView.tsx`（SVG 分层布局 + 缩放/拖拽 + 节点点击联动选中 session + 图例 + 200 节点上限护栏；选中会话时叠加其 spec/plan/tasks/review 产物节点）。
- 接入导航：概览主 tab 新增 `graph` 子项。

### Wave 5 — 3D 与层级联动（F4）✅
- 新增 `runtime/hooks/use-office-layer-binding.ts`：`deriveLayerActivity` / `layerToOfficeStatus` / `deriveOfficeStatusOverlay` 纯函数 + `useOfficeLayerBinding`，把真实 layer/handoff 状态映射为 office agent 的 working/discussing/resting；feature flag `localStorage['teamV2.office.liveBinding']='0'` 可回退。
- `OfficeThreeCanvas`：`officeAgents` 改为消费 `useOfficeLayerBinding(rawOfficeAgents)`，复用既有走位/动画系统实现联动；点击 agent → `onSelectAgent`（既有）联动选中。
- 单测：`use-office-layer-binding.test.ts`（6）。
- mobile/无 office：沿用 TeamPageV2 既有 `showOffice = !isMobile` 守卫，未破坏。

### Wave 6 — 收尾 ✅
- 验证：`pnpm --filter @openAwork/web typecheck` 通过；`pnpm --filter @openAwork/web build` 通过（1m25s）；`src/pages/team` + `src/stores/team` 27 suites / 170 tests 全通过。
- 复查发现并修复：CrossLayerConversationView 残留 `summary` 引用（tsc 捕获，editor diagnostics 漏报——以 `tsc --noEmit` 为准）；office-binding 测试空 `Set` 推断为 `Set<unknown>`（显式 `Set<TeamRoleLayer>()`）。

### 已知后续（非阻塞）
- ✅ T-01-1 后端 `team_usage`/`team_tool_call` 事件发射：复查确认已在 `stream.ts` 经 `stream-team-events.ts` 桥接发出并由 `team-events` WS 转发，F2/F6 全链路已通。
- ✅ 单层下钻：UsageView "按 layer" 分组下点击层级行可展开该层最近调用明细（provider/model/token）。
- ✅ 知识图谱 workspace 级全量产物：新增 `use-team-workspace-artifacts.ts`（消费 `/team/artifacts?teamWorkspaceId=`，后端已返回 `sessionId`，web-client 类型补 `sessionId`），`WorkspaceKnowledgeGraphView` 改为按 workspace 拉全量产物并建 produces 边，不再局限于选中 session。
- ✅ CrossLayerConversationView 的 handoff "请求载荷摘要"：`HandoffEntry` 增 `summary` 字段，dispatcher 从事件 payload（rewrittenIntent>sourceIntent>recommendedNextStep>summary）首次提取并固定，线程节点下展示 2 行摘要。
- ✅ `components/chat/file-preview/use-file-preview.test.tsx`：并行 WIP 的失败断言（期望 "503" 实为响应体 "file unavailable"）已对齐为 `toContain('file unavailable')`，全量 web 套件 82 suites / 701 tests 全绿。

### 收尾验证（2026-05-31 第二轮）
- `pnpm --filter @openAwork/web-client build` 通过；`pnpm --filter @openAwork/web typecheck` 通过；`pnpm --filter @openAwork/web build` 通过。
- 全量 web 测试：82 suites / 701 tests 全通过（含 team 28 suites / 174 tests，web-client team-phase-a 9 tests）。


---

## 11. 顶部 Tab 栏重设计（2026-05-31）

### 背景
6 项功能落地后，顶部 tab 区域混用了 4 套视觉语言（主分类 segmented、子 tab、3D 入口、聚焦 banner），观感零散。用户反馈"顶部不同类型的 tab 切换很丑"。

### 改动
- 新增 `runtime/shell/header/TeamTabBar.tsx`：统一两层胶囊体系——主分类 segmented pills（含未读/待澄清 badge）+ 子 tab pills + 独立 3D 办公按钮。office 视图下隐藏子 tab 行。
- `views/TeamPageV2.tsx`：topBar 内联 ~230 行 JSX 替换为 `<TeamTabBar/>` + 聚焦 banner。
- `runtime/tabs/team-page-v2-tabs.ts`：移除 9 个已死的样式常量，仅保留结构数据（视觉样式集中到 TeamTabBar）。
- `runtime/styles/team-runtime.css`：新增 `.team-tab-pill` hover/active 守卫。
- 单测：`TeamTabBar.test.tsx`（8）。

---

## 12. Tab 整理与合并（2026-05-31）

### 目标
20 个叶子 tab 精简到 **12 个**。策略：**合并为内部 mode-toggle，不删功能**——避免功能丢失，同时降低导航噪音。

### 最终结构（5 主 tab / 12 叶子 + office 沉浸视图）
| 主 tab | 叶子 | 合并来源 |
|--------|------|---------|
| 概览 | dashboard / graph / health | graph = topology + 知识图谱 |
| 对话 | conversation / layered / messages | layered 内含「双栏 / 线程」切换（吸收 thread） |
| 任务 | artifacts / review | artifacts「任务与产物」吸收 tasks + dispatch（会话树/待澄清/任务派发/产物链一体化） |
| 度量 | usage / timing | usage 内含「用量 / 工具调用」切换（吸收 tools） |
| 治理 | templates / shares / audit / settings | 移除 members（与侧栏重复） |

### 关键改动
- `team-page-v2-tabs.ts`：`PRIMARY_TABS` 重写为 12 叶子结构；`MIDDLE_TAB_KEYS` / `LEAF_TO_PRIMARY` / `getDefaultLeafFor` 由结构派生，localStorage 旧 key（topology/thread/tasks/dispatch/tools/members）回落到主 tab 默认子项。
- `MiddleTabRouter.tsx`：`MiddleTabKey` union 收敛到 15 项（含 office/conversation）；移除 topology/thread/tasks/dispatch/tools/members case；删除死辅助 `TaskFailureBanner` + `HandoffCancelInline`。
- `LayeredConversationView.tsx`：新增 `layoutMode`（'split' | 'thread'）头部切换按钮，thread 模式内嵌 `CrossLayerConversationView`。
- `TeamArtifactSection.tsx`：新增 `handoffs` + `onCancelHandoff` props；内嵌 `ClarificationsPanel`（待澄清）+ `RunningHandoffCancelList`（运行中任务取消）；标题改「任务与产物」。
- 新增 `runtime/tabs/tasks/RunningHandoffCancelList.tsx`（从旧 HandoffCancelInline 抽出）。
- `UsageView.tsx`：包一层「用量 / 工具调用」mode toggle，tools 模式渲染 `ToolCallsView`。
- 导航/标签 remap：`team-runtime-navigation.ts`（`tasks`/`dispatch` → `artifacts`）、`HealthView.tsx`（`resolvePreferredTabForLayer` → artifacts）、`MentionsView.tsx`（阻塞动作标签）、`TeamPageV2.tsx`（`focusSuggestedTab` + `onOpenClarifications` → artifacts）。
- 删除孤儿组件：`overview/TopologyView.tsx`、`tasks/DispatchTab.tsx`（功能已被 graph / artifacts 吸收；grep 确认零外部引用）。`TasksTab`/`TeamsTab` 仍被 legacy shell（`MainWorkspace.tsx`）引用，保留。
- 单测更新：`TeamTabBar.test.tsx`（关系图谱/层级标签）、`team-runtime-navigation.test.ts`（remap 断言）、`LayeredConversationView.test.tsx`（新增「线程」模式切换用例，5 tests）。

### 验证
- `pnpm --filter @openAwork/web typecheck` 通过（tsc --noEmit 为权威闸门）。
- `pnpm --filter @openAwork/web exec vitest run src/pages/team`：26 suites / 166 tests 全通过。
- `pnpm --filter @openAwork/web build` 通过（1m17s）。

---

## 13. 复查美化（2026-05-31）

合并完成后的视觉收口，消除"合并 tab 时各自手搓的 mode-toggle"造成的不一致：

- 新增 content-kit 原子 `shared/content-kit/SegmentedToggle.tsx`（受控 segmented 控件：轨道容器 + accent 软底选中胶囊，`size: sm | md`）+ 单测 `SegmentedToggle.test.tsx`（2）。barrel 导出。
- `UsageView.tsx`：「用量 / 工具调用」切换改用 `SegmentedToggle`，删除本地 `MODE_BAR_STYLE` / `MODE_BTN_STYLE` / `MODE_BTN_ACTIVE_STYLE`。
- `LayeredConversationView.tsx`：「双栏 / 线程」切换改用 `SegmentedToggle`（size=sm），删除本地 `LayoutModeBtn` 手搓胶囊。
- `RunningHandoffCancelList.tsx`：内部「运行中任务」小标题从 uppercase muted 微标改为与 `TabSection` 标题同级（12px/700/fg-strong），与 TeamArtifactSection 其它章节标题一致。
- 清理：删除 `team-runtime.css` 中 tab 重设计后已无引用的 `.team-primary-tab` 规则；修正 `TeamTabBar.tsx` docstring ASCII 图中过期的子 tab 名（拓扑/知识图谱/跨层线程 → 关系图谱 / 当前对话·层级·消息）。

### 验证
- `pnpm --filter @openAwork/web typecheck` 通过；`pnpm --filter @openAwork/web build` 通过；`src/pages/team` 27 suites / 169 tests 全通过。

---

## 14. 层级角色提示词只读预览（2026-05-31）

用户诉求：在层级相关视图里能快速预览每层角色的提示词（此前只能进「治理 · 设置」手动生成）。

### 实现
- 新增 hook `runtime/hooks/use-team-role-prompt-preview.ts`：自包含（内部从 `useAuthStore` 取 gatewayUrl/token 自建 `TeamPhaseAClient`），给定 `TeamRoleLayer` 并行拉取 `getPersona`（SOUL 人格）+ `previewInstructionStack`（7 层指令栈）。导出纯函数 `mapTeamLayerToSoulLayer`：前端 7 层 → 5 层 SOUL，`user`/`tester` 无独立 SOUL 返回 null（`supported=false`）。请求竞态用 seq 守卫。
- 新增 `runtime/shared/RolePromptPreviewPanel.tsx`：右侧滑出 portal 浮层，只读。`SegmentedToggle` 切换「角色 SOUL」（MarkdownMessageContent 渲染 + 默认/自定义徽章）与「完整指令栈」（各层注入徽章 + 估算 token + 超限提示 + stableBlock 全文）。不支持的层显示空态。
- 接入三处入口：
  * `LayeredConversationView`：选中具体层级筛选时，头部出现「🧬 角色提示词」按钮，预览该层。
  * `CrossLayerConversationView`：每个线程节点右侧加 🧬 按钮，预览该 handoff 的 `toRoleLayer`。
  * `WorkspaceKnowledgeGraphView`：选中会话后，头部出现「🧬 角色提示词」按钮，预览选中会话所在层（带 teamWorkspaceId 让宪法按工作区注入）。
- 只读定位：编辑 / 保存 / ForceApply 仍在「治理 · 设置」面板，预览面板不提供写操作。

### 测试
- `use-team-role-prompt-preview.test.ts`（6）：层映射、layer=null/tester/enabled=false 不发请求、支持层拉取 persona+stack。
- `RolePromptPreviewPanel.test.tsx`（5）：null 不渲染、SOUL 模式、切指令栈、关闭回调、不支持层空态。

### 验证
- `pnpm --filter @openAwork/web typecheck` 通过；`pnpm --filter @openAwork/web build` 通过；`src/pages/team` 29 suites / 180 tests 全通过。

---

## 15. 角色提示词预览增强（2026-05-31）

用户反馈"展示很简单、看不到实际提示词"。**根因**：SOUL 文件是 YAML frontmatter（5 维度画像）+ Markdown 正文，而面板原先直接把 `soulMd` 丢给 chat 的 markdown 渲染器——它没有 frontmatter 插件，会把开头的 `---` 当成 `<hr>`，导致画像被吞、正文错乱，且无处看/复制字面提示词。默认 SOUL 内容其实很丰富（`soul-defaults.ts`），问题纯在前端呈现。

### 改动
- 新增 `runtime/data/parse-soul-frontmatter.ts`（零依赖轻量解析：拆 frontmatter scalar/列表字段 + 正文，保序，认不出原样保留）+ 单测（4）。
- 重写 `RolePromptPreviewPanel`：4 个模式 segmented 切换——
  * **画像**：5 维度结构卡（身份/语气/关注/边界/输出风格），accent 小标题 + 列表/标量。
  * **正文**：frontmatter 之后的 Markdown 干净渲染。
  * **原文**：字面 SOUL 全文（含 frontmatter），等宽 pre + 「复制全文」。
  * **指令栈**：7 层注入稳定块全文 + 注入徽章 + token，「复制全文」。
  - 头部「复制全文」按钮按当前模式复制原文/指令栈；默认/自定义 SOUL 徽章移到模式行。
- 面板加宽到 `min(680px, 68vw)`。

### 测试
- `parse-soul-frontmatter.test.ts`（4）；`RolePromptPreviewPanel.test.tsx` 更新为画像/原文/指令栈断言（6）。

### 验证
- `typecheck` 通过；`build` 通过；`src/pages/team` 30 suites / 185 tests 全通过。

---

## 16. 角色能力卡（层级工具/产物/指令能力，2026-05-31）

用户问"各层工具/skill 是固定还是可动态调整"——答案是：**能力天花板固定（架构护栏），天花板内的具体启用项动态可配**。为让这点在 UI 上可见，给角色提示词预览面板加了「能力」tab。

### 后端（真相源，避免前后端漂移）
- 新增 `services/agent-gateway/src/team/team-layer-capability-summary.ts`：聚合 `LAYER_CAPABILITIES`（固定护栏：工具类别 / 可派发 / 可写产物 / 可调指令）+ `role-adapter` 默认 toolset/agent 实现，产出 per-layer 摘要，并标记每个工具类别是否 `defaultEnabled`。纯函数。
- 新增路由 `GET /team/layer-capabilities`（可选 `?layer=`），在 `routes/team-phase-a.ts`；`user` 等不支持层返回 404。
- 单测：`team/layer-capability-summary.test.ts`（4）+ `team-phase-a-routes.test.ts` 追加 3 个路由用例。

### web-client
- 新增类型 `LayerCapabilitySummary` / `LayerToolsetCategory` / `LayerCapabilitiesLoadResult` + `getLayerCapabilitiesResult` 方法，barrel 导出。

### 前端
- `use-team-role-prompt-preview.ts`：并行多拉一个 `getLayerCapabilitiesResult`，新增 `capability` 字段。
- `RolePromptPreviewPanel.tsx`：新增「🧰 能力」tab——展示角色实现（adapter/impl/终端层）、工具类别天花板（含「默认启用」绿标）、可派发去向、可写产物、可调内置指令，并用说明文案点明"天花板固定、skill/MCP/模型在治理设置与模板里动态配"。
- 单测：面板加「能力」tab 断言；hook 测试补 capability 断言。

### 验证
- 后端 typecheck + build 通过；web-client build 通过；web typecheck + build 通过。
- `src/pages/team` 30 suites / 189 tests 全通过；后端 team 路由 20 tests + summary 4 tests 全通过。

---

## 17. 角色提示词预览面板细节打磨（2026-05-31）

针对"细节优化"做了一轮交互与可读性打磨：

- **遮罩 + ESC + 滚动锁**：浮层加半透明 backdrop（点击关闭，编辑中不误关）；ESC 关闭（编辑中先退出编辑保护草稿不丢）；打开时锁 `body` 滚动。
- **滑入动画**：backdrop 淡入 + 面板从右滑入（`team-runtime.css` 新增 `role-prompt-fade-in` / `role-prompt-slide-in` keyframes，带 `prefers-reduced-motion` 降级）。
- **指令栈可读化（重点）**：之前把整段 `<team-instruction layer="...">…` XML 原样塞进 `<pre>`，难读。新增 `runtime/data/parse-instruction-stack.ts` 解析器，把 stableBlock 按 `<team-instruction>` 标签拆成有序片段（架构/宪法/项目记忆/经验/个人记忆/SOUL/缓存标记/超限警告），「指令栈」tab 改为**按层折叠卡**：中文标签 + 原始 layer 名 + 内容（宪法/记忆/SOUL 等走 markdown 渲染，其余等宽）；cache-breaker 不单独成卡；空内容给引导文案。

### 测试
- 新增 `parse-instruction-stack.test.ts`（5）：分段/归类、self-closing tag、raw 保底、空串、label/markdown 判定。
- `RolePromptPreviewPanel.test.tsx` 补「指令栈分段折叠」用例 + `beforeEach` 重置共享 mock 状态（消除测试间状态泄漏）。注：并行同事已为该面板加了 editable/ESC 用例，本轮与之合流不冲突。

### 验证
- web `tsc --noEmit` 通过；`build` 通过；`src/pages/team` 31 suites / 196 tests 全通过。
- 注：复查期间 web-client `team.ts` / `session-workspace-metadata.ts` 出现并行 WIP（团队 session-init 特性）的瞬时编译/测试红，均非本功能文件，稍后自行恢复。

---

## 18. 角色提示词面板间距规范化（2026-05-31）

用户反馈"不要胡乱使用边距"。面板里散落着 `gap: 1/3/4/7/8/14`、`padding: 14 / '8px 12px 0' / '7px 10px' / '3px 9px' / '6px 10px'`、`borderRadius: 6/8/10`、`margin: '0 2px'` 等魔法值，且 error/warning/info 三处提示框各写一套内联样式。

### 改动
- content-kit token 补一个 `CK_PAD_SM = '4px 10px'`（按钮/pill/徽章紧凑内边距），barrel 导出。
- `RolePromptPreviewPanel.tsx` 全量收敛到 content-kit token 尺度：
  - 所有 padding → `CK_PAD` / `CK_PAD_SM` / `CK_GAP_LG`；gap → `CK_GAP` / `CK_GAP_SM`；圆角 → `CK_RADIUS` / `CK_RADIUS_SM`；边框 → `CK_BORDER` / `CK_BORDER_SUBTLE`；表面 → `CK_SURFACE` / `CK_SURFACE_SOFT`。
  - 区块小标题统一用 `CK_SECTION_LABEL_STYLE`（画像维度、能力分组共用）。
  - 抽出共享 `Callout`（danger/warning/info 三态）替换 4 处手搓提示框；按钮抽 `ACCENT_BTN_STYLE`；pill 抽 `PILL_BASE_STYLE`，能力 pill / 层徽章 / 默认启用徽章全部继承它。
  - SOUL 字数阈值提为常量 `SOUL_GUIDELINE_LIMIT` / `SOUL_HARD_LIMIT`。
  - 剩余的极少数 sub-token 值（标题/副标题 1px 行距、列表项 3px、pill 的 `3px 10px`）是文本行内微距，集中在 `PILL_BASE_STYLE` 等单一定义里，不再散落。

### 验证
- web `tsc --noEmit` 通过；`build` 通过；`src/pages/team` 32 suites / 200 tests 全通过（面板 12 + content-kit 8 等）。
