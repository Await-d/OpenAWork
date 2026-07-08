# 新旧布局文件夹与逻辑隔离重构方案

> 创建时间：2026-07-08
> 关联文档：
> - `.agentdocs/workflow/260704-opencode-ui-layout-borrow-plan.md`（母方案，W1/W2 已完成）
> - `.agentdocs/workflow/260706-fusion-layout-t1-s2-refactor.md`（融合布局重构，F1/F2 已完成）
> - `apps/web/src/components/Layout.tsx`（布局入口）
> - `apps/web/src/components/layout/useLayoutShared.ts`（共享 Hook，608 行）
> - `apps/web/src/pages/chat-page/ChatPage.tsx`（会话页，25 处 isFusionLayout 分支）
>
> 状态：**待执行**

---

## Task Overview

将新旧版本布局（Fusion / Classic）在**文件夹结构**和**布局逻辑**两个维度做物理隔离，降低耦合性，为后续废弃旧版布局铺路。

核心目标：
1. **文件夹隔离**：Fusion 专用组件移入 `layout/fusion/`，Classic 专用组件移入 `layout/classic/`，共享组件留在 `layout/shared/`
2. **死代码清理**：删除 4 个无引用文件
3. **共享 Hook 拆分**：`useLayoutShared` 拆为公共层 + 各布局专属逻辑
4. **ChatPage 布局感知解耦**：将 26 处 `isFusionLayout` 引用 + 3 个子组件透传重构为策略模式

---

## Current Analysis

### 现状文件归属（精确引用追踪结果）

#### Fusion 专用（18 个文件）

| 文件 | 被引用方 |
|------|---------|
| `LayoutFusion.tsx` | `Layout.tsx` |
| `FusionSidebar.tsx` | `LayoutFusion.tsx` |
| `FusionSidebarPeek.tsx` | `FusionSidebar.tsx` |
| `FusionSidebarPeek.test.tsx` | — |
| `FusionSidebarPeek.integration.test.tsx` | — |
| `FusionSidebar.test-utils.tsx` | — |
| `FusionSidebarPanel.integration.test.tsx` | — |
| `SidebarRailV2.tsx` | `FusionSidebar.tsx` |
| `SidebarRailV2.test.tsx` | — |
| `TitlebarTabStrip.tsx` | `LayoutFusion.tsx` |
| `TitlebarTabStrip.test.tsx` | — |
| `TitlebarTabStrip.css` | — |
| `TitlebarToolsMenu.tsx` | `TitlebarTabStrip.tsx` |
| `TitlebarToolsMenu.css` | — |
| `useTitlebarKeyboardShortcuts.ts` | `TitlebarTabStrip.tsx` |
| `useTitlebarResponsiveState.ts` | `TitlebarTabStrip.tsx` |
| `TitlebarActionButtons.tsx` | `TitlebarTabStrip.tsx`（仅 Fusion 引用） |
| `TitlebarHomeButton.tsx` | `TitlebarActionButtons.tsx`（仅 Fusion 链路引用） |

#### Classic 专用（5 个文件）

| 文件 | 被引用方 |
|------|---------|
| `LayoutClassic.tsx` | `Layout.tsx` |
| `AppSidebar.tsx`（1453 行） | `LayoutClassic.tsx` |
| `ClassicWorkbenchTitlebar.tsx` | `LayoutClassic.tsx` |
| `ClassicWorkbenchTitlebar.css` | — |
| `ClassicWorkbenchTitlebar.test.tsx` | — |
| `WorkbenchModeTabs.tsx` | `ClassicWorkbenchTitlebar.tsx` |

#### 死代码（4 个文件，无任何引用）

| 文件 | 说明 |
|------|------|
| `AppSidebarIcons.tsx` | 导出 MoonIcon/SunIcon/LogoutIcon，无人 import |
| `AppSidebarSections.tsx` | 导出 NavItemLink/TeamGroupList，无人 import |
| `AppSidebar.styles.ts` | 样式常量，无人 import |
| `TitlebarTab.tsx` | 无人 import |

#### 共享组件（~13 个文件）

