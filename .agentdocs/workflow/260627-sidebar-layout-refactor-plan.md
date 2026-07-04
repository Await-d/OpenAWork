# 主界面左侧栏布局改造方案

> 创建时间：2026-06-27
> 关联文档：
> - `apps/web/src/components/Layout.tsx`（当前主布局）
> - `apps/web/src/components/layout/nav/NavRail.tsx`（当前导航栏，将被替代）
> - `apps/web/src/components/layout/sidebar/SessionSidebar.tsx`（当前会话面板，逻辑复用）
> - `apps/web/src/pages/chat-page/ChatPage.tsx`（当前 SessionSidebar 宿主）
> - `.agentdocs/companion-settings-enhancement-plan.md`（方案格式参考）
> - `.agentdocs/workflow/260530-team-page-内容区功能加强方案.md`（方案格式参考）
>
> 状态：**待实施**

---

## 1. Task Overview

当前主界面左侧采用 `NavRail(56px) + SessionSidebar(280px, 仅 Chat 路由内渲染)` 的两栏分离式布局。用户要求改为统一的 `AppSidebar(260px)` 三区块式布局，对标 CodeBuddy 风格：

- **顶部区块**（约15%）：Logo + 定时任务 + 技能 + 智能体
- **中间区块**（约70%）：新建任务按钮 + 搜索框 + 对话与团队会话列表
- **底部区块**（约15%）：通知中心 + 主题切换 + 关于 + 设置 + 退出登录（不变）

同时进行导航项重组：工作流页面删除，会话列表/模板/图片移入设置页面。

## 2. 核心原则

- **合并而非重写**：`AppSidebar` 复用 `NavRail` 的品牌区/底部区逻辑和 `SessionSidebar` 的会话列表渲染逻辑（`SessionSidebarSessionRow` + `groupedSessionTrees`），不重写会话分组/右键菜单/搜索等复杂逻辑。
- **底部完全不变**：底部区块保持现有 `NavRail` 底部区代码逻辑不变，仅迁移宿主容器。
- **全局常驻**：中间区块的会话列表从 Chat 路由内迁移到 Layout 层，所有页面可见。
- **折叠模式兼容**：保留 56px 折叠态，折叠时仅显示图标行。
- **遵守目录产权**：新建文件放 `apps/web/src/components/layout/`；单文件 ≤1500 行。

## 3. 现状分析

### 3.1 当前布局层次

```
Layout.tsx
├── NavRail (56px / 200px)           ← 导航栏，全局常驻
│   ├── 品牌区: Logo + Gateway状态 + 折叠按钮
│   ├── 导航分组: workspace/collaboration/automation/content
│   └── 底部区: 通知/主题/关于/设置/退出
│
└── 主内容区 (flex:1)
    └── CachedRouteOutlet
        └── ChatPage (当路由为 /chat 时)
            ├── SessionSidebar (280px)    ← 会话面板，仅 Chat 路由
            │   ├── 新建会话按钮 + 工作区选择
            │   ├── Tab切换: 会话 / 文件树
            │   ├── 搜索框
            │   └── 会话列表 (按工作区分组)
            ├── 主对话区
            └── 右侧面板
```

### 3.2 关键文件职责

| 文件 | 行数 | 职责 |
|------|------|------|
| `Layout.tsx` | 647 | 主布局壳：NavRail + 主内容区 + 全局弹窗/快捷键 |
| `NavRail.tsx` | 667 | 左侧导航栏：品牌区 + 导航分组 + 底部区 |
| `RailIcon.tsx` | 198 | 导航数据结构 `railGroups` + 图标 `railIcon()` |
| `SessionSidebar.tsx` | 1450 | 会话面板：新建/搜索/会话列表/文件树/右键菜单 |
| `ChatPage.tsx` | 4986 | Chat 页面：内含 SessionSidebar 渲染容器(4355~4419行) |
| `uiState.ts` | — | Zustand store: `leftSidebarOpen`/`navRailExpanded`/`sidebarTab` |

