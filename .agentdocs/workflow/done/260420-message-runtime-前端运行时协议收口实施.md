# .agentdocs/workflow/260420-message-runtime-前端运行时协议收口实施.md

## Task Overview
- 目标：继续处理剩余高优先级差异中“前端运行时协议是否充当第二真相源”的问题，收口 `assistant_trace + RunEventEnvelope + chat-stream-state` 与 canonical message/read model 的边界。
- 范围：`apps/web`、`packages/web-client`、`services/agent-gateway` 中与实时事件、恢复回放、assistant trace 重建相关的链路。
- 非目标：不推翻现有流式协议，不一次性重写 chat 页状态机，不改无关 UI 组件样式。

## Current Analysis
- sender/read/tool-state/compaction 主线已经收口，但前端仍大量依赖：
  - `assistant_trace`
  - `RunEventEnvelope`
  - `chat-stream-state.ts`
  - `support.ts` 中的 transcript/trace 重建逻辑
- 如果这些结构不仅是 transport/view，而仍承担消息树重建或 tool-state 合成，就会形成第二真相源，导致：
  - 持久层 message/read model 与前端看到的 transcript 分叉
  - replay/attach/live flush 的状态不一致
  - assistant trace 与 canonical message/part 漂移

## Solution Design
- 目标不是删除 `assistant_trace` 或 `RunEventEnvelope`，而是把它们降级成 transport/view 层。
- 预期方向：
  1. 重新钉死前端运行时协议与 canonical message/read model 的边界
  2. 找出 browser 当前仍自行重建消息树/工具状态的路径
  3. 把这些路径收口为“消费 canonical read model + runtime event 补丁”，而不是第二真相源
  4. 用 stream/attach/recovery 的回归矩阵验证不破坏现有协议

## Complexity Assessment
- Atomic steps: 5+（runtime 协议钉死、消费点排查、收口实现、回归矩阵、兼容边界）→ +2
- Parallel streams: 是（apps/web、web-client、gateway 协议面可并行）→ +2
- Modules/systems/services: 3+（apps/web、packages/web-client、services/agent-gateway）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是 sender/read 主线收口后的剩余高优先级结构问题，必须把前端协议边界、风险与实施顺序持久化下来，避免 UI/runtime 与 canonical message 再次分叉。

## Implementation Plan

### Phase 1: 前端运行时协议边界重新钉死
- [x] T-01: 重新确定 `assistant_trace` / `RunEventEnvelope` / `chat-stream-state` 在当前架构中的角色边界 ✅
- [x] T-02: 盘点 browser 端仍自行重建消息树/工具状态的消费点 ✅

### Phase 2: 最小结构收口
- [x] T-03: 实施前端第二真相源最小收口 ✅
- [x] T-04: 实施 replay/attach/live flush 边界对齐 ✅

### Phase 3: 验证与归档
- [x] T-05: 跑前端运行时协议相关定向回归 ✅
- [x] T-06: 跑 build/test 并同步 agentdocs ✅

## Notes
- Can split? 可以，至少可拆成两条流：A) browser runtime 协议消费点；B) gateway replay/attach 与 canonical read model 的桥接点。
- Should split? 应该拆。这样可以分别验证 transport 协议和 read-model 边界，不把 UI 与 sender/read 主线重新耦合在一起。
- Dependency order:
  - T-01/T-02 → T-03/T-04
  - T-03/T-04 → T-05 → T-06
- 当前用户已明确要求继续执行，不停留在分析层。
- canonical 结论：
  - `packages/web-client` 继续只是 transport，`RunEventEnvelope` 是运输信封，不是消息树真相源。
  - `chat-stream-state.ts` 继续只承担 runtime overlay / 右侧面板状态，不应承担 canonical transcript 重建。
  - `assistant_trace` 继续保留为兼容/投影视图，但前端内部读取 assistant 消息时应优先读取 `ChatMessage.parts`，只在缺少 parts 时 fallback 到 `content`。
- 本轮已落地的最小收口：
  - `apps/web/src/pages/chat-page/support.ts` 新增/推进 `readAssistantTracePayload(message)` 作为前端内部读取 assistant 消息的统一入口，优先 `parts-first`。
  - `use-chat-render-data.ts`、`stream-recovery.ts`、`use-chat-message-actions.ts`、`chat-message-group-list.tsx`、`virtualized-chat-group-list.tsx` 均已改成优先基于 `ChatMessage` 本身而不是直接 `parseAssistantTraceContent(message.content)`。
  - `ChatPageSections.tsx` 已支持 `renderStreamingChatMessageContentWithOptions(message)`，在拿到 `ChatMessage` 时会优先走 `parts-first`。
  - `ChatPage.tsx` 本地 streaming/attach assistant message 不再把 `assistant_trace` JSON 写进 `message.content`；现在 `parts` 是结构真相，`content` 只保留可读文本。
  - replay/attach/live flush 的边界因此变成：canonical snapshot/read model 是事实层；runtime overlay 只负责活跃 run 的临时显示。
- 本轮修改文件：
  - `apps/web/src/pages/chat-page/support.ts`
  - `apps/web/src/pages/chat-page/use-chat-render-data.ts`
  - `apps/web/src/pages/chat-page/stream-recovery.ts`
  - `apps/web/src/pages/chat-page/use-chat-message-actions.ts`
  - `apps/web/src/components/chat/ChatPageSections.tsx`
  - `apps/web/src/components/chat/chat-message-group-list.tsx`
  - `apps/web/src/components/chat/virtualized-chat-group-list.tsx`
  - `apps/web/src/pages/ChatPage.tsx`
- 本轮验证证据：
  - `pnpm --filter @openAwork/web build` ✅
  - `pnpm --filter @openAwork/web exec vitest run src/components/chat/ChatPageSections.test.tsx` ✅
  - `pnpm --filter @openAwork/web exec vitest run` ✅

## Completion
- T-01 ~ T-06 已全部完成。
- 这轮收口的结果是：前端 runtime 协议继续保留，但被压回 transport/view 层；assistant message 的内部读取与流式临时消息开始以 `parts` 为真相源。
