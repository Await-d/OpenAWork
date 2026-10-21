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
- **流式渲染只重建尾部**：team 侧 token 级 setter 必须走 `conversation-runtime/stream/use-coalesced-stream-setters`（每帧至多一次提交；`use-team-conversation-state.ts` 是唯一接线处）；历史 entry / 分组不得依赖 `streamBuffer` / `streamingSegments`（`useTeamRenderGroups` 的引用稳定不变量）。chat 侧流式消息组走 `reconcileChatRenderGroups` 前缀复用（`use-chat-render-data.ts` 的流式分组缓存，成对保存 entries/groups）。`MessageRow` 是 memo 组件，显示偏好读取必须走 `useDisplayPreferencesStore` + `useShallow` 单订阅（禁止恢复为每字段一个 hook 订阅），ChatPage 的 `buildRenderMessageActions` 等传入回调必须保持引用稳定，否则整列表 memo 全部失效。

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

> 下列数字由 `bun run check:react-compiler` 实测产出（2026-10-14），会随代码变动漂移，**以脚本输出为准**。

- 仍有 ~1800 处 `useMemo` / `useCallback` / `memo` 历史调用，其中 **719 处位于「文件全绿」**（编译器已接管，可评估清理）、1088 处位于有脱靶函数的文件中（**不能盲删**）。不要主动批量删除。
- 仍有 ~250 处手写 `isLoading` / `isPending` / `setLoading` 模式，遇到时优先评估是否能迁 `useActionState` / `useTransition`。
- 数据获取场景目前仍以 `useEffect + useState` 为主；迁 `use() + <Suspense>` 的 promise 缓存层**已就绪**（见下节），遇到新写的取数逻辑直接用它，不要在 render 内裸 `fetch()`。

### 清理手写 memo 前必须先验证编译器是否已接管

React Compiler 对无法优化的组件是**静默跳过**的（不报错、不中断构建）。实测脱靶率约 23%（1293 个函数编译成功 / 390 个脱靶），所以「编译器已接管 ⇒ 可删手写 memo」**不能凭感觉判断**：

- 在**已编译**的文件里删 memo：无害（编译器已接管）
- 在**脱靶**的文件里删 memo：性能回退；若该回调被 `useEffect` 依赖引用，还可能触发**无限渲染循环**

怎么处置取决于脱靶原因：

| 脱靶原因类别                                                                | 处置                                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 代码违规（渲染期读写 ref、改写 props / 参数、条件调用 Hook…）               | **可修**，修完编译器才会进来；收益大于删 memo                                                                   |
| `Existing memoization could not be preserved`（手写 memo 反而挡住了编译器） | **删掉手写 memo 即可解锁**，但要分两类（见下）                                                                  |
| 编译器能力缺口（`try/finally`、try 内值块…）                                | **可绕过**：把整段 `try/catch` **下沉到模块级普通函数**即可（实测有效，见下节）；仅 `import()` 属刻意懒加载不改 |

#### 删 memo 前先分清是哪一类

| 手写的是                            | 编译器行为                          | 处置                                      |
| ----------------------------------- | ----------------------------------- | ----------------------------------------- |
| `useCallback`（函数）               | 编译器会**自动 memoize 函数表达式** | ✅ 直接去掉包装，等价且安全               |
| `useMemo` 里是**对象 / 数组字面量** | 编译器会**自动 memoize 字面量**     | ✅ 直接内联展开                           |
| `useMemo` 里是**带循环的昂贵计算**  | 编译器**不会**自动 memoize 计算过程 | ⚠️ 去掉包装会变成每次渲染重算，需逐案评估 |

实测：`use-provider-catalog-actions.ts`（5 个 useCallback）与 `EditorTabBar.tsx`（8 个 useCallback）按此改造后均 0 脱靶、测试全绿、lint 无回归。剩余 24 处中 19 处所在文件含 `useMemo`，需按上表逐案判断，**不要批量删**。

用法：

```bash
# 全量报告：脱靶率 / 原因分类 / memo 调用点分布
bun run check:react-compiler

# 落盘报表，并与历史报表对比趋势
bun run check:react-compiler -- --json=compiler-report.json
bun run check:react-compiler -- --baseline=compiler-report.json

# CI 门禁：脱靶率超过阈值时退出码 1
bun run check:react-compiler -- --max-bailout-rate=0.25
```

