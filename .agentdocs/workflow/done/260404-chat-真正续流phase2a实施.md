# 260404 Chat 真正续流 Phase 2A 实施

## Task Overview

在已完成的二阶段协议设计基础上，落地最小可用的真正续流能力：为 OpenAWork Chat 增加 active-stream handshake 与 attach-only SSE resume 通道，并接入 Web 端刷新恢复。

## Current Analysis

- 一阶段已经支持基于 `session.runEvents` 的恢复展示，但仍然不是实时 attach。
- `session_run_events` 已具备 `session_id + client_request_id + seq` 的 durable request 事件序列。
- `session_runtime_threads` 已具备活跃 request 事实，但当前没有详细对外读模型。
- `RunEventCursor / RunEventEnvelope` 已存在，但尚未成为正式 transport contract。

## Solution Design

- Gateway 新增：
  - `GET /sessions/:id/stream/active`
  - `GET /sessions/:id/stream/attach`
- Shared / web-client 正式消费 `RunEventEnvelope`
- Web 刷新时优先 attach 当前活跃 request；attach 失败再回退到现有快照恢复展示

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: gateway / web-client / web / tests → +2
- Modules/systems/services: 4 → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是一次跨协议与恢复链的系统实现，需要 workflow 持续跟踪阶段进度与验证结果。

## Implementation Plan

### Phase 1：协议与类型接线
- [x] T-01：补读并冻结 gateway attach 路由依赖点
- [x] T-02：扩展 shared / web-client 的 attach 类型与接口

### Phase 2：Gateway 实现
- [x] T-03：实现 active-stream 查询接口
- [x] T-04：实现 attach-only SSE 路由与 cursor replay

### Phase 3：Web 恢复接线
- [x] T-05：扩展 `useGatewayClient` 的 active snapshot 与 attach 恢复
- [x] T-06：在 `ChatPage` 中接入 attach-first 恢复顺序

### Phase 4：验证
- [x] T-07：补齐 gateway 单测
- [x] T-08：补齐 web / ChatPage 回归
- [x] T-09：运行相关 typecheck / build / tests

## Notes

- 本次只做 Phase 2A，不扩展 WebSocket attach。
- attach 失败时必须保留当前一阶段快照恢复能力，不能回退成“完全看不到流”。
- 已实现的最小闭环：`GET /sessions/:id/stream/active` + `GET /sessions/:id/stream/attach` + `useGatewayClient.attachToActiveStream()` + `ChatPage` attach-first 恢复。
- `ChatPage` 的 attach 触发条件已收敛为“当前 session running，且存在 persisted active stream snapshot 或 recovered runEvents”，避免把普通 observe-only running session 误升级成 attach/precise stop。
- Oracle 复核后已额外修正两个协议细节：
  - attach SSE 改为默认 message 事件，不再写 `event: run`，确保浏览器标准 `EventSource.onmessage` 可以直接接收；
  - attach 的 `afterSeq` 改为“客户端已见 seq 优先，并与服务端 lastSeq 取安全边界”，避免快照到 attach 握手之间漏增量。
- 为了让 Web 路由预加载与 Chat 回归恢复正常，已补一个最小 `apps/web/src/pages/TeamPage.tsx` 页面骨架；这属于工作树里原本缺失的页面文件，不是本次协议本身的一部分。
- 同类阻断后来又出现在 `WorkflowsPage.tsx` 缺失上，也已补最小页面骨架，确保 Web 路由预加载、Chat 回归与构建链恢复稳定。
- 验证已通过：gateway attach/stop route tests、session-run-events tests、`useGatewayClient.test.tsx`、`ChatPage.test.tsx`、`@openAwork/web-client` typecheck/build、`@openAwork/web` typecheck/build、`@openAwork/agent-gateway` build。
- Oracle 最终复核结论：前两处阻断已解决，当前实现“足够关闭”；剩余仅有 replay 查询与 live 订阅之间存在极小竞态窗口，属于低概率非阻断风险。
- Memory sync: completed
