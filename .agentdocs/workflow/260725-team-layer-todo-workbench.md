# 260725-team-layer-todo-workbench

## Task Overview

基于原型 `demo/team-layer-todo-detail-demo.html`，在 Team 经典/并排对话页落地「左主对话 + 右层级/角色/任务/消息工作台」改造方案，并形成可分阶段实施的详细计划。

**实现范围收紧（用户 2026-07-25）**：只修改**经典布局**（`workbenchLayoutMode === 'classic'`）下的 Team 对话工作台；**Fusion 路径保持不变**；不修改 Classic 全局布局壳（`LayoutClassic` / `AppSidebar`）。  
用户已要求开启多代理实施。

**原型真源**：
- `demo/team-layer-todo-detail-demo.html`

**主要落点（实现期）**：
- `apps/web/src/pages/team/views/TeamPageV2.tsx`
- `apps/web/src/pages/team/conversation/*`
- `apps/web/src/pages/team/runtime/tabs/{tasks,overview,metrics,governance}/*`
- 既有 Fusion 侧栏壳 `TeamFusionSidePanel.tsx` 可借鉴，不可原样搬到 Classic 冻结路径

## Current Analysis

### 原型信息架构

```
┌──────────────────────── 主对话 (≈56%) ──────────────────────┬── 工作台 (≈44%, min 500px) ──┐
│ chat-bar: 路径 / 状态 / 耗时 / 失败数                        │ side-tabs: 任务|概览|度量|治理 │
│ chat-quick: 暂停/重试/定位失败/复制摘要/专注对话              │ control-bar + layer-overview  │
│ decision-bar: 已确认决策 chips                               │ layer-rail (b/c/d/e/t/r)      │
│ attention-bar: 待你处理（失败/阻塞）                          │ role-strip                    │
│ stream: 用户/助手气泡 + inline 进度/阻塞/失败卡 + 建议/产物  │ body: todo 列表 + 选中明细消息│
│ jump-rail: 用户消息跳转                                      │ 或 overview/metrics/gov 内容  │
│ composer: 约束 / 澄清回复 / 追加任务                         │                              │
└──────────────────────────────────────────────────────────────┴──────────────────────────────┘
```

交互核心是 **选中态联动**：

```
selectLayer(layerId, roleId?)
  → 优先选该层 failed/blocked/running todo
  → 切到 tasks tab

selectTodo(todoId)
  → 回写 layerId + roleId
  → 右侧消息区按 role/msgFilter 过滤

attention / fail card / focus-fail
  → 滚动到左侧 inline 卡或右侧对应 todo
```

### 现状代码对齐

| 能力 | 现状 | 与原型差距 |
|------|------|------------|
| 左右并排壳 | `TeamPageV2` 中 `workbenchSidePanel = undefined`，右侧工作台已关闭 | 需重新启用并换成 layer-todo 工作台 |
| 主 tab 分类 | 概览/对话/任务/度量/治理 已存在 | 原型把非对话主 tab 钉到右侧 |
| 多层消息 | `TeamMultiLayerPanel` / `TeamMultiLayerFeed` / `TeamConversationLayerSidePanel` | 有层消息，缺 layer→role→todo 明细联动 |
| 任务列表 | `TasksTab` + `TeamTasksWorkbenchHeader` + runtime tasks | 有列表，无 layer rail / role strip / 选中明细消息三栏 |
| 跳转轨 | `TeamUserJumpRail` | 基本可复用 |
| 暂停/失败控制 | runtime controls / notices | 可映射 chat-quick，但文案与入口需收敛到对话顶栏 |
| 澄清/权限 | `ClarificationsPanel`、inline permission reply | 有数据，但无 decision-bar / attention-bar / inline-card 产品壳 |
| Composer 意图 | 通用发送 | 无 约束/澄清/追加 三模式协议 |
| 决策持久化 | 无前端“已确认集”模型 | 需新 view-model，后端持久化可后置 |

### 关键约束（必须遵守）

1. **布局主线是 Fusion-only，Classic 冻结**（`.agentdocs/index.md` ADR 2026-07-14）：
   - 不得以“对称重构”名义继续改造 Classic 旧布局路径（`LayoutClassic.tsx` / `AppSidebar.tsx` 等）。
   - 本原型虽写“经典页”，落点应解释为 **Team 并排对话工作台（Fusion/classic workbench 并排模式）**，优先挂在 `TeamPageV2` 的 workbench 并排壳上，而不是复活 Classic 全局布局。
