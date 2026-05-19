# Chat 真正续流协议（二阶段 resume / reattach 设计）

## 1. 背景

当前仓库已经具备一条务实可用的一阶段修复：

- 后端把 `RunEvent` 持久化到 `session_run_events`
- Web 在刷新/重新进入会话时，能够从 `/sessions/:sessionId` 返回的 `runEvents + state_status` 中恢复“正在生成中的可见内容”

这解决了“刷新后完全看不到流式内容”的问题，但仍然不是**真正的续流**：

1. 页面只能看到“持久化后”的增量，而不是重新接回原始实时流；
2. 浏览器刷新后通常丢失原始 `clientRequestId` 句柄，无法稳定恢复 `precise stop`；
3. 现有 `/stream` / `/stream/sse` 路由本质上是“发起新请求”的入口，不是“附着已有运行”的入口。

本设计文档定义二阶段目标：在不推翻现有架构的前提下，为 OpenAWork 增加**真正的 resume / reattach 协议**。

## 2. 当前基线（代码事实）

### 2.1 已有可复用能力

- `services/agent-gateway/src/session-run-events.ts`
  - 已按 `session_id + client_request_id + seq` 持久化 `RunEvent`
  - 已有 `listSessionRunEventsByRequest(...)`
- `services/agent-gateway/src/session-runtime-thread-store.ts`
  - 已维护当前活跃 request 的 `client_request_id + started_at_ms + heartbeat_at_ms`
  - 当前只有 `hasFreshSessionRuntimeThread(...)`，还没有对外暴露详细 runtime thread 读模型
- `packages/shared/src/index.ts`
  - 已定义 `RunEventCursor`
  - 已定义 `RunEventEnvelope`
- `services/agent-gateway/src/run-event-envelope.ts`
  - 已有 `buildRunEventEnvelope(...)`
  - 已能为 `done/error/permission/question` 导出 `bookend`
- `apps/web/src/hooks/useGatewayClient.ts`
  - 已将当前活跃流最小快照持久化到 `sessionStorage`
  - 当前快照只包含 `sessionId / clientRequestId / startedAt`，不包含 cursor

### 2.2 当前缺口

- `packages/web-client/src/gateway-sse.ts` 与 `gateway-ws.ts`
  - 只支持“创建一次新流”
  - 不支持“附着已有流”
- `services/agent-gateway/src/routes/stream-routes-plugin.ts`
  - `/sessions/:id/stream`（WS）与 `/sessions/:id/stream/sse`（SSE）都是“新请求入口”
  - 没有 attach-only 路由
- `services/agent-gateway/src/routes/stream.ts`
  - durable replay 主要用于“同请求 replay”或终态 replay
  - 没有“从 cursor 继续订阅活跃 request”的能力

## 3. 目标与非目标

### 3.1 目标

1. 刷新页面后，如果原会话仍在运行，前端能够重新接回该 request 的实时事件流；
2. 恢复后重新获得 `precise stop` 能力，而不是只能 `best_effort stop`；
3. 同一页面的弱网断连可依赖 SSE `Last-Event-ID` 做自动续传；
4. 与现有一阶段“基于快照的恢复展示”兼容，作为 attach 失败时的降级兜底。

### 3.2 非目标

1. 本阶段不做跨设备接管；
2. 本阶段不改造移动端和桌面端到完全一致，只要求协议设计可复用；
3. 本阶段不把所有流式传输统一重构成 event-sourcing 新总线；
4. 本阶段不要求 WebSocket 也实现 attach-first，优先解决浏览器刷新恢复主路径。

## 4. 核心设计决策

### 决策 A：分离“发起新请求”和“附着已有请求”

保留现有：

- `POST/WS /sessions/:id/stream`：发起新请求
- `GET /sessions/:id/stream/sse?...message=...`：SSE fallback 发起新请求

新增：

- `GET /sessions/:id/stream/active`：查询当前 session 是否存在可附着的活跃 request
- `GET /sessions/:id/stream/attach`：attach-only SSE 通道，只做 replay + live subscribe，不创建新请求

这样可以避免把 attach 逻辑塞进现有 `/stream/sse`，从而误触发“重复发送原消息”。

### 决策 B：续流 cursor 以 `clientRequestId + seq` 为唯一真相源

继续使用已存在的 `RunEventCursor`：

```ts
interface RunEventCursor {
  clientRequestId: string;
  seq: number;
}
```

规则：

1. 客户端只在**同一个 `clientRequestId`** 内续流；
2. `seq` 只表示该 request 的持久化事件序号，不跨 request 解释；
3. 如果客户端的 `clientRequestId` 与当前活跃 request 不一致，服务端返回冲突信息，客户端可选择切换到新的活跃 request 或降级为快照恢复。

### 决策 C：SSE attach 作为二阶段 MVP 的唯一真实 resume 通道

原因：

1. 浏览器刷新后的核心需求是“服务器 → 客户端”的重新附着，不需要在同一连接里重新发送用户消息；
2. SSE 原生支持 `Last-Event-ID`，适合处理网络抖动后的自动续传；
3. 当前 `useGatewayClient` 已经是“WS 发起，SSE 兜底”，新增 attach-only SSE 的改动面最小。

