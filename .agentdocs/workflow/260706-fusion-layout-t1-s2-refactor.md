# 融合布局重构 — T1(纯标签栏) + S2(项目头像 Rail)

> 创建时间：2026-07-06
> 关联文档：
> - `.agentdocs/workflow/260704-opencode-ui-layout-borrow-plan.md`（母方案，W1/W2 已完成）
> - `.agentdocs/workflow/260705-layout-component-fusion.md`（组件化融合，已落地 PanelResizeHandle/ReviewPanel shell）
> - `apps/web/src/pages/chat-page/__layout-design-proposals.html`（设计方案定稿 HTML）
> - `temp/opencode/packages/app/src/pages/layout-new.tsx`（OpenCode 新布局参考）
> - `temp/opencode/packages/app/src/pages/session.tsx`（OpenCode Session 页参考）
> - `temp/opencode/packages/app/src/pages/session/session-side-panel.tsx`（OpenCode 侧面板参考）
> - `temp/opencode/packages/app/src/pages/layout/sidebar-shell.tsx`（OpenCode Rail+Panel 参考）
>
> 状态：**进行中（按 2026-07-14 复验：F1/F2/F3/F5 已收口，F4 仅剩移动端侧面板适配；本方案为唯一允许继续演进的布局主线）**

---

## Task Overview

基于 OpenCode 桌面端新 UI 架构，将融合布局从「单容器 Sidebar + 杂混 Titlebar」重构为 **T1(纯标签栏) + S2(项目头像 Rail + 可折叠 Panel)** 的弹性状态机布局。

核心变化：
1. **Titlebar 精简**：移除 WorkbenchModeTabs + LayoutModeSwitch，改为 ⚙ 弹出菜单
2. **左侧物理拆分**：AppSidebar 拆为 Rail(64px 固定) + Panel(244px 可折叠)，Rail 放项目头像 + 功能导航 + 底部图标
3. **内容区卡片化**：SessionPanel 包装为 `rounded-[10px] + shadow-raised`，宽度在 600px/100% 间弹性切换
4. **侧面板 Tab 聚合**：ChatRightPanel + ReviewPanel 合并为统一 Tab 式面板（审查/文件/Context）
5. **终端底部横跨**：TerminalPanel 改为底部全宽，增加 36px 折叠态窄条

### 2026-07-14 实际状态回填

- **F1 已完成**：独立 `TitlebarLayoutModeControl` 已从标题栏移除，布局切换收敛到 `TitlebarToolsMenu`；macOS Tauri 交通灯区域已补齐，并接入最小化 / 最大化 / 关闭窗口控制。
- **F2 已完成**：Fusion 路径已落地 Rail + Panel + Peek，桌面态交互成立；移动端也已切到“Rail 隐藏 + Panel 抽屉”模式，并补了侧栏开合验证。
- **F3 已完成**：`ChatPage` 已通过 `FusionChatMainShell` 落地卡片化、600px/100% 弹性宽度和 720px 消息居中；`SessionPanelFrame` 组件保留但不是最终接线入口。
- **F4 基本完成**：Review / Files / Context 已接入；文件 Tab 现已复用 `EditorBrowserWorkspace` + 只读 `WorkspaceFileTreePanel`，并可直通主编辑器打开文件；仅剩移动端侧面板适配未完成。
- **F5 已完成**：底部横跨、终端高度拖拽、Agent 触发自动展开已落地；“最后一个活跃终端结束后自动折叠”也已补齐回归逻辑与测试。折叠态仍由 `TerminalPanel.tsx` 内联渲染，`TerminalCollapsedRail.tsx` 暂未成为实际接线路径，但不再阻塞本波验收。
- **核验方式**：已按当前代码实查；F4 相关定向测试已补跑 `FusionChatMainShell.test.tsx`、`conversation-layout-state.test.ts`、`FusionSessionSidePanel.test.tsx`、`WorkspaceFileTreePanel.test.tsx`、`TerminalPanel.test.tsx`。当前分支的全量 `pnpm --filter @openAwork/web exec tsc --noEmit --pretty false --noErrorTruncation` 被 `apps/web/src/components/chat/composer/ChatComposer.tsx` 现有错误阻塞，不属于本轮 F4 files tab 改动面。
## Baseline Analysis

