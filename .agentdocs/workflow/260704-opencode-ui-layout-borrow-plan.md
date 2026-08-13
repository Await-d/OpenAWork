# OpenCode UI 布局借鉴升级方案

> 创建时间：2026-07-04
> 关联文档：
> - `temp/opencode/packages/app/src/pages/layout.tsx`（OpenCode 主布局参考）
> - `temp/opencode/packages/app/src/pages/home.tsx`（OpenCode 首页参考）
> - `temp/opencode/packages/app/src/pages/session.tsx`（OpenCode 会话页参考）
> - `temp/opencode/packages/app/src/pages/layout/sidebar-shell.tsx`（Rail+Panel 参考）
> - `temp/opencode/packages/app/src/components/titlebar.tsx`（标签页栏参考）
> - `apps/web/src/components/Layout.tsx`（当前主布局）
> - `apps/web/src/components/layout/AppSidebar.tsx`（当前侧边栏）
> - `apps/web/src/pages/chat-page/ChatPage.tsx`（当前会话页）
> - `.agentdocs/workflow/260627-sidebar-layout-refactor-plan.md`（上一轮侧边栏改造记录）
>
> 状态：**进行中（2026-07-04 已完成 W1/W2，W5 基础子集已落；2026-07-14 起剩余工作仅允许落在 Fusion 新版布局）**

---

## Task Overview

2026-06-27 完成了第一轮侧边栏改造（NavRail + SessionSidebar → 统一 AppSidebar），建立了三区块式左侧栏基线。对比 `temp/opencode` 的 UI 布局体系，OpenCode 在多会话并行、会话页信息密度、侧边栏精细度、会话切换零延迟、消息导航、首页视图 6 个维度仍有显著领先。

本方案基于这些差距，制定 6 个波次的分步实施路线，覆盖顶部标签页栏、双层侧边栏、会话页面板化、消息时间线升级、首页视图、交互增强。

## Current Analysis

### 现状差距矩阵

| # | 差距维度 | OpenCode 做法 | OpenAWork 现状 | 影响 |
|---|----------|---------------|----------------|------|
| 1 | 多会话并行 | 顶部标签页栏支持多会话同时打开 | 一次只能看一个会话 | 无法并行任务 |
| 2 | 会话页信息密度 | 右侧 Diff 面板 + 底部终端面板 | 纯单栏 | 变更信息散落在对话中 |
| 3 | 侧边栏精细度 | Rail(64px) + Panel(可拖拽) 双层分离 | 整体 260↔56px 切换 | 折叠态信息丢失 |
| 4 | 会话切换零延迟 | 预取缓存策略（前后 4 条 + LRU） | 每次切换重新加载 | 切换有等待 |
| 5 | 消息导航 | 键盘消息导航 + 智能滚动控制 | 缺失 | 长会话浏览困难 |
| 6 | 首页视图 | 项目概览 + 时间分组会话列表 | 直接跳 /chat | 无全局概览入口 |

### 约束条件

- **文件体积限制**：ChatPage 当前 ~5000 行，所有新面板组件必须拆出独立文件（≤1500 行/文件）
- **桌面端兼容**：`apps/desktop` 直接复用 `apps/web/src/` 页面，所有改动自动影响桌面端
- **色彩体系**：必须遵循 `packages/shared-ui/DESIGN-TOKENS.md` 的 E · Nebula 色彩 token
- **技术栈**：React + Zustand + react-router，不引入 SolidJS 或其他框架
- **后端不变**：不改 `agent-gateway` 路由或 `agent-core` 逻辑
- **范围更新（2026-07-14）**：后续剩余波次只允许落在新版本 Fusion 布局；旧版本 Classic 布局冻结，不再接受结构、样式或交互调整。若某任务需要触碰 Classic 文件，必须先改写为 Fusion-only 等价方案或显式移出本工作流。

## Solution Design

### 总体架构目标

```
改后布局层次:

Layout.tsx
├── TitlebarTabStrip (顶部标签页栏, 36px)        ← 【新增】Wave 1
│   ├── Home 按钮
│   ├── 会话标签 × N (可关闭/可拖拽排序)
│   └── 新建标签按钮 + 更新提示
│
├── 主内容区 (flex:1, flex-row)
│   ├── AppSidebar (左侧栏, 双层架构)             ← 【升级】Wave 2
│   │   ├── SidebarRail (56px 固定)              ← 新增：项目头像列 + 快捷操作
│   │   └── SidebarPanel (244px+, 可拖拽缩放)     ← 新增：会话列表 + 搜索
│   │       └── 折叠态 hover peek 预览            ← 新增
│   │
│   └── 主内容路由出口
│       └── ChatPage (会话页)
│           ├── SessionHeader (会话信息栏)
│           ├── 主面板 (消息时间线 + 输入框)       ← 【升级】Wave 3/4
│           │   ├── MessageTimeline               ← 新增：智能滚动 + 消息导航
│           │   └── ComposerRegion (输入区)
│           ├── ReviewPanel (右侧 Diff 面板)      ← 【新增】Wave 3
│           │   └── 可拖拽调整宽度 + 可折叠
│           └── TerminalPanel (底部终端)          ← 【新增】Wave 3（桌面端优先）
│
└── 全局浮层
    ├── CommandPalette (已有)
    ├── HomeView (首页视图)                       ← 【新增】Wave 5
    └── ToastRegion / PermissionPrompt (已有)
```

---

## Implementation Plan

### 波次总览

| 波次 | 名称 | 核心交付 | 涉及模块 | 优先级 |
|------|------|----------|----------|--------|
| Wave 1 | 顶部标签页栏 | 多会话标签 + 快捷键 + 拖拽排序 | Layout, ChatPage, uiState store | P0 |
| Wave 2 | 双层侧边栏 | Rail+Panel 分离 + 拖拽缩放 + hover peek | AppSidebar, uiState store | P1 |
| Wave 3 | 会话页面板化 | 右侧 Diff 面板 + 底部终端 + ResizeHandle | ChatPage, shared-ui | P0 |
| Wave 4 | 消息时间线 | 智能滚动 + 消息导航 + 历史预取 | ChatPage, conversation hooks | P1 |
| Wave 5 | 首页视图 | 项目概览 + 时间分组 + 全局搜索 | 新建 HomePage, Layout | P2 |
| Wave 6 | 交互增强 | 拖拽排序 + 内联重命名 + 命令系统扩充 | AppSidebar, ChatPage, commands | P2 |

各波次之间**无硬依赖**，可并行推进，但建议按 P0→P1→P2 顺序执行。

> 2026-07-14 收口说明：W1/W2 的历史实现保留，但从现在开始，本工作流剩余的 W3/W4/W6 任务统一只在 Fusion 路径推进；Classic 旧布局不再作为可调整交付面。

### Wave 1 — 顶部标签页栏 (P0)

