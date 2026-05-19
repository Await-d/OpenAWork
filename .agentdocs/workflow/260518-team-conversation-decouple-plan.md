# Team 对话与 Chat 解耦方案

> 创建时间：2026-05-18
> 关联文档：
> - `docs/chat-conversation-reuse-plan.md`（v1.5 复用方案，本方案是其后继）
> - `docs/team-architecture-l1-3-streaming-handoff-spec.md`（L1.3 反向通道）
> - `.agentdocs/workflow/260516-team-page-功能加强方案.md`（TeamPage V2 现状）
>
> 状态：**完成**

---

## 1. 背景

### 1.1 现状

`docs/chat-conversation-reuse-plan.md` v1.5 把"单 session 对话布局"抽成 `SessionConversationView`，让 chat 与 team 共享同一份消息流 + composer 实现。Team 端的复用路径目前是两段式：

- **TeamWorkspaceShell**：当 `composerEnabled=true` 时直接嵌入 `<ChatPage embeddedSessionId .../>` 整壳（`apps/web/src/pages/team/runtime/shell/session-view/TeamWorkspaceShell.tsx`），把 ChatTopBar / ChatEditorPane / ChatRightPanel / QuickTerminalPanel 全部带进 team 页面。
- **TeamSessionView**：`composerEnabled=false` 或 `showWorkspaceControls=false` 时降级为 `<TeamSessionView/>`，包裹 `SessionConversationView` + `useSessionConversationState`，附带 team 自己的提交路由 `resolveSubmitStrategy(roleLayer, substate)`。

ConversationArea 的默认入口（reception session）走的是第一条——**完整嵌入 ChatPage**。

### 1.2 问题

Team 与 chat 的对话**模式**不同（不是仅 chrome 不同）：

| 维度 | Chat | Team |
| --- | --- | --- |
| 对话主体 | 单一用户 ↔ 单一 agent | 用户 ↔ b（接待） + b ↔ pm/executor/reviewer 多层 |
| 写入路径 | 单一 stream | inbound queue（clarification）/ stream（chat-style）/ handoff（创建子 session） |
| 视图组合 | 顺序消息流 | 层级 / 消息 / 待回复 / 接待四视图切换 |
| 对话 chrome | ChatTopBar、Editor、RightPanel、Terminal、Skill、Image | TeamSidebar、WorkspaceSwitcher、TeamHeaderMetrics、StatusBar、3D Office、LayerDrawer |
| Composer 能力 | imageGen / skill / yolo / dialogueMode / agent / web / thinking | multiSelect / bookmarks / promptTemplate / commandPalette / agentSwitch（chat-only 全关） |
| 协议演进方向 | chat-runtime-ssot 的渐进式扩展 | L1.3 inbound + L1.8 层级状态机 + handoff 编排 |

把两个产品共用一个 `SessionConversationView` + `useSessionConversationState`，会带来三类长期粘合代价：

1. **Prop 通胀**：每次 chat 加一个 chat-only feature（如 imageGeneration、skillRecommendation、commandPalette item 列表），SessionConversationView 都要新增 prop 或 slot；team 不用却必须传默认值。当前 SessionConversationView 已有 80+ props。
2. **逻辑分支堆叠**：`useSessionConversationState` 的 `enableWriters / submitInbound / startStream` 路径分裂正是这种粘合的早期信号。继续走下去会出现越来越多 `if (sessionSource === 'team') ...` 或 `if (roleLayer) ...` 的特例。
3. **协议演进互锁**：L1.3 inbound 协议、L1.8 层级状态机继续推进时，team 需要在 hook 内部加大量字段；这些字段对 chat 是噪音。反过来 chat-runtime-ssot 的协议变更也强制 team 跟进。

### 1.3 用户期望

引述用户原话：

> team 的对话模式跟 chat 完全不一样，但是前端的 ui 可以复用，所以我需要对于这个对话需要单独的分开来，防止后续粘合问题

翻译为工程目标：

- **UI 原子复用**：UnifiedComposer / ChatMessageGroupList / InlineQuestionPanel / 各种 inline tool/reasoning/permission 渲染等纯展示组件，chat 与 team 共享同一份实现，避免视觉漂移与重复维护。
- **对话装配独立**：`ChatConversationView` 与 `TeamConversationView` 各自拥有自己的 state hook、消息编排、提交路由、空态、slot 体系，两者**互不依赖、互不影响**。
- **共享层稳定可信**：原子组件与流式 / 滚动 / attach 等协议层 hook 不感知"chat 还是 team"，仅按 `sessionId + 流协议` 工作。

## 2. 目标与非目标

### 2.1 目标

- T1. 拆出 `TeamConversationView` + `useTeamConversationState`，与 chat 端的 `ChatConversationView` + `useChatConversationState`（由现 `SessionConversationView` + `useSessionConversationState` 重命名）平级、独立、不交叉引用。
- T2. 抽出 `conversation-runtime`（流式 / 滚动 / attach / 消息规整等无产品偏向的协议层 hooks），让 chat 与 team 各自的 state hook 都基于它构建。
- T3. 锁住 chat 原子组件的依赖方向：`components/chat/**` 不再反向引用任何 `session-conversation/**` 或产品装配层模块；store 依赖按"必要的就 prop 化"原则收敛。
- T4. 删除 ChatPage 的 `embeddedSessionId / hideSidebar` 嵌入模式（前提是确认只有 team 在用）。