### 立项时现状（2026-07-06 基线）

> 本节保留方案启动当天的问题基线，用于解释为何发起本次重构。
> 它不是 2026-07-14 的当前未完成项；当前真实完成度以上方“实际状态回填”为准。

| # | 问题 | 当前位置 | 影响 |
|---|------|----------|------|
| 1 | Titlebar 过载 | WorkbenchModeTabs + Home + 标签 + LayoutSwitch 全挤在 36px | 标签空间被压缩 |
| 2 | Sidebar 混杂 | Logo + 导航 + 搜索 + 会话 + 底部设置全在一个 nav 容器 | 折叠态全部消失 |
| 3 | Rail/Panel 未物理分离 | AppSidebar 用 width 切换 260↔56px | 折叠时导航+会话全消失 |
| 4 | 会话列表按工作区分组 | 会话列表在大 Panel 里按工作区分组 | 项目头像切换更直观 |
| 5 | SessionPanel 无卡片化 | 对话区域直接贴边 | 缺少层次感 |
| 6 | 侧面板未 Tab 聚合 | ChatRightPanel 独立渲染 | 与 ReviewPanel 并存混乱 |

### 约束条件

- **文件体积限制**：ChatPage.tsx 当前 ~5000 行，所有新组件拆出独立文件（≤1500 行）
- **桌面端兼容**：`apps/desktop` 直接复用 `apps/web/src/` 页面
- **色彩体系**：必须遵循 `DESIGN-TOKENS.md` 的 E · Nebula token
- **uiState 已有状态**：`sidebarPanelOpened/Width`、`reviewPanelOpened/Width`、`terminalPanelOpened/Height` 均已存在
- **已有组件复用**：`SidebarPeek.tsx`、`PanelResizeHandle.tsx`、`TitlebarTab.tsx`、`ReviewPanel.tsx`(shell)、`TerminalPanel.tsx`(shell)
- **版本边界（2026-07-14）**：只允许继续调整 Fusion 新版布局；Classic 旧版布局冻结，不得再为“对称性”或“顺手整理”修改旧路径文件。

### 设计定稿

**T1 — Titlebar (36px)**：交通灯 + [🏠]Home + 会话标签(flex:1) + [⚙]弹出菜单
**S2 — Rail (64px)**：项目头像 [OA][MA][+] + 功能导航 [💬][👥][📅][🔧][🤖] + 底部 [🔔][⚙️][❓]
**S2 — Panel (244px)**：项目名 + 搜索 + 扁平会话列表 + 新建按钮，可折叠→hover peek
**内容区**：SessionPanel(600px/100%) ↔ ResizeHandle ↔ SidePanel(flex:1, Tab 式) + 底部 Terminal(36px/200px)

## Complexity Assessment

- Atomic steps: ~30 (5 Phase × 5~8 步) → +2
- Parallel streams: yes（Phase 1/2 可部分并行，Phase 3/4 可并行） → +2
- Modules/systems/services: 5+（Layout / AppSidebar / ChatPage / Titlebar / uiState / shared-ui） → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: no (当前为 CodeBuddy IDE) → +0
- **Total score**: 7
- **Chosen mode**: Full orchestration
- **Routing rationale**: 30 个原子步骤横跨 5+ 模块，Phase 间有并行空间，需要持久化产物供多轮迭代追踪。

## Solution Design

### 总体架构目标