构建口径的脱靶清单（只包含实际进入打包的文件，比脚本遍历目录更贴近线上）：

```bash
OPENAWORK_COMPILER_LOG=1 bun run --filter @openAwork/web build        # 脱靶逐条打到 stderr
OPENAWORK_COMPILER_LOG=report.json bun run --filter @openAwork/web build  # 另存 JSON 报表
```

编辑期由 `apps/web/eslint.config.mjs` 的 `react-compiler` 规则拦截**新增**反模式：存量违规文件在白名单里降级为 `warn`（不阻塞提交），其余一律 `error`。已接入 `bun run lint`（`lint:web`），随 `preflight` 在 pre-push 与 CI 中执行。

**但该规则有明显的能力边界，不能拿它当唯一依据**：

- **口径不同**：规则只上报严重级为 `InvalidReact` / `InvalidJS` 的诊断。同一份代码规则只报 25 处，而构建期脱靶 390 个函数——编译器自身的能力缺口规则并不上报。
- **版本不同代**：规则捆绑的编译器与构建实际使用的 `babel-plugin-react-compiler@1.0.0` 不是同一代，诊断严重级取值体系都不同（`InvalidReact`/`InvalidJS` vs `Error`/`Warning`/`Hint`/`Off`）。该插件目前只有 `19.1.0-rc.2`，没有与编译器 1.0.0 对齐的稳定版。
- **存在已知盲区**：规则**完全无法发现**下一节的「ref 按名字推断」类。

### 抑制指令的识别范围：按函数源码范围判定，挪位置没有出路

编译器（`babel-plugin-react-compiler` 的 `filterSuppressionsThatAffectFunction`）对
`react-hooks/exhaustive-deps` / `react-hooks/rules-of-hooks` 的抑制指令按源码范围判定：

- 指令在函数体内（哪怕离违规点很远、或只是注释里提到）→ **整个函数**退出优化；
- 文件顶部 `/* eslint-disable <rule> */` 且**无配对 `eslint-enable`** → 其后的**所有函数**全部退出优化（比原状态更糟）。

即「把指令挪到不碍事的位置」不存在。`apps/web` 的 lint 并未启用 `exhaustive-deps`
（`eslint.config.mjs` 只登记规则名），这些指令是纯历史包袱——正确做法是**直接删掉指令行**，
把「依赖为什么刻意省略」留在普通注释里。2026-10-14 已按此清掉 9 处（suppressed 归零）。

### 修复的「暴露效应」：每修一层，下一层才显现；总数会先升后降

编译器的报错按分析阶段递进：修掉前一类违规后，后续阶段才会跑到并暴露下一类。
实测本目录 2026-10-14 一轮修复：抑制指令清零后 390→405，ChatPage 声明序修复后 405→426，
最终 418（多为 `try/catch` 类能力缺口被翻出）。**判断进展要看单个函数是否从「未编译」
变为「已接管」（`check:react-compiler` 的 `files` 明细），不要只看总数**——修到最后一层
大概率撞上 `try/catch` / `finally` / `try` 内条件分支等编译器能力缺口，此时应停下登记、
不要继续重构业务代码。

### 「ref 按名字推断」会静默吃掉整个组件

React Compiler 默认开启 `enableTreatRefLikeIdentifiersAsRefs`，会把名字以 `Ref` 结尾的**成员访问**当作「渲染期访问 ref」，从而放弃优化整个组件——即使全文没有一次 `.current` 读取。

```tsx
// ❌ 成员访问：组件整体退出编译（Cannot access refs during render）
<button ref={props.pickerRef} />
<div ref={session.containerRef} />

// ✅ 先取出为局部变量：正常编译，行为完全等价
const { pickerRef } = props;
<button ref={pickerRef} />
```

已在 `ChatComposerModelControls.tsx` / `InteractiveTerminalView.tsx` 落地这个改法：两文件此前共 49 个脱靶事件、编译成功数为 0，改后编译成功 6 个函数、脱靶 0、自动注入 18 个 memo 值。