### 3.3 问题清单

| # | 问题 | 影响 |
|---|------|------|
| 1 | SessionSidebar 仅在 Chat 路由可见 | 其他页面无法快速切换会话 |
| 2 | NavRail 56px 图标栏信息密度低 | 顶部空间浪费 |
| 3 | 导航项分组过多(4组9项) | 工作流/模板/会话列表使用频率低但占导航位 |
| 4 | 会话列表与导航分离 | 用户需先进入 Chat 才能看会话列表 |

## 4. 目标与非目标

### 4.1 目标

- T1. 新建 `AppSidebar` 组件，合并 NavRail + SessionSidebar 会话列表为统一三区块左侧栏（260px）
- T2. 导航项重组：定时任务/技能/智能体提升到顶部区块；工作流删除；会话列表/模板移入设置
- T3. 会话列表全局常驻（从 ChatPage 迁移到 Layout 层）
- T4. ChatPage 移除 SessionSidebar 渲染容器，布局简化为 `[主内容区] [右面板]`
- T5. 设置页面新增"会话管理"和"模板管理"两个 Tab

### 4.2 非目标

- N1. 不重写 `SessionSidebar.tsx` 内部的会话分组/右键菜单/重命名/导出等逻辑
- N2. 不改变 `CachedRouteOutlet` 路由缓存机制
- N3. 不改变 CSS 变量主题体系
- N4. 不在本次改造中实现团队会话列表（仅展示对话会话，团队会话留后续迭代）
- N5. 不在本次改造中实现文件树功能（文件树 Tab 在 AppSidebar 中不展示）
- N6. 不改变底部区块任何行为

## 5. 设计要点

### 5.1 AppSidebar 三区块结构

```
AppSidebar (260px | 折叠56px)
│
├── 【顶部区块】 flex-shrink:0  约15%
│   ├── 品牌区: Logo + Gateway状态点 + 折叠按钮
│   └── 顶部导航项 (NavLink × 3):
│       ├── ⏰ 定时任务  → /schedules
│       ├── ⚡ 技能      → /skills
│       └── 🤖 智能体    → /agents
│
├── 【中间区块】 flex:1, overflow-y:auto  约70%
│   ├── 新建任务按钮 (+ 工作区选择子按钮)
│   ├── 搜索框 (sessionSearch)
│   └── 会话列表 (groupedSessionTrees)
│       └── 按工作空间分组
│           └── SessionSidebarSessionRow (复用)
│
└── 【底部区块】 flex-shrink:0  约15%
    ├── NotificationCenter (复用)
    ├── 主题切换按钮
    ├── 关于 (NavLink → /about)
    ├── 设置 (NavLink → /settings)
    └── 退出登录按钮
```

### 5.2 导航项调整

| 原导航项 | 原位置 | 调整去向 |
|----------|--------|----------|
| 定时任务 | NavRail automation 组 | **AppSidebar 顶部区块** |
| 技能 | NavRail automation 组 | **AppSidebar 顶部区块** |
| 智能体 | NavRail automation 组 | **AppSidebar 顶部区块** |
| 对话 | NavRail workspace 组 | 中间区块（新建任务按钮 + 会话列表点击） |
| 团队 | NavRail collaboration 组 | 保留路由，从导航栏移除 |
| 图片 | NavRail content 组 | 移入设置页面 Tab |
| 会话列表 | NavRail workspace 组 | 移入设置页面 Tab |
| 模板 | NavRail collaboration 组 | 移入设置页面 Tab |
| 工作流 | NavRail automation 组 | **删除路由和页面** |
| 设置 | NavRail 底部 | 底部区块（不变） |
| 关于 | NavRail 底部 | 底部区块（不变） |
| 通知中心 | NavRail 底部 | 底部区块（不变） |
| 主题切换 | NavRail 底部 | 底部区块（不变） |
| 退出登录 | NavRail 底部 | 底部区块（不变） |