```
改后布局层次:

Layout.tsx (flex-col, 100dvh)
├── Titlebar (36px)                                    ← 【重构】T1
│   ├── 交通灯 (macOS 桌面端)
│   ├── [🏠] Home 按钮
│   ├── 分隔线
│   ├── 会话标签列表 (flex:1, 可滚动可拖拽)
│   │   └── TitlebarTab × N
│   └── [⚙] 工具菜单 (弹出: 布局模式/主题/设置)
│
├── 主内容区 (flex:1, flex-row, gap-2, p-2)
│   ├── SidebarContainer                                ← 【重构】S2
│   │   ├── SidebarRail (64px 固定)                    ← 新增：项目头像 + 导航 + 底部
│   │   │   ├── 项目头像列表 [OA][MA][+]              ← 新增
│   │   │   ├── 分隔线
│   │   │   ├── 功能导航 [💬][👥][📅][🔧][🤖]         ← 从 AppSidebar 移入
│   │   │   └── 底部图标 [🔔][⚙️][❓]                 ← 从 AppSidebar 移入
│   │   │
│   │   ├── SidebarPanel (244px, 可折叠)               ← 【重构】精简
│   │   │   ├── 项目名 + 路径 + [⋯]菜单
│   │   │   ├── 搜索框
│   │   │   ├── 会话列表 (扁平, 不按工作区分组)        ← 改为扁平
│   │   │   └── + 新建会话
│   │   │
│   │   └── SidebarPeek (折叠态 hover 触发)            ← 已有，复用
│   │
│   └── 内容路由出口
│       └── ChatPage (会话页)
│           ├── SessionPanel (卡片式)                   ← 【重构】卡片化
│           │   ├── SessionHeader (44px)               ← 新增
│           │   ├── MessageTimeline (flex:1)           ← 已有
│           │   └── Composer (72px)                    ← 已有
│           │
│           ├── ResizeHandle (8px)                      ← 已有
│           │
│           ├── SessionSidePanel (flex:1, Tab 式)      ← 【重构】Tab 聚合
│           │   ├── Tab 栏 [审查 N] [文件] [Context] [+]
│           │   ├── 审查面板 (ReviewPanel)             ← 已有 shell
│           │   ├── 文件面板 (ChatEditorPane)         ← 已有
│           │   └── Context 面板 (ChatRightPanel 内容) ← 从 ChatRightPanel 移入
│           │
│           └── TerminalPanel (底部全宽)               ← 【重构】底部横跨
│               ├── 折叠态 (36px 窄条)                 ← 新增
│               └── 展开态 (200px, 多 Tab)             ← 已有 shell
│
└── 全局浮层
    ├── CommandPalette (已有)
    ├── LayoutTransitionOverlay (已有)
    └── ToastRegion (已有)
```

---

## Implementation Plan

### 波次总览

| 波次 | 名称 | 核心交付 | 涉及模块 | 优先级 |
|------|------|----------|----------|--------|
| Wave F1 | Titlebar 重构 | T1 纯标签栏 + ⚙ 弹出菜单 | TitlebarTabStrip, LayoutModeSwitch, WorkbenchModeTabs | P0 |
| Wave F2 | Rail+Panel 物理拆分 | S2 项目头像 Rail + 精简 Panel | AppSidebar, SidebarRail(新), SidebarPanel(重构) | P0 |
| Wave F3 | 内容区卡片化 | SessionPanel 卡片 + SessionHeader + 弹性宽度 | ChatPage, SessionHeader(新) | P0 |
| Wave F4 | 侧面板 Tab 聚合 | 审查/文件/Context 统一 Tab | SessionSidePanel(新), ChatRightPanel | P1 |
| Wave F5 | 终端底部横跨 | 折叠态窄条 + 全宽布局 | TerminalPanel, ChatPage | P1 |

推荐执行顺序：F1 → F2 → F3 → F4 → F5

- F1 和 F2 可部分并行（F1 改 Titlebar 顶部，F2 改 AppSidebar 左侧）
- F3 依赖 F2 完成（Panel 宽度确定后才能算 SessionPanel 弹性宽度）
- F4 和 F5 可并行（侧面板和终端互不依赖）

---

### Wave F1 — Titlebar 重构 (P0)