### 2.2 非目标

- N1. 不重写 chat 的对话视图。chat 端只做"重命名 + 文件迁移 + 拆 runtime"，行为零回归。
- N2. 不动后端协议。本方案只重组前端目录结构与依赖关系。
- N3. 不把 conversation-runtime 上抬到 `packages/`（保留在 `apps/web/src/components/conversation-runtime/`），与现有方案文档一致。
- N4. 不在本轮处理 chat 原子组件的 chrome 解耦（如 ChatTopBar 引 DialogueModeToggle 这种业务依赖），仅清理影响 team 复用的反向依赖。

## 3. 设计原则

- **产权清晰**：每个目录只服务一个产权人（chat / team / 共享 runtime / 共享原子）。
- **依赖单向**：`产品装配 → 共享 runtime → 共享原子 → 平台层（@openAwork/*）`。任意层不得反向引用。
- **复制优于通用**：当 chat 与 team 的某段装配逻辑超过 30% 不同（例如提交路由、消息编排），优先复制并独立演化，不试图抽公共抽象。
- **slot 而非 flag**：共享层不通过 `sessionSource === 'team'` 等业务标识做分支；产品差异通过 caller 传 ReactNode / handler 注入。


---

## 4. 现状边界扫描

落地前先列出当前代码的真实依赖图，避免迁移时被反向依赖咬住。

### 4.1 当前目录与产权

```
apps/web/src/
├── pages/
│   ├── ChatPage.tsx                       (~6000 行，chat 业务壳；带 embeddedSessionId 嵌入模式)
│   ├── chat-page/                         (chat 私有装配：editor / right panel / sub-agent / split / hooks)
│   └── team/
│       └── runtime/shell/session-view/
│           ├── TeamWorkspaceShell.tsx     (开关：composerEnabled → ChatPage embedded / 否则 TeamSessionView)
│           ├── TeamSessionView.tsx        (594 行：包裹 SessionConversationView + team 提交路由)
│           ├── TeamSubstateProgressBar.tsx
│           ├── TeamSessionEmptyState.tsx
│           ├── TeamSessionHeader.tsx
│           └── LayerConversationDrawer.tsx
│
├── components/
│   ├── chat/                              (UI 原子 + 部分业务壳混居)
│   │   ├── UnifiedComposer.tsx            (原子：composer 入口)
│   │   ├── ChatMessageGroupList           (原子：消息列表)
│   │   ├── InlineQuestionPanel
│   │   ├── ChatPageSections.tsx           (renderChatMessageContentWithOptions / WelcomeScreen)
│   │   ├── chat-search-overlay / message-multi-select / prompt-template-panel / command-palette
│   │   ├── tool-call/ / file-preview/ / companion/
│   │   ├── ChatTopBar / ChatComposer / QuickTerminalPanel / SkillSettingsPanel / ChatImageGenerationControls
│   │   │      （这些是 chat 业务壳，不是真正的"原子"，但仍住在 components/chat/ 下）
│   │   └── unified-composer/use-unified-composer-state.ts
│   │          ⚠ 反向引用 ../../session-conversation/runtime/*（已发现，见 §4.3）
│   │
│   └── session-conversation/              (chat 端单 session 对话装配 + 协议层 hooks 混居)
│       ├── SessionConversationView.tsx    (~800 行，对话视图)
│       ├── use-session-conversation-state.ts (~860 行，对话 state hook)
│       ├── inbound-types.ts               (team L1.3 写入路径类型，目前住在这里)
│       └── runtime/                       (62 文件，混合产品装配 + 协议层)
│           ├── 协议层（chat / team 都需要）：
│           │   use-scroll-manager / use-stream-reveal / use-conversation-stream
│           │   stream-usage / streaming-thinking / streaming-segments / streaming-reveal
│           │   stream-recovery / attach-stream-* / attachment-upload
│           │   session-runtime / support / ordered-id / sequential-polling
│           │   permission-auto-respond / context-usage / reasoning-content
│           │   transcript-visibility / scroll-alignment / dev-server-detect
│           │   recovery-read-model / terminals-api / use-session-terminals
│           ├── chat 装配层（chat 端使用，team 不需要或重写）：
│           │   use-chat-streaming / use-chat-render-data / use-chat-scroll
│           │   use-chat-data-loaders / use-session-snapshot-loader / use-session-settings-callbacks
│           │   use-session-view-cache / use-session-view-guard / use-stream-attach-retry
│           │   use-assistant-message-processing / use-session-sidebar-run-state
│           │   use-session-content-artifact-count / chat-render-merge / chat-page-utils
│           │   queued-composer-state / queued-composer-file-store
│           │   use-composer-callbacks / use-composer-menu-items / use-composer-queue
│           │   composer-slash-items / server-command-item / image-edit-reference-artifacts
│           ├── 共享视图组件：
│           │   scroll-bottom-button / stream-error-bar / session-run-state-bar / todo-bar
│           │   history-edit-dialog / retry-mode-dialog
│           └── 模型 / artifact 相关：
│               use-model-prices / use-provider-model-info / task-tool-runtime / think-keyword-detector
│
└── stores / hooks / utils / pages（其他平台层）
```

### 4.2 期望的目标产权