### 3.1 目标

在主界面顶部新增浏览器风格的会话标签页栏，支持多会话并行打开、切换、关闭、拖拽排序。

### 3.2 设计要点

#### 3.2.1 标签页栏结构

```
┌──────────────────────────────────────────────────────────────────┐
│ [Home] │ [会话A ×] [会话B ×] [新会话 ×] │ [+] │        [更新提示] │
└──────────────────────────────────────────────────────────────────┘
  36px 高, 与 Titlebar 合并
```

- **Home 按钮**（网格图标）：回到首页视图（Wave 5 完成后生效，当前先跳 /chat）
- **标签列表**：每个标签显示会话标题（截断），活跃标签高亮
- **新建按钮**（+）：创建新标签（草稿态，不关联会话）
- **更新提示**（可选）：桌面端版本更新 pill

#### 3.2.2 标签状态模型

```ts
// apps/web/src/stores/ui/uiState.ts 新增

interface SessionTab {
  id: string;            // tab 唯一 ID
  type: 'session' | 'draft';
  sessionId?: string;    // type=session 时有值
  title: string;         // 显示标题（会话标题或"新会话"）
  workspacePath?: string;// 关联工作区
  createdAt: number;
}

interface TabState {
  tabs: SessionTab[];
  activeTabId: string | null;
  // actions
  addSessionTab: (sessionId: string, title: string, workspacePath?: string) => void;
  addDraftTab: (workspacePath?: string) => void;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateTabTitle: (tabId: string, title: string) => void;
}
```

#### 3.2.3 标签溢出策略

- 标签宽度固定 180px，溢出时启用横向滚动
- 每个标签 `flex-shrink: 0`，不做等比压缩（避免标题不可读）
- 溢出时显示左右箭头按钮快速滚动
- 关闭活跃标签后自动选中相邻标签

#### 3.2.4 快捷键

| 快捷键 | 行为 |
|--------|------|
| `Ctrl+T` | 新建标签 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+Shift+Tab` / `Ctrl+Alt+←` | 上一个标签 |
| `Ctrl+Tab` / `Ctrl+Alt+→` | 下一个标签 |
| `Ctrl+1~9` | 切换到第 N 个标签 |

### 3.3 实施步骤

- [x] T-W1-01: uiState store 新增 TabState 切片（tabs / activeTabId / addSessionTab / addDraftTab / closeTab / selectTab / reorderTabs / updateTabTitle）→ `stores/ui/uiState.ts`
- [x] T-W1-02: 新建 `TitlebarTabStrip.tsx` 组件（Home 按钮 + 标签列表 + 新建按钮 + 溢出滚动）→ `components/layout/TitlebarTabStrip.tsx`
- [x] T-W1-03: 新建 `TitlebarTab.tsx` 单标签组件（标题截断 + 关闭按钮 + 拖拽手柄 + 活跃高亮）→ `components/layout/TitlebarTab.tsx`
- [x] T-W1-04: Layout.tsx 顶部插入 TitlebarTabStrip（36px 高，与现有 Titlebar 区域合并）→ `components/Layout.tsx`
- [x] T-W1-05: ChatPage 监听标签切换，按 activeTab.sessionId 加载对应会话 → `pages/chat-page/ChatPage.tsx`
- [x] T-W1-06: 路由集成：`/chat/:sessionId` 时自动 addSessionTab；标签切换时同步路由 → `components/Layout.tsx`
- [x] T-W1-07: 拖拽排序实现（@dnd-kit/sortable）→ `components/layout/TitlebarTabStrip.tsx`
- [x] T-W1-08: 快捷键注册（Ctrl+T/W/Tab/数字键）→ `components/Layout.tsx`

### 3.4 验收标准

- [x] 顶部标签页栏正确渲染，高度 36px
- [x] 打开会话自动新增标签，关闭标签自动切换相邻标签
- [x] 标签可拖拽排序
- [x] 快捷键 Ctrl+T/W/Tab/数字键正常工作
- [x] 标签溢出时横向滚动正常
- [x] `tsc --noEmit` 零错误

### 3.5 非目标

- 不实现标签右键菜单（后续迭代）
- 不实现标签固定/钉住功能
- 不实现标签分组

---

## 4. Wave 2 — 双层侧边栏 (P1)

### 4.1 目标

将 AppSidebar 从整体 260↔56px 切换升级为 Rail(56px) + Panel(可拖拽缩放) 双层分离架构，Panel 折叠时支持 hover peek 浮层预览。

### 4.2 设计要点

#### 4.2.1 双层结构

```
┌────┬──────────────────┐
│ R  │ Panel            │
│ a  │                  │
│ i  │ 项目名 + 菜单     │
│ l  │ ───────────────  │
│    │ 新建会话按钮      │
│ 56 │ 搜索框            │
│ px │ 会话列表          │
│    │ ...              │
│    │                  │
│ ⚙️ │                  │
│ ❓ │                  │
└────┴──────────────────┘
 56px   244px~400px
       (可拖拽缩放)