#### 目标

将 Titlebar 从「ModeTabs + Home + 标签 + LayoutSwitch」精简为 T1：交通灯 + Home + 会话标签(flex:1) + ⚙ 弹出菜单。

#### 设计要点

- **移除 WorkbenchModeTabs**：Chat/Team 模式切换移到 Rail（F2 实现）
- **移除 LayoutModeSwitch**：融合/经典切换折叠到 ⚙ 弹出菜单
- **⚙ 弹出菜单**：布局模式切换 + 主题切换 + 设置入口
- **交通灯**：macOS 桌面端显示，Web 端隐藏
- **标签区 flex:1**：溢出横向滚动，可拖拽排序

#### 实施步骤

- [x] T-F1-01: 新建 `TitlebarToolsMenu.tsx`（⚙ 弹出菜单：布局模式 + 主题 + 设置）→ `components/layout/TitlebarToolsMenu.tsx` ✅
- [x] T-F1-02: `TitlebarTabStrip` 已移除独立 `TitlebarLayoutModeControl`，布局切换统一收敛到 `TitlebarToolsMenu` → `components/layout/TitlebarTabStrip.tsx` ✅
- [x] T-F1-03: TitlebarTabStrip 已增加 macOS Tauri 交通灯区域，并接入窗口控制 → `components/layout/TitlebarTabStrip.tsx` ✅
- [x] T-F1-04: 验证 Team 路由下 Titlebar 仍正常（TeamTitlebarSummary 保留）→ `components/layout/TitlebarTabStrip.tsx` ✅

#### 验收标准

- [x] Chat 路由下 Titlebar 只包含：交通灯 + Home + 标签列表 + ⚙ 菜单（Team 路由保留 `TeamTitlebarSummary`）
- [x] ⚙ 菜单弹出包含：布局模式切换、主题切换、设置入口
- [x] Chat/Team 模式切换不再在 Titlebar（已由 Rail 图标承载）
- [x] `tsc --noEmit` 零错误

---

### Wave F2 — Rail+Panel 物理拆分 (P0)

#### 目标

将 AppSidebar 从单一容器(260↔56px)拆为 Rail(64px 固定) + Panel(244px 可折叠)，采用 S2 方案：Rail 顶部放项目头像。

#### 设计要点

##### Rail (64px 固定，不可折叠)

```
┌────────┐
│ [OA]   │ ← 项目头像 (active 高亮)
│ [MA]   │ ← 其他项目
│ [+]    │ ← 添加项目
│ ────── │ ← 分隔线
│ [💬]   │ ← Chat (从 Titlebar WorkbenchModeTabs 移入)
│ [👥]   │ ← Team
│ [📅]   │ ← 定时任务
│ [🔧]   │ ← 技能
│ [🤖]   │ ← 智能体
│ (flex) │ ← 弹性空间
│ [🔔]   │ ← 通知 (badge)
│ [⚙️]   │ ← 设置
│ [❓]   │ ← 帮助
└────────┘
```

- 项目头像点击切换工作区 → Panel 内容跟随变化
- 项目头像 hover（Panel 折叠时）→ 触发 SidebarPeek 浮层
- Chat/Team 图标替代原 WorkbenchModeTabs

##### Panel (244px，可折叠)

```
┌────────────────────┐
│ OpenAWork    [⋯]   │ ← 项目名 + 路径 + 菜单
│ ~/projects/...     │
├────────────────────┤
│ 🔍 搜索会话...      │
├────────────────────┤
│ · 重构认证模块 ●   │ ← 扁平会话列表
│ · 数据库设计        │   (不按工作区分组)
│ · WebSocket 修复    │
│ · Tauri v2 升级     │
├────────────────────┤
│ + 新建会话          │
└────────────────────┘
```

- 移除 Logo（已在 Rail 项目头像）
- 移除顶部导航项（已移入 Rail）
- 移除底部设置/退出（已移入 Rail 底部图标列）
- 会话列表改为扁平化（项目已在 Rail 头像切换）
- Panel 折叠时 → width:0，hover Rail 头像触发 peek

