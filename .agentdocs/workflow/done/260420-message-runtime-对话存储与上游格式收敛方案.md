# .agentdocs/workflow/260420-message-runtime-对话存储与上游格式收敛方案.md

## Task Overview
- 目标：针对 OpenAWork 当前“对话存储 + 上游发送格式”相对参考库 `temp/opencode` 的差异，制定一份可执行的收敛方案。
- 范围：仅规划 `services/agent-gateway`、`packages/shared`、`packages/web-client`、`apps/web` 相关的消息模型、`tool_result`、upstream conversation、request-scope、compaction 与协议验证收敛路线。
- 不做：本轮不直接修改生产代码，不提交 schema 变更，不落具体实现。

## Current Analysis
- 当前 OpenAWork 的核心事实层是 `message_v2 + part_v2 + session_run_events`；参考库主线是 `message + part + sync event`。
- 当前最大设计差异不在“能不能存/发”，而在：
  - `tool_result` 的 canonical 真相位置仍依赖 `ToolPart.state.metadata.toolResultContent`
  - 上游发送层同时维护 `chat_completions` / `responses` 两套最终 body 组装
  - request-scope durable replay 以 `clientRequestId` 前缀族谱为中心，复杂度高于参考库
  - compaction 仍依赖 marker/summary 注入与还原，而不是更自然的折叠语义
- 前端真实消费协议已外溢到 `assistant_trace` + `RunEventEnvelope`，因此调整不能只看 gateway 内部，需要同步考虑 shared/web-client/apps/web 的稳定性。

## Solution Design
- 收敛原则：优先统一“真相源”和“中间层”，避免先动最终协议外观。
- 调整主轴分为四段：
  1. **权威语义收口**：明确 `tool_result` / assistant trace / run event 的单一路径真相。
  2. **上游转换统一**：先生成统一 normalized conversation IR，再分发到 `chat_completions` / `responses`。
  3. **历史与回放简化**：收敛 request family 前缀规则、compaction 表示与 cleanup/replay 逻辑。
  4. **协议验证固化**：把 shared/web-client/apps/web 的脆弱假设转成验证矩阵，防止“内部优化”破坏前端协议。
- 执行策略：先做契约与边界设计，再分阶段实现；不建议直接在现状上继续堆 adapter。

## Complexity Assessment
- Atomic steps: 5+（权威语义、上游 IR、request-scope、compaction、验证矩阵、迁移顺序）→ +2
- Parallel streams: 是（权威语义收口、上游转换设计、协议验证可并行推进）→ +2
- Modules/systems/services: 3+（gateway、shared/web-client、apps/web）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是跨 gateway 存储层、上游发送层与前端协议面的系统性收敛任务，必须持久化规划、显示依赖与阶段边界，避免实现期反复返工。

## Implementation Plan

### Phase 1: 权威语义与边界收口
- [x] T-01: 盘点 `message_v2 / part_v2 / session_run_events / assistant_trace` 当前各自承载的事实语义，划清“事实层 / 投影层 / UI façade” ✅
- [x] T-02: 为 `tool_result` 定义单一路径真相，明确 metadata、assistant content、`role='tool'` 三者的保留与投影规则 ✅

### Phase 2: 上游发送统一中间层
- [x] T-03: 设计统一 normalized conversation IR，覆盖 text/reasoning/tool_call/tool_result/compaction/reference 等语义 ✅
- [x] T-04: 规划 `chat_completions` 与 `responses` 仅作为 IR 的末端渲染器，收口当前分散在 `session-message-store.ts` / `stream-model-round.ts` / `upstream-request.ts` 的协议拼装职责 ✅

