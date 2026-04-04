# 260404 Chat 真正续流 resume 协议设计

## Task Overview

在已完成的一阶段“基于 `session.runEvents` 的恢复展示”之上，继续产出一份可直接指导后续实施的二阶段技术设计：让 Chat 在刷新、弱网重连、重新进入会话时，真正重新附着到当前活跃 request，而不是只做快照驱动的伪流式展示。

## Current Analysis

- `services/agent-gateway/src/session-run-events.ts` 已按 `session_id + client_request_id + seq` 持久化 run events，但对外只提供全 request 列表，没有按 cursor 续传能力。
- `services/agent-gateway/src/session-runtime-thread-store.ts` 已持久化当前活跃 request 的 `client_request_id + heartbeat`，但只暴露 `hasFreshSessionRuntimeThread(...)` 布尔判断，无法直接支撑 attach handshake。
- `packages/shared/src/index.ts` 与 `services/agent-gateway/src/run-event-envelope.ts` 已经有 `RunEventCursor / RunEventEnvelope` 这些协议积木，但当前流式路由没有真正用它们做 attach wire contract。
- `apps/web/src/hooks/useGatewayClient.ts` 已把 `active stream` 最小快照持久化到 `sessionStorage`，说明浏览器侧恢复状态已有锚点，但还缺 `lastSeq / lastEventId`。

## Solution Design

### 核心决策

1. **把“发起新请求”和“附着已有请求”拆成两条协议**：保留现有 `/stream` 与 `/stream/sse` 负责发起请求，新增 attach-only SSE 路由负责 resume / reattach。
2. **续流真相源固定为 `RunEventCursor(clientRequestId, seq)`**，不再依赖“前端猜当前运行到哪了”。
3. **二阶段 MVP 只做 SSE attach**：浏览器刷新场景只需要 server → client 的事件恢复，不需要在附着连接里重新发送消息。
4. **一阶段 snapshot recovery 继续保留为兜底层**：attach 失败时不退回到“完全无流”，而是继续使用当前已经实现的恢复展示。

### 交付物

- 正式设计文档：`docs/chat-stream-resume-protocol.md`
- 设计内含：路由草案、cursor 语义、wire format、前端恢复顺序、冲突分支、阶段实施顺序与验证矩阵

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 协议梳理 + 前后端接线点分析 + 设计文档产出 → +2
- Modules/systems/services: web + web-client + agent-gateway + shared → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是一个跨协议、存储、前端恢复与控制能力的系统性演进设计，必须输出持久化审阅文档并明确阶段边界，避免把“恢复展示”误当成“真正续流”。

## Implementation Plan

### Phase 1：协议冻结
- [x] T-01：核对 `session_run_events / session_runtime_threads / RunEventEnvelope` 的现状与缺口
- [x] T-02：确定 attach-only 路由与 cursor 语义
- [x] T-03：确定前端恢复顺序与 attach 失败降级策略

### Phase 2：设计文档产出
- [x] T-04：写出正式协议设计文档
- [x] T-05：明确阶段实施顺序与验证矩阵
- [x] T-06：沉淀 durable architecture decision / pitfall

## Notes

- 二阶段最重要的边界是：**不要把 attach 逻辑硬塞进现有“创建请求”的 SSE 路由**，否则浏览器重连时极易引入重复发送。
- 当前最具性价比的路线是：`/stream/active` handshake + `/stream/attach` attach-only SSE + `RunEventCursor(clientRequestId, seq)`。
- 主设计文档已落在 `docs/chat-stream-resume-protocol.md`。
- Memory sync: completed
