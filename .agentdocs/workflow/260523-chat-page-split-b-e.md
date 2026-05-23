# ChatPage 域 B/E 收尾实施

## Task Overview
完成 `docs/architecture/chat-page-split-plan.md` 中剩余的 ChatPage 流式域（B）收尾，并同步校正域 E 的接入/测试/计划状态。

## Current Analysis
- 计划文档仍标记 B/E 待排期，但仓库里 `use-chat-retry-and-edit.ts` 已存在并被 `ChatPage.tsx` 接入。
- 真正未收口的大头是 `ChatPage.tsx` 内的流式状态、send/stop/attach 协调与相关 refs。
- 目标是把 ChatPage 继续压薄到“组装层”，同时保持行为不变。

## Solution Design
- 以 `conversation/render/use-chat-streaming.ts` 为核心承接域 B，必要时扩展其公开 API。
- 保持域 A/C/D 的既有边界不动，仅改 ChatPage 的组装与流式接线。
- 补齐域 E 的测试与文档同步，避免计划与实现脱节。

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: yes → +2
- Modules/systems/services: 3+ → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 牵涉 ChatPage、streaming hooks、tests、docs/agentdocs 多处协同，且需分阶段验证。

## Implementation Plan

### Phase 1: 收敛流式域边界
- [ ] T-01: 盘点 ChatPage 内流式 state/ref/effect/send/stop 归属
- [ ] T-02: 设计/扩展 `useChatStreaming` 的公开接口

### Phase 2: 代码迁移
- [x] T-03: 将流式 state/ref/reset/stop 的稳定边界抽出到 hook
- [ ] T-04: 继续抽离 sendMessage 主体并精简 ChatPage

### Phase 3: 测试与同步
- [ ] T-05: 补充/修正域 B/E 对应测试
- [ ] T-06: 更新 plan、AGENTS、agentdocs 索引状态

## Notes
- 已将 ChatPage 的流式状态/refs 迁入 `useChatStreaming`，并继续保留 attach/recovery effect 在页面内协调。
- 已新增 `use-chat-stop-active-message.ts`，把 `stopActiveMessage` 从 `ChatPage.tsx` 抽成页面级命令 hook。
- 已新增 `use-chat-branch-session.ts`，把 `createBranchSessionFromMessage` 从 `ChatPage.tsx` 抽成独立 hook，供域 E 复用。
- 已新增 `conversation/composer/prepare-standard-chat-send-input.ts`，把标准聊天附件上传 / 图片输入映射 / 文本摘要追加从 `sendMessage` 主体中抽离。
- 已新增 `conversation/composer/prepare-image-generation-input.ts`，把图片生成分支的参考图 / 上传图映射准备从 `sendMessage` 主体中抽离。
- 已新增 `conversation/composer/submit-image-generation.ts`，把图片生成分支的提交收尾（用户消息落地 / 生成调用 / 成功反馈 / 失败回填）从 `sendMessage` 主体中抽离。
- 已新增 `conversation/composer/start-standard-chat-stream.ts`，把标准流式发送前的 refs 重置 / 批量状态初始化 / 用户消息落地从 `sendMessage` 主体中抽离。
- 已新增 `conversation/render/build-stream-assistant-trace.ts`，把标准流式 / attach 的 assistant trace 构造逻辑统一抽出。
- 已新增 `conversation/render/commit-streaming-round.ts`，把标准流式 / attach 的 round commit 重复逻辑统一抽出。
- 已新增 `conversation/render/apply-stream-tool-event.ts`，把标准流式 / attach 的 `tool_progress` / `tool_result` 状态归一化与 segment 更新统一抽出。
- 已新增 `conversation/render/handle-pending-interaction-event.ts`，把标准流式 / attach 的 permission / question 事件暂停与刷新协调统一抽出。
- 已新增 `conversation/render/apply-session-runtime-event.ts`，把标准流式 / attach 的 `session_child` / `task_update` 列表合并逻辑统一抽出。
- 已新增 `conversation/render/finalize-stream-message.ts`，把标准流式 / attach 的 onDone / onError 最终 assistant message 收尾统一抽出。
- 已新增 `conversation/render/detect-terminal-dev-server.ts`，把标准流式 / attach 的 terminal dev-server 探测逻辑统一抽出。
- 已补齐 `use-chat-streaming.test.tsx` 与 `use-chat-retry-and-edit.test.tsx`。
- 已补齐 `use-chat-stop-active-message.test.tsx`，覆盖 best-effort 停止失败与 precise 停止异常两条边界。
- 已补齐 `use-chat-branch-session.test.tsx`，覆盖“只切分支会话”和“分支后立即发送”两条分支。
- 已补齐 `prepare-standard-chat-send-input.test.ts`，覆盖 existingInputParts 回退与附件摘要/图片输入映射。
- 已补齐 `prepare-image-generation-input.test.ts`，覆盖会话参考图映射与上传图片映射。
- 已补齐 `submit-image-generation.test.ts`，覆盖成功路径与失败回填路径。
- 已补齐 `start-standard-chat-stream.test.ts`，覆盖标准流式启动初始化与“上传了 N 张图片”展示文案。
- 已补齐 `build-stream-assistant-trace.test.ts`，覆盖基础 trace 与 tool call 状态归一化。
- 已补齐 `commit-streaming-round.test.ts`，覆盖空内容短路与成功提交后的重置状态。
- 已补齐 `apply-stream-tool-event.test.ts`，覆盖 batch progress 写入与 tool result 更新。
- 已补齐 `handle-pending-interaction-event.test.ts`，覆盖 permission_asked 暂停与 question_replied 恢复路径。
- 已补齐 `apply-session-runtime-event.test.ts`，覆盖子会话插入/更新与任务状态归一化。
- 已补齐 `finalize-stream-message.test.ts`，覆盖 assistant 最终消息提交与首 token latency 挂载。
- 已补齐 `detect-terminal-dev-server.test.ts`，覆盖非 dev-server 启动命令与 URL 探测命中路径。
- 验证：`lsp_diagnostics`、`pnpm --filter @openAwork/web typecheck`、`pnpm --filter @openAwork/web build`、`pnpm --filter @openAwork/desktop exec vite build`、新增 vitest 用例均通过。
- 域 B/E 计划内拆分已完成：流式状态、tool/pending/session 事件、图片/标准 composer、branch/retry/stop、completion/error、terminal 探测均已抽离；剩余仅是有意保留在页面内的少量会话刷新与 attach/retry 外壳协调。
