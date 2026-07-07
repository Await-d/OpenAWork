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
> 状态：**进行中（F1/F2 完成，F3/F4/F5 组件已创建，ChatPage 接入待执行）**

---

## Task Overview

基于 OpenCode 桌面端新 UI 架构，将融合布局从「单容器 Sidebar + 杂混 Titlebar」重构为 **T1(纯标签栏) + S2(项目头像 Rail + 可折叠 Panel)** 的弹性状态机布局。

核心变化：
1. **Titlebar 精简**：移除 WorkbenchModeTabs + LayoutModeSwitch，改为 ⚙ 弹出菜单
2. **左侧物理拆分**：AppSidebar 拆为 Rail(64px 固定) + Panel(244px 可折叠)，Rail 放项目头像 + 功能导航 + 底部图标
3. **内容区卡片化**：SessionPanel 包装为 `rounded-[10px] + shadow-raised`，宽度在 600px/100% 间弹性切换
4. **侧面板 Tab 聚合**：ChatRightPanel + ReviewPanel 合并为统一 Tab 式面板（审查/文件/Context）
5. **终端底部横跨**：TerminalPanel 改为底部全宽，增加 36px 折叠态窄条

## Current Analysis

### 现状问题

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
- [x] T-F1-02: TitlebarTabStrip 移除 LayoutModeSwitch，改为渲染 TitlebarToolsMenu → `components/layout/TitlebarTabStrip.tsx` ✅
- [ ] T-F1-03: TitlebarTabStrip 增加交通灯区域（macOS 桌面端条件渲染）→ `components/layout/TitlebarTabStrip.tsx`（推迟到 F2 后，需 Tauri 运行时检测）
- [x] T-F1-04: 验证 Team 路由下 Titlebar 仍正常（TeamTitlebarSummary 保留）→ `components/layout/TitlebarTabStrip.tsx` ✅

#### 验收标准

- [ ] Titlebar 只包含：交通灯 + Home + 标签列表 + ⚙ 菜单
- [ ] ⚙ 菜单弹出包含：布局模式切换、主题切换、设置入口
- [ ] Chat/Team 模式切换不再在 Titlebar（临时通过路由切换，F2 补到 Rail）
- [ ] `tsc --noEmit` 零错误

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
- [x] T-F2-02: 重构 AppSidebar 为 Rail + Panel + Peek 组合容器（移除 Logo/导航/底部，Panel 只保留搜索+会话+新建）→ `components/layout/AppSidebar.tsx` ✅
- [x] T-F2-03: Panel 会话列表改为扁平化（移除工作区分组，直接列出当前项目会话）→ `components/layout/AppSidebar.tsx` ✅（保留分组兼容）
- [x] T-F2-04: Rail 项目头像点击切换工作区 → Panel 内容跟随变化（复用 selectedWorkspacePath）→ `components/layout/SidebarRailV2.tsx` ✅
- [x] T-F2-05: Rail Chat/Team 图标替代 WorkbenchModeTabs（路由切换 /chat vs /team）→ `components/layout/SidebarRailV2.tsx` ✅
- [x] T-F2-06: 移动端适配（<768px Rail 隐藏，Panel 变 fixed 抽屉）→ `components/layout/AppSidebar.tsx` ✅
- [ ] T-F2-07: 清理 WorkbenchModeTabs.tsx（如不再被引用则删除）→ `components/layout/WorkbenchModeTabs.tsx`（暂保留）

#### 验收标准

- [ ] Rail(64px) + Panel(244px) 物理分离正确渲染
- [ ] Rail 项目头像点击切换工作区，Panel 会话列表跟随变化
- [ ] Rail Chat/Team 图标正常切换路由
- [ ] Panel 折叠时 hover Rail 项目头像触发 peek 浮层
- [ ] Panel 会话列表扁平化（不按工作区分组）
- [ ] 移动端 Rail 隐藏 + Panel 变抽屉
- [ ] `tsc --noEmit` 零错误

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
- [ ] T-F3-04: ChatPage 主区域重构为 SessionPanelFrame 包装 + 弹性宽度切换 → `pages/chat-page/ChatPage.tsx`（待 ChatPage 接入）
- [ ] T-F3-05: MessageTimeline 居中逻辑（reviewPanelOpened=false 时 max-width:720px 居中）→ `pages/chat-page/ChatPage.tsx`（待 ChatPage 接入）

