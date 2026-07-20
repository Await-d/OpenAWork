# 新旧布局文件夹与逻辑隔离重构方案（Fusion-only 收口）

> 创建时间：2026-07-08
> 关联文档：
> - `.agentdocs/workflow/260704-opencode-ui-layout-borrow-plan.md`（母方案，W1/W2 已完成）
> - `.agentdocs/workflow/260706-fusion-layout-t1-s2-refactor.md`（融合布局重构，F1/F2 已完成）
> - `apps/web/src/components/Layout.tsx`（布局入口）
> - `apps/web/src/components/layout/shared/useLayoutShared.ts`（共享 Hook，608 行）
> - `apps/web/src/pages/chat-page/ChatPage.tsx`（会话页，25 处 isFusionLayout 分支）
>
> 状态：**已完成（2026-07-18：T-01 ~ T-16 全部收口，Fusion-only 主线与桌面端验收闭环完成）**

---

## Task Overview

在**不调整 Classic 旧版布局实现**的前提下，将 Fusion 新版布局在**文件夹结构**和**布局逻辑**两个维度做物理隔离与解耦，降低耦合性，为后续废弃旧版布局铺路。

核心目标：
1. **文件夹隔离**：Fusion 专用组件移入 `layout/fusion/`；共享层只抽离不会迫使 Classic 改动的公共能力
2. **死代码清理**：删除 4 个无引用文件
3. **共享 Hook 收口**：为 Fusion 提取专属 hook / helper，但不重写 Classic 路径
4. **ChatPage 布局感知解耦**：优先抽离 Fusion 分支；Classic fallback 保持冻结，不因“策略对称”被改写

---

## Current Analysis

### 现状文件归属（精确引用追踪结果）

### 2026-07-14 范围更新

- **唯一允许调整面**：Fusion 新版布局及其必要共享入口（如 `Layout.tsx`、Fusion 专属组件、Fusion 侧的 ChatPage 分支）。
- **冻结兼容边界**：`LayoutClassic.tsx`、`AppSidebar.tsx`、`ClassicWorkbenchTitlebar.tsx`、`WorkbenchModeTabs.tsx` 以及其它 Classic 旧路径文件仅作为兼容边界保留，不再接受结构、样式或交互层面的持续演进。
- **执行规则**：如果某个任务必须修改 Classic 文件才能成立，则该任务应被改写为 Fusion-only 等价方案，或从本工作流中移出。

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

#### Classic 专用（5 个文件，冻结）

| 文件 | 被引用方 |
|------|---------|
| `LayoutClassic.tsx` | `Layout.tsx` |
| `AppSidebar.tsx`（1453 行） | `LayoutClassic.tsx` |
| `ClassicWorkbenchTitlebar.tsx` | `LayoutClassic.tsx` |
| `ClassicWorkbenchTitlebar.css` | — |
| `ClassicWorkbenchTitlebar.test.tsx` | — |
| `WorkbenchModeTabs.tsx` | `ClassicWorkbenchTitlebar.tsx` |

### 2026-07-18 实际进展回填

- `apps/web/src/components/layout/` 已按 `fusion/`、`shared/` 与 Classic 冻结边界重新落盘；`Layout.tsx` 已改为消费新目录。
- `useLayoutShared` 已迁到 `shared/`，新增 `fusion/useFusionLayout.ts` 只承接 Fusion 壳的组合逻辑；Classic 继续直接消费共享基线。
- `ChatPage.tsx` 已新增 `useFusionChatLayout.ts`，把 Fusion 的 page-root、dock 判定、审查侧栏 toggle 与终端自动展开规则抽离出主页面。
- `FusionChatMainShell` 已改成真正的 Fusion-only 壳；`ChatTerminalToggle` 不再兼容 Classic 分支；Classic 快捷终端回退到直接使用 `QuickTerminalToggle`。
- `TitlebarTab.tsx` 在当前代码中仍被 `fusion/TitlebarTabStrip.tsx` 使用，之前文档把它记成死代码已过期。

