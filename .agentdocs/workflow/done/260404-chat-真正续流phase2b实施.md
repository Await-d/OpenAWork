# 260404 Chat 真正续流 Phase 2B 实施

## Task Overview

在已完成 Phase 2A 的 active-stream handshake + attach-only SSE 基础上，继续收紧 attach 路径中 durable replay 与 live subscribe 之间的竞态窗口，降低刷新恢复时极端漏事件概率。

## Current Analysis

- Phase 2A 已具备真正续流主链，但 attach 路由当前仍是“先 replay，后 subscribe”。
- Oracle 复核指出该顺序在极小窗口内仍可能漏掉少量事件。
- 现有 `session_run_events` 已有稳定的 `client_request_id + seq`，足够支持 subscribe-before-replay + seq 去重。

## Solution Design

- attach 路由改为：
  1. 先订阅 session run events
  2. 在 replay 期间缓冲匹配 request 的 live events
  3. 读取 durable replay
  4. 用 `seq` 去重并按顺序 flush buffer
  5. 再切到 live direct write

## Complexity Assessment

- Atomic steps: 3–4 → 0
- Parallel streams: gateway 主实现 + 回归测试 + workflow 记录 → +2
- Modules/systems/services: 3 → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 4
- **Chosen mode**: Full orchestration
- **Routing rationale**: 改动面不大，但涉及协议顺序保证与测试语义，必须保留阶段记录与结论归档。

## Implementation Plan

### Phase 1：竞态窗口收口
- [x] T-01：重排 attach 路由为 subscribe-before-replay
- [x] T-02：增加 replay 期间 live buffer 与 seq 去重/顺序冲刷

### Phase 2：验证与归档
- [x] T-03：补齐 attach 竞态场景测试
- [x] T-04：运行 gateway 相关测试与构建
- [x] T-05：同步 workflow 与结论归档

## Notes

- 本次不引入新的前端协议字段，不改 ChatPage / useGatewayClient 行为。
- 目标是压缩竞态窗口，而不是在 Phase 2B 就强行实现全原子事件流协议。
- 具体实现采用 **buffer-live-then-replay**：attach 路由先建立订阅、把 replay 期间到达的 live 事件暂存起来，再按 `seq` 去重并顺序冲刷。
- 新增竞态回归验证了“live 事件在 replay 期间到达”时，最终输出顺序仍是 `replay -> buffered live -> terminal live`。
- Oracle 最终复核结论：这次 Phase 2B 的缓冲+去重方案成立，没有新的关键缺陷；当前实现可关闭。
- 仍需保持一个协议前提：`listSessionRunEventsByRequestAfterSeq` 必须按 `seq` 升序返回，以匹配去重与顺序冲刷逻辑。
- 验证已通过：`stream-attach-route.test.ts`、`stream-stop-route.test.ts`、`session-run-events.test.ts`、`@openAwork/agent-gateway build`。
- Memory sync: completed