WebSocket attach 可作为后续增强，不作为二阶段阻塞项。

### 决策 D：一阶段的“快照恢复展示”继续保留为兜底层

attach 失败时，前端仍然保留当前已实现的体验：

- `recoverActiveAssistantStream(...)` 从 `session.runEvents` 重建可见流内容
- `remoteSessionBusyState` 继续提供运行态指示
- `stopCapability` 可退化为 `best_effort` 或 `observe_only`

也就是说，二阶段不是替换一阶段，而是在它之上补一条更强的 attach 通道。

## 5. 新增对外协议

### 5.1 查询活跃 request

`GET /sessions/:sessionId/stream/active`

返回示例：

```json
{
  "active": {
    "sessionId": "session-1",
    "clientRequestId": "req-123",
    "startedAtMs": 1712200000000,
    "heartbeatAtMs": 1712200004200,
    "stateStatus": "running",
    "attachable": true
  }
}
```

若没有活跃 request：

```json
{ "active": null }
```

用途：

- 前端刷新后先确认“到底有没有可附着的当前 request”；
- 避免直接拿旧的 sessionStorage 快照盲目 attach。

### 5.2 attach-only SSE

`GET /sessions/:sessionId/stream/attach?clientRequestId=req-123&afterSeq=41&token=...`

语义：

1. 校验当前 session 归属与 request 是否仍活跃；
2. 先 replay `seq > afterSeq` 的 durable events；
3. 再订阅该 request 的后续 live events；
4. 遇到 terminal bookend 后结束连接。

#### 返回格式

wire format 采用 SSE 标准：

```text
id: req-123:42
event: run
data: {RunEventEnvelope JSON}

```

`data` 对象使用现有 `RunEventEnvelope`：

```json
{
  "eventId": "run-abc:evt:42",
  "aggregateType": "run",
  "aggregateId": "run-abc",
  "seq": 42,
  "version": 1,
  "timestamp": 1712200004300,
  "payload": {
    "clientRequestId": "req-123",
    "cursor": { "clientRequestId": "req-123", "seq": 42 },
    "deliveryState": "delivered",
    "outputOffset": 42,
    "event": {
      "type": "text_delta",
      "delta": "继续输出",
      "eventId": "run-abc:evt:42",
      "runId": "run-abc",
      "occurredAt": 1712200004300
    }
  }
}
```

> 注：`outputOffset` 在 chat 流上二阶段先定义为“当前 request 已交付事件数的单调偏移”，不要求立即升级成字符级 offset。真正需要文本 offset 的场景，可在后续 Phase 2B 再细化。

### 5.3 SSE 的 `Last-Event-ID` 兼容策略

服务端同时支持两种恢复来源：

1. `afterSeq / clientRequestId` 查询参数：用于页面刷新后的首次 attach；
2. `Last-Event-ID`：用于同一页面的网络抖动自动重连。

优先级：

1. 显式 query cursor
2. `Last-Event-ID`
3. 无 cursor，默认从 `seq = 0` 全量 replay 当前 request

## 6. 服务端实现设计

### 6.1 `session-runtime-thread-store.ts`

新增：

```ts
export function getFreshSessionRuntimeThreadInfo(input: {
  sessionId: string;
  userId: string;
  nowMs?: number;
}): {
  clientRequestId: string;
  startedAtMs: number;
  heartbeatAtMs: number;
} | null;
```

目的：

- 目前只有 `hasFreshSessionRuntimeThread(...)`，不足以做 attach handshake；
- attach 路由需要知道当前活跃的 `clientRequestId`。

### 6.2 `session-run-events.ts`

新增：

```ts
export function listSessionRunEventsByRequestAfterCursor(input: {
  sessionId: string;
  clientRequestId: string;
  afterSeq: number;
}): Array<{ seq: number; event: RunEvent }>;
```

以及：

```ts
export function subscribeSessionRunEventsByRequest(
  sessionId: string,
  clientRequestId: string,
  handler: (event: RunEvent) => void,
): () => void;
```

当前 `subscribeSessionRunEvents(sessionId, handler)` 是 session 粒度，attach 时最好直接过滤到 request 粒度，减少前端误收到其他 request 事件的风险。

### 6.3 `stream-routes-plugin.ts`

新增两个路由：

1. `GET /sessions/:id/stream/active`
2. `GET /sessions/:id/stream/attach`

`/stream/attach` 关键逻辑：

1. 鉴权 + session ownership 校验
2. 读取 fresh runtime thread
3. 校验 query 里的 `clientRequestId`
4. 解析恢复 cursor（query 或 `Last-Event-ID`）
5. replay durable events
6. 订阅 live events
7. 对每个 event 写出 `RunEventEnvelope`
8. 终态时关闭连接

附加行为：

- 每 10 秒发送 SSE comment heartbeat，防止中间代理静默断开；
- 若 runtime thread 过期但最后一条 durable event 是终态，仍要把尾部 replay 完再正常结束；
- 若 request 已切换，返回 `409` 并带上当前活跃 `clientRequestId`。

