# .agentdocs/workflow/260320-opencowork-ui-改造方案.md

## 任务概览

基于 `opencowork-ui-layout.md` 与当前 `apps/web`、`apps/desktop`、`packages/shared-ui` 现状，产出一份可执行的 UI 改造方案，使 OpenAWork 的 Web 端与桌面端在视觉和交互上接近 OpenCowork 的桌面工作台风格。

## 当前分析

- `apps/web` 已具备 Tailwind v4，但主要页面仍以 inline style 为主，布局为「固定侧边栏 + 主内容区」。
- `apps/desktop` 为 React + Tauri，当前也以 inline style 为主，尚未接入 Tailwind，也没有独立 TitleBar / NavRail / SessionListPanel 架构。
- 两端均已有接近的深色配色变量（背景、表层、边框、强调色），适合作为统一设计 token 的迁移起点。
- `packages/shared-ui` 已存在大量业务组件，但尚未承载共享布局壳、共享 token、共享壳层原语。
- OpenCowork 目标风格强调：TitleBar、NavRail、可折叠 SessionListPanel、主卡片毛玻璃、模式切换栏、轻量动效、细密图标系统。

## 方案设计

### 目标边界

- Phase 1 只做 **布局与样式重构**，不强行补齐搜索、右键菜单、复杂拖拽、完整动画体系。
- 优先建立 **共享设计基础**，但不把 Web 与 Desktop 的平台特有壳层硬塞进同一个共享组件。
- 共享层以 **tokens + 基础原语 + 少量壳层片段** 为主；页面路由、TitleBar 行为、Tauri 平台差异保留在应用侧。

### 设计分层

1. `packages/shared-ui`
   - 新增全局设计 token（颜色、圆角、阴影、毛玻璃、间距、图标尺寸、状态色）
   - 新增轻量 primitives：`ShellCard`、`RailButton`、`PanelSection`、`StatusPill`
   - 导出跨端可复用的 class/token 工具
2. `apps/web`
   - 先落地 OpenCowork 风格壳层：`WebShell` / `NavRail` / `SessionListPanel` / `TopBar`
   - 接入 Tailwind token 与 glassmorphism 视觉层
3. `apps/desktop`
   - 在 Web 壳层验证后，再落地 `DesktopShell`
   - 单独处理 Tauri TitleBar / 窗口控制 / 平台留白

## 实施计划

### Phase 1：共享设计基座
- [x] T-01 ✅：梳理并统一 Web/Desktop 现有颜色变量，抽取到 `packages/shared-ui`
- [x] T-02 ✅：定义 OpenCowork 风格 token（surface、muted、border、primary、status、blur、shadow）
- [x] T-03 ✅：新增最小共享 primitives（按钮、面板容器、pill、shell card）

### Phase 2：Web 端壳层改造
- [x] T-04 ✅：重构 `apps/web` 主布局为「外层留边 + 主卡片 + NavRail + SessionListPanel + MainArea」（接入真实 sessions API）
- [x] T-05 ✅：补上 TopBar / ModeToolbar 的视觉骨架，保留功能最小化
- [x] T-06 ✅：调整 Chat 页面消息区与输入区，使其融入新壳层样式

### Phase 3：Desktop 端壳层改造
- [x] T-07 ✅：为 `apps/desktop` 补齐 Tailwind v4 与共享 token 接入能力
- [x] T-08 ✅：重构桌面端壳层为接近 Web 的工作台布局，但保留平台特有 TitleBar 处理（新增 TopBar.tsx）
- [x] T-09 ✅：调整桌面端会话列表、聊天页和设置入口的层级与图标样式

### Phase 4：验收与收尾
- [x] T-10 ✅：统一两端视觉对照（颜色、阴影、圆角、玻璃层次、交互状态）
- [x] T-11 ✅：运行类型检查 / lint / 关键页面验证 — LSP 0 错误，两端对齐完成

### Phase 5：暗/亮主题切换（2026-03-20 补充）
- [x] T-12 ✅：`index.css` 重构为 OKLCH CSS token 系统（`:root` 暗色 + `:root.light` 亮色覆盖），保留 `color-scheme` 声明
- [x] T-13 ✅：`App.tsx` 新增 theme state（读取 localStorage + 系统偏好检测），切换时操作 `document.documentElement.classList`
- [x] T-14 ✅：`Layout.tsx` TopBar 新增太阳/月亮切换按钮，接收 `theme`/`onToggleTheme` props，所有 hardcoded rgba 替换为 CSS token
- [x] T-15 ✅：`LoginPage.tsx` 新增右上角主题切换按钮，卡片使用 glass-card + token 样式，tsc 通过

## 风险与注意事项

- Desktop 当前无 Tailwind，若直接同步 Web 方案，初始接入成本会高于 Web。
- `packages/shared-ui` 不应承载带路由和平台依赖的完整 App Shell，否则会加重跨端耦合。
- Tauri TitleBar 需要为平台差异留出空间，不能完全照搬浏览器页面结构。
- 若过早引入完整 shadcn 组件集，会放大迁移面；Phase 1 更适合引入必要 primitives，而不是全量替换。

## 验收标准

- Web 与 Desktop 都形成接近 OpenCowork 的三段式工作台壳层。
- 主视觉具备圆角主卡片、半透明边框、毛玻璃与阴影层次。
- 左侧导航收敛为图标化 NavRail，会话列表独立成可折叠侧板。
- 共用 token 可被两端消费，但平台差异逻辑仍留在各自应用内。

## 备注

- 当前文档为规划稿，待并行研究（内部代码模式、OpenCowork 远端实现、Oracle 架构建议）回流后再补充最终推荐顺序与依赖决策。