**变体：把成员访问塞进 `ref=` 也会触发，且与命名无关。**

```tsx
const hover = usePathHoverPreview();
<button ref={hover.setAnchorEl} />; // ❌ 脱靶（换成中性名字同样脱靶）
const { setAnchorEl } = hover;
<button ref={setAnchorEl} />; // ✅ 编译
```

`markdown-path-ref.tsx` / `modified-files-summary-card.tsx` 就是这一变体，解构后即解锁。

**另一个反直觉的坑：注释里写出 eslint 抑制指令的原文，会把该组件自己也排除掉**——编译器按文本匹配识别抑制注释。曾在 `App.tsx` 的注释里写过一次，直接多出 7 处脱靶。

**改动这类文件时不要把它「简化」回去**——两处代码都留了注释说明原因。这类盲区 eslint 规则查不出来（实测即使把 `environment.enableTreatRefLikeIdentifiersAsRefs` 显式设为 `true` 也无变化），只能靠 `check:react-compiler` 发现。

### 渲染期 ref 镜像的合法替代（ref 违规清零后的主战场）

「渲染期读/写 ref」被禁后，按读取点位置选替代，三者都已在本目录落地：

| 场景                                              | 改法                                                                                                                    | 实例                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 读取点全在 effect / 事件回调 / 异步内             | 写下沉 `useEffect(() => { xRef.current = x; }, [x])`                                                                    | `use-chat-session-lifecycle.ts`（`messagesRef`）、`BuiltInBrowser.tsx`、`use-file-editor` 类 hook                                                 |
| 渲染期就要读「上一帧结果」（前缀复用 / 几何缓存） | 容器改惰性 state：`const [cache] = useState(() => new Map())`；写入收敛到模块函数以规避 `This value cannot be modified` | `chat-message-group-list.tsx`（4 个容器 + `ResizeObserver`）、`use-chat-render-data.ts`（模块级 `WeakMap` + 每实例 `useState(() => ({}))` token） |
| 成员访问被塞进 `ref=`                             | 解构为局部量（见上一节变体）                                                                                            | `markdown-path-ref.tsx`                                                                                                                           |

两条实测规律：

- **`ref=` 属性值可达范围内的 ref 读取会被判成渲染期访问**：把 `resizeObserverRef.current` 的读取挪进 ref 回调、或改用局部变量中转、或改名，都**无效**；只能让该读取不再经过 ref（本目录改为 state 容器承载）。
- state 容器方案里，新容器必须保留在使用它的既有 memo 依赖数组内（同实例恒等 ⇒ 运行时等价于不加），否则编译器退回 `Existing memoization could not be preserved`。已在 `chat-message-group-list.tsx` 代码内写明。

### 非 try 族脱靶的处置清单（2026-10-15 一轮：301 → 285）

try 族（259 个）是能力缺口、不可修。其余按下面三类处置，**后两类刻意不改**：

| 类别                                                     | 处置                                              | 说明                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS 变量做 key（`['--tint' as string]: v`）              | ✅ 断言移到整个对象（`{ ... } as CSSProperties`） | 4 个文件全部转为「已接管」，自动 memo 45~59 个值                                                                                                          |
| computed key 解构（`const { [id]: _x, ...rest } = obj`） | ✅ 浅拷贝 + `delete`                              | `QuickTerminalPanel`、`use-session-terminals`                                                                                                             |
| `for (;;)` 省略 test                                     | ✅ `while (true)` + 循环体末尾自增                | `useSessions`                                                                                                                                             |
| 默认参数位读 ref（`= xRef.current`）                     | ✅ 改可选参数 + 函数体内 `??` 兜底                | `use-settings-providers`                                                                                                                                  |
| 逻辑测试里的三元 / 可选链 / `!` 作赋值目标               | ✅ 拆成 if、或先落局部变量                        | `ChatComposer`、`ChatPageSections`、`OfficeThreeCanvas`                                                                                                   |
| 手写 memo 漏列依赖                                       | ✅ 按上面 ② 补上                                  | `ChatComposer` 补 `textareaRef` 后接管（memo 63）                                                                                                         |
| 动态 `import()`（8）                                     | ❌ 不改                                           | mermaid / docx / xlsx / chart / tauri webview 的**刻意懒加载**，改静态会把巨型依赖打进首屏                                                                |
| 对象 getter（8）                                         | ❌ 不改                                           | 它正是「延迟读 ref」的手段（见上表），改成普通属性会立刻触发 "Cannot access refs during render"                                                           |
| `team-runtime-reference-data.tsx` 的 8 个 useMemo        | ❌ 保留手写 memo                                  | 实测摘包装确实能接管（8 → 0），但**编译产物零 memo 缓存**，8 处聚合每次渲染重算，且 `baseSessions` 是 `useEffect` 依赖、引用每次变 → 属上表 ⚠️ 类，净损失 |