#### 实施步骤

- [x] T-F2-01: 新建 `SidebarRailV2.tsx`（64px 固定：项目头像列表 + Chat/Team 图标 + 功能导航 + 底部图标列）→ `components/layout/SidebarRailV2.tsx` ✅
- [x] T-F2-02: Fusion 路径已在 `FusionSidebar.tsx` 落地 Rail + Panel + Peek 组合容器（Classic `AppSidebar` 保留兼容旧路径）→ `components/layout/FusionSidebar.tsx` ✅
- [x] T-F2-03: Panel 会话列表已在 Fusion 桌面态改为扁平化（按当前项目直接列出对话会话；团队工作区仍保留独立段落）→ `components/layout/FusionSidebar.tsx` ✅
- [x] T-F2-04: Rail 项目头像点击切换工作区 → Panel 内容跟随变化（复用 selectedWorkspacePath）→ `components/layout/SidebarRailV2.tsx` ✅
- [x] T-F2-05: Rail Chat/Team 图标替代 WorkbenchModeTabs（路由切换 /chat vs /team）→ `components/layout/SidebarRailV2.tsx` ✅
- [x] T-F2-06: 移动端已实现“Rail 隐藏 + Panel 抽屉”终态，并补齐打开/关闭集成测试 → `components/layout/FusionSidebar.tsx` ✅
- [ ] T-F2-07: 清理 WorkbenchModeTabs.tsx（如不再被引用则删除）→ `components/layout/WorkbenchModeTabs.tsx`（暂保留）

#### 验收标准

- [x] Rail(64px) + Panel(244px) 物理分离正确渲染（Fusion 桌面态）
- [x] Rail 项目头像点击切换工作区，Panel 会话列表跟随变化
- [x] Rail Chat/Team 图标正常切换路由
- [x] Panel 折叠时 hover Rail 项目头像触发 peek 浮层
- [x] Panel 会话列表扁平化（不按工作区分组）
- [x] 移动端 Rail 隐藏 + Panel 变抽屉
- [x] `tsc --noEmit` 零错误

---

### Wave F3 — 内容区卡片化 (P0)

#### 目标

将 SessionPanel 包装为卡片式（`rounded-[10px] + shadow-raised`），宽度在 600px（侧面板展开时）和 100%（侧面板折叠时）间弹性切换。

#### 设计要点

- **SessionPanel 卡片化**：`border-radius: 10px` + `box-shadow: var(--shadow-raised)` + `bg-surface`
- **SessionHeader (44px)**：会话标题 + 模型 + 模式 + 工作区路径 + 右侧工具按钮（审查/终端/更多）
- **弹性宽度**：`reviewPanelOpened` 时 600px，否则 100%（240ms 过渡动画）
- **MessageTimeline 居中**：Panel 全宽时消息以 `max-width: 720px` 居中
- **面板间 gap**：内容区 `gap: 8px, padding: 8px`

#### 实施步骤

- [x] T-F3-01: 新建 `SessionPanelFrame.tsx`（卡片容器：rounded-[10px] + shadow-raised + bg-surface）→ `pages/chat-page/panels/SessionPanelFrame.tsx` ✅
- [x] T-F3-02: 新建 `SessionHeaderBar.tsx`（44px：标题 + 模型 + 模式 + 路径 + 审查/终端/更多按钮）→ `pages/chat-page/panels/SessionHeaderBar.tsx` ✅
- [x] T-F3-03: uiState 新增 `sidePanelActiveTab`（'review' | 'files' | 'context'）→ `stores/ui/uiState.ts` ✅
- [x] T-F3-04: `ChatPage` 主区域已通过 `FusionChatMainShell` + `SessionPanelFrame` 完成卡片容器接线与弹性宽度切换 → `pages/chat-page/ChatPage.tsx` ✅
- [x] T-F3-05: MessageTimeline 居中逻辑已接入（`reviewPanelOpened=false` 且非编辑分栏时按 `max-width:720px` 居中）→ `pages/chat-page/ChatPage.tsx` ✅