```
apps/web/src/
├── components/
│   ├── chat-atoms/                        (新；纯展示原子，无产品偏向)
│   │   └── （从 components/chat/ 中筛选并迁入）
│   │
│   └── conversation-runtime/              (新；协议层 hooks，按 sessionId 工作)
│       └── （从 session-conversation/runtime/ 中筛选并迁入）
│
└── pages/
    ├── chat-page/
    │   └── conversation/                  (新；chat 独占装配)
    │       ├── ChatConversationView.tsx          (= 旧 SessionConversationView)
    │       ├── use-chat-conversation-state.ts    (= 旧 useSessionConversationState)
    │       ├── chat-render.ts / chat-submit.ts / ...（chat 装配层从 runtime 上迁的私有 hooks）
    │       └── ...
    │
    └── team/
        └── conversation/                  (新；team 独占装配)
            ├── TeamConversationView.tsx
            ├── use-team-conversation-state.ts
            ├── team-submit-router.ts             (从 TeamSessionView 抽出，扩展 inbound/stream/handoff)
            ├── team-render.tsx                   (team 自己的消息映射策略)
            └── team-conversation-extras.tsx     (TeamSubstateProgressBar / TeamSessionHeader / ...)
```

依赖方向（落地后实际状态）：

```
pages/chat-page/conversation/   ─┐
                                  ├──► components/conversation-runtime/
pages/team/conversation/        ─┘                  │
        │                                            │
        └────────────► components/chat/ (atoms) ◄────┘
                              │
                              ▼
                      @openAwork/* (web-client / shared / shared-ui)
```

- `chat-page/conversation/` 与 `team/conversation/` **互不可见**
- `components/chat/` 与 `components/conversation-runtime/` 互引 type/常量是**允许的**：
  - `components/chat/` 的 atoms 引 `conversation-runtime/messages/support.js` 取 `ChatMessage` 等普适类型
  - `components/chat/ChatTopBar.tsx` 引 `conversation-runtime/views/todo-bar.js` 复用共享视图
  - 这是工程现实——`ChatMessage` 类型住在 runtime 协议层比住在 atoms 更合理
- 协议层 `conversation-runtime/` 仍**禁止**反向引产品装配层（`pages/chat-page/conversation/**` / `pages/team/conversation/**` / `pages/team/runtime/**`）

### 4.3 已发现的反向依赖（迁移前需先解决）

#### Issue A：`components/chat/unified-composer/use-unified-composer-state.ts` 反向引 `session-conversation/runtime/*`

实际反向依赖链（从 grep 结果摘录）：

```
components/chat/unified-composer/use-unified-composer-state.ts
  ├── ../../session-conversation/runtime/use-composer-callbacks
  ├── ../../session-conversation/runtime/use-composer-menu-items
  ├── ../../session-conversation/runtime/use-composer-queue
  ├── ../../session-conversation/runtime/chat-page-utils      (buildQueuedComposerScopeKey)
  ├── ../../session-conversation/runtime/queued-composer-state
  ├── ../../session-conversation/runtime/queued-composer-file-store
  ├── ../../session-conversation/runtime/support
  └── ../../session-conversation/runtime/image-edit-reference-artifacts
```

判断：UnifiedComposer 名义上是原子，但其 state hook 把 chat 端的"队列、菜单项、callbacks"全部吸收了。

处理：本方案不重写 UnifiedComposer，先把这些被它引用的 runtime 文件归入"协议层 / chat 装配层"分类时，**如果是协议层（如 `support`）**就和 UnifiedComposer 一起视为共享层；**如果是 chat 装配层（如 `use-composer-queue`、`queued-composer-*`、`chat-page-utils.buildQueuedComposerScopeKey`、`image-edit-reference-artifacts`）**则把它们随 UnifiedComposer 一起留在 chat 一侧的依赖里——也就是说 UnifiedComposer 在迁移分类里**先继续算"chat 业务壳"**，team 端按需复用，但不强行把它降级为 chat-atoms。

#### Issue B：`session-conversation/runtime/*` 反向引页面层

```
runtime/support.ts                          ←→ ../../../pages/dialogue-mode
runtime/use-session-settings-callbacks.ts   ←→ ../../../pages/dialogue-mode
runtime/use-provider-model-info.ts          ←→ ../../../utils/chat-session-defaults
runtime/use-assistant-message-processing.ts ←→ ../../../hooks/useComposerWorkspaceCatalog
runtime/use-session-view-cache.ts           ←→ ../../../pages/chat-stream-state
runtime/use-session-snapshot-loader.ts      ←→ ../../../pages/chat-stream-state
runtime/use-chat-render-data.ts             ←→ ../../../pages/chat-stream-state (ToolCallCardModel)
runtime/use-composer-menu-items.ts          ←→ ../../../hooks/useComposerWorkspaceCatalog
runtime/use-session-content-artifact-count  ←→ ../../../pages/artifacts/artifact-workspace-types
runtime/use-session-sidebar-run-state.ts    ←→ ../../../utils/session-list-events
runtime/chat-page-utils.ts                  ←→ ../../../pages/dialogue-mode
                                            ←→ ../../../pages/chat-stream-state
runtime/session-runtime.ts                  ←→ ../../../utils/pending-permission-state
```

判断：标"chat-stream-state"、"chat-page-utils"的，本来就是 chat 装配层；标"dialogue-mode"、"useComposerWorkspaceCatalog"、"chat-session-defaults"的，是 chat 业务概念但被原子拿来当 type 使用。

处理：在分类阶段（§5.1）按"是否依赖 chat 业务概念"分桶——