### 5.3 RailIcon.tsx 数据结构调整

```ts
// 删除 railGroups
// 新增两个导出:

/** 顶部区块导航项 */
export const TOP_NAV_ITEMS: NavItem[] = [
  { to: '/schedules', label: '定时任务', iconKey: 'Schedules' },
  { to: '/skills',    label: '技能',     iconKey: 'Skills' },
  { to: '/agents',    label: '智能体',   iconKey: 'Agents' },
];

/** 底部区块导航项 */
export const BOTTOM_NAV_ITEMS: NavItem[] = [
  { to: '/about',    label: '关于',  iconKey: 'About' },
  { to: '/settings', label: '设置',  iconKey: 'Settings' },
];

// railIcon() 函数保持不变
// railLabelCn 可删除（label 直接写在数据中）
```

### 5.4 折叠模式行为

| 区块 | 展开态(260px) | 折叠态(56px) |
|------|---------------|-------------|
| 顶部 | 图标 + 文字标签 | 仅图标 |
| 中间 | 新建任务按钮 + 搜索框 + 会话列表 | 仅 "+" 按钮 |
| 底部 | 图标 + 文字标签 | 仅图标 |

### 5.5 响应式策略

| 视口宽度 | 行为 |
|----------|------|
| `>= 1280px` | AppSidebar 默认展开 260px |
| `960px ~ 1280px` | AppSidebar 自动折叠到 56px |
| `< 960px` | AppSidebar 折叠到 56px，用户可手动展开为 overlay |

### 5.6 ChatPage 改动

**移除**：
- SessionSidebar 渲染容器（约第 4355~4419 行的 `leftSidebarOpen` div + `shouldOverlaySidebar` 遮罩）
- sidebar 相关状态解构（约第 586~591 行：`leftSidebarOpen`/`setLeftSidebarOpen`/`toggleLeftSidebar`/`isNarrowViewport`/`shouldOverlaySidebar`/`sidebarWidth`）
- `SessionSidebar` import（第 122 行）

**改后布局**：
```
改前: [SessionSidebar容器 280px] [主内容区] [右面板]
改后: [主内容区] [右面板]   (SessionSidebar 由 Layout 层 AppSidebar 统一提供)
```

**需排查的内部引用**：ChatPage 内 `leftSidebarOpen` 的其他引用（如第 4562 行 `sidebarOpen={leftSidebarOpen}`），改为从 `useUIStateStore` 直接读取或移除。

### 5.7 设置页面新增 Tab

| Tab ID | 名称 | 内容来源 |
|--------|------|----------|
| `sessions` | 会话管理 | 复用 `SessionsPage` 内容组件 |
| `templates` | 模板管理 | 复用 `TeamTemplatesPage` 内容组件 |

原路由 `/sessions` 和 `/templates` 保留为重定向到 `/settings/sessions` 和 `/settings/templates`。

## 6. Complexity Assessment

- Atomic steps: 7+ → +2
- Parallel streams: no → +0
- Modules/systems/services: 3+ (Layout/ChatPage/Settings/RailIcon) → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 4
- **Chosen mode**: 单 Agent 顺序执行（按 Step 1→7 顺序推进，每步独立验证）

## 7. Implementation Plan

### Step 1 — RailIcon.tsx 数据结构调整
- [ ] T-01-1: 删除 `railGroups`、`railItems`、`railLabelCn` 导出
- [ ] T-01-2: 新增 `NavItem` 类型 + `TOP_NAV_ITEMS` + `BOTTOM_NAV_ITEMS` 导出
- [ ] T-01-3: 保留 `railIcon()` 函数不变
- [ ] T-01-4: 全局搜索 `railGroups`/`railItems`/`railLabelCn` 引用点，逐一修正
- **验收**：`tsc --noEmit` 通过