| 文件 | 被引用方 |
|------|---------|
| `useLayoutShared.ts`（608 行） | `Layout.tsx` |
| `layout-mode-options.ts` | `LayoutModeSwitch` / `TitlebarLayoutModeControl` |
| `LayoutModeSwitch.tsx` | `Layout.tsx` / `ClassicWorkbenchTitlebar.tsx` |
| `LayoutModeSwitch.css` | — |
| `LayoutModeSwitch.test.tsx` | — |
| `LayoutTransitionOverlay.tsx` | `Layout.tsx` |
| `TitlebarLayoutModeControl.tsx` | `LayoutModeSwitch.tsx` / `TitlebarTabStrip.tsx` |
| `TitlebarLayoutModeControl.css` | — |
| `FloatingPermissionPrompt.tsx` | `Layout.tsx` |
| `FloatingPermissionPrompt.test.tsx` | — |
| `PanelResizeHandle.tsx` | `ReviewPanel.tsx` / `FusionDockedSidePanel.tsx` |
| `TeamTitlebarSummary.tsx` | `TitlebarTabStrip.tsx` |
| `TitlebarIcons.tsx` | `TitlebarLayoutModeControl`(共享) / `TitlebarHomeButton`(Fusion) / `TitlebarToolsMenu`(Fusion) |

#### 共享子目录（5 个）

| 目录 | 被引用方 |
|------|---------|
| `nav/` | `AppSidebar`(Classic) + `SidebarRailV2`(Fusion) |
| `sidebar/` | `AppSidebar`(Classic) + `FusionSidebar`(Fusion) + Team 页面 + ChatPage |
| `file-tree/` | 两种布局的侧栏 |
| `workspace/` | 两种布局 |
| `notification/` | `AppSidebar`(Classic) + `SidebarRailV2`(Fusion) |

### ChatPage.tsx 中的 26 处 isFusionLayout 引用 + 3 个子组件透传

| 行号 | 用途 | 分类 |
|------|------|------|
| 567 | 定义 `isFusionLayout` | — |
| 639-655 | Classic 编辑器自动展开 | 副作用 |
| 677-704 | Fusion 终端面板自动展开 | 副作用 |
| 4245-4260 | 审查面板 toggle 逻辑 | 回调 |
| 4444-4458 | 命令面板 label / description | 配置 |
| 4586-4589 | 右面板 toggle 回调 | 回调 |
| 4602-4605 | 是否显示 Docked 审查面板 | 派生 |
| 4653-4659 | page-root className / flex 方向 | 样式 |
| 4731-4734 | FusionChatMainShell props | 渲染 |
| 4790-4795 | 对话区 compact / maxWidth | 样式 |
| 4800-4830 | SessionHeaderBar vs 旧 header | 渲染 |
| 4860-4862 | ChatTerminalToggle props | 渲染 |
| 4963-4971 | ChatWorkbenchStatusStrip | 渲染 |
| 5227-5229 | QuickTerminalPanel | 渲染 |
| 5249-5252 | ChatRightPanel vs FusionDocked | 渲染 |

#### 子组件中的 isFusionLayout 透传（3 个文件）

| 文件 | 用途 |
|------|------|
| `panels/ChatWorkbenchStatusStrip.tsx` | `isFusionLayout` 为 false 时直接 return null（不渲染） |
| `panels/ChatTerminalToggle.tsx` | 根据 `isFusionLayout` 切换 terminalPanelOpened / quickTerminalOpen |
| `layout/FusionChatMainShell.tsx` | 根据 `isFusionLayout` 切换 6 处 CSS 类名 + 侧面板/终端渲染 |

> **影响**：Phase 3 策略模式重构时，这 3 个子组件也需要同步改造——要么从策略对象获取属性，要么由 ChatPage 在 props 层面屏蔽差异。

---

## Complexity Assessment

- Atomic steps: ~12（4 Phase × 3 步） → 0
- Parallel streams: yes（Phase 1 文件移动 + 死代码清理可并行；Phase 2 的 fusion/classic hook 拆分可并行） → +2
- Modules/systems/services: 3（layout 组件目录 / ChatPage / uiState store） → +1
- Long step (>5 min): yes（useLayoutShared 拆分 + ChatPage isFusionLayout 重构） → +1
- Persisted review artifacts: yes → +1
- OpenCode available: no（当前为 CodeBuddy IDE） → +0
- **Total score**: 5
- **Chosen mode**: Full orchestration
- **Routing rationale**: 横跨 layout 目录、ChatPage、uiState 三个模块，Phase 间有并行空间，需要持久化产物供多轮迭代追踪。

---

## Solution Design

### 目标目录结构