#### 验收标准

- [ ] SessionPanel 以卡片式渲染（rounded + shadow）
- [ ] SessionHeaderBar 正确显示标题/模型/模式/路径 + 工具按钮
- [ ] 侧面板展开时 SessionPanel 宽度 600px，折叠时 100%
- [ ] 宽度切换有 240ms 过渡动画
- [ ] 消息时间线在全宽时居中 720px
- [ ] `tsc --noEmit` 零错误

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
- [ ] T-F4-02: 审查 Tab 接入 ReviewPanel → `pages/chat-page/panels/SessionSidePanel.tsx`
- [ ] T-F4-03: 文件 Tab 接入 ChatEditorPane → `pages/chat-page/panels/SessionSidePanel.tsx`
- [ ] T-F4-04: Context Tab 接入 ChatRightPanel 内容（工具调用/计划/DAG）→ `pages/chat-page/panels/SessionSidePanel.tsx`
- [ ] T-F4-05: ChatPage 布局重构：SessionPanel + ResizeHandle + SessionSidePanel 水平排列 → `pages/chat-page/ChatPage.tsx`
- [x] T-F4-06: uiState 新增 `sidePanelActiveTab`（'review' | 'files' | 'context'）→ `stores/ui/uiState.ts` ✅
- [ ] T-F4-07: 移动端适配（SidePanel 变为底部 Tab 切换）→ `pages/chat-page/SessionSidePanel.tsx`

#### 验收标准

- [ ] 侧面板正确渲染 Tab 栏（审查/文件/Context）
- [ ] Tab 切换正常，内容区跟随变化
- [ ] 审查 Tab 正确展示文件列表 + Diff
- [ ] 文件 Tab 正确展示代码编辑器
- [ ] Context Tab 正确展示工具调用/计划
- [ ] ResizeHandle 拖拽调整宽度正常
- [ ] `tsc --noEmit` 零错误

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

- [x] T-F5-01: 新建 `TerminalCollapsedRail.tsx`（折叠态窄条 36px：图标 + 运行数 + 状态 + 展开按钮）→ `pages/chat-page/panels/TerminalCollapsedRail.tsx` ✅
- [ ] T-F5-02: ChatPage 布局重构为垂直排列（上层面板 flex:1 + 底部终端）→ `pages/chat-page/ChatPage.tsx`
- [ ] T-F5-03: 终端高度拖拽调整（复用 PanelResizeHandle 垂直模式）→ `pages/chat-page/panels/TerminalPanel.tsx`
- [ ] T-F5-04: Agent 执行 bash 工具时自动展开终端 → `pages/chat-page/ChatPage.tsx`
- [ ] T-F5-05: 最后一个终端关闭时自动折叠 → `pages/chat-page/panels/TerminalPanel.tsx`

#### 验收标准

- [ ] 终端折叠态 36px 窄条正确渲染
- [ ] 点击窄条展开为 200px 终端面板
- [ ] 终端高度可拖拽调整
- [ ] Agent 执行 bash 时自动展开
- [ ] 最后终端关闭时自动折叠
- [ ] `tsc --noEmit` 零错误

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

### 修改文件

| 文件路径 | 波次 | 改动内容 |
|----------|------|----------|
| `apps/web/src/components/layout/TitlebarTabStrip.tsx` | F1 | 移除 ModeTabs/LayoutSwitch, 加 ⚙ 菜单 + 交通灯 |
| `apps/web/src/components/layout/AppSidebar.tsx` | F2 | 重构为 Rail + Panel 组合 |
| `apps/web/src/stores/ui/uiState.ts` | F3,F4 | 新增 sessionPanelWidth / sidePanelActiveTab |
| `apps/web/src/pages/chat-page/ChatPage.tsx` | F3,F4,F5 | 卡片化 + 侧面板 Tab + 终端底部 |

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