- 仅 type-only 依赖且类型本身是普适的（如 `DialogueMode` string union）：保留依赖，迁移时跟着模块走。
- 依赖 chat 装配层（`chat-stream-state.ChatRightPanelState/ToolCallCardModel`、`chat-page-utils.buildXXX`）：归入 **chat 装配层**，迁到 `pages/chat-page/conversation/`。
- 仅 utils 层依赖（`session-list-events`、`pending-permission-state`）：保留，按是否产品偏向决定 utils 自己是否要拆。

具体分桶清单见 §5.1。

### 4.4 当前 ChatPage 嵌入模式的实际触达面

`ChatPage` 287 行附近的 `embeddedSessionId / hideSidebar` 入参仅被 `TeamWorkspaceShell.tsx` 一处调用：

```
TeamWorkspaceShell → <ChatPage embeddedSessionId={sessionId} hideSidebar />
```

判断：本方案 §6.5 删除 ChatPage 嵌入模式时，影响面只有一个调用点；可以放心删。


---

## 5. 文件分桶清单

将 `session-conversation/runtime/` 的 62 个文件 + `session-conversation/` 顶层 3 个文件按目标产权分桶。

分桶标准：
- **共享协议层**（→ `components/conversation-runtime/`）：不引 chat 业务概念（`ChatRightPanelState`、`ToolCallCardModel`、`buildChatRightPanelStateFromRunEvents`、`chat-stream-state`、`useComposerWorkspaceCatalog`、`artifact-workspace-types`、`session-list-events`），仅依赖 `@openAwork/*`、React、本目录内其他协议层文件。
- **chat 装配层**（→ `pages/chat-page/conversation/`）：引了 chat 业务概念，或功能上只有 chat 在用。
- **共享视图组件**（→ `components/conversation-runtime/views/`）：纯展示 `.tsx`，不含 chat 业务逻辑。
- **保留原位**：不需要移动的文件。

### 5.1 共享协议层（→ `components/conversation-runtime/`，按功能域分子目录）

实施时按以下子目录组织（落地结果见 `apps/web/src/components/conversation-runtime/`）：

| 子目录 | 文件 | 说明 |
| --- | --- | --- |
| `stream/` | `use-conversation-stream` / `stream-recovery` / `stream-usage` / `streaming-segments` / `streaming-thinking` | 流式协议主链路 |
| `attach/` | `use-stream-attach-retry` / `attach-stream-eligibility` / `attach-stream-reconnect` / `attach-stream-reconnect-wiring` | 断线重连 |
| `reveal/` | `streaming-reveal` / `use-stream-reveal` / `think-keyword-detector` | 流式逐字显现节奏 |
| `scroll/` | `use-scroll-manager` / `scroll-alignment` / `scroll-constants` | 滚动管理 |
| `messages/` | `support` / `reasoning-content` / `transcript-visibility` / `context-usage` / `ordered-id` | 消息 / 内容处理 |
| `session/` | `session-runtime` / `recovery-read-model` / `permission-auto-respond` / `inbound-types` / `sequential-polling` | session 协议层 |
| `terminals/` | `terminals-api` / `use-session-terminals` | 终端 API |
| `attachments/` | `attachment-upload` / `dev-server-detect` | 附件 / 检测 |
| `views/` | （由 §5.3 填入） | 共享视图组件 |

**新增文件**：
- `scroll/scroll-constants.ts`：从 `chat-page-utils.ts` 提取 `CHAT_LATEST_FOCUS_THRESHOLD_PX` / `CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX` / `CHAT_LATEST_REGION_FALLBACK_PX` / `CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS` / `CHAT_SCROLL_BOTTOM_PADDING` / `CHAT_SCROLL_BOTTOM_SPACER_HEIGHT`，让 `use-scroll-manager` 不再依赖 chat 装配层。

### 5.2 chat 装配层（→ `pages/chat-page/conversation/`，按功能域分子目录）

实施时按以下子目录组织（落地结果见 `apps/web/src/pages/chat-page/conversation/`）：

| 子目录 | 文件 | 说明 |
| --- | --- | --- |
| 顶层 | `ChatConversationView.tsx`（= 旧 SessionConversationView） / `use-chat-conversation-state.ts`（= 旧 useSessionConversationState） + 测试 | 对话视图入口 + state hook |
| `render/` | `chat-page-utils` / `chat-render-merge` / `use-chat-streaming` / `use-chat-render-data` / `use-chat-scroll` / `image-edit-reference-artifacts` / `task-tool-runtime` | 消息渲染 / 流式 orchestration |
| `snapshot/` | `use-session-snapshot-loader` / `use-session-view-cache` / `use-session-view-guard` / `use-session-content-artifact-count` / `use-session-sidebar-run-state` / `use-assistant-message-processing` | session 快照 / 缓存 / 守卫 |
| `settings/` | `use-session-settings-callbacks` / `use-provider-model-info` / `use-model-prices` | session 设置 / provider 信息 |
| `data/` | `use-chat-data-loaders` | 数据加载（workspace / mcp / file tree） |
| `composer/` | `use-composer-callbacks` / `use-composer-menu-items` / `use-composer-queue` / `queued-composer-state` / `queued-composer-file-store` / `composer-slash-items` / `server-command-item` | composer 装配 / 队列 |
| `views/` | `history-edit-dialog` / `retry-mode-dialog` | chat-only 对话框 |

