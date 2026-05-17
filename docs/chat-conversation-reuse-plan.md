# Chat 对话布局复用方案（v1.4）

> 用途：把 ChatPage 的"单 session 对话布局"抽成 `<SessionConversationView>`，让 TeamPageV2 直接复用，避免 team 在 `ConversationArea.tsx` 重新发明一套消息列表 + composer + 流式渲染。
>
> 关联文档：
>
> - L1 基线：`team-architecture-l1-baseline.md`（特别是 L1.3 / L1.8）
> - **L1.3 详细 spec**：`team-architecture-l1-3-streaming-handoff-spec.md`（Phase 2b/2c 的后端依据）
> - 思想分析归档：`team-architecture-spec-kit-borrowing-discussion.md`
> - 当前 team v2 方案：`.agentdocs/workflow/260516-team-page-功能加强方案.md`
>
> 创建时间：2026-05-16
> 最近更新：2026-05-17（v1.4：完成主对话区/层级对话/消息总线三处的 chat 渲染统一；composer feature flag 接入；前端契约就绪）
> 当前状态：**Phase 1 + 2a 全量落地 + 2b 前端契约 + composer feature flag 接入；待后端 L1.3 改造启用 inbound 写入**

---

## 0. 设计哲学

三条原则贯穿整个方案：

1. **能复用现成接口的就不发明新接口**：chat 用的是按 sessionId 寻址的通用协议，与"chat"或"team"无关。team 复用对话布局**不需要新增任何 chat 类后端接口**。
2. **能放可选 slot 就不放 feature flag**：chat-only 的 chrome（ChatTopBar、SubAgentRunList、CompanionStage 等）通过 slot 注入，不用 if/else 判断 `sessionSource`。
3. **能延后到 L1.3 inbound_messages 协议落地再做的就别现在做**：team 接入 SessionConversationView 时**先以"composer 默认 disabled 的只读模式"接入**，等 L1.3 反向通道协议正式上线后再放开输入。

---

## 1. 复用目标与非目标

### 1.1 目标

- chat 和 team 共享同一份**单 session 对话布局**实现
- 共享的能力包括：消息列表（含 reasoning / tool / event / file diff / permission 内嵌）、流式渲染、断线重连、滚动管理、todo bar、stream error bar、scroll-to-bottom、history edit、retry dialog、UnifiedComposer
- ChatPage 行为零回归
- TeamPageV2 接入后，点开任意 b/c/pm1/pm2/executor/reviewer session 看到的消息流与 chat 完全一致

### 1.2 非目标

- **不**做"统一消息 view-model"重构。team 的执行 session 本身就是 chat 协议下的 session，消息模型同源。
- **不**把 SessionConversationView 上抬到 packages（短期内只放在 `apps/web/src/components/`）。
- **不**移植 chat 特有的右侧面板（plan / dag / viz / mcp / agent / skills / bookmarks / history）。team 在外层套自己的 RightPanel。
- **不**把 ChatTopBar / ChatEditorPane / SubAgentRunList / CompanionStage / SkillRecommendationDrawer 抽进 SessionConversationView。

---

## 2. 架构定位

