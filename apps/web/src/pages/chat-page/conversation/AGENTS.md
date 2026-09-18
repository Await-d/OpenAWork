# chat-page/conversation · chat 端对话装配

> chat 产品独占的对话视图 + state hook + chat-only chrome（history-edit / retry / image-edit-reference / queued composer 等）。

## 产权

- **所属人**：chat 产品（ChatPage.tsx）
- **演进策略**：可自由演进，不受 team 端约束。

## 目录约定

```
chat-page/conversation/
├── ChatConversationView.tsx              对话视图入口（含 80+ props）
├── use-chat-conversation-state.ts        state hook
├── use-chat-conversation-state.test.tsx  hook 测试
├── render/                               消息渲染 / 流式 orchestration
│   ├── chat-page-utils.ts
│   ├── chat-render-merge.ts
│   ├── use-chat-streaming.ts
│   ├── use-chat-render-data.ts
│   ├── image-edit-reference-artifacts.ts
│   ├── image-edit-reference-artifacts.test.ts
│   └── task-tool-runtime.ts
├── snapshot/                             session 快照 / 缓存 / 守卫
│   ├── use-session-snapshot-loader.ts
│   ├── use-session-view-cache.ts
│   ├── use-session-view-guard.ts
│   ├── use-session-content-artifact-count.ts
│   ├── use-session-sidebar-run-state.ts
│   └── use-assistant-message-processing.ts
├── settings/                             session 设置
│   ├── use-session-settings-callbacks.ts
│   ├── use-provider-model-info.ts
│   └── use-model-prices.ts
├── data/                                 数据加载
│   └── use-chat-data-loaders.ts
├── composer/                             composer 装配 / 队列
│   ├── use-composer-callbacks.ts
│   ├── use-composer-menu-items.ts
│   ├── use-composer-queue.ts
│   ├── queued-composer-state.ts
│   ├── queued-composer-file-store.ts
│   ├── composer-slash-items.ts
│   └── server-command-item.ts
└── views/                                chat-only 对话框
    ├── history-edit-dialog.tsx
    └── retry-mode-dialog.tsx
```

## 长内容折叠与虚拟列表不变量

- **折叠策略（`components/chat/markdown/fold-policy.ts`）**：`FoldDisabledContext` 为真时，
  围栏块（`CodeBlock` >100 行 → 60vh、`MarkdownPreviewCodeBlock` >15 行/400 字 → 300px）不折叠。
  两处 provider：① `StreamingMarkdownContent` 包住整棵流式树（含 stable blocks）—— 流式期间钳高会让
  滚动容器停止增长、自动贴底失效且把刚流出的尾部裁掉；② `CollapsibleAssistantContent` 在 `isLatest`
  时提供 —— 避免"刚读完内容就收起 + 视口上跳"。历史回复的整条折叠（`FOLD_CHAR_THRESHOLD`）行为不变；
  `data-collapsed` / `data-testid` 语义不得改。
- **虚拟列表高度（`components/chat/message/chat-message-group-list.tsx` 的 `resolveGroupHeight`）**：
  该组有已挂载、被 ResizeObserver 观测的节点时，即使签名变化也**沿用上次实测高度**——屏幕内的组永远有
  DOM，RO 会在真实尺寸变化时纠正；此时退回封顶估算会让后续所有组整体上移并与长消息重叠、`minHeight`
  同时低估。离屏（无节点）的组仍走签名门禁（其实测值可能已过期）。失效逻辑只在内容**收缩**或状态迁移时
  丢弃实测值；估算封顶是给离屏组兜底的，不要为了"流式很长"就把门禁整体去掉。

## 依赖约束（关键）

- ❌ **禁止** import `pages/team/**`（team 是平级产品，不互引）
- ✅ **允许** import `components/conversation-runtime/**`（共享协议层）
- ✅ **允许** import `components/chat/**`（共享 atoms）
- ✅ **允许** import `pages/chat-page/**`（同产品的 ChatPage 业务壳）

## 演进规则

- 增加 chat-only feature（imageGeneration / skill / yolo / dialogueMode 等）：
  - 改动只发生在本目录与 `components/chat/`
  - 不需要通知 team（team 已通过 `pages/team/conversation/` 独立维护）
- 改动协议层（流式 / 滚动 / attach）：
  - 只能在 `components/conversation-runtime/` 改，不要 fork 一份到本目录
  - 同步通知 team

## 关联文档

- `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` §5.2