`inbound-types.ts` 由于是 team L1.3 共享类型，归入 §5.1 共享层（`conversation-runtime/session/inbound-types.ts`），与 chat 装配层无关。

### 5.3 共享视图组件（→ `components/conversation-runtime/views/`）

| 文件 | 说明 |
| --- | --- |
| `scroll-bottom-button.tsx` | 滚动到底部按钮 |
| `stream-error-bar.tsx` | 流式错误提示条 |
| `session-run-state-bar.tsx` | session 运行状态条 |
| `todo-bar.tsx` | todo 浮层 |

### 5.4 chat 装配视图（→ `pages/chat-page/conversation/views/`）

| 文件 | 说明 |
| --- | --- |
| `history-edit-dialog.tsx` | 历史编辑对话框（chat-only） |
| `retry-mode-dialog.tsx` | 重试模式对话框（chat-only） |

### 5.5 测试文件跟随源文件迁移

| 测试文件 | 跟随 |
| --- | --- |
| `support.test.ts` | → `conversation-runtime/` |
| `streaming-segments.test.ts` | → `conversation-runtime/` |
| `stream-usage.test.ts` | → `conversation-runtime/` |
| `dev-server-detect.test.ts` | → `conversation-runtime/` |
| `use-session-terminals.test.tsx` | → `conversation-runtime/` |
| `image-edit-reference-artifacts.test.ts` | → `pages/chat-page/conversation/` |

### 5.6 `components/chat/` 原子分类

本轮**不做大规模迁移**（§2.2 N4），仅标注分类供后续参考：

| 分类 | 文件 | 本轮动作 |
| --- | --- | --- |
| **纯原子**（team 可直接 import） | `ChatMessageGroupList` / `InlineQuestionPanel` / `chat-search-overlay` / `message-multi-select` / `prompt-template-panel` / `command-palette` / `bookmarks-panel` / `markdown-message-content` / `markdown-path-ref` / `tool-call-inline` / `assistant-reasoning-block` / `assistant-error-content` / `assistant-event-row` / `collapsible-assistant-content` / `streaming-markdown-content` / `streaming-markdown-chunks` / `context-usage-meter` / `image-lightbox` / `message-hover-actions` / `modified-files-summary-card` / `time-divider` / `tool-icon` / `chat-provider-display` / `chat-remote-stream-placeholder` / `chat-session-skeleton` / `agent-color-map` | 不动 |
| **chat 业务壳**（team 按需复用，不强行降级） | `UnifiedComposer` / `ChatComposer` / `ChatTopBar` / `ChatPageSections`（WelcomeScreen 部分） / `QuickTerminalPanel` / `QuickTerminalToggle` / `BuiltInBrowser` / `ChatImageGenerationControls` / `ChatImageGenerationResultStrip` / `SkillSettingsPanel` / `SessionTerminalsPanel` / `SessionTerminalsChip` / `model-picker-panels` / `model-picker-search` / `message-export` / `unified-composer/use-unified-composer-state` / `companion/*` / `file-preview/*` / `tool-call/*`（部分） | 不动 |

team 端复用 `UnifiedComposer` 时直接 `import { UnifiedComposer } from '../../../components/chat/UnifiedComposer.js'`，接受这条跨产权引用——因为 UnifiedComposer 的 props 接口已经足够通用（`input / setInput / onSubmit / features / placeholder`），不会因 chat 内部改动而破坏 team 调用方。

### 5.7 汇总统计

| 目标位置 | 文件数 | 说明 |
| --- | --- | --- |
| `components/conversation-runtime/` | 27 + 1 新增 + 5 测试 = 33 | 协议层 + 共享视图 |
| `pages/chat-page/conversation/` | 24 + 2 顶层 + 2 视图 + 1 测试 = 29 | chat 装配 |
| `pages/team/conversation/` | 5~7 新建 | team 装配（新写） |
| `components/chat/`（不动） | ~50 | 原子 + 业务壳 |


---

## 6. 实施步骤

按风险递增排列，每步可独立合并、独立验证。

### 6.1 Step 1 · 提取 scroll-constants（0.5 天）

**目的**：解除 `use-scroll-manager` 对 `chat-page-utils` 的依赖，为后续迁移扫清路障。

**操作**：

1. 新建 `components/session-conversation/runtime/scroll-constants.ts`
2. 从 `chat-page-utils.ts` 剪切以下常量到新文件：
   - `CHAT_LATEST_FOCUS_THRESHOLD_PX`
   - `CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX`
   - `CHAT_LATEST_REGION_FALLBACK_PX`
   - `CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS`
   - `CHAT_SCROLL_BOTTOM_PADDING`
   - `CHAT_SCROLL_BOTTOM_SPACER_HEIGHT`
3. `chat-page-utils.ts` 改为 re-export 这些常量（保持外部引用不断）
4. `use-scroll-manager.ts` 改为从 `./scroll-constants.js` 引入
5. `SessionConversationView.tsx` 中对这些常量的引用也改为从 `./runtime/scroll-constants.js` 引入

**验证**：`pnpm tsc --noEmit` + `pnpm test --run`

### 6.2 Step 2 · 创建 `components/conversation-runtime/` 并迁入协议层（1 天）

**目的**：把 §5.1 列出的 27 个协议层文件 + 4 个共享视图 + 测试文件迁到新目录。

**操作**：