### Step 2 — 新建 AppSidebar.tsx
- [ ] T-02-1: 新建 `apps/web/src/components/layout/AppSidebar.tsx`
- [ ] T-02-2: 实现顶部区块（品牌区 + TOP_NAV_ITEMS 导航）
- [ ] T-02-3: 实现中间区块（新建任务按钮 + 搜索框 + 会话列表，复用 `useSessions` + `SessionSidebarSessionRow`）
- [ ] T-02-4: 实现底部区块（NotificationCenter + 主题 + BOTTOM_NAV_ITEMS + 退出）
- [ ] T-02-5: 实现折叠模式（56px 图标态）
- [ ] T-02-6: 实现右键菜单 portal（复用 `SessionContextMenu`）
- **验收**：`tsc --noEmit` 通过；AppSidebar 可独立渲染

### Step 3 — Layout.tsx 替换 NavRail
- [ ] T-03-1: Layout.tsx 中用 `AppSidebar` 替换 `NavRail`
- [ ] T-03-2: 移除 NavRail 专属 props（`isChatRoute`/`leftSidebarOpen`/`onExpandSidebar`）
- [ ] T-03-3: 传递 `onOpenWorkspacePicker` 给 AppSidebar
- **验收**：`tsc --noEmit` 通过；所有页面左侧显示 AppSidebar

### Step 4 — ChatPage.tsx 移除 SessionSidebar
- [ ] T-04-1: 移除 SessionSidebar 渲染容器（4355~4419 行 div + 遮罩）
- [ ] T-04-2: 移除 sidebar 相关状态解构（586~591 行）
- [ ] T-04-3: 移除 `SessionSidebar` import（122 行）
- [ ] T-04-4: 排查并修正 ChatPage 内其他 `leftSidebarOpen`/`shouldOverlaySidebar` 引用
- [ ] T-04-5: 排查 `sidebarOpen`/`onToggleSidebar` 传给子组件的 props（4562~4563 行）
- **验收**：`tsc --noEmit` 通过；ChatPage 不再渲染左侧面板

### Step 5 — 路由清理
- [ ] T-05-1: `App.tsx` 删除 `/workflows` 路由定义（614~623 行）
- [ ] T-05-2: `preloadable-route-modules.ts` 删除 `workflows` 模块（97~101 行）
- [ ] T-05-3: 全局搜索 `WorkflowsPage` 引用，确认无残留
- [ ] T-05-4: `/sessions` 和 `/templates` 路由改为重定向到 `/settings/sessions` 和 `/settings/templates`
- **验收**：`tsc --noEmit` 通过；`/workflows` 不再可访问

### Step 6 — 设置页面新增 Tab
- [ ] T-06-1: `SettingsPage` Tab 列表新增"会话管理"和"模板管理"
- [ ] T-06-2: 复用 `SessionsPage` / `TeamTemplatesPage` 内容组件
- **验收**：`tsc --noEmit` 通过；设置页可切换到新 Tab

### Step 7 — 清理与验证
- [ ] T-07-1: 删除 `NavRail.tsx`
- [ ] T-07-2: 确认 `WorkflowsPage` 是否可删除（检查是否有其他引用）
- [ ] T-07-3: `pnpm --filter @openAwork/web typecheck` 零错误
- [ ] T-07-4: `pnpm --filter @openAwork/web build` 通过
- [ ] T-07-5: 视觉自查：展开/折叠/窄屏三态正常
- [ ] T-07-6: 快捷键自查：Ctrl+B / Ctrl+K / Ctrl+N / Ctrl+, 正常

## 8. 改动文件清单

### 8.1 新建

| 文件路径 | 说明 |
|----------|------|
| `apps/web/src/components/layout/AppSidebar.tsx` | 统一左侧栏组件 |

### 8.2 修改