**暴露效应再次被验证**：修掉一层会翻出下一层——`OfficeThreeCanvas` 修掉 `posArr[i]! +=` 后翻出 14 处渲染期读 ref，全部按下表下沉 effect 后归零并自动 memo 25 个值。判断进展仍应看单个函数是否从「未编译」变为「已接管」。

#### try 族能力缺口可绕过：整段 `try/catch` 下沉到模块级函数

原先的结论是「能力缺口改代码无用，等版本升级」，**这个结论已被推翻**（2026-10-15 实测）：

把含 `try/catch` 的整段逻辑搬到**模块级普通函数**（非组件 / 非 hook），编译器就不再检查它，调用方随之转入「已接管」——错误处理一行没删，只是换了执行位置，语义逐字不变（"try 覆盖到哪"照搬，包括 catch 内的三元）。

```tsx
// ❌ 组件内：try 内的条件 / 三元 / 可选链都会报
//    "Support value blocks ... within a try/catch statement" → 整个组件脱靶
try { const r = JSON.parse(c); if (r?.t === 'x') { ... } } catch { }

// ✅ 模块级：编译器不检查普通函数，调用方恢复接管
function tryParse(text: string) { try { ... } catch { return null; } }
```

已按此法归零的两个文件：`ChatPageSections.tsx`（`tryCreateCompactionCard`）、
`channels-tab-content.tsx`（`loadCapabilityCatalogCountsOnce`、`saveChannelOnce`）。

两个配套要点：

- **三元 / 逻辑判断能放在 try 外的就先放外面**（如「选哪个请求」的 thunk），try 内只留会抛异常的 `await`，可少搬代码。
- **catch 参数不要在嵌套回调里被捕获**：`catch (e) { setState(prev => ... e ...); throw e; }` 会报
  "consistently local or context references"（同一变量既是 context 又是 local）。修法是先在回调**外**把文案算成常量，回调只捕获常量。

代价是搬移代码（每个函数约 10~50 行）并逐处核对异常边界，因此 259 处 try 族全量改造属**大工程**，需按文件收益排队，不要一次铺开。

#### 降本关键：同一文件里的 try/finally 往往高度重复，用「一个包装函数」批量吃下

盘点发现，多数文件的多个 try/catch/finally 是**同一个模板**——「置 pending → try → catch 映射错误文案 → finally 清 pending」。这种不需要给每处各写一个函数，只要下沉**一个**通用包装函数，把差异部分当 `run` 回调传入：

```ts
// 模块级：一个函数吃掉本文件所有同构的 try/catch/finally
async function runPendingActionOnce(ctx: {
  pending: PendingAction;
  fallbackMessage: string;
  setActionError: (m: string | null) => void;
  setPendingAction: (a: PendingAction | null) => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setPendingAction(ctx.pending);
  ctx.setActionError(null);
  try {
    await ctx.run();
  } catch (error) {
    ctx.setActionError(error instanceof Error ? error.message : ctx.fallbackMessage);
  } finally {
    ctx.setPendingAction(null);
  }
}
```

已确认适用：`PromptSnippetsPanel.tsx`（10 处，其中 6 处同构）、
`ChannelSubscriptionSettings.tsx`（7 处全部同构）、`desktop-web-access-section.tsx`（多数同构）。
差异项（是否忽略 abort、固定文案还是归一化文案、finally 收的是 pending 还是别的 loading 标志）
用可选的 `ignoreAbort` / `fixedErrorMessage` 字段或另起一个专用函数处理即可。

优先级建议：按「单文件 try 族数量」降序处理，前 25 个文件即占总量约四成。