```
apps/web/src/components/layout/
├── shared/                          # 共享层（~13 个文件）
│   ├── useLayoutShared.ts           # 拆分后只保留真正公共的逻辑
│   ├── layout-mode-options.ts
│   ├── LayoutModeSwitch.tsx
│   ├── LayoutModeSwitch.css
│   ├── LayoutModeSwitch.test.tsx
│   ├── LayoutTransitionOverlay.tsx
│   ├── TitlebarLayoutModeControl.tsx
│   ├── TitlebarLayoutModeControl.css
│   ├── FloatingPermissionPrompt.tsx
│   ├── FloatingPermissionPrompt.test.tsx
│   ├── PanelResizeHandle.tsx
│   ├── TeamTitlebarSummary.tsx
│   └── TitlebarIcons.tsx
│
├── fusion/                          # 新版本布局（~18 个文件）
│   ├── LayoutFusion.tsx
│   ├── FusionSidebar.tsx
│   ├── FusionSidebarPeek.tsx
│   ├── FusionSidebarPeek.test.tsx
│   ├── FusionSidebarPeek.integration.test.tsx
│   ├── FusionSidebar.test-utils.tsx
│   ├── FusionSidebarPanel.integration.test.tsx
│   ├── SidebarRailV2.tsx
│   ├── SidebarRailV2.test.tsx
│   ├── TitlebarTabStrip.tsx
│   ├── TitlebarTabStrip.test.tsx
│   ├── TitlebarTabStrip.css
│   ├── TitlebarToolsMenu.tsx
│   ├── TitlebarToolsMenu.css
│   ├── TitlebarActionButtons.tsx     # 仅 TitlebarTabStrip 引用
│   ├── TitlebarHomeButton.tsx        # 仅 TitlebarActionButtons 引用
│   ├── useTitlebarKeyboardShortcuts.ts
│   └── useTitlebarResponsiveState.ts
│
├── classic/                         # 旧版本布局（~6 个文件）
│   ├── LayoutClassic.tsx
│   ├── AppSidebar.tsx
│   ├── ClassicWorkbenchTitlebar.tsx
│   ├── ClassicWorkbenchTitlebar.css
│   ├── ClassicWorkbenchTitlebar.test.tsx
│   └── WorkbenchModeTabs.tsx
│
├── nav/                             # 共享子目录（保持原位）
├── sidebar/                         # 共享子目录（保持原位）
├── file-tree/                       # 共享子目录（保持原位）
├── workspace/                       # 共享子目录（保持原位）
└── notification/                    # 共享子目录（保持原位）
```

### useLayoutShared 拆分策略

```
useLayoutShared.ts (608行, 当前)
    ↓ 拆分为
shared/useLayoutShared.ts           # 公共层：认证、命令面板、权限/问题订阅、键盘快捷键
fusion/useFusionLayout.ts           # Fusion 专属：fusion sidebarTab、panel 状态、dock 判定
classic/useClassicLayout.ts         # Classic 专属：classic sidebarTab、editor auto-open、quick terminal
```

**拆分原则**：
- 认证（accessToken、clearAuth、gatewayUrl）→ 公共
- 视口检测（isNarrowViewport）→ 公共
- 路由感知（navigate、location、isChatRoute）→ 公共
- 命令面板（isPaletteOpen、paletteCommands）→ 公共
- 权限/问题（pendingPermission、pendingQuestion）→ 公共
- `sidebarTab`、`expandedDirs`、`leftSidebarOpen` → 保留在公共层（两种布局都读取）
- `layoutMode` 本身 → 保留在公共层（Layout.tsx 需要它做分支）

### ChatPage isFusionLayout 解耦策略

引入 `ChatLayoutStrategy` 接口，将布局差异封装为策略对象：

```typescript
// shared/ChatLayoutStrategy.ts
interface ChatLayoutStrategy {
  readonly layoutMode: 'fusion' | 'classic';
  // 渲染
  shouldRenderStatusStrip: boolean;
  shouldRenderQuickTerminal: boolean;
  shouldRenderChatRightPanel: boolean;
  shouldRenderDockedSidePanel: boolean;
  // 样式
  pageRootClassName: string;
  pageRootStyle: CSSProperties;
  compactConversation: boolean;
  centerContent: boolean;
  contentMaxWidth: number | 'fluid' | undefined;
  // 回调
  toggleReviewPanel: () => void;
  // 副作用控制
  shouldAutoOpenEditor: boolean;
  shouldAutoOpenTerminal: boolean;
}
```