### 6.4 `run-event-envelope.ts`

继续复用 `buildRunEventEnvelope(...)`，不重复发明 envelope。区别只是：

- 现有代码主要用于 verification / protocol helper
- 二阶段把它正式纳入 attach route 的 wire contract

## 7. 前端与 web-client 设计

### 7.1 `useGatewayClient.ts`

将当前持久化快照从：

```ts
{
  (sessionId, clientRequestId, startedAt);
}
```

扩展为：

```ts
{
  sessionId: string;
  clientRequestId: string;
  startedAt: number;
  lastSeq: number;
  lastEventId?: string;
  transport: 'ws' | 'sse' | 'attach-sse';
}
```

新增能力：

- `attachStream(sessionId, callbacks)`
- 在收到 `RunEventEnvelope` 时更新 `lastSeq / lastEventId`
- attach 成功后恢复 `precise stop`
- attach 失败时清理坏快照并降级到当前已有的 snapshot recovery

### 7.2 `packages/web-client`

新增两类 API：

#### A. Sessions client

```ts
getActiveStream(token, sessionId);
```

#### B. SSE client

```ts
attachToActiveStream(sessionId, options);
```

其中 `GatewaySSEClient` 负责：

- 构造 attach URL
- 解析 `RunEventEnvelope`
- 在网络断线时利用浏览器原生 `Last-Event-ID` 自动续传

### 7.3 `ChatPage.tsx`

恢复顺序改为：

1. 先加载会话快照，拿到 `state_status`
2. 若发现本地存在 `activeStreamSnapshot`，且当前会话 busy
3. 先请求 `/stream/active`
4. 若 request 仍匹配，则调用 `attachStream(...)`
5. attach 成功后：
   - `stopCapability = precise`
   - `visibleStreaming` 优先来自 live attach
6. attach 失败后：
   - 继续沿用当前已实现的 `recoverActiveAssistantStream(...)`
   - `stopCapability` 回退为 `best_effort` / `observe_only`

## 8. 冲突与边界处理

### 8.1 旧快照指向的 request 已结束

- 服务端返回 `404` 或 `active = null`
- 前端清理本地 active snapshot
- UI 回退到普通会话快照显示

### 8.2 旧快照指向的 request 不是当前活跃 request

- 服务端返回 `409`，并返回新的 `clientRequestId`
- 前端可以自动重试一次 attach 最新 request
- 若仍失败，则回退到 snapshot recovery

### 8.3 cursor 缺口或顺序异常

- 若 `afterSeq` 大于当前最大持久化 seq，服务端返回 `416` 或 `409`
- 前端自动改为 `afterSeq=0` 全量 replay 当前 request
- 若仍异常，降级为 snapshot recovery

### 8.4 attach 成功但当前页没有拿到任何新事件

这是允许的：说明当前 request 仍忙但暂时没有新输出。此时：

- 运行状态栏继续存在
- stop 仍是 precise
- 一旦后端发出下一个事件，UI 立即恢复实时展示

## 9. 实施阶段

### Phase 2A：协议最小闭环（建议先做）

1. `session-runtime-thread-store.ts` 暴露活跃 request 详情
2. `session-run-events.ts` 增加按 cursor replay / request 订阅 helper
3. gateway 新增 `/stream/active` + `/stream/attach`
4. web-client 新增 attach SSE client
5. `useGatewayClient.ts` 持久化 `lastSeq`
6. `ChatPage.tsx` 接入“刷新后 attach 优先，快照恢复兜底”

### Phase 2B：体验强化

1. 同页面弱网恢复验证 `Last-Event-ID`
2. attach 成功后恢复更精确的 stop 文案与状态
3. Desktop / Mobile 复用同一 attach handshake

### Phase 2C：可选增强

1. WebSocket attach
2. 跨标签页 attach 协调
3. 更细粒度 `outputOffset` 语义

## 10. 验证矩阵

### Gateway

- `stream-attach-route.test.ts`
  - 活跃 request attach 成功
  - cursor replay 正确
  - request mismatch 返回 409
  - terminal replay 后关闭连接
- `session-run-events` 单测
  - `afterSeq` 查询顺序稳定
  - request 级订阅不串流
- verification
  - `verify-stream-attach-resume.ts`
  - 覆盖“启动 → attach → 收到后续 chunk → precise stop”

### Web / web-client

- `useGatewayClient.test.tsx`
  - 持久化 `lastSeq`
  - attach 成功恢复 precise stop
  - attach 失败回退 snapshot recovery
- `ChatPage.test.tsx`
  - 刷新后重新 attach 并继续收到新增文本
  - attach 不可用时继续使用当前一阶段恢复展示

## 11. 最终建议

二阶段最值得落地的，不是“把现有 `/stream/sse` 改得更复杂”，而是：

1. **新增 attach-only SSE 通道**；
2. **以 `clientRequestId + seq` 为续流真相源**；
3. **把一阶段的 snapshot recovery 留作兜底**。

这样能以最小改动获得真正可感知的“刷新后继续接上流”的体验，同时保持当前架构的稳定性与可回滚性。