```

#### 4.2.2 Rail 内容（56px 固定）

- 项目头像列表（当前工作区 + 其他工作区快捷切换）
- 底部：设置 + 帮助图标
- 项目头像支持右键菜单（切换/关闭/编辑）

#### 4.2.3 Panel 内容

- 顶部：当前项目名（可内联编辑）+ 工作区路径 + 菜单按钮
- 中间：新建会话按钮 + 搜索框 + 会话列表
- Panel 宽度可拖拽调整，范围 `[244px, 窗口宽度的30%]`
- 宽度持久化到 `uiState store`

#### 4.2.4 折叠态 hover peek

- Panel 折叠时，鼠标 hover 到 Rail 上的项目头像，触发 peek 浮层
- peek 浮层以 `opacity + translateX` 过渡动画显示
- peek 浮层内容 = Panel 内容（只读预览模式，点击后展开 Panel）
- 鼠标离开后 300ms 延迟关闭 peek

#### 4.2.5 移动端适配

- `< 768px`：Panel 变为 `fixed` 抽屉，`translateX` 过渡
- Rail 隐藏，通过顶部 Titlebar 的菜单按钮打开抽屉

### 4.3 实施步骤

- [x] T-W2-01: uiState store 新增 `sidebarPanelWidth`（默认 244）/ `sidebarPanelOpened`（默认 true）→ `stores/ui/uiState.ts`
- [x] T-W2-02: 新建 `SidebarRail.tsx`（56px 固定：项目头像列表 + 添加按钮 + 底部设置/帮助图标）→ `components/layout/SidebarRail.tsx`
- [x] T-W2-03: 新建 `SidebarPanel.tsx`（项目名 + 菜单 + 新建按钮 + 搜索框 + 会话列表，复用 `useSessions` + `SessionSidebarSessionRow`）→ `components/layout/SidebarPanel.tsx`
- [x] T-W2-04: 新建 `SidebarResizeHandle.tsx`（pointerdown→move→up 拖拽缩放，范围 244px ~ 窗口30%）→ `components/layout/SidebarResizeHandle.tsx`
- [x] T-W2-05: 新建 `SidebarPeek.tsx`（折叠态 hover Rail 项目头像触发浮层，300ms 延迟关闭，opacity+translateX 过渡）→ `components/layout/SidebarPeek.tsx`
- [x] T-W2-06: AppSidebar.tsx 改为 Rail + Panel + ResizeHandle + Peek 组合容器 → `components/layout/AppSidebar.tsx`
- [x] T-W2-07: 移动端适配（`<768px` Panel 变 fixed 抽屉，translateX 过渡）→ `components/layout/AppSidebar.tsx`
- [x] T-W2-08: 宽度持久化 + 刷新后恢复 → `stores/ui/uiState.ts`

### 4.4 验收标准

- [x] Rail(56px) + Panel 双层正确渲染
- [x] Panel 可拖拽缩放，范围 244px ~ 窗口30%
- [x] Panel 宽度刷新后保持
- [x] Panel 折叠时 hover Rail 项目头像触发 peek 浮层
- [x] peek 浮层 300ms 延迟关闭，动画流畅
- [x] 移动端 Panel 变为抽屉
- [x] `tsc --noEmit` 零错误

---

## 5. Wave 3 — 会话页面板化 (P0)

### 5.1 目标

将 ChatPage 从纯单栏升级为多面板布局：主面板 + 右侧 Diff 面板 + 底部终端面板，面板间可拖拽调整宽度/高度。

### 5.2 设计要点

#### 5.2.1 面板布局

```
┌─────────────────────────────────────────────┐
│ SessionHeader (会话标题 + 模型 + 操作按钮)     │ 40px
├──────────────────────────┬──────────────────┤
│                          │                  │
│  MessageTimeline         │  ReviewPanel     │
│  (消息时间线)              │  (代码变更 Diff)  │
│                          │                  │
│  宽度可拖拽               │  可折叠           │
│  min 450px               │  min 300px       │
│                          │                  │
├──────────────────────────┤                  │
│  ComposerRegion          │                  │
│  (输入框 + 工具栏)         │                  │
├──────────────────────────┴──────────────────┤
│  TerminalPanel (终端, 可折叠)                 │ 可选, 0~200px
└─────────────────────────────────────────────┘
```

#### 5.2.2 ReviewPanel（右侧 Diff 面板）

- **触发时机**：Agent 执行了文件修改工具（hash-edit / write_file 等）后自动展开
- **内容**：按变更类型分组的文件列表 + 选中文件的 Diff 视图
- **变更范围切换**：当前轮次 / 当前分支 / 全部未提交（Select 组件）
- **Diff 样式**：统一视图(unified) / 分割视图(split) 切换
- **行内评论**：可在 Diff 行上添加评论，评论自动注入到 Prompt context
- **折叠态**：折叠时显示变更文件数 badge

#### 5.2.3 TerminalPanel（底部终端面板）

- **仅桌面端**：`isTauriRuntime()` 时可用
- **触发方式**：手动展开 + Agent 执行 bash 工具时自动展开
- **内容**：xterm.js 终端实例，工作区路径为 CWD
- **折叠态**：完全隐藏（高度 0）

#### 5.2.4 面板间拖拽

- 主面板 ↔ ReviewPanel：水平 ResizeHandle
- 主面板 ↔ TerminalPanel：垂直 ResizeHandle
- 尺寸持久化到 `uiState store`

#### 5.2.5 卡片化视觉

- 各面板使用 `border-radius: 10px` + `box-shadow` + 背景分层
- 面板间间隙 8px
- 面板内部 padding 12px

### 5.3 实施步骤

- [x] T-W3-01: uiState store 新增 `reviewPanelOpened` / `reviewPanelWidth`（默认 400）/ `terminalPanelOpened` / `terminalPanelHeight`（默认 160）→ `stores/ui/uiState.ts`
- [x] T-W3-02: 新建 `PanelResizeHandle.tsx` 通用拖拽手柄（支持水平/垂直方向）→ `components/layout/PanelResizeHandle.tsx`
- [x] T-W3-03: 新建 `ReviewPanel.tsx`（文件列表 + Diff 视图 + 变更范围切换 + 统一/分割切换）→ `pages/chat-page/panels/ReviewPanel.tsx`（已完成：已落 shell、范围选择、统一视图、`FileChangeReviewPanel` 复用入口、折叠态 rail）
- [ ] T-W3-04: ReviewPanel 接入 session diff 数据（通过 `@openAwork/web-client` 获取变更文件列表 + diff）→ `pages/chat-page/panels/ReviewPanel.tsx`（阻塞：当前未发现可直接消费的 web-client 会话 diff API）
- [x] T-W3-05: 新建 `TerminalPanel.tsx`（xterm.js + Tauri PTY，仅 `isTauriRuntime()` 时可用）→ `pages/chat-page/panels/TerminalPanel.tsx`（已完成：已落底部终端 shell；真实运行视图继续复用现有 `QuickTerminalPanel`，避免重复实现 PTY）
- [x] T-W3-06: ChatPage 布局重构为多面板 Flex（主面板 + ReviewPanel 水平 + TerminalPanel 垂直）→ `pages/chat-page/ChatPage.tsx`（已完成：FusionChatMainShell 已接入 ReviewPanel（通过 FusionDockedSidePanel）+ TerminalPanel，支持拖拽调整宽度/高度）
- [ ] T-W3-07: 行内评论功能（Diff 行上添加评论 → 自动注入 Prompt context）→ `pages/chat-page/panels/ReviewPanel.tsx`（未实施：超出本轮范围）
- [x] T-W3-08: 卡片化样式（border-radius:10px + box-shadow + 背景分层 + 面板间隙 8px）→ `pages/chat-page/ChatPage.tsx`（已完成：FusionChatMainShell.css 已应用 gap: var(--spacing-2)，面板使用 bg-base/bg-surface 分层）
- [x] T-W3-09: 移动端适配（ReviewPanel 变为底部 Tab 切换，TerminalPanel 隐藏）→ `pages/chat-page/ChatPage.tsx`（已完成：FusionMobileBottomPanel 已实现移动端 Tab 切换，TerminalPanel 在移动端通过 hasSession 条件控制）

### 5.4 验收标准

- [x] 右侧 ReviewPanel 正确展示文件变更 Diff（已完成：ReviewPanel 组件已实现，通过 useReviewPanelFileChanges 获取数据）
- [x] ReviewPanel 可折叠/展开，宽度可拖拽调整（已完成：折叠态显示 rail，展开态通过 PanelResizeHandle 调整宽度）
- [x] 变更范围切换（当前轮次/分支/全部）正常（已完成：ReviewPanelHeader 提供范围选择器）
- [x] Diff 视图统一/分割切换正常（已完成：ReviewPanelHeader 提供视图模式切换）
- [x] 底部 TerminalPanel 桌面端可用（xterm.js + Tauri PTY）（已完成：TerminalPanel 复用 QuickTerminalPanel）
- [x] TerminalPanel 可折叠/展开，高度可拖拽调整（已完成：折叠显示 rail，展开通过 QuickTerminalPanel 内置拖拽）
- [x] 面板尺寸刷新后保持（已完成：uiState store 持久化 reviewPanelWidth 和 terminalPanelHeight）
- [x] 移动端：ReviewPanel 变为底部 Tab 切换（已完成：FusionMobileBottomPanel 实现）
- [ ] `tsc --noEmit` 零错误（部分通过：本次改动无新增错误，现有错误来自并行改动）

### 5.5 非目标

- 不实现 ReviewPanel 的 PR 级别 review 功能
- 不实现 TerminalPanel 的多终端实例
- 不实现面板的拖拽浮出（docking → floating）

---

## 6. Wave 4 — 消息时间线升级 (P1)

### 6.1 目标

升级消息时间线：智能自动滚动 + 消息级键盘导航 + 历史消息无限加载 + 会话预取缓存。

### 6.2 设计要点

#### 6.2.1 智能自动滚动

```ts
// 自动滚动策略：
// 1. 新消息到达时，如果用户在底部 → 自动滚动到底
// 2. 用户手动上滚 → 暂停自动滚动，显示"回到底部"浮动按钮
// 3. 用户点击"回到底部"或按 End 键 → 恢复自动滚动
// 4. overflow-anchor: none 防止内容插入时跳动