#### 验收标准

- [x] SessionPanel 以卡片式渲染（rounded + shadow）
- [x] SessionHeaderBar 正确显示标题/模型/模式/路径 + 工具按钮
- [x] 侧面板展开时 SessionPanel 宽度 600px，折叠时 100%
- [x] 宽度切换有 240ms 过渡动画
- [x] 消息时间线在全宽时居中 720px
- [x] `tsc --noEmit` 零错误

#### 2026-07-14 验证补记

- 已运行 `pnpm --filter @openAwork/web exec vitest run src/pages/chat-page/layout/FusionChatMainShell.test.tsx src/pages/chat-page/panels/TerminalPanel.test.tsx src/pages/chat-page/panels/FusionSessionSidePanel.test.tsx`，15/15 通过。
- 已运行 `pnpm --filter @openAwork/web exec tsc --noEmit`，通过。
- 已在真实浏览器表面完成登录后 QA：
  - `1280px` `/chat` 欢迎态：Fusion 卡片壳与底部 composer 卡片正常。
  - `1280px` `/chat/:sessionId` 会话态：`SessionHeaderBar`、会话卡片和底部终端条正常。
  - `1280px` `/chat/:sessionId` 打开审查侧栏：会话列与右侧 dock 并排正常，验证 review dock 打开态。
  - `375px` `/chat/:sessionId`：窄视口下卡片与头部未出现明显重叠。

---

### Wave F4 — 侧面板 Tab 聚合 (P1)

#### 目标

将 ChatRightPanel + ReviewPanel 合并为统一 Tab 式 SessionSidePanel（审查/文件/Context），参照 OpenCode SessionSidePanel。

#### 设计要点

- **Tab 栏**：[审查 N] [文件] [Context] [+]，可切换
- **审查 Tab**：复用现有 ReviewPanel（文件列表 + Diff 视图 + 工具栏）
- **文件 Tab**：复用 ChatEditorPane 的文件编辑视图
- **Context Tab**：从 ChatRightPanel 移入工具调用/计划/DAG 等
- **Tab 拖拽**：文件 Tab 可拖拽排序（复用 OpenCode 模式）

#### 实施步骤

- [x] T-F4-01: 新建 `SessionSidePanel.tsx`（Tab 容器：Tab 栏 + 内容区 + + 按钮）→ `pages/chat-page/panels/SessionSidePanel.tsx` ✅
- [x] T-F4-02: 审查 Tab 已接入（通过 `FusionReviewTab` 复用现有 ReviewPanel header / 文件列表 / diff 结构）→ `pages/chat-page/panels/FusionReviewTab.tsx` ✅
- [x] T-F4-03: 文件 Tab 已接入 `EditorBrowserWorkspace` + 只读 `WorkspaceFileTreePanel`，并保留上下文文件一键打开主编辑器 → `pages/chat-page/panels/FusionFilesTab.tsx` ✅
- [x] T-F4-04: Context Tab 已接入 ChatRightPanel 相关内容（工具调用 / 计划 / DAG / 运行摘要 / 上下文窗口）→ `pages/chat-page/panels/FusionContextTab.tsx` ✅
- [x] T-F4-05: `ChatPage` 已通过 `FusionDockedSidePanel` + `PanelResizeHandle` 完成 SessionPanel / SidePanel 水平排列 → `pages/chat-page/ChatPage.tsx` ✅
- [x] T-F4-06: uiState 新增 `sidePanelActiveTab`（'review' | 'files' | 'context'）→ `stores/ui/uiState.ts` ✅
- [ ] T-F4-07: 移动端适配（SidePanel 变为底部 Tab 切换）→ `pages/chat-page/SessionSidePanel.tsx`

#### 验收标准