### Phase 3: 历史回放与 compaction 简化
- [x] T-05: 收敛 request family 前缀与 lineage 规则，减少 `assistant_event:` / `task-auto-resume:` / 派生 request id` 的自由扩张面 ✅
- [x] T-06: 把 compaction 从“marker + 注入 + 还原”风格调整为更自然的历史折叠语义，并给出迁移兼容策略 ✅

### Phase 4: 协议稳定与实施顺序
- [x] T-07: 建立 shared/web-client/apps/web 的协议脆弱点矩阵，明确哪些字段/事件不能被内部调整破坏 ✅
- [x] T-08: 输出分阶段实施顺序、风险、验证矩阵与回滚策略，确保后续实现能按小步闭环推进 ✅

## Notes
- Can split? 可以，至少可拆成三条流：A) `tool_result` 权威语义；B) 上游 IR 与协议渲染；C) request-scope/compaction/前端协议验证。
- Should split? 应该拆。拆分能降低回归爆炸半径，并让“内部收口”与“前端兼容”分别验证。
- Dependency order:
  - T-01 → T-02 → T-03 → T-04
  - T-01 → T-05
  - T-03/T-05 → T-06
  - T-02/T-04/T-06 → T-07 → T-08
- Gate 1 约束：本文件是方案与分解，不代表已获批进入实现。后续若要改代码，应先按本方案收口目标、影响文件、风险与验证策略，再等明确批准。
- 第一阶段已确认的边界：
  - **事实层**：`message_v2 + part_v2 + session_run_events`
  - **兼容/投影层**：`message-v2-adapter.ts`、`session-message-store.ts`
  - **UI façade**：`assistant_trace` + `RunEventEnvelope` + 历史 `role='tool'` 兼容读取
- 第一阶段已落地的最小收口：gateway 内部读取/投影 `tool_result` 时，改为优先按 `content.type === 'tool_result'` 解释，而不是依赖 `message.role === 'tool'`；未删除前端兼容路径。
- 当前判定的单一路径真相：`tool_result` 在 gateway 内部的 canonical 真相源是 `message-v2-adapter.ts` 写入到 `ToolPart.state.metadata.toolResultContent` 的内容；assistant-side 与 `role='tool'` 视图属于兼容投影/读取面。
- 第二阶段已落地的最小收口：
  - 新增 `services/agent-gateway/src/normalized-conversation.ts`，统一 `NormalizedConversationMessage` 与双向 render/normalize helper。
  - `session-message-store.ts` 现在会产出 `prepared.normalizedMessages`，历史 conversation 的协议无关 IR 固定在这里生成。
  - `stream-model-round.ts` 主流请求路径在发往 provider 之前，会把最终快照规范化成 IR，并交给 `buildUpstreamRequestBody()`；`upstream-request.ts` 开始支持从 `normalizedMessages` 渲染最终 `chat_completions / responses` body。
  - 保留旧 `messages` 入口作为兼容 wrapper，避免一次性打断 `workflow-llm` 与其它次级调用点。
- 本轮修改文件：
  - `services/agent-gateway/src/tool-result-contract.ts`
  - `services/agent-gateway/src/session-message-store.ts`
  - `services/agent-gateway/src/message-v2-adapter.ts`
  - `services/agent-gateway/src/routes/stream.ts`
  - `services/agent-gateway/src/call-omo-agent-output.ts`
  - `services/agent-gateway/src/delegated-task-display.ts`
  - `services/agent-gateway/src/normalized-conversation.ts`
  - `services/agent-gateway/src/routes/upstream-request.ts`
  - `services/agent-gateway/src/routes/stream-model-round.ts`
  - `services/agent-gateway/src/__tests__/stream-protocol.unit.test.ts`
  - `services/agent-gateway/src/__tests__/stream-model-round.test.ts`
- 验证证据：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session-message-store.test.ts src/__tests__/stream-replay.test.ts src/__tests__/call-omo-agent-output.test.ts src/__tests__/delegated-task-display.test.ts src/__tests__/message-v2-adapter.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session-message-store.test.ts src/__tests__/stream-protocol.unit.test.ts src/__tests__/stream-model-round.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway build` ✅
  - `pnpm --filter @openAwork/agent-gateway test` ✅（`verify-message-v2-deep-conversation` 仍按缺真实 API 环境变量时 skip）
  - Memory sync: completed
- 第三阶段已落地的最小收口：
  - 新增 `services/agent-gateway/src/request-lineage.ts`，把 request-scope family 匹配收口为 `matchesRequestScope()`。
  - `message-v2-adapter.ts` 与 `session-message-store.ts` 的 request-scope list/update/delete 路径已统一复用该 helper，不再散落 `=== || startsWith(...)`。
  - 新增 `services/agent-gateway/src/compaction-marker.ts`，把 compaction marker payload 构造、marker 识别和 latest marker 读取集中到 codec/helper。
  - `session-message-store.ts` 与 `message-v2-adapter.ts` 已接入 compaction marker helper，但**保留各自现有 `source` 字面量**，不对外改协议。
  - 这一阶段刻意不改 `assistant_event:` / `task-auto-resume:` / `compaction-marker:` 前缀本身，也不重做 replay/attach 全链，只做规则集中。