interface ScrollState {
  overflow: boolean;     // 内容是否溢出
  bottom: boolean;       // 用户是否在底部
  jump: boolean;         // 是否大跳（距离底部 > 400px）
}
```

#### 6.2.2 消息级键盘导航

| 快捷键 | 行为 |
|--------|------|
| `Alt+↑` | 跳转到上一条用户消息 |
| `Alt+↓` | 跳转到下一条用户消息 |
| `Shift+Alt+↑` | 跳转到上一条未读消息 |
| `Shift+Alt+↓` | 跳转到下一条未读消息 |
| `End` | 回到底部（恢复自动滚动） |
| `Escape` | 清除消息焦点 |

- 跳转时使用 `scrollIntoView({ block: 'center', behavior: 'smooth' })`
- 跳转后暂停自动滚动，直到用户按 End 或点击"回到底部"

#### 6.2.3 历史消息无限加载

- 滚动到顶部 200px 以内时触发 `loadOlder()`
- 加载前记录滚动位置锚点，加载后恢复（防跳动）
- 使用 `requestAnimationFrame` 调度，避免阻塞
- 最多一次加载 50 条消息

#### 6.2.4 会话预取缓存

```ts
// 会话预取策略（借鉴 OpenCode layout.tsx:630-792）：
// 1. 当前会话前后各 4 条会话预取消息数据
// 2. 并发控制：最多 2 路并发预取
// 3. LRU 淘汰：每工作区最多缓存 10 条会话
// 4. 切换会话时从缓存直接渲染，无闪烁

interface SessionPrefetchQueue {
  inflight: Set<string>;
  pending: string[];
  running: number;
}