2. 现有超大文件不可继续膨胀：
   - `TeamPageV2.tsx` ~1721 行
   - `TeamConversationView.tsx` ~1524 行
   - `use-team-conversation-state.ts` 极大
   - 必须新建组件/view-model，禁止把原型整页塞进单文件。
3. 复用优先：TasksTab / MultiLayer / JumpRail / Clarifications / runtime status 只做适配，不重写任务/消息真相源。
4. 本轮方案默认 **前端读模型重排 + 局部交互增强**；composer 三模式真生效、决策集服务端持久化属于可选二期。

### 主要风险

1. **IA 冲突**：当前“中间主 tab 承载任务/概览/治理” vs 原型“右侧常驻工作台”。需要明确：并排模式下对话常驻左侧，右侧只承载非对话主 tab。
2. **数据语义不齐**：demo 的 `LAYERS/TODOS/messages` 干净；真实链路是 `roleLayer + handoff + runtime task + multi-session messages + clarification`，要做派生 view-model。
3. **看起来像 vs 真能用**：纯 UI 复制中等；联动状态机 + 失败/阻塞语义 + 测试回归才是高成本。
4. **双布局分叉**：若只改 classic workbench flag、不接 Fusion 并排，会留下第二套体验。

## Solution Design

### 产品定位（方案决策）

**采用：Team 并排工作台（Workbench Side Panel v2）**

- 入口：`TeamPageV2` 在 `workbenchLayoutMode` 为 fusion/classic 并排时启用右侧工作台。
- 左侧：永远是 `TeamConversationView`（对话主表面）。
- 右侧：`TeamLayerTodoWorkbench`（新），默认 Tab = 任务；可切概览/度量/治理。
- 不修改全局 Classic 布局冻结边界；不重开 `LayoutClassic` 演进。

### 目标架构

```
TeamPageV2
├── TeamTabBar / Superbar（状态摘要保留，避免与 chat-quick 重复过重）
├── main row
│   ├── TeamConversationView（左）
│   │   ├── ChatOpsBar（新：路径/状态/快捷）
│   │   ├── DecisionBar（新）
│   │   ├── AttentionBar（新）
│   │   ├── message stream + InlineOpsCard（新）
│   │   ├── TeamUserJumpRail（既有）
│   │   └── ComposerIntentMode（新，可二期）
│   └── TeamLayerTodoWorkbench（右，新）
│       ├── WorkbenchTabs（任务/概览/度量/治理）
│       ├── LayerOverview + LayerRail
│       ├── RoleStrip
│       └── TasksBody
│           ├── TodoList
│           └── TodoDetailMessageStream
└── view-model: useTeamLayerTodoWorkbenchModel（新）
```

### 数据派生（view-model）

新建纯函数 + hook，不改后端协议：

```ts
// 伪结构
type WorkbenchLayer = {
  id: TeamRoleLayer;
  code: string;
  name: string;
  color: string;
  state: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
  live: boolean;
  roles: WorkbenchRole[];
  messageSessionIds: string[];
};

type WorkbenchTodo = {
  id: string;
  key: string; // #12
  title: string;
  sub?: string;
  layer: TeamRoleLayer;
  roleId?: string;
  status: 'pending' | 'running' | 'failed' | 'blocked' | 'done';
  priority?: 'P0' | 'P1' | 'P2';
  owner?: string;
  elapsedLabel?: string;
  source: 'runtime-task' | 'session-todo' | 'handoff';
};

type WorkbenchSelection = {
  tab: 'tasks' | 'overview' | 'metrics' | 'governance';
  layerId: TeamRoleLayer | 'all';
  roleId: string | 'all';
  todoId: string | null;
  msgFilter: 'all' | 'dialog' | 'tool' | 'error' | 'handoff';
  todoFilter: 'all' | 'active' | 'blocked' | 'done';
};
```

派生源优先级：

1. **层/角色**：team definition / roster / handoff roleLayer
2. **任务**：runtime tasks 为主，sessionTodos / review cards 为辅
3. **消息**：按层 session 聚合（复用 `LayerMessages` 构建逻辑）
4. **待处理**：failed/blocked tasks + pending clarifications + pending permissions

### 分阶段交付

#### Phase 0 — 边界冻结与信息架构确认（方案期，本轮完成）

- 明确：本改造挂 Team 并排工作台，不碰 Classic 全局布局冻结路径
- 明确 MVP / 二期边界
- 产出 workflow + master_plan

#### Phase 1 — 右侧任务工作台 MVP（优先）

目标：左对话 + 右任务台可用，联动选中态成立。

