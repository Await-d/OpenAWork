# 260323 opencode 对标会话持久化方案

## Task Overview

用户要求参考 `temp/opencode` 的真实实现，为 OpenAWork 当前 Web Chat 会话/消息持久化设计一套更正确的方案。

本方案不是单纯复述现状，而是基于两边源码对照回答三个问题：

1. `opencode` 真实是如何保存 session、message、part 与流式增量的；
2. OpenAWork 当前链路与其相比，关键缺口在哪里；
3. 在不照搬 opencode 的前提下，OpenAWork 的最小正确方案应该如何落地。

> 说明：本方案建立在 `260323-聊天消息后端持久化方案.md` 的现状调查之上；本文件是加入 `temp/opencode` 参考后的收敛版方案。

## Current Analysis

### OpenAWork 当前事实

1. `services/agent-gateway/src/db.ts` 只有一张 `sessions` 表承担会话主存储；消息与 metadata 都塞在：
   - `messages_json TEXT NOT NULL DEFAULT '[]'`
   - `metadata_json TEXT NOT NULL DEFAULT '{}'`
2. `services/agent-gateway/src/routes/sessions.ts` 只会在：
   - `POST /sessions` 时把 `messages_json` 初始化为 `'[]'`
   - `POST /sessions/import` 时写入导入消息
   - `PATCH /sessions/:id` / `PATCH /sessions/:id/workspace` 时更新 metadata
3. `services/agent-gateway/src/routes/stream.ts` 只做：
   - session 存在性校验
   - metadata 读取
   - 向上游模型发起流式请求
   - 把 delta 回传给前端
   **不会**把 user / assistant 消息写回数据库。
4. Web 端 `apps/web/src/pages/ChatPage.tsx` 发送消息时，只把消息追加到本地 state；且读取会话时依赖 `session.messages`，但 gateway 实际返回的是 `messages_json`，存在契约错位。

### opencode 当前事实

1. `temp/opencode/packages/opencode/src/session/session.sql.ts` 使用 SQLite + Drizzle，主事实不是一个 `messages_json` 大字段，而是三层：
   - `session`
   - `message`
   - `part`
2. `message` / `part` 表并不是把所有字段拆列，而是把高变化业务字段放进：
   - `data: text({ mode: 'json' })`
3. `temp/opencode/packages/opencode/src/session/index.ts` 中：
   - `updateMessage()` 负责 upsert message
   - `updatePart()` 负责 upsert part
   - `updatePartDelta()` 只发事件，不写库
4. `temp/opencode/packages/opencode/src/session/processor.ts` 中：
   - `text-start` / `reasoning-start` 先创建空 part 入库
   - `text-delta` / `reasoning-delta` 只做事件广播
   - `text-end` / `reasoning-end` 才把最终文本/元数据落库
5. opencode 另有文件型 `Storage.write(["session_diff", sessionID], ...)` 作为派生缓存，但主事实仍在 SQLite。

### 核心差异

1. **OpenAWork 是“大 JSON 会话壳”模型，opencode 是“session/message/part 三层主事实”模型。**
2. **OpenAWork 当前流式聊天不落库；opencode 在边界时点落库。**
3. **OpenAWork 的消息契约现在就已经错位（`messages_json` vs `messages`）；opencode 的读取模型是围绕 message/part hydrate 构建的。**
4. **OpenAWork 需要多用户 `user_id` 与 gateway 鉴权；opencode 更偏本地会话管理，因此不能直接照搬。**

## Solution Design

### 设计原则

1. **吸收 opencode 的骨架，不照搬其全量复杂度。**
2. **以 gateway 为事实源，保留 OpenAWork 现有 `user_id` 与 Web/gateway 架构边界。**
3. **把 `messages_json` 降级为兼容投影，不再把它当主存储。**
4. **流式 delta 继续只走事件通道，持久化只在边界时点发生。**

### 推荐目标态：简化版 `session / message / part`

#### 1. sessions（保留现表）

继续保留当前 `sessions` 表，职责缩小为：

- 会话身份：`id`, `user_id`
- 会话标题/状态：`title`, `state_status`
- 会话元数据：`metadata_json`
- 兼容投影：`messages_json`（过渡期保留）
- 排序与审计字段：`created_at`, `updated_at`

#### 2. messages（新增主事实表）

建议字段：

- `id`
- `session_id`
- `user_id`
- `role`
- `seq`
- `data_json`
- `created_at`
- `updated_at`

职责：

- 一行表示一条 user / assistant 消息骨架
- `seq` 保证会话内稳定顺序
- `data_json` 承载灵活字段（如 provider/model/finish/error）

#### 3. parts（新增片段表）