#### 死代码（3 个文件，已删除）

| 文件 | 说明 |
|------|------|
| `AppSidebarIcons.tsx` | 导出 MoonIcon/SunIcon/LogoutIcon，无人 import |
| `AppSidebarSections.tsx` | 导出 NavItemLink/TeamGroupList，无人 import |
| `AppSidebar.styles.ts` | 样式常量，无人 import |

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

> **影响**：后续解耦时只允许抽离 Fusion 正向分支；Classic fallback 继续保留原行为，不再为了“策略对称”创建 Classic 对应实现。

---

## Complexity Assessment

- Atomic steps: 8（4 Phase） → +2
- Parallel streams: yes（Fusion 文件移动 + 死代码清理可并行；Fusion hook 抽离与 ChatPage 收口可分阶段推进） → +2
- Modules/systems/services: 3（layout 组件目录 / ChatPage / uiState store） → +1
- Long step (>5 min): yes（Fusion hook 抽离 + ChatPage Fusion 分支收口） → +1
- Persisted review artifacts: yes → +1
- OpenCode available: no（当前为 CodeBuddy IDE） → +0
- **Total score**: 7
- **Chosen mode**: Full orchestration
- **Routing rationale**: 横跨 layout 目录、ChatPage、uiState 三个模块，且需要在“不改 Classic”的硬约束下做 Fusion-only 收口，必须保留明确的执行边界和验收记录。

---

## Solution Design

### 目标目录结构

```
apps/web/src/components/layout/
├── shared/                          # 共享层（仅放不会迫使 Classic 改 import 的公共能力）
│   ├── useLayoutShared.ts           # 保持 Classic 兼容基线；只做必要的纯公共抽离
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
├── LayoutClassic.tsx                # Classic 冻结，保留原位
├── AppSidebar.tsx                   # Classic 冻结，保留原位
├── ClassicWorkbenchTitlebar.tsx     # Classic 冻结，保留原位
├── ClassicWorkbenchTitlebar.css     # Classic 冻结，保留原位
├── ClassicWorkbenchTitlebar.test.tsx
├── WorkbenchModeTabs.tsx            # Classic 冻结，保留原位
│
├── nav/                             # 共享子目录（保持原位）
├── sidebar/                         # 共享子目录（保持原位）
├── file-tree/                       # 共享子目录（保持原位）
├── workspace/                       # 共享子目录（保持原位）
└── notification/                    # 共享子目录（保持原位）
```

### useLayoutShared 收口策略

```
useLayoutShared.ts (608行, 当前，保持 Classic 兼容基线)
    ↓ 增量收口为
shared/useLayoutShared.ts           # 只抽离纯公共 helper；Classic 不强制改调用方式
fusion/useFusionLayout.ts           # Fusion 专属：sidebarTab、panel 状态、dock 判定、Fusion 派生值
```

**拆分原则**：
- 认证（accessToken、clearAuth、gatewayUrl）→ 公共
- 视口检测（isNarrowViewport）→ 公共
- 路由感知（navigate、location、isChatRoute）→ 公共
- 命令面板（isPaletteOpen、paletteCommands）→ 公共
- 权限/问题（pendingPermission、pendingQuestion）→ 公共
- `sidebarTab`、`expandedDirs`、`leftSidebarOpen` → 保留在公共层（两种布局都读取）
- `layoutMode` 本身 → 保留在公共层（Layout.tsx 需要它做分支）
- Classic 旧布局继续消费稳定基线，不新建 `classic/useClassicLayout.ts`，避免为了目录对称而修改旧路径

### ChatPage isFusionLayout 收口策略

不再追求一次性消除所有 `isFusionLayout`。本轮只把 Fusion 分支抽离为独立 helper / shell，Classic fallback 保持原样：