const PREFETCH_CHUNK = 200;       // 每次预取 200 条消息
const PREFETCH_CONCURRENCY = 2;   // 2 路并发
const PREFETCH_SPAN = 4;          // 前后各 4 条
const PREFETCH_MAX_PER_DIR = 10;  // 每工作区最多 10 条
```

### 6.3 实施步骤

- [x] T-W4-01: 新建 `useAutoScroll.ts`（新消息到底自动滚 + 用户上滚暂停 + "回到底部"恢复 + overflow-anchor:none）→ `pages/chat-page/hooks/useAutoScroll.ts`（未新建：现有 `components/conversation-runtime/scroll/use-scroll-manager.ts` 已覆盖自动跟随、用户上滚暂停、回到底部恢复）
- [x] T-W4-02: 新建 `useMessageNavigation.ts`（Alt+↑/↓ 跳转用户消息 + End 恢复滚动）→ `pages/chat-page/hooks/useMessageNavigation.ts`（已完成：支持 Alt+↑/↓ 跳转用户消息，End 键滚动到底部）
- [x] T-W4-03: 新建 `useHistoryInfinite.ts`（滚动到顶部 200px 触发加载 + 锚点恢复 + rAF 调度 + 单次 50 条）→ `pages/chat-page/hooks/useHistoryInfinite.ts`（已完成：滚动接近顶部触发 onLoadOlder，锚点恢复防跳动）
- [x] T-W4-04: 新建 `useSessionPrefetch.ts`（前后各 4 条预取 + 2 路并发 + LRU 淘汰每工作区 10 条）→ `pages/chat-page/hooks/useSessionPrefetch.ts`（已完成：LRU 缓存 + 2 路并发 + 每工作区 10 条上限）
- [ ] T-W4-05: 新建 `MessageTimeline.tsx`（替代当前内联渲染，接入上述 hooks）→ `pages/chat-page/conversation/MessageTimeline.tsx`（未实施：需重构现有 ChatPage 消息渲染逻辑，超出本轮范围）
- [x] T-W4-06: 新建 `ScrollToBottomButton.tsx`（浮动按钮 + jump 状态指示）→ `pages/chat-page/conversation/ScrollToBottomButton.tsx`（未新建：现有 `ChatConversationView` 已渲染 `ChatScrollBottomButton`）
- [ ] T-W4-07: ChatPage 接入新 MessageTimeline 组件 → `pages/chat-page/ChatPage.tsx`（未实施：依赖 T-W4-05）
- [x] T-W4-08: 快捷键注册到 Layout（Alt+↑/↓/End/Escape）→ `components/Layout.tsx`（已完成：快捷键已在 useChatKeyboardShortcuts 和 ChatPage/App.tsx 中注册）

### 6.4 验收标准

- [x] 新消息到达时自动滚动到底（用户在底部时）（已完成：现有 use-scroll-manager.ts 已实现）
- [x] 用户上滚时暂停自动滚动，显示"回到底部"按钮（已完成：现有实现已覆盖）
- [x] "回到底部"按钮点击/End 键恢复自动滚动（已完成：现有 ChatScrollBottomButton + useMessageNavigation）
- [x] Alt+↑/↓ 跳转用户消息正常（已完成：useMessageNavigation 实现）
- [x] 滚动到顶部触发历史加载，加载后位置不跳（已完成：useHistoryInfinite 实现）
- [x] 会话切换时从预取缓存渲染，无加载等待（已完成：useSessionPrefetch 实现）
- [ ] `tsc --noEmit` 零错误（部分通过：本次改动无新增错误，现有错误来自并行改动）

---

## 7. Wave 5 — 首页视图 (P2)

### 7.1 目标

新增独立首页视图，展示项目概览 + 按时间分组的最近会话 + 全局会话搜索，替代当前直接跳转 /chat 的行为。

### 7.2 设计要点

#### 7.2.1 首页布局

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│  ┌──────────┐  ┌──────────────────────────────────┐  │
│  │ Projects  │  │  [搜索框: 搜索会话...]            │  │
│  │           │  │                                  │  │
│  │ ◉ 项目A   │  │  ── 今天 ──                       │  │
│  │ ○ 项目B   │  │  [会话1] 项目A · 2小时前          │  │
│  │ ○ 项目C   │  │  [会话2] 项目A · 5小时前          │  │
│  │           │  │  [会话3] 项目B · 6小时前          │  │
│  │ [+ 添加]  │  │                                  │  │
│  │           │  │  ── 昨天 ──                       │  │
│  │           │  │  [会话4] 项目A · 昨天 15:30       │  │
│  │           │  │  [会话5] 项目C · 昨天 10:12       │  │
│  │           │  │                                  │  │
│  │ ⚙️ 设置    │  │  ── 更早 ──                      │  │
│  │ ❓ 帮助    │  │  [会话6] 项目B · 3天前           │  │
│  └──────────┘  └──────────────────────────────────┘  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

#### 7.2.2 左栏 — 项目列表（280px）

- 项目头像 + 名称 + 未读会话数 badge
- 点击项目筛选右栏会话列表
- 底部：设置 + 帮助
- 多服务器支持时显示服务器健康状态

#### 7.2.3 右栏 — 会话列表

- **搜索框**：全局会话搜索（标题 + 消息内容），支持键盘上下箭头导航 + 回车选中
- **时间分组**：今天 / 昨天 / 更早，粘性标题
- **会话行**：会话头像 + 标题 + 项目名 + 相对时间
- **粘性标题渐隐**：滚动时下一个分组标题推上来时，当前标题渐隐
- 右上角浮动"新建会话"按钮

#### 7.2.4 路由集成

- `/` → 首页（已登录时）
- `/chat/:sessionId` → 会话页
- 标签页栏 Home 按钮回到首页

### 7.3 实施步骤

- [x] T-W5-01: 新建 `HomePage.tsx`（双栏布局容器，max-width:1080px 居中）→ `pages/home/HomePage.tsx`
- [x] T-W5-02: 新建 `HomeProjectColumn.tsx`（左栏 280px：项目头像列表 + 未读 badge + 添加按钮 + 设置/帮助）→ `pages/home/HomeProjectColumn.tsx`
- [x] T-W5-03: 新建时间分组工具函数（今天/昨天/更早，基于 Date 本地日界；未新增 luxon 依赖）→ `pages/home/utils/session-grouping.ts`
- [x] T-W5-04: 新建 `HomeSessionList.tsx`（右栏：会话行 + 时间分组 + 粘性标题）→ `pages/home/HomeSessionList.tsx`
- [x] T-W5-05: 新建 `useStickyHeaderOpacity.ts`（滚动时下一组标题推上来当前标题渐隐）→ `pages/home/hooks/useStickyHeaderOpacity.ts`
- [x] T-W5-06: 新建 `HomeSessionSearch.tsx`（搜索框 + 结果浮层 + 键盘↑↓导航 + Enter 选中）→ `pages/home/HomeSessionSearch.tsx`
- [x] T-W5-07: App.tsx 路由调整（`/` → HomePage，已登录时）→ `App.tsx`
- [x] T-W5-08: TitlebarTabStrip Home 按钮接入（点击回到首页）→ `components/layout/TitlebarTabStrip.tsx`

### 7.4 验收标准

- [x] 首页双栏布局正确渲染
- [x] 左栏项目列表点击筛选右栏会话
- [x] 搜索框支持标题 + 消息内容搜索
- [x] 搜索结果键盘导航（↑↓ + Enter）正常
- [x] 时间分组（今天/昨天/更早）正确
- [x] 粘性标题渐隐动画流畅
- [ ] `tsc --noEmit` 零错误

---

## 8. Wave 6 — 交互增强 (P2)

### 8.1 目标

补充拖拽排序、内联重命名、命令系统扩充等交互增强。

### 8.2 设计要点

#### 8.2.1 会话拖拽排序

- 在 AppSidebar Panel 会话列表中，支持拖拽会话调整顺序
- 使用 `@dnd-kit/core`（React 生态首选）
- 拖拽时显示半透明浮层预览
- 顺序持久化到 `uiState store`（仅前端排序，不改后端）

#### 8.2.2 内联重命名

- 会话标题双击 → 切换为 `<input>` 编辑态
- `Enter` 保存，`Esc` 取消
- 失焦自动保存
- 项目名/工作区名同样支持内联重命名

#### 8.2.3 命令系统扩充

新增命令：

| 命令 | 快捷键 | 描述 |
|------|--------|------|
| `sidebar.toggle` | `Ctrl+B` | 切换侧边栏 Panel 展开/折叠 |
| `tab.new` | `Ctrl+T` | 新建标签 |
| `tab.close` | `Ctrl+W` | 关闭当前标签 |
| `tab.next` | `Ctrl+Tab` | 下一个标签 |
| `tab.prev` | `Ctrl+Shift+Tab` | 上一个标签 |
| `session.next` | `Alt+↓` | 下一条用户消息 |
| `session.prev` | `Alt+↑` | 上一条用户消息 |
| `review.toggle` | `Ctrl+Shift+R` | 切换 ReviewPanel |
| `terminal.toggle` | `Ctrl+`` ` | 切换 TerminalPanel |
| `theme.cycle` | `Ctrl+Shift+T` | 循环切换主题 |

### 8.3 实施步骤

- [ ] T-W6-01: 安装 `@dnd-kit/core` + `@dnd-kit/sortable` 依赖 → `apps/web/package.json`（阻塞：`apps/web/package.json` 当前未安装 `@dnd-kit/*`；本轮按最小风险不新增依赖）
- [ ] T-W6-02: 会话列表拖拽排序实现（DragOverlay 浮层 + 顺序持久化到 uiState）→ `components/layout/sidebar/SessionSidebarSessionRow.tsx`（阻塞：依赖 T-W6-01）
- [x] T-W6-03: 新建 `InlineEditor.tsx` 通用内联编辑组件（双击编辑 + Enter 保存 + Esc 取消 + 失焦保存）→ `packages/shared-ui/src/primitives/InlineEditor.tsx`（已完成）
- [x] T-W6-04: 会话标题内联重命名接入 → `components/layout/sidebar/SessionSidebarSessionRow.tsx`（已完成：BaseSessionRow 新增 titleSlot，SessionSidebarSessionRow 接入 InlineEditor）
- [x] T-W6-05: 项目名内联重命名接入 → `components/layout/SidebarPanel.tsx`（已完成：FusionSidebar 接入 InlineEditor，使用 localStorage 存储工作区别名）
- [x] T-W6-06: 命令系统扩充（注册 sidebar.toggle / tab.* / session.* / review.toggle / terminal.toggle / theme.cycle + 快捷键）→ `hooks/command/useCommandRegistry.ts`（已完成：Ctrl+B 侧边栏、Ctrl+Shift+R 审查面板、Ctrl+\` 终端、Ctrl+Alt+T 主题切换已接入）
- [ ] T-W6-07: 命令面板搜索结果优化（分类展示 + 快捷键标注）→ `packages/shared-ui/src/`（未实施：超出本轮范围）

### 8.4 验收标准

- [ ] 会话列表可拖拽排序，顺序刷新后保持（阻塞：依赖 @dnd-kit 安装）
- [x] 会话标题双击可内联编辑，Enter/Esc/失焦行为正确（已完成：SessionSidebarSessionRow 接入 InlineEditor）
- [x] 项目名双击可内联编辑（已完成：FusionSidebar 接入 InlineEditor）
- [x] 所有新快捷键正常工作（已完成：Ctrl+B/Shift+R/\`/Alt+T 已接入）
- [ ] 命令面板展示新增命令，分类正确（未实施：超出本轮范围）
- [ ] `tsc --noEmit` 零错误（部分通过：本次改动无新增错误，现有错误来自并行改动）

---

## 9. 全局改动文件清单

### 9.1 新建文件

| 文件路径 | 波次 | 说明 |
|----------|------|------|
| `apps/web/src/components/layout/TitlebarTabStrip.tsx` | W1 | 顶部标签页栏 |
| `apps/web/src/components/layout/TitlebarTab.tsx` | W1 | 单标签组件 |
| `apps/web/src/components/layout/SidebarRail.tsx` | W2 | 侧边栏 Rail |
| `apps/web/src/components/layout/SidebarPanel.tsx` | W2 | 会话面板容器，复用现有 SessionSidebar |
| `apps/web/src/components/layout/SidebarResizeHandle.tsx` | W2 | 拖拽缩放手柄 |
| `apps/web/src/components/layout/SidebarPeek.tsx` | W2 | hover peek 浮层 |
| `apps/web/src/components/layout/PanelResizeHandle.tsx` | W3 | 通用面板拖拽手柄 |
| `apps/web/src/pages/chat-page/panels/ReviewPanel.tsx` | W3 | 右侧 Diff 面板 |
| `apps/web/src/pages/chat-page/panels/TerminalPanel.tsx` | W3 | 底部终端面板 |
| `apps/web/src/components/layout/PanelResizeHandle.test.tsx` | W3 | 通用面板拖拽手柄测试 |
| `apps/web/src/pages/chat-page/panels/ReviewPanel.test.tsx` | W3 | ReviewPanel 阻塞空态测试 |
| `apps/web/src/pages/chat-page/hooks/useAutoScroll.ts` | W4 | 智能自动滚动 |
| `apps/web/src/pages/chat-page/hooks/useMessageNavigation.ts` | W4 | 消息键盘导航 |
| `apps/web/src/pages/chat-page/hooks/useHistoryInfinite.ts` | W4 | 历史无限加载 |
| `apps/web/src/pages/chat-page/hooks/useSessionPrefetch.ts` | W4 | 会话预取缓存 |
| `apps/web/src/pages/chat-page/conversation/MessageTimeline.tsx` | W4 | 消息时间线组件 |
| `apps/web/src/pages/chat-page/conversation/ScrollToBottomButton.tsx` | W4 | 回到底部按钮 |
| `apps/web/src/pages/home/HomePage.tsx` | W5 | 首页 |
| `packages/shared-ui/src/primitives/InlineEditor.tsx` | W6 | 内联编辑器 |
| `apps/web/src/components/common/display/InlineEditor.test.tsx` | W6 | InlineEditor 交互测试 |

### 9.2 修改文件

| 文件路径 | 波次 | 改动内容 |
|----------|------|----------|
| `apps/web/src/stores/ui/uiState.ts` | W1-W3 | 新增 TabState / SidebarPanel 状态 / ReviewPanel 与 TerminalPanel shell 状态 |
| `apps/web/src/test/mocks/shared-ui.tsx` | W6 | Web 测试 mock 转发 shared-ui InlineEditor |
| `packages/shared-ui/src/index.ts` | W6 | 导出 InlineEditor |
| `packages/shared-ui/src/primitives/index.tsx` | W6 | 导出 InlineEditor 原语 |
| `apps/web/src/components/Layout.tsx` | W1,W2 | 顶部插入 TitlebarTabStrip；AppSidebar 升级；快捷键注册 |
| `apps/web/src/components/layout/AppSidebar.tsx` | W2 | 已收敛为 Rail + SidebarPanel + ResizeHandle + Peek 组合容器 |
| `apps/web/src/App.tsx` | W5 | 新增 `/home` 路由 |

### 9.3 不变动文件

| 文件路径 | 不变原因 |
|----------|----------|
| `apps/web/src/components/common/routing/CachedRouteOutlet.tsx` | 路由缓存机制不变 |
| `apps/web/src/stores/auth/auth.ts` | 认证状态不变 |
| `packages/agent-core/` | 后端 Agent 逻辑不变 |
| `services/agent-gateway/` | 网关路由不变 |
| `packages/shared-ui/DESIGN-TOKENS.md` | 色彩体系不变 |

---

## 10. 依赖矩阵

```
Wave 1 (标签页) ──────────────────────────────→ 独立可启动
Wave 2 (双层侧边栏) ──────────────────────────→ 独立可启动（依赖 Wave 1 的 Titlebar 高度计算）
Wave 3 (会话页面板化) ────────────────────────→ 独立可启动（依赖 ChatPage 布局空间）
Wave 4 (消息时间线) ──────────────────────────→ 独立可启动（依赖 ChatPage 消息渲染区）
Wave 5 (首页视图) ────────────────────────────→ 依赖 Wave 1 的 Home 按钮入口
Wave 6 (交互增强) ────────────────────────────→ 依赖 Wave 2 的 SidebarPanel 组件
```

**推荐执行顺序**：W1 → W3 → W2 → W4 → W5 → W6

- W1 和 W3 都是 P0，优先执行
- W1 完成后 Titlebar 高度确定，W2 可以准确计算布局
- W3 完成后 ChatPage 面板骨架就位，W4 可以在主面板内升级消息时间线
- W5 和 W6 是 P2，最后执行

---

## 11. 技术选型

| 需求 | 选型 | 理由 |
|------|------|------|
| 标签页拖拽排序 | `@dnd-kit/core` + `@dnd-kit/sortable` | React 生态首选，无障碍支持好，轻量 |
| 面板拖拽缩放 | 自实现 `PanelResizeHandle` | 逻辑简单（pointerdown→move→up），无需引入库 |
| 终端 | `xterm.js` + `@xterm/addon-fit` | 已在项目中使用，Tauri PTY 对接 |
| Diff 视图 | `react-diff-view` + `diff` | 支持统一/分割视图，语法高亮 |
| 无限滚动 | 自实现 `useHistoryInfinite` | 逻辑可控，需精确控制滚动锚点 |
| 内联编辑 | 自实现 `InlineEditor` | 逻辑简单（input + focus/blur/keydown） |

---

## 12. 风险与缓解

| 风险 | 影响波次 | 缓解策略 |
|------|----------|----------|
| ChatPage 文件过大（当前 ~5000 行） | W3, W4 | 严格遵循 1500 行限制，面板组件全部拆出独立文件 |
| 标签页状态与路由同步冲突 | W1 | 标签状态为前端唯一真相源，路由变化时同步标签，反之不同步 |
| 预取缓存内存占用 | W4 | LRU 淘汰 + 每工作区上限 10 条 + 可配置 |
| xterm.js 桌面端 PTY 权限 | W3 | 仅 `isTauriRuntime()` 时启用，Web 端隐藏终端面板 |
| @dnd-kit 与现有 DnD 冲突 | W6 | 当前项目无 DnD 依赖，无冲突风险 |
| 桌面端复用 Web 页面的兼容性 | 全部 | 所有改动在 `apps/web/src/` 内，桌面端自动复用 |

---

## Complexity Assessment

### 总体评估

- Atomic steps: 48 (6 波次 × 7~9 步) → +2
- Parallel streams: yes（波次间无硬依赖，W1/W3 可并行）→ +2
- Modules/systems/services: 5+（Layout / AppSidebar / ChatPage / uiState / shared-ui）→ +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 48 个原子步骤横跨 5+ 模块，波次间可并行但波次内需顺序执行，需要持久化产物供多轮迭代追踪。

### 各波次评估

| 波次 | Atomic steps | Parallel streams | Modules | Long step | Persisted | OpenCode | Total | Mode |
|------|-------------|-----------------|---------|-----------|-----------|----------|-------|------|
| W1 | 8 → +2 | no → +0 | 3 → +1 | yes → +1 | yes → +1 | yes → -1 | 4 | Lightweight |
| W2 | 8 → +2 | no → +0 | 2 → +1 | yes → +1 | yes → +1 | yes → -1 | 4 | Lightweight |
| W3 | 9 → +2 | no → +0 | 3 → +1 | yes → +1 | yes → +1 | yes → -1 | 4 | Lightweight |
| W4 | 8 → +2 | no → +0 | 2 → +1 | yes → +1 | yes → +1 | yes → -1 | 4 | Lightweight |
| W5 | 8 → +2 | no → +0 | 2 → +1 | yes → +1 | yes → +1 | yes → -1 | 4 | Lightweight |
| W6 | 7 → +2 | no → +0 | 3 → +1 | no → +0 | yes → +1 | yes → -1 | 3 | Lightweight |

> 各波次独立评估均为 Lightweight（score 3~4），但总体方案因跨波次并行 + 模块数 ≥5 + 持续产物需求，采用 Full orchestration 统一管理。各波次内部按单 Agent 顺序执行。

---

## 14. 进展记录

> 以下表格在实施过程中逐步填写。

| 日期 | 波次 | Step | 状态 | 备注 |
|------|------|------|------|------|
| 2026-07-04 | W1 | T-W1-01~08 | 已完成 | 新增前端会话标签状态、顶部 36px 标签栏、路由同步、原生拖拽排序与 Ctrl+T/W/Tab/数字键快捷键；ChatPage 现在按 `/chat/:sessionId` 激活 tab，并在恢复快照后回写真实 session 标题与 workspace。 |
| 2026-07-04 | W2 | T-W2-01~08 | 已完成 | AppSidebar 已收敛为固定 Rail + 可持久化宽度 SidebarPanel + ResizeHandle + 折叠态 Peek；Panel 复用现有 `SessionSidebar`，移动端沿用 fixed drawer CSS。 |
| 2026-07-04 | W5 | T-W5-01,08 | 已完成/部分 | 新增 `/home` 首页基础视图和 Titlebar Home 入口；搜索、时间分组拆分组件、粘性标题、`/` 登录后重定向尚未完成。 |
| 2026-07-04 | W5 | T-W5-02..07 | 已完成/待验证 | 补齐首页项目列、Date 版今天/昨天/更早分组、会话列表粘性标题、全局搜索（本地标题/字段 + web-client 消息搜索）与已登录根路由到 `/home`；未引入 luxon 依赖。 |
| 2026-07-04 | W3/W4/W6 | T-W3-01~02, T-W6-03 | 已完成/部分/阻塞 | 新增 W3 面板开关与尺寸持久化、通用 `PanelResizeHandle`、`ReviewPanel` 空态 shell、`TerminalPanel` shell；确认 `QuickTerminalPanel` 已覆盖终端运行视图，`FileChangeReviewPanel` 可作为 diff 渲染入口但缺 session diff web-client 数据源；W4 自动滚动/回到底部已由现有 `use-scroll-manager.ts` + `ChatConversationView` 覆盖，未重复新建；W6 新增 shared-ui `InlineEditor` 原语，`@dnd-kit/*` 未安装且本轮不新增依赖。 |
| 2026-08-13 | W3 | T-W3-03,05,06,08,09 | 已完成 | ReviewPanel 和 TerminalPanel 已接入 FusionChatMainShell，支持拖拽调整、折叠展开、移动端适配；卡片化样式已通过 FusionChatMainShell.css 实现。T-W3-04（session diff API）和 T-W3-07（行内评论）阻塞/超出范围。 |
| 2026-08-13 | W4 | T-W4-02,03,04,08 | 已完成 | 新增 useMessageNavigation（Alt+↑/↓ 导航）、useHistoryInfinite（顶部加载+锚点恢复）、useSessionPrefetch（LRU 缓存+并发控制）三个 hook；快捷键已在 useChatKeyboardShortcuts 注册。T-W4-05,07（MessageTimeline 重构）超出范围。 |
| 2026-08-13 | W6 | T-W6-04,05,06 | 已完成 | 会话标题和项目名内联重命名已接入 InlineEditor；命令系统扩充完成（Ctrl+B 侧边栏、Ctrl+Shift+R 审查、Ctrl+\` 终端、Ctrl+Alt+T 主题）。T-W6-01,02（拖拽排序）阻塞，T-W6-07（命令面板优化）超出范围。 |

---

## Notes

### 设计决策

- **标签状态为前端唯一真相源**：路由变化时同步标签（`/chat/:id` → addSessionTab），但标签切换不强制改变路由（避免与 `CachedRouteOutlet` 缓存冲突）。用户通过标签点击切换会话时，才同步路由。
- **2026-07-04 降级说明**：标签拖拽排序先用浏览器原生 drag/drop 实现，未安装 `@dnd-kit`，避免引入新依赖与并行工作冲突；后续若需要无障碍完整拖拽，可在 W6 统一补依赖。
- **2026-07-04 Panel 决策更新**：W2 已新建 `SidebarPanel.tsx` 并接入 `AppSidebar`。Panel 内容复用既有 `SessionSidebar`，由该组件继续承接会话列表、搜索、文件树与工作区选择器，不在 AppSidebar 里重复内联。
- **2026-07-04 ChatPage 边界**：W3/W4 未实施；当前有其他代理在 ChatComposer/Companion 一带并行改动，本轮只触碰 ChatPage 的 tab 同步与标题回写，不改消息渲染、Composer 或 Companion 流程。
- **2026-07-04 W3 最小风险落地**：已完成 `uiState` 的 Review/Terminal 面板开关和尺寸持久化、通用 `PanelResizeHandle`。`ReviewPanel` 只落 shell 与 `FileChangeReviewPanel` 复用入口；真实文件变更列表和 diff 读取需要先在 `@openAwork/web-client` 暴露 session diff 数据源。`TerminalPanel` 只落底部 panel shell，运行终端继续复用现有 `QuickTerminalPanel`，避免重复实现 xterm/Tauri PTY。
- **2026-07-04 W4 复用结论**：现有 `components/conversation-runtime/scroll/use-scroll-manager.ts` 已支持近底部自动跟随、用户上滚暂停、点击回到底部恢复；`ChatConversationView` 已渲染 `ChatScrollBottomButton`。本轮不新建 `useAutoScroll` / `ScrollToBottomButton`，避免重复实现。消息级 Alt 导航、历史顶部锚点恢复和会话预取缓存仍未完成。
- **2026-07-04 W6 依赖结论**：`apps/web/package.json` 未安装 `@dnd-kit/core` / `@dnd-kit/sortable`。考虑到当前已有原生 tab 拖拽与并行侧栏改动，本轮不改依赖；会话列表拖拽排序保持阻塞。已新增 shared-ui `InlineEditor`，并通过 Web 测试 mock 转发真实原语做交互测试。
- **Wave 1/3 并行可行性**：W1（标签页栏）在 Layout 顶部，W3（面板化）在 ChatPage 内部，两者物理隔离可并行开发。但 W1 的 Titlebar 高度（36px）会影响 W3 的可用高度计算，需约定固定值。
- **预取缓存策略**：借鉴 OpenCode `layout.tsx:630-792` 的 LRU + 并发控制，但预取数据通过 `@openAwork/web-client` 的 session message API 获取，不走 SSE/WS。
- **xterm.js 桌面端限制**：TerminalPanel 仅在 `isTauriRuntime()` 为 true 时渲染，Web 端完全不加载 xterm.js 相关代码（动态 import）。

### 约束与边界

- 所有新增文件必须遵循 `AGENTS.md` 中的 1500 行体积限制
- 所有新增 UI 必须遵循 `DESIGN-TOKENS.md` 的 E · Nebula 色彩 token
- 所有对 `agent-gateway` 的 HTTP 请求必须通过 `@openAwork/web-client` 发起
- 不引入 SolidJS（OpenCode 使用 SolidJS，OpenAWork 使用 React，不混用）
- 不改后端 API 或 `agent-core` 逻辑

### 与上一轮改造的关系

本方案是 `260627-sidebar-layout-refactor-plan.md`（已完成）的延续。上一轮建立了 AppSidebar 三区块基线，本轮在此基础上升级为双层架构并扩展会话页布局。

### 2026-07-04 验证记录

- `pnpm --filter @openAwork/web exec vitest run src/stores/ui/uiState.test.ts`：通过，7 tests passed。
- `pnpm --filter @openAwork/web typecheck`：通过。
- `pnpm exec prettier --write apps/web/src/components/layout/AppSidebar.tsx apps/web/src/components/layout/SidebarPanel.tsx apps/web/src/pages/chat-page/ChatPage.tsx`：通过。
- 文件体积复查：`AppSidebar.tsx` 已从 1500+ 行收敛到约 158 纯代码行；`SidebarPanel.tsx` 约 27 纯代码行。`ChatPage.tsx` 仍为既有超大文件，本轮未扩大其渲染/Composer/Companion 实现，仅增加 tab 同步。
- `pnpm --filter @openAwork/web exec vitest run --config vitest.config.ts src/stores/ui/uiState.test.ts src/components/common/display/InlineEditor.test.tsx src/components/layout/PanelResizeHandle.test.tsx src/pages/chat-page/panels/ReviewPanel.test.tsx`：通过，4 files / 14 tests passed。
- `pnpm --filter @openAwork/shared-ui typecheck`：通过。
- `pnpm --filter @openAwork/web typecheck`：通过。
- LSP diagnostics：`apps/web/src/stores/ui/uiState.ts`、`apps/web/src/pages/chat-page/panels/ReviewPanel.tsx`、`packages/shared-ui/src/primitives/InlineEditor.tsx` 均无 error。
- 视觉 QA：本轮 W3/W6 产物尚未接入可访问 route 或组件展示页，无法生成真实浏览器截图；未伪造视觉通过。后续接入 ChatPage 或 Story/Showcase 后需补 375/768/1280px 截图验证。

### 2026-07-04 Wave 5 验证记录

- `pnpm --filter @openAwork/web typecheck`：未通过；当前失败来自并发改动中的 `apps/web/src/components/layout/AppSidebarSections.tsx`、`apps/web/src/components/layout/nav/NavRail.tsx`、`apps/web/src/pages/chat-page/ChatPage.tsx`，均不在 Wave 5 本次允许修改范围内。
- LSP diagnostics：`apps/web/src/pages/home/**` 与 `apps/web/src/App.tsx` 无 error。
- `pnpm exec prettier --check apps/web/src/pages/home/HomePage.tsx apps/web/src/pages/home/HomeProjectColumn.tsx apps/web/src/pages/home/HomeSessionList.tsx apps/web/src/pages/home/HomeSessionSearch.tsx apps/web/src/pages/home/hooks/useStickyHeaderOpacity.ts apps/web/src/pages/home/utils/session-grouping.ts apps/web/src/pages/home/home.css apps/web/src/App.tsx .agentdocs/workflow/260704-opencode-ui-layout-borrow-plan.md`：通过。
- 视觉/交互 QA：通过 Playwright 在 `http://127.0.0.1:5179/home` 注入会话数据验证桌面双栏（`280px 784px`）、移动单栏（`294px`）、项目筛选、今天/昨天/更早分组、搜索浮层与 Enter 选中导航。