1. 创建目录 `apps/web/src/components/conversation-runtime/`
2. 创建子目录 `apps/web/src/components/conversation-runtime/views/`
3. 按 §5.1 清单，逐文件 `smartRelocate`（IDE 自动更新 import）
4. 共享视图组件（§5.3）迁入 `views/` 子目录
5. `inbound-types.ts` 从 `session-conversation/` 迁入 `conversation-runtime/`
6. 新建 `components/conversation-runtime/index.ts` barrel export（可选，按团队偏好）

**迁移顺序**（按依赖拓扑，叶子先动）：

```
第 1 批（零内部依赖）：
  ordered-id / sequential-polling / scroll-constants / scroll-alignment
  streaming-reveal / streaming-thinking / stream-usage / context-usage
  reasoning-content / transcript-visibility / think-keyword-detector
  permission-auto-respond / dev-server-detect / terminals-api / inbound-types

第 2 批（依赖第 1 批）：
  support / session-runtime / streaming-segments / stream-recovery
  recovery-read-model / attachment-upload / attach-stream-eligibility

第 3 批（依赖第 2 批）：
  use-stream-reveal / use-scroll-manager / use-conversation-stream
  use-stream-attach-retry / attach-stream-reconnect / attach-stream-reconnect-wiring
  use-session-terminals

第 4 批（共享视图）：
  views/scroll-bottom-button / views/stream-error-bar
  views/session-run-state-bar / views/todo-bar
```

**验证**：每批迁完跑 `pnpm tsc --noEmit`；全部迁完跑完整测试。

### 6.3 Step 3 · 迁移 chat 装配层到 `pages/chat-page/conversation/`（1 天）

**目的**：把 §5.2 列出的 chat 装配文件从 `session-conversation/runtime/` 迁到 chat 私有目录。

**操作**：

1. 创建目录 `apps/web/src/pages/chat-page/conversation/`
2. 创建子目录 `apps/web/src/pages/chat-page/conversation/views/`
3. 按 §5.2 清单逐文件 `smartRelocate`
4. `history-edit-dialog.tsx` / `retry-mode-dialog.tsx` 迁入 `views/`
5. 重命名顶层文件：
   - `SessionConversationView.tsx` → `ChatConversationView.tsx`
   - `use-session-conversation-state.ts` → `use-chat-conversation-state.ts`
6. 更新 `ChatPage.tsx` 中的 import 路径

**验证**：`pnpm tsc --noEmit` + `pnpm test --run` + 手动打开 `/chat` 页面确认对话正常。

### 6.4 Step 4 · 新建 `pages/team/conversation/`（3–5 天）

**目的**：team 端拥有自己的对话装配，不再引用 chat 端的 `ChatConversationView` / `useChatConversationState`。

**操作**：

1. 创建目录 `apps/web/src/pages/team/conversation/`

2. 新建 `use-team-conversation-state.ts`：
   - 从 `useChatConversationState` **复制**为模板（不是引用）
   - 删除 chat-only 字段：`dialogueMode` / `yoloMode` / `webSearchEnabled` / `imageGenerationMode` / `manualAgentId` / `selectedImageEditReferenceArtifactId` / `historyEditPrompt` / `retryPrompt` / `sessionViewCache` / `sessionViewGuard` / `rightPanelState` / `childSessions` / `sessionTasks` / `editorMode` / `splitPos` / `fileEditor` / `quickTerminal` / `browserPreview`
   - 保留：`messages` / `streaming` / `stoppingStream` / `streamBuffer` / `streamError` / `input` / `setInput` / `scrollRegionRef` / `contentColumnRef` / `bottomRef` / `onScroll` / `showScrollToBottom` / `hasPendingFollowContent` / `scrollToBottom` / `pendingPermissions` / `pendingQuestions` / `providers` / `activeProviderId` / `activeModelId` / `sessionStateStatus` / `isSessionLoading` / `visibleStreaming`
   - 新增 team-only 字段：`roleLayer` / `substate` / `handoffsInline` / `layeredGroups` / `receptionSessionId` / `teamWorkspaceId`
   - 引入共享协议层：`useConversationStream` / `useScrollManager` / `useStreamReveal` / `useStreamAttachRetry`
   - 写入路由：`team-submit-router.ts`

3. 新建 `team-submit-router.ts`：
   - 从 `TeamSessionView.resolveSubmitStrategy` 提取
   - 扩展 handoff 路径：`{ kind: 'handoff'; targetLayer: string }`
   - 扩展 future 路径：`{ kind: 'inbound'; messageType: 'spec_revision' | 'plan_approval' | ... }`

4. 新建 `TeamConversationView.tsx`：
   - 引入 `useTeamConversationState`
   - 引入共享原子：`ChatMessageGroupList` / `UnifiedComposer` / `InlineQuestionPanel`
   - 引入共享视图：`scroll-bottom-button` / `stream-error-bar`
   - 引入 team 专属组件：`TeamSubstateProgressBar` / `TeamSessionHeader` / `TeamSessionEmptyState`
   - 不引入 chat 装配层任何文件

5. 新建 `team-render.tsx`（可选）：
   - team 自己的消息映射策略（如按 agent 分组、handoff 卡片夹层、层级折叠）
   - 初版可直接用 `renderChatMessageContentWithOptions`，后续按需分化

6. 新建 `team-conversation-extras.tsx`：
   - 把 `TeamSubstateProgressBar` / `TeamSessionHeader` / `TeamSessionEmptyState` 从 `team/runtime/shell/session-view/` 迁入或 re-export

