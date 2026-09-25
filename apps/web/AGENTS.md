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
│   ├── chat-page/
│   │   ├── ChatPage.tsx    # /chat、/chat/:sessionId
│   │   ├── hooks/          # ChatPage 域 hook（session / pending / retry / stop 等）
│   │   ├── conversation/   # 流式渲染、composer、snapshot、render helper
│   │   └── panels/         # 右栏、编辑器、子 Agent 等面板
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

| 任务                         | 位置                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 新增页面/路由                | `src/pages/` + 在 `src/App.tsx` 注册                                                                                   |
| ChatPage 主组装层            | `src/pages/chat-page/ChatPage.tsx`                                                                                     |
| ChatPage 流式状态域          | `src/pages/chat-page/conversation/render/use-chat-streaming.ts`                                                        |
| ChatPage 会话分支/重试       | `src/pages/chat-page/hooks/use-chat-branch-session.ts`、`use-chat-retry-and-edit.ts`                                   |
| ChatPage 停止流 / 待处理交互 | `src/pages/chat-page/hooks/use-chat-stop-active-message.ts`、`conversation/render/handle-pending-interaction-event.ts` |
| ChatPage composer helper     | `src/pages/chat-page/conversation/composer/`                                                                           |
| ChatPage render helper       | `src/pages/chat-page/conversation/render/`                                                                             |
| 认证 Token / 登录状态        | `src/stores/auth.ts`（Zustand persist）                                                                                |
| 全局布局/导航                | `src/components/Layout.tsx`                                                                                            |
| 网关 WS/SSE 客户端           | `src/hooks/gateway/useGatewayClient.ts`                                                                                |
| 主题（深色/浅色）            | `App.tsx` + `src/index.css` CSS 变量                                                                                   |
| 共享 UI 组件                 | `@openAwork/shared-ui`（非本地）                                                                                       |

## 架构说明

- **Zustand 水合守卫**：`App.tsx` 中的 `useHasHydrated()` 等待 `useAuthStore.persist.hasHydrated()` 完成后再渲染，防止认证闪烁。桌面端有相同模式（有意保留的重复）。
- **主题**：默认深色，浅色模式通过 `document.documentElement.classList.add('light')` 切换，存储于 `localStorage`。
- **引导**：通过 `localStorage.getItem('onboarded') !== '1'` 控制是否显示。
- **遥测授权**：通过 `localStorage.getItem('telemetry_consent_shown') !== '1'` 控制。
- **ESLint**：`apps/web` 当前按阶段性策略仍被根目录 ESLint 排除；`bun run --filter @openAwork/web lint` 会显式提示跳过，待后续单独收口历史 lint 债务。
- **会话权限档位（composer）**：档位控件 `src/components/chat/composer/ComposerPermissionModeSelect.tsx`（在 `UnifiedComposer.tsx:616` 渲染，`ComposerPermissionMode = SessionPermissionMode`，选项定义见 :21-37）；顶栏 `src/components/chat/session/ChatTopBar.tsx` 的 `auto-edit`（:167）与 `yolo`（:114）chip 是只读展示。
- **metadata 快照必须含 `permissionMode`**：`createSessionMetadataSnapshot`（`src/pages/chat-page/conversation/render/chat-page-utils.ts:86`）的 `permissionMode` 字段（:103）参与 dirty 检查；若遗漏，`ask → auto-edit` 会得到完全相同的快照，导致 PATCH 被静默跳过。同一快照里 `yoloMode` 仍按 `permissionMode === 'yolo'` 派生回写（:104）。
- **流式传输 SSE 回退契约（`src/hooks/gateway/useGatewayClient.ts`）**：WS 断开后的 SSE 回退是**有界重试**（`SSE_FALLBACK_RETRY_DELAYS_MS` = 1s/2s/4s），重试前用 `resolveFreshStreamToken` 取认证 store 里的最新 token（距过期 ≤60s 先单飞刷新）——禁止再用 `stream()` 闭包里的发送时刻 token，长回合里它会过期并让 EventSource 401 硬失败。每次重试都携带最新 `afterSeq`，网关按 `clientRequestId` 单飞重放不会重复执行；只有重试预算耗尽才向用户抛 `SSE_ERROR`。用户显式停止（`stopStream`）或新流/attach 接管时必须取消待触发重试。
- **attach 的 `no_active_stream` 不是终态（会话仍 running 时）**：`runSessionAttachEffect` 收到网关「无活跃流」但会话状态仍为 `running` 时必须 `scheduleAttachRetry` 有界重试，不能直接 `cancelAttachRetry()` 放弃——典型场景是权限批准后的续跑（网关先执行被批准的工具、运行线程稍后才可见）。会话真正 idle（`isAttachStreamTerminal`）时 disposition 会转入 `terminal` 并取消重试，因此不会空转。
- **权限 / 提问暂停不得呈现为「停止」**：`resolveSessionStopCapability`（`src/components/conversation-runtime/session/session-runtime.ts`）在 `remoteSessionBusyState === 'paused'` 时必须返回 `'none'`——composer 主按钮随之显示专属等待态（「待处理」+ 时钟图标，禁用），**禁止**退化成停止按钮（⏹ +「尝试停止」），否则用户会误以为会话已停止。暂停期间取消运行走审批卡 / 问题面板的拒绝入口。配套：`formatStopReasonLabel('tool_permission')` 固定映射「等待权限」（`src/components/conversation-runtime/messages/message-format.ts`），不得原样透传或显示「已停止」。
- **`terminal_output` 状态更新必须合并**（`src/components/conversation-runtime/terminals/use-session-terminals.ts`）：高输出命令/终端每 ~100ms 一条事件，逐条更新 ChatPage 顶层 state 会让整页持续重渲染。`applyRunEvent` 对 `terminal_output` 只入队（同一终端保留最新一条），按 `TERMINAL_OUTPUT_STATE_FLUSH_MS`（250ms）统一 flush；`terminal_started` / `terminal_exited` 立即生效且**先 flush 待处理输出**（否则旧 tail 会丢）。终端的实时数据面走各自 WS/SSE 流，不受该合并影响。