1. 恢复 `TeamPageV2` `sidePanel` 插槽（仅并排模式）
2. 新建 `TeamLayerTodoWorkbench` 壳 + tabs
3. 新建 `useTeamLayerTodoWorkbenchModel`
4. 实现 layer-rail / role-strip / todo list / 选中 todo 明细（消息可先简版）
5. 概览/度量/治理先 **嵌入现有 tab 内容**，不重做视觉

#### Phase 2 — 左侧运营对话壳

1. ChatOpsBar（状态 + 快捷：暂停/重试/定位失败/专注对话）
2. AttentionBar（失败/阻塞/待确认）
3. InlineOpsCard（progress / block / fail / done）
4. 与右侧 todo 双向跳转

#### Phase 3 — 决策与输入意图（可选增强）

1. DecisionBar（前端 session 级已确认集，可 localStorage）
2. ComposerIntentMode：约束 / 澄清 / 追加
3. 澄清模式对接现有 clarification reply；约束/追加若无协议则先做前端前缀/标签

#### Phase 4 — 打磨与回归

1. 专注对话（收起右侧）
2. 计数 badge、空态、窄屏策略（右侧变抽屉）
3. 定向测试 + 关键路径回归

### MVP 明确不做

- 不改 backend handoff / task schema
- 不新建第二套消息存储
- 不 1:1 复刻 demo 的全部装饰动画
- 不重做 overview/metrics/governance 视觉
- 不做决策集服务端持久化（除非产品后续点名）

### 关键影响文件（实现期预估）

**新建（建议）**

- `apps/web/src/pages/team/views/workbench/TeamLayerTodoWorkbench.tsx`
- `apps/web/src/pages/team/views/workbench/TeamLayerRail.tsx`
- `apps/web/src/pages/team/views/workbench/TeamRoleStrip.tsx`
- `apps/web/src/pages/team/views/workbench/TeamTodoListPanel.tsx`
- `apps/web/src/pages/team/views/workbench/TeamTodoDetailStream.tsx`
- `apps/web/src/pages/team/views/workbench/use-team-layer-todo-workbench-model.ts`
- `apps/web/src/pages/team/views/workbench/team-layer-todo-workbench-model.ts`
- `apps/web/src/pages/team/conversation/ops/TeamChatOpsBar.tsx`
- `apps/web/src/pages/team/conversation/ops/TeamAttentionBar.tsx`
- `apps/web/src/pages/team/conversation/ops/TeamDecisionBar.tsx`
- `apps/web/src/pages/team/conversation/ops/TeamInlineOpsCard.tsx`
- 对应 `*.test.ts(x)`

**修改**

- `TeamPageV2.tsx`：恢复 sidePanel 接线，传入 workbench model
- `TeamConversationLayout.tsx` / `TeamConversationView.tsx`：挂运营条与 inline card 槽位
- 样式：team v2 / conversation 相关 css module 或现有 class
- 必要时轻改 `TeamFusionSidePanel` 仅作 API 对齐参考，不强制替换

### 验证策略

1. 单测：view-model 派生（层/角色/任务过滤、选中联动、preferred todo）
2. 组件测：Workbench tabs、todo 选中、attention 显示条件
3. 页面测：`TeamPageV2` 并排模式 sidePanel 可见；focus 模式收起
4. 手工：有失败任务时左右跳转一致；无任务空态；窄屏不炸布局
5. 回归：现有 TasksTab / MultiLayer / JumpRail / permission reply 不回归

### 工期粗估（1 人熟悉 team 模块）

| 阶段 | 工期 |
|------|------|
| Phase 1 右侧 MVP | 4–6 天 |
| Phase 2 左侧运营壳 | 3–4 天 |
| Phase 3 决策/输入意图 | 2–4 天（看协议深度） |
| Phase 4 打磨回归 | 2–3 天 |
| **合计可用闭环** | **约 1.5–2.5 周（到 Phase 2）** |
| **高保真** | **约 3–4 周（含 Phase 3/4）** |

## Complexity Assessment

| Signal | Observation | Score |
|--------|-------------|-------|
| Atomic steps | 14（方案拆解 + 后续实现波次任务） | +2 |
| Parallel streams | 是：view-model / 右侧壳 / 左侧运营条 / 既有 tab 嵌入可并行 | +2 |
| Modules/systems/services | 3+：TeamPageV2、conversation、runtime tabs/tasks/status | +1 |
| Long step (>5 min) | 是：联动状态机与数据映射 | +1 |
| Persisted review artifacts | 是：workflow + master_plan | +1 |
| OpenCode available | 否（当前 Claude Code） | 0 |
| **Total** |  | **+7** |

- **Chosen mode**: Full orchestration
- **Routing rationale**: 跨 conversation + TeamPageV2 + runtime tabs 的信息架构改造，任务多、有并行流与持久方案文档需求；本轮只产出方案，runtime 用于后续实现协调。