**验证**：
- `pnpm tsc --noEmit`
- 手动打开 `/team/:workspaceId` 页面，确认 reception session 对话正常
- 确认 LayerConversationDrawer 中的子 session 对话正常
- 确认 clarification 回复正常（inbound 路径）
- 确认 stream 路径正常（reception 普通对话）

### 6.5 Step 5 · 切流量 + 删旧路径（0.5 天）

**目的**：把 team 端的入口从旧路径切到新路径，删除废弃文件。

**操作**：

1. `ConversationArea.tsx`：
   - 删除 `import { TeamWorkspaceShell }` / `import { TeamSessionView }`
   - 改为 `import { TeamConversationView } from '../../conversation/TeamConversationView.js'`
   - Path 2（receptionSessionId 存在）改为渲染 `<TeamConversationView sessionId={receptionSessionId} />`

2. `LayerConversationDrawer.tsx`：
   - 子 session 视图也改为 `<TeamConversationView sessionId={...} compact />`

3. 删除文件：
   - `pages/team/runtime/shell/session-view/TeamWorkspaceShell.tsx`
   - `pages/team/runtime/shell/session-view/TeamSessionView.tsx`

4. 删除 ChatPage 嵌入模式：
   - `ChatPage.tsx`：删除 `embeddedSessionId` / `hideSidebar` props 及相关 `embedded` 分支逻辑
   - 确认无其他调用方

5. 清理空目录：
   - 如果 `components/session-conversation/` 已空，删除整个目录

**验证**：
- `pnpm tsc --noEmit` + `pnpm test --run`
- 手动验证 chat 页面无回归
- 手动验证 team 页面全路径正常

### 6.6 Step 6 · 锁边界（0.5 天）

**目的**：防止未来开发者无意中重新引入交叉依赖。

**操作**：

1. 在 `eslint.config.js` 中添加 `no-restricted-imports` 规则（或使用 `eslint-plugin-boundaries`）：

```js
// pages/chat-page/conversation/** 禁止引 pages/team/**
// pages/team/conversation/** 禁止引 pages/chat-page/**
// components/conversation-runtime/** 禁止引 pages/**
// components/chat/** 禁止引 components/conversation-runtime/**（原子不依赖协议层）
```

2. 在以下位置添加 `AGENTS.md` 或 `README.md` 声明产权与依赖约束：
   - `components/conversation-runtime/AGENTS.md`
   - `pages/chat-page/conversation/AGENTS.md`
   - `pages/team/conversation/AGENTS.md`

3. 更新 `docs/chat-conversation-reuse-plan.md`：
   - 标注 v1.5 方案已被本方案取代
   - 指向本文档作为后继

**验证**：`pnpm lint` 通过，无新 warning。


---

## 7. 风险与回退

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Step 2/3 迁移后 import 路径遗漏 | 编译失败 | 每批迁完立即 `tsc --noEmit`；使用 `smartRelocate` 自动更新引用 |
| `use-scroll-manager` 依赖的常量提取不完整 | 运行时滚动异常 | Step 1 单独验证，跑 scroll 相关单测 |
| `useTeamConversationState` 复制后遗漏必要字段 | team 对话功能缺失 | Step 4 验证清单覆盖 clarification / stream / permission / question 四条路径 |
| chat 端 `ChatConversationView` 重命名后外部引用断裂 | 编译失败 | `smartRelocate` 处理；额外 grep 确认无遗漏 |
| 删除 `embeddedSessionId` 后发现其他调用方 | 编译失败 | Step 5 前先 grep 确认只有 TeamWorkspaceShell 一处 |
| team 端 `UnifiedComposer` 复用时 props 不兼容 | 编译失败或运行时异常 | UnifiedComposer 的 props 接口已稳定（`input/setInput/onSubmit/features/placeholder`），team 只用子集 |
| 后续 chat 改流式协议导致 conversation-runtime 变更 | 两端都需更新 | 这是正确的分离边界——协议层变更本应通知所有消费方；通过 TypeScript 类型保证编译时发现 |

**回退策略**：

- Step 1–3 是纯重构（移动文件 + 重命名），任何一步出问题可 `git revert` 整个 commit。
- Step 4 是新增文件，不影响旧路径；出问题时 `ConversationArea` 仍指向旧的 `TeamWorkspaceShell`。
- Step 5 是切流量，是唯一的"不可并行"步骤。如果切后发现问题，revert Step 5 的 commit 即可回到旧路径。
- 每个 Step 独立 PR，独立 review，独立合并。

---

## 8. 时间线

| Step | 工作量 | 前置依赖 | 可并行 |
| --- | --- | --- | --- |
| Step 1 · 提取 scroll-constants | 0.5 天 | 无 | — |
| Step 2 · 迁入协议层 | 1 天 | Step 1 | — |
| Step 3 · 迁移 chat 装配层 | 1 天 | Step 2 | — |
| Step 4 · 新建 team conversation | 3–5 天 | Step 2（不依赖 Step 3） | 可与 Step 3 并行 |
| Step 5 · 切流量 + 删旧 | 0.5 天 | Step 3 + Step 4 | — |
| Step 6 · 锁边界 | 0.5 天 | Step 5 | — |

**总计**：6.5–8.5 天（1 人），其中 Step 3 与 Step 4 可并行缩短到 5.5–7.5 天。

**里程碑**：

