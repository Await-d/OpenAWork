# apps/web — 知识库

## 概述

React SPA（Vite），主要 UI 应用。基于路由的页面结构，Zustand 认证状态，共享组件来自 `@openAwork/shared-ui`。所有非登录页面均受 ProtectedRoute 保护。

## 目录结构

```
src/
├── main.tsx            # Vite 入口 — ReactDOM.render + BrowserRouter
├── App.tsx             # 路由树 + ProtectedRoute + useHasHydrated 水合守卫
├── index.css           # 全局 CSS 变量（--bg 等），主题（dark/light 通过 .light 类切换）
├── pages/              # 每个路由一个文件
│   ├── LoginPage.tsx
│   ├── ChatPage.tsx        # /chat、/chat/:sessionId
│   ├── SessionsPage.tsx
│   ├── ArtifactsPage.tsx
│   ├── SettingsPage.tsx
│   ├── SkillsPage.tsx
│   ├── ChannelsPage.tsx
│   ├── WorkflowsPage.tsx
│   ├── TeamPage.tsx
│   ├── UsagePage.tsx
│   └── SchedulesPage.tsx
├── components/
│   ├── Layout.tsx          # 侧边导航 + Outlet 容器
│   ├── OnboardingModal.tsx  # 首次运行引导（localStorage 'onboarded' 键）
│   ├── ToastNotification.tsx
│   └── UpdateBanner.tsx     # 自动更新通知横幅
├── stores/
│   └── auth.ts             # Zustand 持久化存储：accessToken、login、logout
├── hooks/
│   └── useGatewayClient.ts # 实例化 WS/SSE 网关客户端
└── utils/
    ├── logger.ts
    └── session-transfer.ts
```

## 查找指引

| 任务                  | 位置                                    |
| --------------------- | --------------------------------------- |
| 新增页面/路由         | `src/pages/` + 在 `src/App.tsx` 注册    |
| 认证 Token / 登录状态 | `src/stores/auth.ts`（Zustand persist） |
| 全局布局/导航         | `src/components/Layout.tsx`             |
| 网关 WS/SSE 客户端    | `src/hooks/useGatewayClient.ts`         |
| 主题（深色/浅色）     | `App.tsx` + `src/index.css` CSS 变量    |
| 共享 UI 组件          | `@openAwork/shared-ui`（非本地）        |

## 架构说明

- **Zustand 水合守卫**：`App.tsx` 中的 `useHasHydrated()` 等待 `useAuthStore.persist.hasHydrated()` 完成后再渲染，防止认证闪烁。桌面端有相同模式（有意保留的重复）。
- **主题**：默认深色，浅色模式通过 `document.documentElement.classList.add('light')` 切换，存储于 `localStorage`。
- **引导**：通过 `localStorage.getItem('onboarded') !== '1'` 控制是否显示。
- **遥测授权**：通过 `localStorage.getItem('telemetry_consent_shown') !== '1'` 控制。
- **ESLint**：`apps/` 被根目录 ESLint 排除——此应用**不参与** `pnpm lint` 检查。

## 约定

- 页面组件保持轻量——业务逻辑放在 hooks 或 shared-ui 组件中。
- 禁止从 `dist/` 直接导入——使用 `@openAwork/*` workspace 包。
- 所有本地导入使用 `.js` 扩展名（NodeNext）。

## 常用命令

```bash
pnpm --filter @openAwork/web dev        # Vite 开发服务器
pnpm --filter @openAwork/web build      # 生产构建 → dist/
pnpm --filter @openAwork/web test       # Vitest
pnpm --filter @openAwork/web test:e2e   # Playwright E2E
```

## 代码组织规则

### 文件体积限制

- **单文件行数上限：1500 行**。1300–1500 行为预警区间，应主动评估拆分；超过 1500 行必须立即拆分，不得以任何理由豁免。
- 拆分时优先按**职责边界**切分，而非随机截断：
  - UI 渲染逻辑 → 独立子组件
  - 数据获取 / 副作用 → 独立 hook（`use*.ts`）
  - 纯计算 / 格式化 → `utils/` 工具函数
  - 常量 / 枚举 → `constants/` 或同级 `*.constants.ts`

### 组件提取原则

- **复杂 UI 优先组件化**：单个渲染块超过 80 行、或包含 3 层以上嵌套 JSX，必须提取为独立组件。
- **通用功能必须组件化**：在 2 个及以上页面/组件中重复出现的 UI 片段，提取到 `@openAwork/shared-ui` 或本地 `src/components/`。
- 提取规则：
  - 页面级子区域 → `src/components/<PageName>/` 子目录
  - 跨页面通用组件 → `src/components/` 或上报至 `packages/shared-ui/src/`
  - 与业务无关的纯展示组件 → 优先放 `shared-ui`

### 拆分检查清单（提交前自查）

在提交涉及页面/组件的改动前，确认以下各项：

[ ] 当前文件是否超过 1500 行？→ 超过则必须拆分后再提交（1300–1500 行应主动评估）
[ ] 是否有可提取为独立组件的渲染块（>80 行 或 >3 层嵌套）？
[ ] 是否有在其他页面已存在的相似 UI 逻辑？→ 合并为共享组件
[ ] 拆出的 hook/util 是否有对应单元测试？

### 反模式（禁止）

- 禁止在单个页面文件中堆砌多个独立功能的完整实现——每个功能域独立文件。
- 禁止用注释分隔替代文件拆分（`// ====== Section A ======`）——这是拆分信号，不是解决方案。
- 禁止因"暂时"而跳过拆分——技术债从第一次妥协开始累积。

## UI 设计规范

### 核心原则

- **设计质量优先**：UI 实现必须以用户体验和视觉美感为首要目标，功能完成不是降低设计标准的理由。
- **专业工具强制使用**：所有涉及 UI 的任务必须加载专业 skill，禁止在不参考设计规范的情况下徒手堆砌样式。
  - 视觉/布局/交互设计 → 加载 `frontend-design` skill
  - 组件库使用（antd/shadcn）→ 加载对应 skill（`ant-design` 等）
  - 响应式 / React 性能 → 加载 `vercel-react-best-practices` skill
  - Web 标准与可访问性审查 → 加载 `web-design-guidelines` skill

### 用户体验要求

- **操作流畅性**：交互元素必须有明确的 hover / active / focus 状态，禁止裸样式按钮。
- **视觉层次**：页面必须具备清晰的信息层级（主操作 > 次操作 > 辅助信息），禁止所有元素等权重平铺。
- **空间节奏**：间距、字号、色彩必须遵循统一的 design token，禁止魔法数字（如 `margin: 13px`）。
- **反馈完整性**：loading、empty、error 三态必须设计，禁止只实现 happy path。

### 执行约束

- 禁止以"先实现功能再优化样式"为由跳过设计——样式与功能同步交付。
- 禁止复制粘贴通用 AI 生成的平庸布局——每个页面需结合实际场景做针对性设计。
- 禁止忽略移动端适配——所有 Web 页面默认需响应式支持（最低 375px 宽度）。
- UI 改动提交前必须经过视觉自查：对齐、间距、色彩对比度（WCAG AA 标准）。

## 禁止事项

- 禁止移除 `useHasHydrated()` 守卫——会导致刷新时认证闪烁。
- 禁止在页面文件中直接写业务逻辑——提取到 hooks 中。
- 禁止从 `@openAwork/*/dist/` 导入——使用 workspace 入口点。