**实测踩过的坑（务必照此实现）**：包装函数「不传 `onError` 就什么都不做」会把异常**吞掉**——原代码里 `try` 无 `catch` 意味着「异常向上抛」给表单就地展示，改写后必须显式 `throw error`。`SshWorkspacePickerModal` 因此被自家测试抓到一个失败用例（「新建失败时就地展示错误且不改动当前连接」），修法：

```ts
catch (error) {
  if (!ctx.onError) throw error;   // 没有错误处理器 = 调用方要「向上抛」的原语义
  ctx.onError(error);
}
```

结论：**改完这类文件必须跑对应测试**（`bun run --filter @openAwork/web test <文件>`），脱靶报表证明「编译器进来了」，测试才证明「行为没变」。

### 既有 memo 的依赖校验：`PreserveManualMemo` 两类差异与修法

ref 类违规清零后，编译器才会跑到既有 memo 的依赖校验，报 `Existing memoization could not be preserved`，并在 `description` 里给出「推断依赖 vs 源码依赖」原文。两类典型差异：

```tsx
// ① Inferred less specific property than source
//    推断 workspace，源码 workspace.searchFileIndex —— 「hook 返回对象上的方法调用」
//    会被推断成整个对象依赖（async 方法如 `await workspace.setWorkspace(...)` 同理）
workspace.searchFileIndex(root, {...})       // ❌ 依赖写 workspace.searchFileIndex 也不匹配
const { searchFileIndex } = workspace;      // ✅ 先取局部量，body 与 deps 都用它
searchFileIndex(root, {...})

// ② Inferred dependency not present in source
//    源码 deps 为 []，推断 textareaRef / setMessages ——
//    memo 内引用的 ref 对象、以及自定义 hook 返回的 setter 必须列入依赖
useCallback((text) => { textareaRef.current?.focus(); }, []);          // ❌
useCallback((text) => { textareaRef.current?.focus(); }, [textareaRef]); // ✅（ref 身份稳定，行为不变）
```

要点：hook 返回的方法/刷新函数若是 `useCallback` 包出来的，取成局部量后引用身份与原先完全一致，属等价改写；自定义 hook 返回的 setter 漏列依赖则是存量隐患（典型症状：provider 切换后仍沿用旧 key 计算），补上属修复。诊断命令：

```bash
node scripts/check-react-compiler-bailout.mjs --json=/tmp/report.json   # 全量
node -e "…babel + babel-plugin-react-compiler + logger…"                # 单文件打印 description
```

### 取数：`usePromiseValue` + `<Suspense>`

`use() + <Suspense>` 的 promise 缓存层已落地，新写的一次性取数（目录清单、静态配置、跨组件复用的同一份数据）直接用它，不要再 `useEffect` + `setLoading` / `setError`：

```tsx
// 模块级：缓存实例必须长期存活，在渲染期新建等于没有缓存
const agentCatalog = createPromiseCache<AgentInfo[]>({ ttlMs: 5 * 60_000 });

function AgentList() {
  const agents = usePromiseValue(agentCatalog, 'all', () => listAgents());
  return (
    <ul>
      {agents.map((a) => (
        <li key={a.id}>{a.name}</li>
      ))}
    </ul>
  );
}

// 上层必须有边界：挂起 → Suspense fallback，失败 → 错误边界
<Suspense fallback={<Spinner />}>
  <AgentList />
</Suspense>;
```

位于 `src/lib/async/`：`promise-cache.ts`（与框架无关，同一 key 只取一次）/ `use-promise-value.ts`（接 `use()`）。核心不变量是 `get()` **先同步写入缓存再启动取数**，因此重渲染拿到的是同一个 promise，`use()` 不会进入无限挂起循环。

不适用：轮询 / 实时数据、写操作（走 `useActionState`）、分页与乐观更新——本模块刻意保持最小，这类需求应单独评估。

## 禁止事项

- 禁止移除 `useHasHydrated()` 守卫——会导致刷新时认证闪烁。
- 禁止在页面文件中直接写业务逻辑——提取到 hooks 中。
- 禁止从 `@openAwork/*/dist/` 导入——使用 workspace 入口点。
