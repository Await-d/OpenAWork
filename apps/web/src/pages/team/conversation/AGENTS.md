# team/conversation · team 端对话装配

> team 产品独占的对话视图 + state hook + team-only chrome（TeamSubstateProgressBar / TeamSessionHeader / TeamSessionEmptyState）+ 提交路由（stream / inbound / handoff）。

## 产权

- **所属人**：team 产品（TeamPageV2.tsx / ConversationArea / LayerConversationDrawer 等业务壳）
- **演进策略**：可自由演进，不受 chat 端约束。

## 目录约定

```
team/conversation/
├── TeamConversationView.tsx              对话视图入口（adapter 壳，调 useTeamConversationState）
├── TeamConversationLayout.tsx            哑视图层（消息列表 + composer + chrome slots，是 ChatConversationView 的独立副本）
├── use-team-conversation-state.ts        state hook
├── submit/                               提交路由
│   ├── team-submit-router.ts             resolveTeamSubmitStrategy（stream / inbound / handoff）
│   └── team-submit-router.test.ts
└── extras/                               team-only 装饰组件
    ├── TeamSessionEmptyState.tsx
    ├── TeamSessionHeader.tsx
    ├── TeamSubstateProgressBar.tsx
    ├── TeamMultiLayerCardWall.tsx        「角色窗口墙」：一个角色实例一张卡的层级泳道
    ├── team-layer-messages.ts            LayerMessages 契约 + 生命周期装配纯函数
    ├── card-wall-expanded-state.ts       卡片展开态的 localStorage 持久化（按会话分键）
    └── TeamMultiLayerFeed.tsx            与卡片墙并列的合并消息流视图
```

## 角色窗口墙（TeamMultiLayerCardWall）的几个硬约束

- **稀疏层级并排**：接待层与规划层（`COMPACT_LANE_LAYERS`）几乎只会有一个实例，实例数 ≤1 时
  并到同一行左右各占一半（单元格带 `data-compact-lane`），实例 ≥2 自动回落为整行泳道。
  并排只是布局合并，层级顺序（文档流）仍是 reception → pm1 → …，不改变泳道语义。
  但并排的单元格 basis = `CARD_WIDTH`：**两半各自都要放得下一张同宽卡片才并排**，
  面板不够宽时自动折成上下两行 —— 否则上半屏 280px、下半屏 560px 两种卡型会同时出现在一屏里。
- **卡片是「基准宽 + 等分剩余 + 上限」**：`CARD_WIDTH = 336` 是 flex-basis（不是硬宽度），
  泳道内 flex-wrap 折行、剩余横向空间由卡片等分吸收，单卡上限 `CARD_MAX_WIDTH = 448`。
  不要再写死一个 px 宽度：窄面板会挤、宽面板会留大片空白。
  但**高度**必须是定值（折叠态 `COLLAPSED_BODY_HEIGHT`）—— 高矮不齐会把墙面拉成参差的便签墙。
- **折叠态只显示「最新一条消息的一行」**：走 `getTeamMessagePreviewText` 的纯文本预览
  （去 markdown 标记、归纳 JSON、单行省略），不渲染 markdown、不显示角色标签与时间戳 ——
  这些细节只在展开态出现。`COLLAPSED_BODY_HEIGHT` 就是这一行的高度，不要再加回去。
- **卡片边界靠背景层级 + `--shadow-sm`，不描边**：高亮 / 终态用内描边
  （`boxShadow: inset 0 0 0 1px …`）。不要写 `borderStyle: 'dashed'` —— 没同时给 borderWidth
  时浏览器会按默认 `medium` 渲染成 3px 粗虚线，和「活着」的卡片对比会非常刺眼。
- **按钮不要写内联 `background`**：内联样式优先于 CSS，会直接压掉 `.team-v2-control` 的
  hover / active / focus-visible 规则，按钮就退化成「点了没反馈」的静态色块。
  底色交给 `team-v2-control--surface` 变体，见 `runtime/styles/team-runtime.css`。