ChatPage 通过 `useChatLayoutStrategy(layoutMode)` 获取策略对象，消除所有 `isFusionLayout` 分支。

---

## Implementation Plan

### Phase 1: 死代码清理 + 文件夹创建（低风险，可并行）

- [ ] T-01: 删除 4 个死代码文件（`AppSidebarIcons.tsx`、`AppSidebarSections.tsx`、`AppSidebar.styles.ts`、`TitlebarTab.tsx`）
- [ ] T-02: 创建 `layout/fusion/`、`layout/classic/`、`layout/shared/` 三个子目录
- [ ] T-03: 将 Fusion 专用文件移入 `fusion/`，更新所有 import 路径
- [ ] T-04: 将 Classic 专用文件移入 `classic/`，更新所有 import 路径
- [ ] T-05: 将共享文件移入 `shared/`，更新所有 import 路径
- [ ] T-06: 运行 `pnpm typecheck` + `pnpm lint` 验证，修复 import 路径

### Phase 2: useLayoutShared 拆分（中等风险，fusion/classic 可并行）

- [ ] T-07: 分析 `useLayoutShared.ts` 608 行，标记每个字段的归属（公共 / fusion / classic）
- [ ] T-08: 创建 `fusion/useFusionLayout.ts`，提取 Fusion 专属逻辑
- [ ] T-09: 创建 `classic/useClassicLayout.ts`，提取 Classic 专属逻辑
- [ ] T-10: 精简 `shared/useLayoutShared.ts` 为纯公共层，`LayoutFusion` / `LayoutClassic` 各自组合公共 + 专属 hook
- [ ] T-11: 更新 `Layout.tsx` import 路径，运行 typecheck + lint

### Phase 3: ChatPage isFusionLayout 解耦（高收益，工作量大）

- [ ] T-12: 创建 `ChatLayoutStrategy` 接口 + `FusionChatLayoutStrategy` / `ClassicChatLayoutStrategy` 两个实现
- [ ] T-13: 创建 `useChatLayoutStrategy` hook，按 `layoutMode` 返回对应策略
- [ ] T-14: 重构 ChatPage.tsx，将 26 处 `isFusionLayout` 分支替换为策略对象属性读取；同步改造 3 个子组件（`ChatWorkbenchStatusStrip`、`ChatTerminalToggle`、`FusionChatMainShell`）
- [ ] T-15: 运行全量测试 `pnpm --filter @openAwork/web test`（如有）+ typecheck + lint

### Phase 4: 验证与收口

- [ ] T-16: 手动切换 Fusion ↔ Classic 布局，验证两种模式功能正常
- [ ] T-17: 验证桌面端（`apps/desktop`）布局切换正常
- [ ] T-18: 更新 `.agentdocs/index.md` 记录架构决策

---

## Notes

### 风险矩阵

| Phase | 风险 | 缓解措施 |
|-------|------|---------|
| Phase 1 | import 路径遗漏 | typecheck 全量覆盖 |
| Phase 2 | hook 拆分后状态不同步 | 保持 `useLayoutShared` 返回类型不变，专属 hook 作为扩展 |
| Phase 3 | 策略对象遗漏边缘 case | 逐行对照 26 处分支 + 3 个子组件透传，保持行为等价 |
| Phase 3 | ChatPage.tsx 5000+ 行，改动范围大 | 策略对象只替换读取方式，不改变渲染结构 |

### 执行顺序建议

```
Phase 1 (T-01 ~ T-06)  ← 可立即执行，纯机械操作
    ↓
Phase 2 (T-07 ~ T-11)  ← 依赖 Phase 1 的目录结构
    ↓
Phase 3 (T-12 ~ T-15)  ← 依赖 Phase 2 的 hook 拆分
    ↓
Phase 4 (T-16 ~ T-18)  ← 验证收口
```

Phase 1 内部：T-01 与 T-02~T-05 可并行（死代码清理不受目录移动影响）。
Phase 2 内部：T-08 与 T-09 可并行。

### 不在本次范围

- AppSidebar.tsx（1453 行）的内部拆分——单独工作流处理
- ChatPage.tsx 整体拆分——单独工作流处理
- Fusion 布局功能补齐（F3/F4/F5）——由 `260706-fusion-layout-t1-s2-refactor.md` 跟踪