建议字段：

- `id`
- `message_id`
- `session_id`
- `part_index`
- `kind`
- `data_json`
- `created_at`
- `updated_at`

Phase 1 先只支持：

- `text`
- `tool_call`
- `tool_result`

不要一开始就引入 opencode 的 `snapshot` / `patch` / `compaction` / `subtask` 等全部 part 类型。

### 为什么不是继续强化 `messages_json`

参考 opencode 后，结论更明确：

1. 大字段覆盖写会让并发与幂等处理变差；
2. 后续如果要承接 tool call、structured output、多片段回复，`messages_json` 会越来越难维护；
3. 即使短期能工作，也会继续把“传输格式”和“存储事实”绑死在一起。

### 为什么又不能照搬 opencode 全量设计

1. OpenAWork 当前最紧急的是 Web Chat 正常落库与恢复，不是一步到位做完整 TUI/Agent 事件宇宙；
2. OpenAWork 还需要兼容已有 `/sessions` API、`messages_json` 历史数据、Web/mobile 调用方；
3. OpenAWork 运行在 gateway 多用户场景下，必须保留 `user_id` 边界和现有鉴权模型。

### 写入策略

#### 流式 delta

参考 opencode，**不落库**，理由：

- 高频 token 写库没有必要；
- 容易放大 SQLite 写压力；
- UI 已经有 WS/SSE 实时事件通道。

#### 边界落库

最小正确方案只在以下时点写入：

1. user 提交消息时，写一条 user message；
2. assistant `done` 时，写一条 assistant message + 相关 parts；
3. assistant `error` / 中断时，写一条带失败状态的 assistant message。

### 参考 opencode 的使用方式（不是只参考表结构）

本轮对标的重点，不只是“存成什么样”，还包括“运行时怎么使用这些存储”。

#### opencode 的使用流

1. **创建 assistant 消息骨架**
   - 在真正开始一次 assistant 处理前，先通过 `Session.updateMessage(...)` 创建 assistant message。
   - 证据：`temp/opencode/packages/opencode/src/session/prompt.ts:571-597`

2. **流式处理中按 part 维度推进**
   - `text-start` / `reasoning-start`：先建空 part 并入库
   - `text-delta` / `reasoning-delta`：只走 `updatePartDelta()` 事件
   - `text-end` / `reasoning-end`：再用 `updatePart()` 把最终内容落库
   - 证据：`temp/opencode/packages/opencode/src/session/processor.ts:63-110,291-341`

3. **读取历史不是读一个大 JSON，而是 hydrate**
   - `Session.messages()` 调 `MessageV2.stream()` 拉 message rows
   - `hydrate()` 再把 message 与 part 拼成 `{ info, parts }`
   - 证据：
     - `temp/opencode/packages/opencode/src/session/index.ts:524-537`
     - `temp/opencode/packages/opencode/src/session/message-v2.ts:533-557`

4. **模型输入不是直接拿 DB row，而是做转换层**
   - `MessageV2.toModelMessages()` 把 `{info, parts}` 转成真正给模型的消息数组
   - 证据：`temp/opencode/packages/opencode/src/session/message-v2.ts:559-622`

#### OpenAWork 应吸收的“使用方式”

因此，OpenAWork 的目标不应只是“新增两张表”，而应同时建立以下使用路径：

1. **写路径抽象化**
   - 不让 `stream.ts` 直接散落 SQL；
   - 应由统一的 message/part repository 或 session service 承担：
     - create user message
     - create assistant skeleton
     - finalize assistant parts

2. **读路径结构化**
   - `GET /sessions/:id` 不应直接返回 session row；
   - 应先从 `messages/parts` hydrate，再投影成前端所需的 `messages` 结构。

3. **模型输入转换层独立**
   - 不应再像当前 `stream.ts` 一样仅拼 `[system?, user]`；
   - 应建立从会话主事实 → 模型输入 messages 的独立转换逻辑，后续历史回灌、tool_result、多模态才能持续扩展。

4. **实时体验与持久化分离**
   - WS/SSE 继续承担实时 delta；
   - DB 只负责最终可恢复状态；
   - 不把“实时 token 推送”和“最终历史事实”混成一套写路径。

### 兼容层策略

过渡阶段保留 `sessions.messages_json`，但只作为：

1. 旧接口回退读取来源；
2. 导出/历史迁移的兼容投影；
3. 双写期的安全网。

最终读取顺序应为：