## Implementation Plan

### Phase 0: 方案与边界（本轮）

- [x] T-01 ✅: 盘点原型结构与现有 Team 并排/侧栏/任务/多层消息能力
- [x] T-02 ✅: 确认 Fusion-only / Classic 冻结约束，校正落点为并排工作台而非 Classic 全局布局
- [x] T-03 ✅: 定义目标架构、view-model、分阶段边界与 MVP 不做清单
- [x] T-04 ✅: 写入 workflow + runtime master_plan，并注册 index

### Phase 1: 右侧任务工作台 MVP（classic-only 已落地）

- [x] T-05 ✅: 定义 `team-layer-todo-workbench-model` 纯函数与单测（层/角色/todo 派生、过滤、preferred selection）
- [x] T-06 ✅: 实现 `useTeamLayerTodoWorkbenchModel`（接 runtime tasks / handoffs / layer nodes）
- [x] T-07 ✅: 新建 `TeamLayerTodoWorkbench` 壳（tabs + layer overview/rail 槽位）
- [x] T-08 ✅: 实现 `TeamLayerRail` + `TeamRoleStrip` + 选中态
- [x] T-09 ✅: 实现 `TeamTodoListPanel`（过滤/优先级/状态）与 `TeamTodoDetailStream`（简版消息）
- [x] T-10 ✅: `TeamPageV2` 仅 classic 恢复并排 `sidePanel`，默认 tasks；focusMode/mobile 收起右侧；fusion 不变
- [x] T-11 ✅: 概览/度量/治理嵌入现有 middle tab 默认叶子内容（不重做视觉）

### Phase 2: 左侧运营对话壳（classic 已挂载）

- [x] T-12 ✅: `TeamChatOpsBar` + classic `ClassicTeamConversationOpsChrome` 已挂到对话 beforeMessages
- [x] T-13 ✅: `TeamAttentionBar` 已挂载（失败 handoff / pending clarification 时显示）
- [x] T-14 ✅: `TeamInlineOpsCard` + `ClassicTeamConversationInlineCards` 已挂 afterMessages（fail/block/progress）
- [x] T-15 ✅: 定位失败优先滚到内联卡，其次运营条 attention 锚点；打开任务台可退出专注模式

### Phase 3: 决策与输入意图（MVP 范围收口）

- [x] T-16 ✅: `TeamDecisionBar` 前端可移除确认集（session 内存；服务端持久化不做）
- [x] T-17 ⏸️: Composer 三模式 UI **明确后置**（非 classic MVP 阻塞项）
- [x] T-18 ⏸️: 真协议提交 **明确后置**

### Phase 4: 打磨与回归

- [x] T-19 ✅: classic 去 maxWidth 限制；focusMode/mobile 收起右侧；session-first 并排
- [x] T-20 ✅: workbench/ops/ConversationArea 定向测试通过；改动文件无新增 TS 错误
- [x] T-21 ✅: 修复数据映射：lane tags 还原 failed；blocked 含 failed；handoff 与 runtime 合并
- [x] T-22 ✅: 接通填入回复（composer-reference 事件）；澄清按 session scope 过滤
- [x] T-23 ✅: classic 剥离旧 chrome（RunState/Substate/ViewMode dual 侧栏/ErrorDiagnostics/浮动专注/SmartSuggestion）
- [x] T-24 ✅: 状态/操作收敛到最顶 TeamStatusBar；去掉暂停大横幅与重复 ops 按钮
- [x] T-25 ✅: classic 密度样式（直角/贴边/56·44 分栏/30·70 任务台）对齐 demo
- [x] T-26 ✅: 消息默认窗口统一 50：recovery turnLimit / MultiLayerFeed / LayerChat / TodoDetailStream / MessagesTab；上滑无感加载 +50
- [x] T-27 ✅: 修复主 tab 切换（middleTab 驱动中间内容；workbench 仅 conversation/office）

## Notes

- Gate 1：本文件为实施改造详细方案；用户已批准并完成 classic-only MVP。
- 原型文件仅作视觉/交互真源，禁止把 demo 内联脚本逻辑直接复制进生产。
- 实现范围已收紧为 **classic workbench only**；Fusion 路径与 Classic 全局壳未改。
- 消息 50 默认：`messageLimit` 是 **user turn** 上限，不是 raw message 条数；UI 文案「最近 50 条」指客户端渲染窗口。
- Memory sync：方案完成后写入 index 的架构决策与坑位（Fusion 并排工作台 vs Classic 冻结）。
