# conversation-runtime · 共享协议层

> 单 session 对话的协议层 hooks + 工具，与产品（chat / team）无关。

## 产权

- **所属人**：跨产品共享（chat、team 都依赖）
- **演进策略**：变更需要通知所有消费方；优先做向后兼容。

## 目录约定

```
conversation-runtime/
├── stream/        流式协议（use-conversation-stream / stream-recovery / stream-usage / streaming-segments / streaming-thinking）
├── attach/        断线重连（use-stream-attach-retry / attach-stream-eligibility / attach-stream-reconnect / attach-stream-reconnect-wiring）
├── reveal/        流式逐字显现节奏（streaming-reveal / use-stream-reveal / think-keyword-detector）
├── scroll/        滚动管理（use-scroll-manager / scroll-alignment / scroll-constants / scroll-follow-state / use-scroll-intent）
├── messages/      消息 / 内容处理（support / reasoning-content / transcript-visibility / context-usage / ordered-id）
├── session/       session 协议（session-runtime / recovery-read-model / permission-auto-respond / inbound-types / sequential-polling）
├── terminals/     终端（terminals-api / use-session-terminals）
├── attachments/   附件 / 检测（attachment-upload / dev-server-detect）
└── views/         共享视图组件（scroll-bottom-button / stream-error-bar / session-run-state-bar / todo-bar）
```

## 依赖约束（关键）

- ❌ **禁止** import `pages/chat-page/conversation/**`（产品装配层）
- ❌ **禁止** import `pages/team/conversation/**`（产品装配层）
- ❌ **禁止** import `pages/team/runtime/**`（team 业务壳）
- ✅ **允许** import `@openAwork/*`（平台层）、React、本目录内其他模块
- ⚠️ **type-only** 例外：可保留对 `pages/dialogue-mode.ts` 的 type 引用（DialogueMode 是普适 string union）
- ⚠️ **utils 例外**：可引 `utils/pending-permission-state`、`utils/chat-session-defaults` 等纯 utils

## 不变量（改动前必读）

- **滚动恢复只有三条路径**（`scroll/scroll-follow-state.ts` 的 `resolveFollowInterrupted` 是唯一裁决处）：
  ① 程序化落点落在 latest 边缘内（`scroll-alignment.ts` 的 `resolveAtLatestEdge`）；
  ② 非程序化位置回到**真正底部**（`distanceToBottom <= CHAT_TRUE_BOTTOM_TOLERANCE_PX`）；
  ③ **显式向下意图**（`seek-latest`：wheel 向下 / 触控朝新内容 / ArrowDown·PageDown·End·Space）
  且落在 latest 边缘内 —— 由 `use-scroll-manager.ts` 的 `handleSeekLatest` 处理。
  向上手势一律走 `leave-latest` 立即挂起。**禁止**引入时间窗口 / 防抖式"忽略若干毫秒内滚动事件"，
  也**禁止**把宽松的 latest 边缘判定开放给非向下意图：那正是历史回归（一个滚轮刻度被静默撤销）的来源。
- **`tool_result` 先到时必须就地占位**：live（`stream/streaming-segments.ts`
  `applyToolResultToStreamingSegment`）与持久化（`messages/trace-codec.ts`
  `partsFromOrderedAssistantContent`）两条路径必须**同序**；匹配不到 `tool_call` 时在**到达位置**
  插入占位 tool 段（`toolName` 回退字面量 `'tool'`，后续同 `toolCallId` 的 `tool_call_delta`
  原地补齐 name/input），**不得**推到数组末尾，也不得静默丢弃。

## 演进规则

- 协议变更（消息 shape / 流式事件 / 滚动行为等）需要：
  1. 在 PR 描述中列出所有消费方（grep `from '\.\.\/conversation-runtime/'`）
  2. 同 PR 同步更新 chat / team 两侧的 state hook
  3. 确保两侧都有测试覆盖

## 关联文档

- `docs/chat/chat-conversation-reuse-plan.md` v1.5