## Protocol Fragility Matrix

| 面向 | 关键协议/字段 | 当前依赖位置 | 阶段内允许动作 | 阶段内禁止动作 |
|---|---|---|---|---|
| shared/web-client | `RunEvent` payload（尤其 `tool_call_delta` / `tool_result`） | `packages/web-client/src/gateway-ws.ts`, `gateway-sse.ts`, `sessions.ts` | 内部 helper 收口、保持 event payload 不变 | 改 event type / 字段名 / 序列语义 |
| apps/web transcript | `assistant_trace` JSON 形状 | `apps/web/src/pages/chat-page/support.ts`, `use-chat-render-data.ts` | 内部生成路径收口 | 删除 `assistant_trace` 或改变 `payload.toolCalls` 形状 |
| 历史兼容读取 | `Message.role === 'tool'` + `content[].tool_result` | `support.ts`, `stream-recovery.ts`, `delegated-task-display.ts`, `call-omo-agent-output.ts` | content-first 读取；保留兼容投影 | 直接删除 `role='tool'` 历史兼容路径 |
| attach/replay | `RunEventEnvelope` 内的 `event` / `seq` / `cursor` | `apps/web/src/pages/chat-stream-state.ts`, `stream-recovery.ts` | 内部 lineage helper 收口 | 变更 envelope 或 replay 排序规则 |
| compaction UI | compaction 卡片/marker 摘要行为 | `apps/web/src/pages/chat-page/support.ts`, `assistant-event-row.tsx`, `chat-stream-state.ts` | 集中 codec、统一边界判定 | 改 marker JSON 形状或卡片事件来源 |

## Execution Order, Risk, Verification, Rollback

### 执行顺序
1. 阶段一：确定事实层 / 投影层 / UI façade 边界，并把 `tool_result` 收口为 content-first + canonical metadata truth。
2. 阶段二：引入 `normalized-conversation.ts`，让历史 conversation 与主流上游请求共享同一份 IR。
3. 阶段三：把 request family 匹配与 compaction marker codec 收到 helper，但不改协议字面量。
4. 阶段四：把 shared/web-client/apps/web 的脆弱假设明确写成矩阵，作为后续更深层结构调整的硬边界。

### 风险矩阵
| 风险 | 触发方式 | 当前缓解 |
|---|---|---|
| 历史 `role='tool'` 回放失效 | 直接删旧兼容路径 | 阶段一只做 content-first 读取，不删投影 |
| chat/responses 双协议再次分叉 | IR 只接入一条主链 | 阶段二让 `buildUpstreamRequestBody()` 同时支持 `messages` 与 `normalizedMessages`，主流 `runModelRound()` 已走 IR |
| request-scope 清理误删 | 各处继续手写前缀匹配 | 阶段三统一为 `matchesRequestScope()` |
| compaction marker 判断漂移 | marker 读写逻辑散落 | 阶段三统一到 `compaction-marker.ts` codec |
| 前端协议被内部重构破坏 | 改字面量/事件形状 | 阶段四明确禁止修改的 façade 与 event payload |

### 验证矩阵
- 阶段一：
  - `session-message-store.test.ts`
  - `stream-replay.test.ts`
  - `call-omo-agent-output.test.ts`
  - `delegated-task-display.test.ts`
  - `message-v2-adapter.test.ts`
- 阶段二：
  - `stream-protocol.unit.test.ts`
  - `stream-model-round.test.ts`
  - `session-message-store.test.ts`
- 阶段三：
  - `message-v2-adapter.test.ts`
  - `session-message-store.test.ts`
  - `session-compaction.test.ts`
  - `stream-model-round.test.ts`
  - `stream-replay.test.ts`
  - `stream-session-title.test.ts`
- 全量回归：
  - `pnpm --filter @openAwork/agent-gateway build`
  - `pnpm --filter @openAwork/agent-gateway test`

### 回滚策略
- 若阶段一回归：只回退 content-first 读取与 tool_result truth 相关改动，不动前端协议层。
- 若阶段二回归：保留 `normalized-conversation.ts`，但让主路径退回 `messages` 入口；IR 继续作为旁路结构保留。
- 若阶段三回归：保留 helper 文件，回退接线点；不回退既有前缀/marker 字面量。

## Completion
- T-01 ~ T-08 已全部完成。
- 该任务已产出可执行路线图，并完成前三阶段的最小代码收口与第四阶段的验证/风险矩阵沉淀。