```typescript
// fusion/use-fusion-chat-layout.ts
interface FusionChatLayoutState {
  shouldRenderStatusStrip: true;
  shouldRenderQuickTerminal: boolean;
  shouldRenderDockedSidePanel: boolean;
  pageRootClassName: string;
  compactConversation: boolean;
  centerContent: boolean;
  contentMaxWidth: number | 'fluid' | undefined;
  toggleReviewPanel: () => void;
  shouldAutoOpenTerminal: boolean;
}
```

ChatPage 只在 `isFusionLayout === true` 时读取 `useFusionChatLayout()` 的返回值；Classic 分支继续保留当前 fallback，不新增对称的 Classic strategy 实现。

---

## Implementation Plan

### Phase 1: Fusion 目录隔离 + 死代码清理（低风险，可并行）

- [x] T-01: 删除 3 个真实死代码文件（`AppSidebarIcons.tsx`、`AppSidebarSections.tsx`、`AppSidebar.styles.ts`）；`TitlebarTab.tsx` 经复验仍在 `fusion/TitlebarTabStrip.tsx` 中被使用，因此不删除
- [x] T-02: 创建 `layout/fusion/` 与必要的 `layout/shared/` 子目录（不为 Classic 建新目录）
- [x] T-03: 将 Fusion 专用文件移入 `fusion/`，仅更新 Fusion 路径与共享入口 import
- [x] T-04: 将不会迫使 Classic 文件改 import 的公共能力移入 `shared/`
- [x] T-05: 运行 `pnpm --filter @openAwork/web typecheck`；`pnpm lint` 因仓库中与本次无关的桌面测试 lint 债失败，已补充对新增/关键改动文件的 `eslint --no-ignore` 验证

### Phase 2: Fusion hook 抽离（中等风险）

- [x] T-06: 分析 `useLayoutShared.ts` 608 行，保留其为共享基线，并确认 Fusion 组合逻辑应外提到独立 hook
- [x] T-07: 创建 `fusion/useFusionLayout.ts`，提取 Fusion 壳专属组合逻辑
- [x] T-08: 将 `useLayoutShared.ts` 收口为 Classic-safe 基线，只抽离纯公共 helper；`LayoutFusion` 组合公共层 + Fusion hook
- [x] T-09: 更新 `Layout.tsx` / `LayoutFusion.tsx` import 路径，运行 typecheck + lint

### Phase 3: ChatPage Fusion 分支解耦（高收益，工作量大）

- [x] T-10: 创建 `useFusionChatLayout`，承接 Fusion 分支的 page-root、dock 判定、审查侧栏 toggle 与终端自动展开规则
- [x] T-11: 重构 `ChatPage.tsx`，将 Fusion 正向分支替换为 helper 读取；Classic fallback 保持原样
- [x] T-12: 同步改造 3 个 Fusion 侧子组件（`ChatWorkbenchStatusStrip`、`ChatTerminalToggle`、`FusionChatMainShell`），避免继续把 Classic 逻辑耦合进去
- [x] T-13: 运行相关测试 + typecheck + lint 验证（定向 Vitest 10 文件 / 34 测试通过；`pnpm --filter @openAwork/web typecheck` 通过）

### Phase 4: 验证与收口

- [x] T-14: 手动验证 Fusion 新版布局功能正常；已通过 Vite 预览 + Playwright mock gateway 打开 `/chat`，确认 `titlebar-tab-strip`、`fusion-chat-main-shell`、`page-root page-root-fusion-col` 与 Fusion 侧栏/主会话区真实挂载
- [x] T-15: 验证桌面端（`apps/desktop`）Fusion 布局切换正常
  已完成：补充 `apps/desktop` 的 `vite:dev` 脚本与 `e2e/fusion-layout.spec.ts`，并通过 `pnpm --filter @openAwork/desktop test:e2e` 实际验证桌面壳内的 Fusion / Classic 切换兼容