```
┌─────────────────────────────────────────────────────────┐
│ ChatPage (chat 业务壳，约 1500 行)                       │
│  ├─ ChatTopBar / ChatEditorPane / ChatRightPanel         │
│  ├─ SkillRecommendationDrawer / CommandPalette / 等       │
│  └─ <SessionConversationView                              │
│       sessionId={currentSessionId}                        │
│       sessionSource="chat"                                │
│       topBar={<ChatTopBar/>}                              │
│       beforeMessages={<SubAgentRunList/>}                 │
│       afterMessages={<CompanionStage/>}                   │
│       composerExtras={{ imageGen, skillRec, ... }}        │
│     />                                                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ TeamPageV2 (team 协作壳)                                  │
│  ├─ TeamSessionListSidebar / TopTeamHeader / RightPanel   │
│  ├─ OfficeCompactBar / LayerConversationDrawer / 等        │
│  └─ ConversationArea                                      │
│      ├─ activeSessionId 不存在 → 现有 EmptyState/Loading  │
│      └─ activeSessionId 存在 → <SessionConversationView   │
│           sessionId={activeSessionId}                     │
│           sessionSource="team"                            │
│           topBar={<TeamSubstateProgressBar/>}             │
│           composerExtras={{ /* 全关 */ }}                  │
│           composerDisabled={!inboundMessagesProtocol}     │
│         />                                                │
└─────────────────────────────────────────────────────────┘

         ↓ 都通过 sessionId 调以下接口（已存在）

┌─────────────────────────────────────────────────────────┐
│ Backend (sessions 表，按 sessionId 寻址，与来源无关)      │
│  GET  /sessions/:id/recovery                             │
│  WS   /sessions/:id/stream                               │
│  GET  /sessions/:id/stream/sse                           │
│  GET  /sessions/:id/stream/active                        │
│  GET  /sessions/:id/stream/attach                        │
│  POST /sessions/:id/stream/stop                          │
│  GET  /sessions/:id/permissions/pending                  │
│  POST /sessions/:id/permissions/reply                    │
│  GET  /sessions/:id/questions/pending                    │
│  POST /sessions/:id/questions/reply                      │
│  GET  /sessions/:id/todos                                │
│  GET  /sessions/:id/children                             │
│  POST /sessions/:id/messages/truncate                    │
│  ...                                                     │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 接口对账结论

### 3.1 chat 类接口：100% 现成，无需新增

所有 ChatPage 用到的接口都按 sessionId 寻址，不区分来源。team 创建的 session（通过 `POST /team/sessions`）和 chat 创建的 session（通过 `POST /sessions`）落在同一张 `sessions` 表，使用同一组接口。

| 视图能力                  | 后端接口                                                              | 状态 |
| ------------------------- | --------------------------------------------------------------------- | ---- |
| 加载消息历史 + 恢复中断流 | `GET /sessions/:id/recovery`                                          | ✅   |
| 流式发送 + 接收 token     | `WS /sessions/:id/stream` 或 `SSE /sessions/:id/stream/sse`           | ✅   |
| 断线重连 attach           | `GET /sessions/:id/stream/active` + `GET /sessions/:id/stream/attach` | ✅   |
| 停流                      | `POST /sessions/:id/stream/stop`                                      | ✅   |
| 工具权限 inline 处理      | `GET/POST /sessions/:id/permissions/{pending,reply}`                  | ✅   |
| 提问 inline 处理          | `GET/POST /sessions/:id/questions/{pending,reply}`                    | ✅   |
| Todo / Tasks / Children   | `GET /sessions/:id/{todos,tasks,children}`                            | ✅   |
| 历史编辑/重试             | `POST /sessions/:id/messages/truncate`                                | ✅   |
| Snapshot/restore          | `GET /sessions/:id/snapshots`、`POST /sessions/:id/restore/*`         | ✅   |
| 终端                      | `GET /sessions/:id/terminals`                                         | ✅   |

### 3.2 team 类接口：现状满足只读需求

| 端点                                     | 用途                                       | 状态 |
| ---------------------------------------- | ------------------------------------------ | ---- |
| `POST /team/sessions`                    | 创建 b/c/pm1/pm2/executor/reviewer session | ✅   |
| `WS /team-events`                        | handoff / scheduler / artifact 事件        | ✅   |
| `POST /team/handoffs`                    | 创建 handoff                               | ✅   |
| `GET /team/sessions/:sessionId/handoffs` | 查 handoff 链                              | ✅   |
| `POST /team/handoffs/:handoffId/cancel`  | 取消 handoff                               | ✅   |

### 3.3 sessions 表字段对账（来自 db.ts）

**已落地**：

- 基础字段：`id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at`
- 历史扩展：`parent_id, workspace_id, time_*, summary_*, revert, permission`
- L1.8 部分：`team_parent_session_id, role_layer, handoff_state, intent_state, last_heartbeat`

**未落地**（不阻塞 SessionConversationView 复用，但阻塞外层 chrome 展示子状态机）：

- L1.3：`substate, substate_updated_at`
- L1.8：`structural_depth, execution_depth, paused, paused_at`

**未落地**（阻塞 team 用户在 SessionConversationView 直接对话）：

- L1.3：`session_inbound_messages` 整张表

### 3.4 必须现在解决的接口层调整

| 编号   | 调整                                                                                                               | 影响                                                      | 阶段                   |
| ------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------- |
| **A1** | `POST /team/sessions` 创建时按 `roleLayer` 自动注入 `defaultProvider/defaultModel/dialogueMode` 到 `metadata_json` | UnifiedComposer 启动时正确恢复 team 各层的角色绑定        | Phase 2a 前完成        |
| **A2** | team 接入时 composer 默认 disabled，等 L1.3 inbound_messages 协议落地后开                                          | 避免出现"两个写入源"违反 L1.3                             | Phase 2a 锁定行为      |
| **B1** | 实施 L1.3 inbound_messages 表 + `POST /team/sessions/:sessionId/inbound-messages` 端点                             | 解锁 team 用户在 SessionConversationView 输入             | Phase 2b（可独立后做） |
| **B2** | 实施 L1.3 `sessions.substate` 字段 + `session.substate_changed` 事件                                               | 外层 chrome 可展示 c.drafting_spec / d.dispatching 等进度 | Phase 2c（可选）       |

---

## 4. 实施阶段

### Phase 0：后端字段对账（1-2 天）

**目的**：动手前确认事实，把不一致点列清楚。

任务：

1. ✅ 已完成：grep `db.ts` 列出 sessions 表当前所有字段
2. ✅ 已完成：列出后端路由全集
3. ⚠️ 待做：决定 A1（自动注入 metadata）由谁实现，确认 `agent-catalog.ts` 中各 roleLayer 的默认 provider/model 已有
4. ⚠️ 待做：与团队对齐 A2（composer 先 disabled）

**退出条件**：A1 确定实施方，A2 团队达成共识。

### Phase 1：抽离 + chat 内部用（2-3 周，单人专项）

**目的**：把"对话视图"从 ChatPage 切开，但**视图组件先只在 chat 里用**。这阶段不暴露给 team，避免一次性改太多。

#### 1.1 文件迁移

把以下文件从 `apps/web/src/pages/chat-page/` 移到 `apps/web/src/components/session-conversation/runtime/`：

**视图层**：

- `chat-scroll-bottom-button.tsx` → `scroll-bottom-button.tsx`
- `chat-stream-error-bar.tsx` → `stream-error-bar.tsx`
- `chat-todo-bar.tsx` → `todo-bar.tsx`
- `session-run-state-bar.tsx` → 同名
- `history-edit-dialog.tsx` → 同名
- `retry-mode-dialog.tsx` → 同名

**运行时 hooks**：

- `use-chat-streaming.ts` → `use-streaming.ts`
- `use-chat-render-data.ts` → `use-render-data.ts`
- `use-chat-scroll.ts` + `use-scroll-manager.ts` → 同名
- `use-session-snapshot-loader.ts` → 同名
- `use-session-view-cache.ts` + `use-session-view-guard.ts` → 同名
- `use-stream-attach-retry.ts` → 同名
- `use-stream-reveal.ts` → 同名
- `use-assistant-message-processing.ts` → 同名
- `use-chat-data-loaders.ts` → `use-data-loaders.ts`
- `session-runtime.ts` → 同名
- `stream-recovery.ts` + `recovery-read-model.ts` → 同名
- `attach-stream-eligibility.ts` + `attach-stream-reconnect.ts` + `attach-stream-reconnect-wiring.ts` → 同名

**业务工具**：

- `support.ts`（消息模型）→ 同名
- `chat-page-utils.ts` → `utils.ts`
- `chat-render-merge.ts` → `render-merge.ts`
- `streaming-segments.ts` + `streaming-thinking.ts` + `streaming-reveal.ts` + `stream-usage.ts` → 同名
- `context-usage.ts` + `task-tool-runtime.ts` + `scroll-alignment.ts` + `transcript-visibility.ts` + `reasoning-content.ts` → 同名
- `permission-auto-respond.ts` + `pending-permission-state.ts`（如有）→ 同名
- `composer-slash-items.ts` + `queued-composer-state.ts` + `queued-composer-file-store.ts` → 同名
- `attachment-upload.ts` + `image-edit-reference-artifacts.ts` → 同名
- `ordered-id.ts` + `dev-server-detect.ts` + `think-keyword-detector.ts` + `terminals-api.ts` + `server-command-item.ts` → 同名

**留在原位（chat 业务特有）**：

- `chat-editor-pane.tsx`（split 编辑器）
- `chat-right-panel.tsx` + `right-panel-sections.tsx` + `right-panel-tabs.tsx`
- `sub-agent-run-list.tsx` + `sub-session-detail-panel.tsx` + `use-sub-session-detail.ts`
- `use-chat-image-generation.ts`
- `use-chat-message-actions.ts` + `use-chat-ui-actions.ts`
- `use-composer-callbacks.ts` + `use-composer-menu-items.ts` + `use-composer-queue.ts`（这些其实可以进，但作为 props 注入而非内部 import，避免和 chat-page/ 互相依赖）

**关键约束**：迁移后 `apps/web/src/components/chat/*`（已有的 ChatComposer / UnifiedComposer / ChatMessageGroupList 等）的反向 import `../../pages/chat-page/support` 改为 import 新位置 `../session-conversation/runtime/support`。这一步打破了**双向耦合**。

#### 1.2 SessionConversationView 接口设计

```tsx
interface SessionConversationViewProps {
  // ─── 必填 ───────────────────────────────────────────
  sessionId: string | null;
  sessionSource: 'chat' | 'team';

  // ─── chrome slots（chat 特有的边角料）────────────────
  topBar?: ReactNode; // chat: ChatTopBar / team: TeamSubstateProgressBar
  beforeMessages?: ReactNode; // chat: SubAgentRunList / team: 任务流缩略
  afterMessages?: ReactNode; // chat: CompanionStage / team: handoff 进度

  // ─── composer 能力开关 ──────────────────────────────
  composerDisabled?: boolean; // team Phase 2a 用 true
  composerExtras?: {
    imageGeneration?: boolean; // team: false
    skillRecommendation?: boolean; // team: false
    multiSelect?: boolean;
    bookmarks?: boolean;
    promptTemplate?: boolean;
    commandPalette?: boolean;
    dialogueModeToggle?: boolean; // team: false
    yoloMode?: boolean; // team: false
    agentSwitch?: boolean; // team: false（team 角色由 roleLayer 决定，不由用户切）
  };

  // ─── 必传回调 ───────────────────────────────────────
  onSelectChildSession?: (childId: string) => void;
  onOpenRecovery?: () => void;
  onOpenWorkspaceSelector?: () => void;

  // ─── 可选：错误/事件上抛（外层 chrome 用） ──────────
  onSessionStateChange?: (status: SessionStateStatus | null) => void;
  onStreamError?: (err: { code: string; message?: string }) => void;
}
```

**默认行为**：

- `composerExtras` 全部默认 `false`，chat 显式开启
- `composerDisabled` 默认 `false`
- `topBar / beforeMessages / afterMessages` 全部为可选 slot

#### 1.3 ChatPage 改造

ChatPage 从 5724 行降到约 1500 行，只保留：

- chat 业务 state（skill、image generation、companion、bookmarks、multiSelect、template panel）
- chat 特有 chrome（TopBar、EditorPane、RightPanel、SkillRecommendationDrawer 等）
- 调用 `<SessionConversationView sessionSource="chat" .../>`

**state 拆分原则**（依据已有调研结果）：

- A 类（通用对话布局，约 25 个）→ 进 SessionConversationView
- B 类（模型/会话设置，6 个）→ 进 SessionConversationView，但通过 `composerExtras` 控制是否暴露 UI
- C 类（chat 业务特有，约 25 个）→ 留 ChatPage
- D 类（外部协调，几个）→ 留 ChatPage，必要时通过 props 传给 SessionConversationView

#### 1.4 验收

- ChatPage 行为零回归（跑现有 e2e + 手测核心场景）
- ChatPage 行数从 5724 降到 < 1800
- `apps/web/src/components/chat/*` 不再 import `pages/chat-page/`
- 新建 `components/session-conversation/runtime/*` 不 import `pages/chat-page/`（单向依赖：chat-page → session-conversation）

#### 1.5 风险与缓解

| 风险                                    | 缓解                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| 62 个 useState 拆分容易漏               | 按 A/B/C/D 分类逐项 review，每类完成做一次回归测试                             |
| 反向 import 改起来量大                  | 用 `smartRelocate` 一次性迁，自动更新引用                                      |
| chat-only state 通过 slot 注入难度大    | slot 失败的项先放回 ChatPage，等 Phase 1 后再优化                              |
| useChatQueueStore 的 scope key 复用问题 | 已经是 `${email}:${sessionId}`，team session 的 sessionId 来自同一张表不会冲突 |

### Phase 2a：team 只读模式接入（3-5 天）

**目的**：team 在 ConversationArea 中"看选中 session 的执行流"，但 composer 暂时 disabled。

#### 2a.1 改造点

1. `TeamPageV2` 增加 `activeSessionId` 状态（来自当前 c/d/e/f/g 哪个 session 被选中）
2. `ConversationArea.tsx`：
   - `activeSessionId` 存在 → `<SessionConversationView sessionId={activeSessionId} sessionSource="team" composerDisabled />`
   - 不存在 → 现有 EmptyState + push messages 流
3. 注入 team 特有 chrome：
   - `topBar`：基于 `roleLayer + handoff_state` 渲染状态徽章
   - `afterMessages`：保留现有 `PushMessageCard` 推送队列

#### 2a.2 后端配套（A1）

`POST /team/sessions` 实现里：

```ts
// 伪代码
const roleDefaults = getRoleLayerDefaults(roleLayer); // 来自 agent-catalog
const metadata = {
  ...input.metadata,
  defaultProvider: roleDefaults.providerId,
  defaultModel: roleDefaults.modelId,
  dialogueMode: 'coding', // team 默认
  // ... 其他 chat 启动时需要的字段
};
```

实施位置：`services/agent-gateway/src/handoff/team-session-create.ts` 或路由 handler 内。

#### 2a.3 验收

- team 中点开任意 b/c/pm1/pm2/executor/reviewer session
- 可看到完整消息流（含 reasoning / tool call / file diff / permission inline）
- composer 显示但 disabled，提示"该会话正在执行中，请通过 b 与团队对话"
- handoff 状态变化时 topBar 徽章实时更新

### Phase 2b：L1.3 inbound_messages 协议落地（1-2 周，可独立后做）

**目的**：让 team 用户能直接在 SessionConversationView 里向 c session 提交 clarification answer。

#### 2b.1 后端

1. Migration：
   ```sql
   CREATE TABLE session_inbound_messages (
     id TEXT PRIMARY KEY,
     target_session_id TEXT NOT NULL,
     source_layer TEXT NOT NULL,
     message_type TEXT NOT NULL,
     payload_json TEXT NOT NULL,
     state TEXT NOT NULL DEFAULT 'pending',
     created_at INTEGER NOT NULL,
     consumed_at INTEGER
   );
   CREATE INDEX idx_inbound_target_state ON session_inbound_messages(target_session_id, state);
   ```
2. 新端点：
   - `POST /team/sessions/:sessionId/inbound-messages`
   - `GET /team/sessions/:sessionId/inbound-messages?state=pending`（c session 内部 LLM 循环消费用）
3. c/d/e/f/g 各 layer runner 在 LLM 循环里消费 pending inbound messages
4. team-events bus 增 event type：`session.inbound-message-created`

#### 2b.2 前端

1. UnifiedComposer 增加 `submitMode: 'stream' | 'inbound'` 区分
2. `sessionSource === 'team'` 时 `submitMode = 'inbound'`
3. 解除 `composerDisabled`

#### 2b.3 验收

- team 中 c 处于 substate=clarifying 时，用户在 composer 输入答案
- 答案以 inbound message 落库，c 在下一轮 LLM 循环中消费
- `WS /team-events` 推送 `session.inbound-message-created` 给 b，b 决定是否打断陪聊

### Phase 2c：substate 子状态机展示（按需做）

**目的**：在 team 的 SessionConversationView topBar 显示"c.drafting_spec → c.spec_ready → c.clarifying"等进度。

#### 2c.1 后端

1. Migration：`ALTER TABLE sessions ADD COLUMN substate TEXT; ADD COLUMN substate_updated_at INTEGER;`
2. team-events bus 增 event type：`session.substate-changed`
3. 各 layer runner 在子步骤切换时 `UPDATE sessions SET substate = ?` + 推送事件

#### 2c.2 前端

1. team 这边写一个 `<TeamSubstateProgressBar sessionId={...}/>`
2. 通过 `topBar` slot 注入 SessionConversationView

### Phase 3：上抬到 packages（暂不做）

仅当出现第三个消费方（mobile / desktop）时才做。把 `apps/web/src/components/session-conversation/` 整体搬到 `packages/session-conversation` 或 `packages/shared-ui` 子目录。

---

## 5. 已锁定的决策

> 2026-05-16 v1.2：以下决策已经达成共识。修改需走文档 §8 流程。

### 5.1 已锁定（v1.2）

| 编号                         | 决策内容                                                                                                                                                                                                                                                                                    | 含义                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **D1（原 A1 实施方）**       | `POST /team/sessions` 创建时自动注入 `defaultProvider/defaultModel/dialogueMode` 到 metadata 的工作，**与 Phase 2b 同 PR 一起做**（不再随 Phase 2a 提前）。理由：Phase 2a composer disabled，metadata 中的 provider/model/dialogueMode 默认值对 team 端没有实际作用——读出来也不显示在 UI 上 | metadata 注入推迟到 Phase 2b，那时 composer 启用，metadata 默认值才有意义                                           |
| **D2（原 A2 共识）**         | team 接入 SessionConversationView 时 **composer 默认 disabled**，等 Phase 2b 落地后再开                                                                                                                                                                                                     | Phase 2a 的 SessionConversationView `composerDisabled = true`；UI 显示但提示"该会话正在执行中，请通过 b 与团队对话" |
| **D3（原 Phase 2b 优先级）** | Phase 2b（L1.3 inbound_messages 协议）**不立即排期**，等 Phase 2a 上线观察 1-2 周后再排                                                                                                                                                                                                     | 给团队留时间验证只读复用是否真减少了 team 的视图工作量；同时 L1.3 spec 改造 1+3+4 由 L1.3 团队主导，本方案只接入    |
| **D4（v1.2 修订）**          | **不做 hook v1.0 完整内化**。Phase 2a 用 v0.1 骨架版 hook + chat 端继续用 ChatPage 现有 hook 链路（不切走）。Phase 2b 启动时只给 hook 增加 inbound writer 能力（~50 行），不下放 chat stream 协议——这与 L1.3 §0.A.4 规定的"team 反向通道走 inbound_messages 不走 chat stream"对齐           | 避免让 team 学坏 chat 的写入协议，保持各自协议清晰                                                                  |

### 5.2 暂未拍板（按需触发）

- **Phase 2c 触发条件**：等 c/d 各 layer runner 真的开始往 substate 写值时再做。当前 substate 字段都没建（见 L1.3 spec §0.A.2 改造 2）。
- **Phase 3 上抬 packages 触发条件**：等第三个消费方（mobile/desktop）出现时再做。
- **~~Hook v1.0 内化~~**（v1.2 修订：**不再作为 Phase 2 路线图项**）：经过 v1.2 复审，hook v1.0 内化（把 ChatPage 中 stream/attach/recovery 等 chat 业务 hook 搬到 useSessionConversationState）**与 L1.3 设计意图冲突**——L1.3 §0.A.4 规定 team 反向通道走 `session_inbound_messages`，不走 chat stream 协议。让 hook v1.0 内化后给 team 用，等于让 team 学坏 chat 的写入路径。
  - **替代方案**：Phase 2b 启动时仅给 hook 增加 **inbound writer**（约 50 行），让 team composer 提交时调 `POST /team/sessions/:sessionId/inbound-messages`。chat stream 协议保持留在 ChatPage，不下放。
  - **如果有"减肥 ChatPage"需求**：作为独立 chat 重构议题处理，不属于本方案范围。

---

## 5.3 Phase 2b 启动 Checklist（v1.2 新增）

> 当 D3 触发条件满足（Phase 2a 上线 1-2 周观察期结束 + 团队决定排期）时，按以下顺序启动 Phase 2b。

### 5.3.1 后端前置（依赖 L1.3 spec 改造 1+3+4）

- [ ] **改造 1**（`session_inbound_messages` 表）：按 L1.3 spec §1.3.1 的字段命名落地 migration（`to_session_id` / `from_role_layer` / `message_type` / `state` / `payload_json` / `consumed_by_loop_iteration` 等）+ 索引（`idx_inbound_target_pending` / `idx_inbound_cancel`）
- [ ] **改造 3**（c 层等待 inbound 循环）：修改 `services/agent-gateway/src/handoff/artifact-chain.ts`，把 "[NEEDS CLARIFICATION] 推送后不等待回复"改为"进入 substate=clarifying + 等待 inbound clarification_answer"
- [ ] **改造 4**（`handoff_records` 补字段）：按 L1.3 spec §0.A.2 加 `idempotency_key / paused_at / paused_by_user_id / pause_reason` + `idx_handoff_records_idempotency` 索引
- [ ] 新端点 `POST /team/sessions/:sessionId/inbound-messages`：接收前端写入的 inbound message
- [ ] team-events bus 新增 `session.inbound-message-created` 事件类型
- [ ] **D1 metadata 注入**：`POST /team/sessions` 创建时按 `roleLayer` 自动写入 `defaultProvider/defaultModel/dialogueMode` 到 `metadata_json`（来自 `agent-catalog.ts` 中 roleLayer 默认绑定）

### 5.3.2 前端跟进

- [ ] `useSessionConversationState` 升级到 v0.2：从 `recovery.session.metadata_json` 读取 `defaultProvider/defaultModel/dialogueMode` 作为初始值
- [ ] `UnifiedComposer` 增加 `submitMode: 'stream' | 'inbound'` 区分；`sessionSource === 'team'` 时走 `submitMode = 'inbound'`，调 `POST /team/sessions/:sessionId/inbound-messages`
- [ ] `TeamSessionView` 解除 `composerDisabled`（删掉 hint）
- [ ] message_type 由 substate 自动决定：`substate=clarifying` → `clarification_answer`；其他 → `user_input`
- [ ] 给 inbound 写入流加单元测试

### 5.3.3 集成验证

- [ ] team 中创建一个 c session，substate=clarifying 时用户在 composer 输入答案
- [ ] 答案以 inbound message 落库，c 在下一轮 LLM 循环中消费
- [ ] team-events WS 推送 `session.inbound-message-created` 给 b
- [ ] b 决定是否打断陪聊（this 由 b runner 决定，不在本方案）
- [ ] chat 端零回归（ChatPage 仍走 stream，不走 inbound）

### 5.3.4 ~~hook v1.0 触发条件~~（v1.2 修订：移除）

v1.2 修订前曾考虑"是否同步做 hook v1.0 内化"。**经复审已决定不做**——见 §5.2 中的修订说明。

Phase 2b 启动时唯一需要给 hook 增加的能力是 **inbound writer**：

- `useSessionConversationState` 增加 `submitInbound(messageType, payload)` 方法
- 内部调 `POST /team/sessions/:sessionId/inbound-messages`
- `TeamSessionView` 解除 `composerDisabled`，把 `onComposerSubmit` 改为调 `submitInbound('user_input' | 'clarification_answer', { text })`

---

## 6. 与 L1 决策的对齐

| 决策                                            | 本方案对齐方式                                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1.1 五层架构**                               | 五层各自的 session 都通过 SessionConversationView 渲染，无差别                                                                                                              |
| **L1.3 流式 handoff + 子状态机 + 双向消息通道** | substate 通过外层 chrome 的可选 slot 展示；inbound messages 由 Phase 2b 单独实施，不进 SessionConversationView 内部                                                         |
| **L1.4 escape hatch**                           | inbound message 走 `POST /team/sessions/:sessionId/inbound-messages`，由 b 路由层使用，与 SessionConversationView 无关                                                      |
| **L1.6 延迟硬约束 p95 < 3s**                    | UnifiedComposer 现有的 streaming/stoppingStream 状态机已满足；team 的"已开始处理"反馈走 b 的同步对话，不依赖 SessionConversationView                                        |
| **L1.7 handoff_records 独立表**                 | SessionConversationView 不感知 handoff_records，由 team 外层 chrome 通过 `GET /team/sessions/:sessionId/handoffs` 自行展示                                                  |
| **L1.8 sessions 表扩展**                        | 已落地的字段（team_parent_session_id / role_layer / handoff_state / intent_state）由 team 外层 chrome 消费；未落地的 substate / structural_depth / paused 不阻塞 Phase 1/2a |
| **L1.9 BackgroundTaskScheduler**                | 与 SessionConversationView 无关                                                                                                                                             |

---

## 7. 工作量估算

| 阶段                                                                          | 估算       | 实际                                       | 后端依赖                                                    |
| ----------------------------------------------------------------------------- | ---------- | ------------------------------------------ | ----------------------------------------------------------- |
| Phase 0 后端字段对账                                                          | 1-2 天     | ✅ 已完成（约 0.5 天）                     | —                                                           |
| Phase 1 抽离 + chat 内部用                                                    | 2-3 周     | ✅ 已完成（约 1 天，主要靠 smartRelocate） | 0 改动                                                      |
| Phase 2a team 只读接入（前端骨架）                                            | 3-5 天     | ✅ 已完成（约 0.5 天）                     | 0 改动（D1 已推迟到 2b）                                    |
| **Phase 2b 前端契约**（hook v0.2 + inbound writer + roleLayer/substate 透传） | —          | ✅ 已完成（约 1 天）                       | 0 改动（端点未落地，前端契约先行）                          |
| **Phase 2c 前端契约**（substates.ts + TeamSubstateProgressBar）               | —          | ✅ 已完成（约 0.5 天）                     | 0 改动（substate 字段未落地，前端 fallback 到 stateStatus） |
| **关键路径合计**（chat/team 共享对话布局，骨架版 + 前端契约先行）             | **3-4 周** | **约 3 天**                                | —                                                           |
| Phase 2b 后端落地                                                             | 1-2 周     | 待启动                                     | L1.3 改造 1+3+4（团队工作）                                 |
| Phase 2c 后端落地                                                             | 3-5 天     | 待启动                                     | L1.3 改造 2（团队工作）                                     |
| ~~Hook v1.0 内化~~                                                            | ~~1 周~~   | **不做**（D4 v1.2 修订）                   | —                                                           |
| Phase 3 上抬 packages                                                         | 暂不做     | —                                          | —                                                           |

**实际工时显著小于估算**：核心原因是 IDE 的 smartRelocate 工具自动更新跨文件 import，使得文件迁移阶段（Phase 1 §1.1）从"2-3 周"压缩到"半天"。Phase 2b/2c 前端契约也比估算快——因为它们本质是"按 spec 写类型 + 写 client + 写 hook 方法 + 写测试"，没有任何业务逻辑。

**剩余工作全部在后端**：L1.3 改造 1+2+3+4（13.5 天，由后端开发完成）。前端在 Phase 2b/2c 后端落地后**无需改动**即可工作（hook 已经 transparent 透传 sessions.role_layer/substate；submitInbound 已经按 spec 调对应端点）。

---

## 9. v1.4 增量（260517）：UI 链路统一

> v1.3 完成「TeamPageV2 → ConversationArea → TeamSessionView」单一入口；v1.4 把
> 整个 team 页面里所有"对话型"视图都对齐到 chat 渲染。

### 9.1 主对话区默认 reception 渲染

- `useResolvedTeamRuntimeReferenceData` 暴露新字段 `defaultReceptionSessionId`：
  当前 workspace 中第一个 `parentSessionId == null` 的根会话即视作 b session。
- `ConversationArea` 重写为三态路径：
  1. `messagesOverride` 注入 → pass-through（保留对话 tab 选中具体子 session 的能力）
  2. `receptionSessionId` 存在 → 内嵌 `<TeamSessionView/>` 渲染主对话流
  3. 都没有 → idle/loading/error 引导面板
- 旧的 `ConversationCard` 自定义渲染、内置 textarea、`MOCK_PUSH_MESSAGES` 全部删除。
- `team-events` 推送的通知卡片改为通过 `SessionConversationView.afterMessages` slot
  注入，不再侵入 LLM 主消息流。

### 9.2 层级对话双栏化

- `LayeredConversationView` 从单栏 timeline 升级为左 timeline / 右 TeamSessionView。
- 点击 timeline 行选中对应 to_session，右栏即时切到该 session 的 chat 渲染。
- 抽屉版 `LayerConversationDrawer` 同步升级：选中非 reviewer 层级时直接内嵌
  `<TeamSessionView/>`（之前只展示 sessionId/state 元数据），与 tab 双栏右侧
  视觉一致；reviewer 层仍走 `<ReviewReportView/>` 独立 layout。

### 9.3 消息总线视觉对齐

- `MessagesTab`（消息总线）的卡片 body 从纯文本切到 `MarkdownMessageContent`
  渲染，回复 / 广播片段同步 markdown 化。代码块、链接、内联格式与 chat 端一致。
- `MentionsView`（待回复 / @ 我的）的通知 body 同步换 `MarkdownMessageContent`，
  让团队推送的提醒文案与主 chat 流保持同样的字体 / 链接 / 内联格式样式。
- 协议保留：MessagesTab / MentionsView 仍读 team-events 总线消息，写入仍走
  `sendMessage`，不接 inbound 端点（这条线属于"控制平面信令"，与 LLM session
  消息正交）。

### 9.4 Phase 2b 前端 composer 接入

- `TeamSessionView` 增加 `composerEnabled?: boolean`（默认 false 与 D2 对齐）。
- 启用后 `onComposerSubmit` 调 `submitInbound(messageType, payload)`：
  - `state.substate === 'clarifying'` → `clarification_answer`
  - 其他 → `user_input`
- 提交完成后自动 `state.reload()`，让最新落库的消息出现在视图里。
- TeamPageV2 用 `localStorage['teamV2.inboundComposer.enabled']==='1'` 作为
  feature flag。后端 L1.3 改造完成后，把 flag 默认值切到 `'1'` 即可面向所有用户开放。

### 9.5 V1 路径标记弃用

- `MainWorkspace.tsx` / `tabs/conversation/ConversationTab.tsx` 添加 `@deprecated`
  注释，明确这些只为 V1 fallback 保留；V2 合稳后随 fallback 一并删除。

### 9.6 v1.4 验收

- `pnpm --filter @openAwork/web typecheck` ✅
- `pnpm --filter @openAwork/web test` 408/408 ✅
  - 新增 `ConversationArea.test.tsx`（5 tests）覆盖三态路由
  - 新增 `LayeredConversationView.test.tsx`（4 tests）覆盖 timeline 行点击 → 右栏 TeamSessionView
- 用户进 `/team/<workspace>` 第一眼即 chat 视觉（不再是卡片 mock）
- 「对话 / 层级」子 tab 切到具体 handoff 时右栏即时渲染 chat 对话
- 顶部 LayerConversationDrawer 抽屉非 reviewer 层同步用 chat 渲染
- 「对话 / 消息」总线 + 「对话 / 待回复」MentionsView 卡片代码 / 链接 / 列表与 chat 端样式一致
- 设置 feature flag 后，team composer 解锁并通过 inbound 通道写入

---

## 8. 文档约束

- 本方案修改影响 chat 与 team 两端，任何调整必须同步本文档
- Phase 1 启动前 `chat-conversation-reuse-plan.md` 必须 review 通过
- 每个 Phase 退出时在本文档对应章节追加"实际工作量 / 偏差原因 / 后续修订"
- Phase 1/2a/2b/2c 各自独立 PR，PR 描述引用本文档对应章节