- M1（Step 1–2 完成）：`conversation-runtime` 目录就位，协议层独立可用。
- M2（Step 3 完成）：chat 端装配归位，`session-conversation/` 目录清空。
- M3（Step 4 完成）：team 端拥有独立对话装配，可在 feature flag 下验证。
- M4（Step 5–6 完成）：旧路径删除，边界锁定，方案落地。

---

## 9. 验收标准

### 9.1 功能验收

- [ ] Chat 页面（`/chat/:sessionId`）：对话、流式、断线重连、历史编辑、重试、权限、提问、todo、搜索、多选、书签、模板、命令面板、图片生成——全部正常，无回归。
- [ ] Team 页面（`/team/:workspaceId`）：
  - [ ] Reception session 对话正常（stream 路径）
  - [ ] Clarification 回复正常（inbound 路径）
  - [ ] 子 session（pm1/pm2/executor/reviewer）在 LayerConversationDrawer 中正常渲染
  - [ ] TeamSubstateProgressBar / TeamSessionHeader / TeamSessionEmptyState 正常显示
  - [ ] UnifiedComposer 输入 + 发送正常
  - [ ] 滚动管理 + scroll-to-bottom 正常
  - [ ] 流式错误提示正常
  - [ ] InlineQuestionPanel 正常
  - [ ] PendingPermission 内嵌正常

### 9.2 架构验收

- [ ] `pnpm tsc --noEmit` 零错误
- [ ] `pnpm lint` 零新 warning
- [ ] `pnpm test --run` 全部通过
- [ ] `pages/chat-page/conversation/**` 无任何 `from '../../team'` 或 `from '../team'` import
- [ ] `pages/team/conversation/**` 无任何 `from '../../chat-page'` 或 `from '../chat-page'` import
- [ ] `components/conversation-runtime/**` 无任何 `from '../../pages'` import（除 type-only `DialogueMode`）
- [ ] `ChatPage.tsx` 不再有 `embeddedSessionId` / `hideSidebar` props
- [ ] `TeamWorkspaceShell.tsx` / `TeamSessionView.tsx` 已删除
- [ ] `components/session-conversation/` 目录已删除

### 9.3 文档验收

- [ ] `docs/chat-conversation-reuse-plan.md` 标注为 superseded
- [ ] `components/conversation-runtime/AGENTS.md` 声明产权与依赖约束
- [ ] `pages/chat-page/conversation/AGENTS.md` 声明产权与依赖约束
- [ ] `pages/team/conversation/AGENTS.md` 声明产权与依赖约束

---

## 10. 附录：TeamConversationView API 草案

```tsx
// pages/team/conversation/TeamConversationView.tsx

export interface TeamConversationViewProps {
  /** 要渲染的 team session id */
  sessionId: string;
  /** 紧凑模式（LayerConversationDrawer 等嵌入场景） */
  compact?: boolean;
  /** 是否启用 composer 输入。默认 true。 */
  composerEnabled?: boolean;
  /** 消息列表前 slot */
  beforeMessages?: ReactNode;
  /** 消息列表后 slot */
  afterMessages?: ReactNode;
  /** 顶部 slot（默认渲染 TeamSubstateProgressBar） */
  topBar?: ReactNode;
}
```

```tsx
// pages/team/conversation/use-team-conversation-state.ts

export interface UseTeamConversationStateOptions {
  sessionId: string;
  composerEnabled?: boolean;
}

export interface TeamConversationState {
  // ─── 消息 ──────────────────────────────────────────
  messages: ChatMessage[];
  streaming: boolean;
  stoppingStream: boolean;
  visibleStreaming: boolean;
  streamError: string | null;
  setStreamError: (error: string | null) => void;
  isSessionLoading: boolean;

  // ─── team 专属 ─────────────────────────────────────
  roleLayer: string | null;
  substate: string | null;
  sessionStateStatus: SessionStateStatus | null;
  sessionMetadata: Record<string, unknown> | null;

  // ─── 输入 ──────────────────────────────────────────
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  submit: (text: string) => Promise<void>;

  // ─── 滚动 ──────────────────────────────────────────
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  contentColumnRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  showScrollToBottom: boolean;
  hasPendingFollowContent: boolean;
  scrollToBottom: (behavior: 'smooth' | 'auto', target: 'latest-edge' | 'center') => void;

  // ─── 交互 ──────────────────────────────────────────
  pendingPermissions: PendingPermissionRequest[];
  pendingQuestions: PendingQuestionRequest[];
  replyQuestion: (requestId: string, status: 'answered' | 'dismissed', answers?: string[][]) => Promise<void>;

  // ─── provider ──────────────────────────────────────
  providers: ChatSettingsProvider[];
  activeProviderId: string;
  activeModelId: string;

  // ─── 流控 ──────────────────────────────────────────
  startStream: (text: string) => Promise<void>;
  stopStream: () => Promise<void>;
  submitInbound: (messageType: string, payload: unknown) => Promise<void>;
  reload: () => Promise<void>;
}
```

```tsx
// pages/team/conversation/team-submit-router.ts

export type TeamSubmitStrategy =
  | { kind: 'stream' }
  | { kind: 'inbound'; messageType: 'clarification_answer' | 'user_input' | 'spec_revision' | 'plan_approval' }
  | { kind: 'handoff'; targetLayer: string };

export function resolveTeamSubmitStrategy(
  roleLayer: string | null,
  substate: string | null,
): TeamSubmitStrategy;
```

---

*文档结束*