- [x] T-16: 更新 `.agentdocs/index.md`，移除已不存在的活动工作流 `260705-layout-component-fusion`，并同步本工作流的真实完成度

---

## Verification

- `pnpm --filter @openAwork/web typecheck` ✅
- `pnpm --filter @openAwork/web lint` ✅（脚本按仓库约定输出“跳过 apps/web lint”）
- `pnpm lint` ✅（2026-07-19 补齐桌面 updater 测试中的 `consistent-type-imports` 历史 lint 债后通过）
- `pnpm exec eslint --no-ignore ...`（本次新建/关键改动文件）✅
- `pnpm --filter @openAwork/web exec vitest run ...` 定向两轮，共 10 个测试文件 / 34 个测试 ✅
- 2026-07-19 隔离复查补强：`useFusionChatLayout` 不再回传 Classic root/layout；Classic/Fusion 对话布局 resolver 拆分；旧根路径、Fusion→Classic、shared→Fusion/Classic 反向搜索无残留 ✅
- `pnpm --filter @openAwork/web exec vitest run src/pages/chat-page/layout/conversation-layout-state.test.ts src/pages/chat-page/layout/use-fusion-chat-layout.test.tsx src/pages/chat-page/layout/FusionChatMainShell.test.tsx src/pages/chat-page/panels/ChatTerminalToggle.test.tsx src/pages/chat-page/panels/ChatWorkbenchStatusStrip.test.tsx` ✅（5 个测试文件 / 15 个测试）
- `pnpm --filter @openAwork/desktop typecheck` ✅
- `pnpm --filter @openAwork/desktop test:e2e` ✅（新增 `apps/desktop/e2e/fusion-layout.spec.ts`，2 个桌面 ChatPage 布局切换场景通过）
- Web 手动验证：Vite 预览 `http://127.0.0.1:4173/chat` + Playwright mock gateway 截图 `/tmp/openawork-fusion-chat-clean.png` ✅
- 桌面端手动/半实机验证：Vite 桌面壳 `http://127.0.0.1:1420/chat/session-desktop-demo` + Playwright mock gateway 截图 `/tmp/openawork-desktop-chat-stable.png` ✅

## Notes

### 风险矩阵

| Phase | 风险 | 缓解措施 |
|-------|------|---------|
| Phase 1 | Fusion 文件迁移误伤 Classic import | 只迁移 Fusion 专用文件；Classic 路径保持原位 |
| Phase 2 | hook 抽离后 Classic 行为漂移 | `useLayoutShared` 保持 Classic-safe 基线，不强制旧布局改调用方式 |
| Phase 3 | Fusion helper 漏掉边缘 case | 逐行对照 Fusion 正向分支与 3 个子组件透传，保持 Classic fallback 原样 |
| Phase 3 | ChatPage.tsx 5000+ 行，改动范围大 | 只替换 Fusion 读取方式，不重写 Classic 渲染结构 |

### 执行顺序建议

```
Phase 1 (T-01 ~ T-05)  ← 可立即执行，Fusion-only 机械操作
    ↓
Phase 2 (T-06 ~ T-09)  ← 依赖 Phase 1 的目录结构
    ↓
Phase 3 (T-10 ~ T-13)  ← 依赖 Phase 2 的 hook 抽离
    ↓
Phase 4 (T-14 ~ T-16)  ← 验证收口
```

Phase 1 内部：T-01 与 T-02~T-04 可并行（死代码清理不受 Fusion 目录迁移影响）。
Phase 2 内部：T-07 与 T-08 可分段推进，但不引入 Classic 对称改造。

### 不在本次范围

- AppSidebar.tsx（1453 行）的内部拆分——旧版 Classic 冻结，不在本工作流处理
- ChatPage.tsx 整体拆分——单独工作流处理
- 任何要求继续演进 Classic 旧布局的任务——显式移出范围
- Fusion 布局功能补齐（F3/F4/F5）——由 `260706-fusion-layout-t1-s2-refactor.md` 跟踪