| 文件路径 | 改动内容 |
|----------|----------|
| `apps/web/src/components/Layout.tsx` | 用 AppSidebar 替换 NavRail |
| `apps/web/src/components/layout/nav/RailIcon.tsx` | 删除 railGroups，新增 TOP_NAV_ITEMS / BOTTOM_NAV_ITEMS |
| `apps/web/src/pages/chat-page/ChatPage.tsx` | 移除 SessionSidebar 渲染容器和相关状态 |
| `apps/web/src/App.tsx` | 删除 /workflows 路由；/sessions 和 /templates 改为重定向 |
| `apps/web/src/routes/preloadable-route-modules.ts` | 删除 workflows 模块 |
| `apps/web/src/stores/ui/uiState.ts` | leftSidebarOpen 语义调整（如有必要） |
| `apps/web/src/pages/settings/SettingsPage.tsx` | 新增会话管理和模板管理 Tab |

### 8.3 删除

| 文件路径 | 说明 |
|----------|------|
| `apps/web/src/components/layout/nav/NavRail.tsx` | 被 AppSidebar 完全替代 |
| `apps/web/src/pages/workflows/WorkflowsPage.tsx` | 工作流页面删除（需确认无其他引用） |

### 8.4 不变动

| 文件路径 | 不变原因 |
|----------|----------|
| `apps/web/src/components/layout/sidebar/SessionSidebar.tsx` | 内部逻辑不变，AppSidebar 复用其子组件 |
| `apps/web/src/components/layout/sidebar/SessionSidebarSessionRow.tsx` | 会话行组件，直接复用 |
| `apps/web/src/components/common/routing/CachedRouteOutlet.tsx` | 路由缓存机制不变 |
| `apps/web/src/components/layout/notification/NotificationCenter.tsx` | 底部通知中心，直接复用 |

## 9. 验收标准

### 9.1 功能验收

- [ ] 左侧栏三区块布局正确：顶部(定时任务/技能/智能体) + 中间(会话列表) + 底部(不变)
- [ ] 会话列表在所有页面可见（不仅限于 Chat 路由）
- [ ] 会话列表搜索/分组/右键菜单/新建会话功能正常
- [ ] 顶部导航项点击跳转正确（/schedules /skills /agents）
- [ ] 底部区块行为与改造前完全一致
- [ ] ChatPage 不再渲染左侧 SessionSidebar 容器
- [ ] `/workflows` 路由不可访问
- [ ] 设置页面可切换到"会话管理"和"模板管理"Tab

### 9.2 架构/质量验收

- [ ] `pnpm --filter @openAwork/web typecheck` 零错误
- [ ] `pnpm --filter @openAwork/web build` 通过
- [ ] `NavRail.tsx` 已删除，无残留引用
- [ ] AppSidebar 单文件 ≤1500 行

### 9.3 响应式验收

- [ ] `>= 1280px`：AppSidebar 展开 260px，三区块完整显示
- [ ] `960px ~ 1280px`：AppSidebar 折叠 56px，仅显示图标
- [ ] `< 960px`：AppSidebar 折叠，可手动展开为 overlay

## 10. 风险与回退

| 风险 | 影响 | 缓解 |
|------|------|------|
| ChatPage 内 `leftSidebarOpen` 引用遗漏 | 编译错误或运行时 undefined | T-04-4 逐处排查，以 `tsc --noEmit` 为权威闸门 |
| `useSessions` hook 调用位置变化 | 会话刷新副作用可能失效 | hook 内部副作用不依赖调用位置（基于 store + 事件订阅）；验证会话列表能正常刷新 |
| `shouldOverlaySidebar` 逻辑迁移 | 窄屏下侧边栏 overlay 模式失效 | 逻辑迁移到 AppSidebar 内部或 Layout 层 |
| `WorkflowsPage` 有其他引用 | 删除后编译错误 | T-05-3 全局搜索确认 |
| 桌面端兼容 | `apps/desktop/src/App.tsx` 直接导入 web 页面 | 桌面端复用 Layout，改动自动生效；验证桌面端构建 |
| 文件树功能丢失 | 用户无法通过侧边栏浏览文件 | 文件树功能保留在 SessionSidebar 组件中，可通过其他入口（如 ChatPage 右面板）访问；后续迭代补回 |