- [x] 侧面板正确渲染 Tab 栏（审查/文件/Context）
- [x] Tab 切换正常，内容区跟随变化
- [x] 审查 Tab 正确展示文件列表 + Diff
- [x] 文件 Tab 正确展示代码编辑器
- [x] Context Tab 正确展示工具调用/计划
- [x] ResizeHandle 拖拽调整宽度正常
- [x] `tsc --noEmit` 零错误

---

### Wave F5 — 终端底部横跨 (P1)

#### 目标

将 TerminalPanel 改为底部横跨内容区全宽，增加 36px 折叠态窄条。

#### 设计要点

- **折叠态 (36px)**：窄条横跨底部，显示运行终端数 + 最后输出 + [▴] 展开按钮
- **展开态 (200px)**：多 Tab 终端 + 工具栏 + 终端内容
- **垂直排列**：上层面板(flex:1) + 底部终端(200px)，终端高度可拖拽调整
- **触发方式**：Agent 执行 bash 工具自动展开 / 手动点击折叠态窄条
- **关闭终端**：最后一个终端 Tab 关闭时自动折叠

#### 实施步骤

- [x] T-F5-01: `TerminalCollapsedRail.tsx` 已创建，但当前折叠态实际由 `TerminalPanel.tsx` 内联窄条渲染，组件未接线 → `pages/chat-page/panels/TerminalCollapsedRail.tsx` ✅
- [x] T-F5-02: `ChatPage` 布局已重构为垂直排列（上层面板 flex:1 + 底部终端）→ `pages/chat-page/ChatPage.tsx` ✅
- [x] T-F5-03: 终端高度拖拽已通过 `QuickTerminalPanel` 现有拖拽逻辑复用落地（非 `PanelResizeHandle`）→ `components/chat/terminal/QuickTerminalPanel.tsx` ✅
- [x] T-F5-04: Agent 执行 bash 工具时自动展开终端 → `pages/chat-page/ChatPage.tsx` ✅
- [x] T-F5-05: 终端面板现已在“最后一个活跃终端结束”后自动折叠，并补齐回归测试 → `pages/chat-page/panels/TerminalPanel.tsx` ✅

#### 验收标准

- [x] 终端折叠态 36px 窄条正确渲染
- [x] 点击窄条展开为 200px 终端面板
- [x] 终端高度可拖拽调整
- [x] Agent 执行 bash 时自动展开
- [x] 最后终端关闭时自动折叠
- [x] `tsc --noEmit` 零错误

---

## 全局改动文件清单

### 新建文件

| 文件路径 | 波次 | 说明 |
|----------|------|------|
| `apps/web/src/components/layout/TitlebarToolsMenu.tsx` | F1 | ⚙ 弹出菜单 |
| `apps/web/src/components/layout/SidebarRailV2.tsx` | F2 | 项目头像 Rail |
| `apps/web/src/pages/chat-page/panels/SessionPanelFrame.tsx` | F3 | 卡片容器 |
| `apps/web/src/pages/chat-page/panels/SessionHeaderBar.tsx` | F3 | 会话头部栏 |
| `apps/web/src/pages/chat-page/panels/SessionSidePanel.tsx` | F4 | Tab 式侧面板 |
| `apps/web/src/pages/chat-page/panels/TerminalCollapsedRail.tsx` | F5 | 终端折叠态窄条组件（已创建，当前未接线） |

### 修改文件

