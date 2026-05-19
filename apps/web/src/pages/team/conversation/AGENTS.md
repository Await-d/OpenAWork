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
    └── TeamSubstateProgressBar.tsx
```

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