1. 优先读 `messages` / `parts` 主事实表；
2. 若无新数据，再回退解析旧 `messages_json`；
3. `GET /sessions/:id` 对外统一返回 `messages` 数组。

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 参考仓调研 + 当前仓差异分析可并行 → +2
- Modules/systems/services: temp/opencode + OpenAWork gateway/web-client/web → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是一次跨仓对标后的架构方案收敛，需要把参考实现、差异、取舍与落地阶段一起固化，否则后续实施会失去设计依据。

## Implementation Plan

### Phase 1：止血当前契约（P0）
- [ ] T-01：修正 `GET /sessions/:id` 返回 `messages`，不再让 Web 直接面对 `messages_json`
- [ ] T-02：兼容读取旧 `messages_json`，避免历史会话在迁移期丢失
- [ ] T-03：对齐 `packages/web-client/src/sessions.ts` 与 Web Chat 读取契约

### Phase 2：引入主事实层（P0）
- [ ] T-04：新增 `messages` 表，承载 user / assistant 消息骨架
- [ ] T-05：新增 `parts` 表，承载 text/tool_call/tool_result 片段
- [ ] T-06：补齐索引、外键与 `seq` / `part_index` 约束
- [ ] T-06b：新增统一 repository / service，承接 `updateMessage / updatePart / hydrate` 这一层使用方式

### Phase 3：改造写入路径（P0）
- [ ] T-07：在 `stream.ts` 用户提交时写 user message
- [ ] T-08：delta 继续走 WS/SSE 事件，不写库
- [ ] T-09：在 `done` / `error` 边界落 assistant message + parts
- [ ] T-10：同事务更新 `sessions.updated_at` 与兼容投影 `messages_json`
- [ ] T-10b：建立“会话主事实 → 前端 messages / 模型 messages”两条独立投影链路

### Phase 4：迁移与双写（P0）
- [ ] T-11：把历史 `messages_json` 回填到 `messages/parts`
- [ ] T-12：建立双写期读写策略与退场条件
- [ ] T-13：覆盖 import / export / legacy session 恢复路径

### Phase 5：增强能力（P1）
- [ ] T-14：在消息主事实稳定后，再评估历史回灌模型上下文
- [ ] T-15：按需要补 tool_result / structured output / compact part
- [ ] T-16：评估是否需要像 opencode 一样为派生 diff 建独立缓存层

## Staged Execution Strategy

### Stage A：契约止血（≤3 主文件）
- `services/agent-gateway/src/routes/sessions.ts`
- `packages/web-client/src/sessions.ts`
- `apps/web/src/pages/ChatPage.tsx` 或相关测试

### Stage B：数据层扩展（≤3 主文件）
- `services/agent-gateway/src/db.ts`
- `services/agent-gateway/src/<message-repository>.ts`
- 对应测试/迁移文件

### Stage C：流式边界落库（≤3 主文件）
- `services/agent-gateway/src/routes/stream.ts`
- `services/agent-gateway/src/routes/stream-protocol.ts`（如需）
- 对应测试文件

### Stage D：迁移与兼容收口（≤3 主文件）
- `services/agent-gateway/src/<migration-or-backfill>.ts`
- `packages/web-client/src/sessions.ts`
- 导入/导出相关文件

## Acceptance Criteria

1. Web Chat 发送一轮消息后，刷新页面可恢复完整 user / assistant 历史；
2. gateway 主事实不再依赖 `sessions.messages_json` 单列大 JSON；
3. 流式期间不会因每个 delta 落库而显著拖慢输出；
4. `GET /sessions/:id` 的返回契约与 Web/mobile 客户端一致；
5. 双写期内旧会话与新会话都可正常读取；
6. 后续如引入 tool_call/tool_result，不需要再次推翻存储模型。

## Risks and Decision Notes

1. **不能一步照搬 opencode 的全部 part 类型**：当前 OpenAWork 先解决最小正确性问题。
2. **不能继续把 `messages_json` 当主事实**：否则只是把旧问题延后。
3. **delta 不落库是刻意设计，不是缺失**：这是参考 opencode 后确认的性能/复杂度权衡。
4. **双写期必须可回退**：新表成功但兼容投影失败时，要有明确重试或事务策略。

## Notes

- `temp/opencode` 源码已核实存在，关键证据见：
  - `packages/opencode/src/session/session.sql.ts`
  - `packages/opencode/src/session/index.ts`
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/message-v2.ts`
- 本方案明确同时参考了 opencode 的**存储实现**与**使用方式**：不仅参考三层 schema，也参考 `updateMessage/updatePart/updatePartDelta/messages()/hydrate/toModelMessages()` 这条完整调用链。
- Oracle 复核结论：OpenAWork 应采用**简化版** `session/message/part` 三层主事实；`messages_json` 保留为兼容层；delta 继续只做事件，不做数据库主存储。
