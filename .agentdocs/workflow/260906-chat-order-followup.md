# Chat 消息顺序问题第二轮定位

## Task Overview

用户确认上一轮修复后消息先后顺序仍然错误，需追踪实时事件到最终渲染的完整时序并修复。

## Current Analysis

上一轮已修复快照 parts 合并、跨消息工具合并和旧迁移随机 ID，但用户仍能复现，说明当前问题可能发生在实时事件归并、消息分组、工具结果投影或最终 render entries 生成阶段。必须先记录失败输入和事件序列，避免继续凭历史假设修改。

## Solution Design

以 `clientRequestId + durable seq` 作为唯一重放身份：标准 WS/SSE 每次成功持久化事件后把数据库游标一并交给客户端，客户端在分发事件前推进并持久化 `lastSeq`；页面重新挂载后的 attach 只请求该游标之后的事件。文本、Thinking 内容指纹仅作兼容防线，不再承担主去重职责。任何代码变更必须由失败测试驱动。

## Complexity Assessment

- Atomic steps: 5 → +2
- Parallel streams: yes → +2
- Modules or systems: 4 → +1
- Long step over 5 min: yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: no → 0
- Total score: 7
- Chosen mode: Full orchestration
- Routing rationale: 上一轮已覆盖静态顺序但实测仍失败，本轮需要跨层时序证据和真实浏览器复现。

## Implementation Plan

- [x] T-01: 追踪实时事件 accumulator 是否按事件序号保持 parts 顺序 ✅
- [x] T-02: 追踪 render entries/grouping 是否把不同消息或轮次重新合并 ✅
- [x] T-03: 追踪后端 run event/message projection 是否丢失或重排事件 ✅
- [x] T-04: 为标准流游标未推进构造跨连接失败测试 ✅
- [x] T-05: Gateway 标准流携带持久游标，Web 在分发前持久化游标 ✅
- [x] T-06: 验证 WS→SSE、页面重挂载→attach、Thinking/工具顺序回归 ✅
- [x] T-07: 清理失去必要性的内容指纹启发式并完成全量回归（协议主链已收口；旧指纹保留兼容防线）✅

## Notes

- 工作树混有大量并行用户修改，禁止回滚或整理无关文件。
- 必须区分“数据顺序错误”和“视觉布局错误”。
- 根因证据：标准流创建 `lastSeq: 0` 后从未推进；只有 attach envelope 会更新它，因此页面重挂载会从 0 重放已展示事件。
- 2026-09-06 修复：Gateway 实时事件在持久化后附加 `cursor(clientRequestId, seq)`；Web 标准 WS/SSE 在分发前推进并保存 `lastSeq`，跨连接 attach 从最新游标续传。
- 验证：Web `useGatewayClient.test.tsx` 18/18；Gateway `stream-replay-race` + `session-run-events` 4/4。
- 追加收口：WS→SSE 回退显式携带 `afterSeq`，普通 `/stream/sse` 的 single-flight replay 按游标只发送未消费事件。
- 前端展示层复查：最终 `groupChatRenderEntries()` 增加 message ID / assistant clientRequestId 去重；工具轮派生 ID（`:assistant:<round>`）保留为独立消息。
- 最新 Web 前端专项：5 个测试文件、63 项通过。