## 约定

- 页面组件保持轻量——业务逻辑放在 hooks 或 shared-ui 组件中。
- 禁止从 `dist/` 直接导入——使用 `@openAwork/*` workspace 包。
- 所有本地导入使用 `.js` 扩展名（NodeNext）。

## 常用命令

```bash
bun run --filter @openAwork/web dev        # Vite 开发服务器
bun run --filter @openAwork/web build      # 生产构建 → dist/
```

### 真实浏览器验收 harness（`harness/`）

`harness/` 是**开发期验收目录**，不参与构建、不被 `src/` 导入，用于在**真实 Chromium** 里
渲染真实组件，覆盖 jsdom 覆盖不到的部分（真实布局下的截断、真实引擎解析后的计算样式）。
需要 dev server 已在 `127.0.0.1:5173` 运行：

```bash
# 仓库根目录执行（NODE_PATH 指向唯一声明 playwright 的 workspace，原因见 harness/README.md）
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-notice-3viewports.ts
```

新增涉及**布局 / 尺寸 / 省略号 / 主题变量解析**的组件改动时，应在此补对应用例——
jsdom 不做布局（见 `.agentdocs/index.md` 已知陷阱）。

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
[ ] 若为大型页面（如 ChatPage），是否优先按自治状态域拆成 `hooks/` + `conversation/*` helper，而不是继续向主页面堆逻辑？

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

## React 19 适配约定

> 项目运行在 `react@^19` + `babel-plugin-react-compiler@^1`（已在 `vite.config.ts` 启用，target=19）。
> 新代码必须遵循下列约束；存量代码可渐进式跟进，但不得新增反模式。

### 推荐写法

- **表单异步提交**：`<form action={fn}>` + `useActionState`。**同一组件**内直接用 `useActionState` 返回的第三个值（`isPending`）；**跨组件 / 设计系统按钮**才需要 `useFormStatus()` 读 pending 避免 prop drilling。参考实现：
  - `src/pages/misc/LoginPage.tsx` — 单组件 form
  - `src/components/onboarding/OnboardingModal.tsx`（`BrowserOnboardingLoginForm`）— 抽出独立子组件，让 step 切走时 `useActionState` 随 unmount 自动重置，避免旧 error 残留
  - `src/pages/team/runtime/tabs/tasks/ClarificationsPanel.tsx`（`PendingCard`）— 同一组件场景，直接用 `isPending` + 受控 `draft` 实现按钮 visual disabled
- **Context Provider**：直接 `<FooContext value={...}>`，不要再写 `<FooContext.Provider value={...}>`。
- **Ref 转发**：函数组件直接把 `ref` 当 prop 接收，**不要**再写 `forwardRef`。
- **乐观更新**：用 `useOptimistic` 替代手写 "先渲染目标态、错误回滚" 模式。
- **数据获取**：如果是一次性 Promise（模块级或 cache 层创建），优先 `use(promise)` + 父级 `<Suspense>`，不要在 `useEffect` 内 fetch + 手写 `setLoading` / `setError`。

### 反模式（禁止）

- ❌ `<FooContext.Provider>` —— 用 `<FooContext>`。**例外**：`react-router` 的 `UNSAFE_LocationContext.Provider` / `UNSAFE_RouteContext.Provider` 是库内部对象，必须保留 `.Provider` 写法。
- ❌ `forwardRef` 包装函数组件。
- ❌ `useFormState`（已弃用）—— 用 `useActionState`（从 `react` 导入，不是 `react-dom`）。
- ❌ `<form onSubmit={async (e) => { e.preventDefault(); setLoading(true); ... }}>` 三件套 —— 用 `<form action>` + `useActionState`。
- ❌ 手写大量 `useMemo` / `useCallback` / `React.memo` —— React Compiler 已自动处理；新代码默认不写，确实需要才补（少数热点 / 大列表稳定引用）。
- ❌ 启用 React Compiler 后直接 mutate state / props（`array.push(...)` / `obj.foo = ...`）—— 编译器以不可变性为前提推断依赖，必须返回新对象 / 新数组。
- ❌ 给 `use()` 传**在 render 中创建的 Promise** —— 会触发无限 Suspense 循环。Promise 必须来自模块级、缓存层或框架 loader。
- ❌ 把 `useActionState` 的 dispatch 从非 form 事件（如 `onClick`）触发 —— 会失去 FormData 语义和表单重置行为。

### 渐进迁移待办（参考）

- 仍有 ~1100 处 `useMemo` / `useCallback` / `memo` 历史调用，**不要主动批量删除**；后续在改动文件时若编译器已接管，可顺手清理。
- 仍有 ~160 处手写 `isLoading` / `isPending` / `setLoading` 模式，遇到时优先评估是否能迁 `useActionState` / `useTransition`。
- 数据获取场景目前仍以 `useEffect + useState` 为主，迁 `use() + <Suspense>` 需要先建立 promise 缓存层（如 React Query 或自定义 cache utility），不要在 render 内裸 `fetch()`。

## 禁止事项

- 禁止移除 `useHasHydrated()` 守卫——会导致刷新时认证闪烁。
- 禁止在页面文件中直接写业务逻辑——提取到 hooks 中。
- 禁止从 `@openAwork/*/dist/` 导入——使用 workspace 入口点。