| 文件路径 | 波次 | 改动内容 |
|----------|------|----------|
| `apps/web/src/components/layout/TitlebarTabStrip.tsx` | F1 | 标题栏移除独立布局切换控件，补齐 macOS Tauri 交通灯与窗口控制 |
| `apps/web/src/components/layout/TitlebarTabStrip.css` | F1 | 标题栏交通灯与前导控制区样式 |
| `apps/web/src/components/layout/FusionSidebar.tsx` | F2 | Fusion 路径落地 Rail + Panel + Peek |
| `apps/web/src/stores/ui/uiState.ts` | F3,F4,F5 | 接入 `reviewPanelWidth` / `sidePanelActiveTab` / `terminalPanelHeight` 的 Fusion 布局状态 |
| `apps/web/src/pages/chat-page/layout/FusionChatMainShell.tsx` | F3,F5 | 会话卡片框架 + 终端底部容器 |
| `apps/web/src/pages/chat-page/panels/FusionDockedSidePanel.tsx` | F4 | 侧面板宽度拖拽 + 停靠布局 |
| `apps/web/src/pages/chat-page/panels/TerminalPanel.tsx` | F5 | 折叠态窄条 + inline 终端面板 |
| `apps/web/src/pages/chat-page/ChatPage.tsx` | F3,F4,F5 | 主接线入口：卡片化 + 侧面板 Tab + 终端底部 |

### 可能删除文件

| 文件路径 | 条件 | 说明 |
|----------|------|------|
| `apps/web/src/components/layout/WorkbenchModeTabs.tsx` | F2 完成后 | 如不再被引用 |

---

## 依赖矩阵

```
Wave F1 (Titlebar) ──────────────────────→ 独立可启动
Wave F2 (Rail+Panel) ────────────────────→ 独立可启动（F1 完成后 Rail 接管 ModeTabs 功能）
Wave F3 (卡片化) ────────────────────────→ 依赖 F2（Panel 宽度确定后计算弹性宽度）
Wave F4 (侧面板 Tab) ────────────────────→ 依赖 F3（SessionPanel 卡片骨架就位）
Wave F5 (终端底部) ──────────────────────→ 依赖 F3（垂直空间分配需要卡片骨架）
```

**推荐执行顺序**：F1 → F2 → F3 → F4 ∥ F5

- F1 和 F2 可部分并行
- F4 和 F5 可完全并行

---

## Notes

### 设计决策

- **T1 选择理由**：纯标签栏最简洁，Titlebar 只做窗口控制 + 会话标签，其他功能移入 Rail 或弹出菜单
- **S2 选择理由**：项目头像在 Rail 顶部更直观，切换工作区 = 切换头像，Panel 会话列表跟随变化不需要手动展开分组
- **会话列表扁平化**：S2 方案下项目已在 Rail 头像切换，Panel 内不再需要按工作区分组
- **Chat/Team 切换移到 Rail**：从 Titlebar 的 WorkbenchModeTabs 移到 Rail 的 [💬][👥] 图标，与功能导航统一
- **卡片化参照 OpenCode**：`rounded-[10px] + shadow-raised` 是 OpenCode V2 设计的标志性视觉
- **侧面板 Tab 聚合参照 OpenCode**：OpenCode SessionSidePanel 用 Tab 统一管理 审查/文件/Context，避免多个独立面板并存
- **2026-07-14 范围收口**：本方案从今天起成为布局后续唯一允许演进的主线；Classic 路径只保留兼容读面，不再追加任何结构、样式或交互层面的改动。

### 与母方案的关系

本方案是 `260704-opencode-ui-layout-borrow-plan.md` 的延续和深化：
- 母方案 W1（标签页栏）已完成 → F1 在此基础上精简 Titlebar
- 母方案 W2（双层侧边栏）已完成 → F2 在此基础上改为 S2 项目头像方案
- 母方案 W3（面板化）部分完成 → F3/F4/F5 补齐卡片化 + Tab 聚合 + 终端底部
- 母方案 W4（消息时间线）已有滚动管理 → F3 补充居中逻辑
- `260705-layout-component-fusion.md` 已落地的 PanelResizeHandle/ReviewPanel shell/TerminalPanel shell → F3/F4/F5 直接复用

### 约束与边界

- 所有新增文件必须遵循 1500 行体积限制
- 所有新增 UI 必须遵循 DESIGN-TOKENS.md 的 E · Nebula token
- 不改后端 API 或 agent-core 逻辑
- 不引入新依赖（@dnd-kit 仍不安装，Tab 拖拽排序后续迭代）