- **泳道 meta 必须保持单一文本节点**：testing-library 的 `getNodeText` 只拼接**直接文本子节点**，
  把「第 N 层」「主会话所在层」拆进不同 `<span>` 会让 `/第 4 层.*主会话所在层/` 之类的既有断言直接失效。
- **底栏只放动作**：消息条数在身份头副行；底栏不要再放一个和头部按钮同义的「展开 / 收起」。

- **终态展示**：实例结束/关闭后卡片**不消失**，切终态展示态（已完成/已失败/已取消 + 结束时间）。
  判定「结束」只能走 handoff 记录（`sessions.state_status` 表达不了结束），且：
  - 归属只能用 `handoff.toSessionId` —— 回落 `sessionId` 会把上游接待层根会话误标成已取消；
  - 一个实例可能有多条 handoff（回收重试），只有最近一条是终态才算结束。
    两条规则都在 `team-layer-messages.ts` 的纯函数里，改动前先看它的注释。
- **权限条放在消息区之外**：折叠态消息区只有约 3 行高且 `overflow: hidden`，权限条塞进消息流
  会被直接裁掉；权限请求是必须被看见、必须被处置的。
- **权限按 `sessionId` 归位**：网关恢复接口返回整棵子树的待处理权限，不过滤就会在每张卡片上
  重复渲染同一个请求。
- **`onOpenSession` 由外壳注入**：卡片墙不猜「打开完整会话」意味着什么。外壳（TeamPageV2）
  实现为打开底部 `LayerConversationDrawer` 并聚焦该实例，刻意**不**切 `selectedTeamId` ——
  角色实例是子会话，通常不在 `workspaceGroups` 里，切过去会破坏整页 runtime 的作用域不变式。

## 依赖约束（关键）

- ❌ **禁止** import `pages/chat-page/**`（chat 是平级产品，不互引）
  - **历史例外**（260518 解耦方案落地时的过渡状态，**新代码不应引入新跨引**）：
    - `TeamConversationLayout.tsx` import：
      - `pages/chat-page/conversation/render/image-edit-reference-artifacts`（type-only：`ImageEditReferenceArtifact`，chat-only image edit feature 的 type，team 端永远传 null）
      - `pages/chat-page/conversation/views/history-edit-dialog`（chat-only 对话框，team 端传 `historyEditPrompt={null}` 不会渲染内容）
      - `pages/chat-page/conversation/views/retry-mode-dialog`（chat-only 对话框，team 端传 `retryPrompt={null}` 不会渲染内容）

    这 3 处剩余跨引都是 chat-only feature 的对话框 / 类型实体，不是协议工具。team 端永远传 null，运行时无影响。后续 audit 时若 Layout 做更彻底的改造（拆分能力开关或彻底 fork 副本），可以彻底剥离。

  - **已下沉的协议工具（不再跨引）**：
    - `groupChatRenderEntries` → `components/conversation-runtime/messages/group-render-entries.ts`
    - scroll 常量 → `components/conversation-runtime/scroll/scroll-constants.ts`

- ✅ **允许** import `components/conversation-runtime/**`（共享协议层）
- ✅ **允许** import `components/chat/**`（共享 atoms：UnifiedComposer / ChatMessageGroupList / InlineQuestionPanel / chat-search-overlay 等）
- ✅ **允许** import `pages/team/**`（同产品的 team runtime / shell / tabs / stores）

## 演进规则

- 增加 team-only feature（handoff 卡片 / 层级折叠 / agent 泳道等）：
  - 改动只发生在本目录与 `pages/team/runtime/`
  - 不需要通知 chat
- 提交路由调整（stream / inbound / handoff 之间增加新 messageType）：
  - 在 `submit/team-submit-router.ts` 添加新 case，并加 `team-submit-router.test.ts` 测试
  - 同步检查 `useTeamConversationState.submitInbound` 类型是否需要扩展（取决于 backend 是否落地新 inbound type）
- 改动协议层（流式 / 滚动 / attach）：
  - 只能在 `components/conversation-runtime/` 改，不要 fork 一份到本目录
  - 同步通知 chat

## 关联文档

- `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` §6.4
- `docs/chat-conversation-reuse-plan.md` v1.5 D5 决策
- `docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.3