**回退策略**：每个 Step 独立 commit，出问题可按 Step 粒度 revert。Step 2（新建 AppSidebar）与 Step 3（Layout 替换）可合并为一次提交，确保 NavRail 到 AppSidebar 的切换原子化。

## 11. 不在本方案范围内的事

- 不实现团队会话列表（仅展示对话会话，团队会话留后续迭代）
- 不实现文件树功能（AppSidebar 不展示文件树 Tab）
- 不改后端 API 或路由
- 不引入新的 UI 组件库
- 不改 CSS 变量主题体系
- 不做移动端（mobile）适配深挖，仅保证不破坏现有断点行为
- 不改 `CachedRouteOutlet` 路由缓存机制

## 12. Notes / 进展记录

### 全部完成（2026-06-27）

- **Step 1** ✅ RailIcon.tsx：删除 `railGroups`/`railItems`/`railLabelCn`；新增 `NavItem` 类型 + `TOP_NAV_ITEMS`(定时任务/技能/智能体) + `BOTTOM_NAV_ITEMS`(关于/设置)；保留 `railIcon()` 函数。
- **Step 2** ✅ 新建 `AppSidebar.tsx`(~600行)：三区块布局（顶部:Logo+TOP_NAV_ITEMS / 中间:新建任务+搜索+会话列表 / 底部:通知+主题+BOTTOM_NAV_ITEMS+退出）；复用 `useSessions` hook + `SessionSidebarSessionRow` + `SessionContextMenu` + `WorkspaceGitBadge` + `NotificationCenter`；折叠模式(56px)仅显示图标。
- **Step 3** ✅ Layout.tsx：`NavRail` 替换为 `AppSidebar`；移除 NavRail 专属 props(`isChatRoute`/`leftSidebarOpen`/`onExpandSidebar`)；新增 `onOpenWorkspacePicker`/`onLogout` 传递。
- **Step 4** ✅ ChatPage.tsx：移除 `SessionSidebar` import + 渲染容器(原4346~4410行) + sidebar状态解构(原585~591行) + `onToggleSidebar`/`sidebarOpen` props；ChatPage 布局简化为 `[主内容区] [右面板]`。
- **Step 5** ✅ 路由清理：`App.tsx` 删除 `/workflows` 路由；`/sessions` 和 `/templates` 改为 `<Navigate>` 重定向到 `/settings/sessions` 和 `/settings/templates`；`preloadable-route-modules.ts` 删除 `workflows` 模块。
- **Step 6** ✅ 设置页面：`settings-page-helpers.ts` 的 `TABS` 新增 `sessions`/`templates`；`TAB_CATEGORIES` 的 tools 分类追加两者；`SettingsPage.tsx` 新增 `SessionsPage`/`TeamTemplatesPage` 导入 + 条件渲染块 + `SettingsNavIcon` 图标。
- **Step 7** ✅ 清理验证：删除 `NavRail.tsx`；`tsc --noEmit` 零错误；全文件 linter 零错误。

### 改动文件汇总

| 操作 | 文件 |
|------|------|
| 新建 | `apps/web/src/components/layout/AppSidebar.tsx` |
| 修改 | `apps/web/src/components/Layout.tsx` |
| 修改 | `apps/web/src/components/layout/nav/RailIcon.tsx` |
| 修改 | `apps/web/src/pages/chat-page/ChatPage.tsx` |
| 修改 | `apps/web/src/App.tsx` |
| 修改 | `apps/web/src/routes/preloadable-route-modules.ts` |
| 修改 | `apps/web/src/pages/settings/shared/settings-page-helpers.ts` |
| 修改 | `apps/web/src/pages/settings/SettingsPage.tsx` |
| 删除 | `apps/web/src/components/layout/nav/NavRail.tsx` |
