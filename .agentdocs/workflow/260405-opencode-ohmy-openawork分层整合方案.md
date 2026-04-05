# .agentdocs/workflow/260405-opencode-ohmy-openawork分层整合方案.md

## Task Overview

分析 `temp/opencode` 与 `temp/oh-my-opencode` 的组合使用方式，并基于该组合关系，为 OpenAWork 制定一套可执行的分层整合方案，重点覆盖：

- 上游消息发送与信息管理
- 内核层 / 增强层边界
- hook / transform / config 设计
- 分阶段实施顺序与验证策略

## Current Analysis

### 参考库组合关系（结论）

1. `opencode` 是 **宿主内核 / runtime 平台**，负责：
   - session / message / part 持久化
   - provider runtime
   - compaction / continuation handoff
   - provider transform
   - plugin API
   - TUI / desktop / web 客户端承载

2. `oh-my-opencode` 是 **建立在 OpenCode 插件 API 之上的增强层**，负责：
   - 强意见 agents / hooks / tools / MCP
   - orchestration / background agents / workflow discipline
   - Claude Code compatibility bridge
   - 独立配置、安装器、doctor/CLI 包装

3. 两者的正确组合方式是：
   - `opencode` 作为宿主与内核
   - `oh-my-opencode` 作为 overlay / pack / harness layer
   - 用户运行的仍是同一个宿主，只是加载插件后默认行为被增强

### 对 OpenAWork 的直接启发

- 不要把 `oh-my-opencode` 当成第二个 runtime
- 不要同时复制两个底座
- 应采用“**内核层 + 可选增强层 + 客户端层**”的三层结构
- 首先要解决的是 **消息发送与信息管理可观测性**，否则后续 overlay 只会放大问题

### 已识别的风险点

1. 现有 OpenAWork 上游链路并非 lossless：存在 artifact 过滤、safe window、compaction、tool output 引用化等行为
2. 如果在没有稳定 hook ABI / transform ABI 的前提下先造 overlay 包，后续会形成强耦合
3. 如果把增强策略写进 Web/Desktop/Mobile，会破坏多客户端结构
4. 如果不引入 canonical message/part 模型，就无法精确审计“原始信息 / 展示信息 / 上游信息”的差异

## Solution Design

### 设计原则

1. **底座先稳，增强后叠**
2. **先 canonical，再 transform，再 overlay**
3. **发送链路必须可审计**
4. **UI 只消费结果，不承载 runtime 策略**
5. **增强层配置与核心配置分离**

### 目标分层

#### A. 内核层（OpenAWork Core）

建议继续由以下包承担：

- `packages/agent-core`
- `services/agent-gateway`
- `packages/shared`

职责：

- canonical message / part 模型
- session 持久化与查询
- provider runtime
- upstream message pipeline
- compaction / summary handoff
- tool execution / permission / retry / routing
- hook / transform ABI

#### B. 增强层（OpenAWork Overlay）

建议新增：

- `packages/agent-overlay`（名称可再议）

职责：

- opinionated agents
- orchestration defaults
- background task strategy
- curated MCP / tools / commands / skills
- compatibility bridge（Claude Code 风格）
- workflow discipline / todo continuation / think mode 等增强逻辑

约束：

- 不接管 session 持久化
- 不接管 transport
- 不直接改写 UI
- 只通过 hook / registry / config 接入

#### C. 客户端层（现有 Apps）

- `apps/web`
- `apps/desktop`
- `apps/mobile`

职责：

- chat / trace / session / task / thinking UI
- 运行态与恢复态可视化
- 设置与调试入口

约束：

- 不决定 upstream send 策略
- 不决定 compaction 策略
- 不直接承载 agent orchestration 逻辑

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: yes → +2
- Modules/systems/services: 3+ → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是跨三个代码库的架构比对与整合方案设计，涉及底座、增强层、发送链路、配置边界与多客户端结构，必须形成可持久的详细方案而不是一次性口头建议。

## Implementation Plan

### Phase 0：方案冻结与现状盘点

- [ ] T-01：冻结 OpenAWork 现有 upstream send 链路图（从 session → prepared conversation → provider messages → request body）
- [ ] T-02：补一份现有“信息变换清单”，列出 display 替换、artifact 过滤、safe window、compaction、tool output reference 等行为
- [ ] T-03：定义哪些行为属于“可接受变换”，哪些属于“必须可关闭 / 可审计变换”

### Phase 1：Canonical Message / Part 模型

- [ ] T-04：在 `packages/shared` 或 `packages/agent-core` 明确 canonical part schema
- [ ] T-05：覆盖至少 `text / reasoning / tool_call / tool_result / summary / artifact / compaction_marker / subtask`
- [ ] T-06：让 gateway 持久化层以 canonical part 为真相源，而不是只依赖拼接文本
- [ ] T-07：建立从 canonical log 到 Web/Desktop/Mobile 展示模型的稳定投影

### Phase 2：Upstream Pipeline 分层

- [ ] T-08：抽出 `PreparedConversationBuilder`
- [ ] T-09：抽出 `ProviderMessageTransform`
- [ ] T-10：抽出 `RequestBodyBuilder`
- [ ] T-11：为三层都增加 transformation report（输入条数、过滤条数、摘要替代条数、引用化条数、最终发模条数）

### Phase 3：Compaction 与信息管理策略

- [ ] T-12：把 compaction 明确为 continuation handoff，而不是纯 token trimming
- [ ] T-13：把 prune / safe window / tool output reference 阈值配置化
- [ ] T-14：补一套“高保真模式”开关，用于尽量减少上下文压缩
- [ ] T-15：审查 `displayMessage ?? message`，明确 rawMessage / displayMessage 双轨策略

### Phase 4：Hook / Overlay ABI

- [ ] T-16：先定义 hook ABI（messages.transform / provider.transform / session.compacting / tool.definition / chat.params / chat.headers）
- [ ] T-17：定义 overlay config 文件边界（例如 `.openawork/openawork-overlay.json`）
- [ ] T-18：新增 `packages/agent-overlay`，先只承载最小增强能力，不做大而全集成
- [ ] T-19：把强意见能力（agents / MCP / workflow discipline）从 core 抽离到 overlay

### Phase 5：渐进接入与兼容

- [ ] T-20：先让 overlay 以 workspace 包方式接入，不先做 installer/doctor
- [ ] T-21：验证 Web/Desktop/Mobile 在 overlay 缺失时仍可正常工作
- [ ] T-22：视需要再补 installer / doctor / compatibility bridge

## Verification Strategy

### 发送与信息完整性

- 验证 canonical log 与最终上游 request 的差异报告是否准确
- 验证 rawMessage 与 displayMessage 是否可同时审计
- 验证 compaction 前后是否可追溯到被摘要替代的范围

### 架构边界

- 验证 overlay 关闭时 core 行为不受影响
- 验证客户端不直接依赖 overlay 内部实现
- 验证 hook ABI 变更是否可通过版本检查发现

### 兼容与回归

- Web/Desktop/Mobile 基础 chat 流程不回归
- gateway provider 发送协议不回归
- compaction / recovery / task / thinking 等现有链路不回归

## Detailed Execution Plan

### Phase 0 详细拆解：现状冻结与发送链路审计

#### T-01：冻结 upstream send 链路图

**目标**

- 明确一次普通聊天请求从“会话消息”到“上游 HTTP body”的完整流转路径
- 为后续的 canonical/transform 改造建立基线

**涉及文件（首批）**

- `services/agent-gateway/src/routes/stream.ts`
- `services/agent-gateway/src/routes/stream-runtime.ts`
- `services/agent-gateway/src/routes/stream-model-round.ts`
- `services/agent-gateway/src/session-message-store.ts`
- `services/agent-gateway/src/routes/upstream-request.ts`
- `packages/agent-core/src/provider/*`

**操作步骤**

1. 列出普通聊天请求在 gateway 中的入口函数
2. 标记“取历史 / 组系统 prompt / 转 provider 协议 / 发 HTTP 请求”四个阶段
3. 画一张最小链路图：
   - Session messages
   - Prepared conversation
   - Provider messages
   - Request body
4. 把链路图落到文档中，作为后续实施基线

**产出物**

- 一张可追溯的 send pipeline 图
- 一个函数级别的调用清单

**验收标准**

- 能回答“哪一层在过滤 / 哪一层在做 provider 兼容 / 哪一层在拼 body”
- 文档中的每一层都能映射到具体文件与函数

#### T-02：建立“信息变换清单”

**目标**

- 把所有可能导致“和原始信息不一致”的行为列全

**必须覆盖的变换类型**

- `displayMessage` 替代原始 `message`
- artifact 过滤
- safe window 裁窗
- compaction summary 替代
- 大 tool output reference 化
- prune old tool_result
- omitBodyKeys
- 仅取 `final` 消息

**操作步骤**

1. 对每种变换补一条记录：
   - 触发条件
   - 代码位置
   - 变换前后差异
   - 是否可关闭
2. 输出到文档中的“信息变换清单”小节

**验收标准**

- 不再出现“我们感觉这里可能裁剪了”的模糊判断
- 每个变换都有代码位置和行为描述

#### T-03：定义变换分类与审计等级

**目标**

- 给所有变换分级，避免后续实现时把“正常过滤”和“高风险信息丢失”混在一起

**建议分类**

- A 类：必须保留的正常变换（如内部 UI artifact 过滤）
- B 类：允许存在，但必须可关闭 / 可观测（如 safe window、tool output reference）
- C 类：高风险，需要优先整改（如 raw message 被 display 覆盖）

**产出物**

- 一张变换分级表
- Phase 1/2 的改造优先级输入

### Phase 1 详细拆解：Canonical Message / Part 模型

#### T-04：冻结 canonical schema 归属位置

**目标**

- 明确 schema 在哪个包里定义、哪个层是真相源

**推荐方案**

- `packages/shared`：放纯类型 / schema / DTO
- `packages/agent-core`：放运行时转换与操作 helper
- `services/agent-gateway`：放持久化映射与 SQLite schema

**决策点**

- `shared` 只放“无业务副作用结构”
- `agent-core` 不要承担 gateway 存储细节

#### T-05：定义 part taxonomy

**最小 part 集合**

- `text`
- `reasoning`
- `tool_call`
- `tool_result`
- `summary`
- `artifact`
- `compaction_marker`
- `subtask`
- `system_injected_context`

**建议文件**

- `packages/shared/src/index.ts`
- 可新建：`packages/shared/src/message-parts.ts`

**操作步骤**

1. 先给每类 part 定义最小字段集
2. 明确哪些 part 是“可上游发送”，哪些是“仅本地/仅 UI”
3. 定义 role + part 的组合约束（如 user 不允许 reasoning，tool_result 需绑定 toolCallId）

**验收标准**

- 现有 thinking/tool/subtask/summary 都能映射到 part 模型
- 不再依赖字符串拼接去表达结构语义

#### T-06：Gateway 持久化层切换到 canonical truth

**目标**

- 让 session 存储的真相源从“拼接文本/弱结构 content”逐步过渡到 canonical part

**涉及位置**

- `services/agent-gateway/src/session-message-store.ts`
- 相关 SQLite message/content 持久化逻辑

**操作步骤**

1. 先在读取链路中支持 canonical 结构
2. 再在写入链路中逐步补齐 canonical part 写入
3. 保留 legacy 兼容读，不一次性切断旧结构

**迁移策略**

- read path 先兼容
- write path 再迁移
- legacy backfill 最后做

#### T-07：建立 canonical → UI projection

**目标**

- Web/Desktop/Mobile 不直接消费底层原始存储结构，而是消费稳定 projection

**建议投影对象**

- `assistant_trace`
- `thinking blocks`
- `tool timeline`
- `answer body`
- `session summary`

**涉及位置**

- `apps/web/src/pages/chat-page/support.ts`
- `apps/web/src/components/chat/*`
- `apps/mobile/src/chat-message-content.ts`

**验收标准**

- 同一 canonical message 在三端的展示语义一致
- 不再需要为 Web/Mobile 各写一套临时 reasoning 解析器

### Phase 2 详细拆解：Prepared → Transform → RequestBody

#### T-08：抽出 PreparedConversationBuilder

**职责**

- 从 canonical session history 选择本轮有效上下文
- 处理 compaction boundary
- 处理 artifact 过滤
- 处理 latest user fallback

**建议位置**

- `services/agent-gateway/src/conversation/prepared-conversation-builder.ts`

#### T-09：抽出 ProviderMessageTransform

**职责**

- reasoning 字段映射
- toolCallId/provider metadata 兼容
- strip media / interleaved reasoning / provider-specific message fixes

**建议位置**

- `packages/agent-core/src/provider/message-transform.ts`
  或
- `services/agent-gateway/src/provider/provider-message-transform.ts`

#### T-10：抽出 RequestBodyBuilder

**职责**

- `/responses` vs `/chat_completions`
- headers / omitBodyKeys / overrides / protocol body merge

**建议位置**

- 保持在 `services/agent-gateway/src/routes/upstream-request.ts`，但拆成更细 helper

#### T-11：Transformation Report

**目标**

- 每次发给上游时都能知道“哪些东西变了”

**建议字段**

- `rawMessageCount`
- `preparedMessageCount`
- `filteredArtifactCount`
- `compactedHistoryCount`
- `referencedToolOutputCount`
- `providerNormalizedCount`
- `finalOutboundMessageCount`

**可见性建议**

- gateway debug log
- session audit 表
- 可选的开发者调试面板

## Dependency Graph

- T-01 → T-02 → T-03
- T-03 → T-04
- T-04 → T-05 → T-06 → T-07
- T-03 → T-08
- T-05 + T-08 → T-09 → T-10 → T-11
- T-11 完成后，Phase 3 的 compaction / fidelity 策略才有足够可观测基础

## Execution Notes

- **不要** 先建 `packages/agent-overlay` 再补底层 ABI
- **不要** 先改 Web thinking / answer UI 再统一 canonical schema
- **不要** 一次性迁移旧消息；先兼容读，再迁写入

## Immediate Next Step

建议下一轮直接启动：

1. `T-01`：画 OpenAWork 当前 upstream send pipeline
2. `T-02`：输出信息变换清单
3. `T-03`：把变换分成 A/B/C 三类

只有完成这三步，后续 canonical / transform / overlay 改造才不会失焦。

## T-01 / T-02 / T-03 执行前分析稿

### T-01 正式版：OpenAWork 当前 send pipeline 图

```text
[Client Request]
  │
  ├─ apps/web / desktop / mobile → web-client / gateway 请求体
  │
  ▼
[Gateway Route Entry]
  services/agent-gateway/src/routes/stream.ts
  services/agent-gateway/src/routes/stream-runtime.ts
  │
  ├─ persistStreamUserMessage()
  │    services/agent-gateway/src/stream-session-title.ts
  │    - 写入 user message
  │    - 当前使用 displayMessage ?? message
  │
  ▼
[Session History Fetch]
  services/agent-gateway/src/routes/stream-model-round.ts
  │
  ├─ listSessionMessages(statuses: ['final'])
  │    services/agent-gateway/src/session-message-store.ts
  │
  ▼
[Prepared Conversation]
  services/agent-gateway/src/session-message-store.ts
  │
  ├─ buildPreparedUpstreamConversation()
  │    ├─ filter !isContextArtifactMessage()
  │    ├─ selectMessagesSinceCompactionBoundary()
  │    ├─ selectSafeConversationWindow()   (conditional)
  │    └─ prepend [COMPACT BOUNDARY] summary (conditional)
  │
  └─ buildUpstreamConversationFromHistory()
       ├─ tool_result → tool role message
       ├─ assistant text → strip assistant UI event text
       ├─ modified_files_summary → inject context text
       └─ assistant tool_call → serialize tool_calls
  │
  ▼
[Round System Layer]
  services/agent-gateway/src/routes/stream-system-prompts.ts
  │
  ├─ buildRoundSystemMessages()
  │    - workspace context
  │    - route system prompt
  │    - request system prompts
  │    - tool output readback guidance
  │    - memory block
  │
  ▼
[Upstream Message Assembly]
  services/agent-gateway/src/routes/stream-model-round.ts
  │
  ├─ upstreamMessages =
  │    system messages
  │  + prepared conversation
  │  + syntheticContinuationPrompt (optional user message)
  │
  ▼
[Provider Request Body]
  services/agent-gateway/src/routes/upstream-request.ts
  │
  ├─ buildUpstreamRequestBody()
  │    ├─ protocol split: /responses vs /chat_completions
  │    ├─ applyRequestOverridesToBody()
  │    │    └─ omitBodyKeys
  │    ├─ applyThinkingConfigToBody()
  │    └─ provider-specific body adaptation
  │
  ▼
[HTTP POST to Upstream Provider]
  fetchUpstreamStreamWithRetry()
  │
  ▼
[SSE/Stream Parse]
  stream-protocol.ts / runModelRound()
  │
  ▼
[Assistant Finalization]
  buildAssistantContent() / appendSessionMessage()
```

#### T-01.1 分层说明（正式版）

##### Layer A：入口层（Route / Request Ingress）

**文件**

- `services/agent-gateway/src/routes/stream.ts`
- `services/agent-gateway/src/routes/stream-runtime.ts`
- `services/agent-gateway/src/stream-session-title.ts`

**职责**

- 接住客户端请求
- 记录 user message
- 初始化 request-scoped stream 运行上下文

**当前关键事实**

- 这里已经发生第一处语义选择：`displayMessage ?? message`

##### Layer B：历史选择层（Session History Selection）

**文件**

- `services/agent-gateway/src/routes/stream-model-round.ts`
- `services/agent-gateway/src/session-message-store.ts`

**职责**

- 只取 `final` 消息
- 选择当前轮次应进入模型上下文的历史范围

**当前关键事实**

- 非 final 消息不会进入主轮次上下文
- history 进入 prepared conversation 前已经可能被 boundary/window 改写
- `listSessionMessages()` 在 legacy 场景下不是纯读取；`hydrateLegacyMessages()` 可能先把旧 `messages_json` 写回正式消息表，再继续后续链路

##### Layer C：prepared conversation 层

**文件**

- `services/agent-gateway/src/session-message-store.ts`

**职责**

- artifact 过滤
- compaction boundary 处理
- safe window 裁窗
- 历史消息 → upstream chat message 映射

**当前关键事实**

- 这一层是“是否完整发送”的核心风险层
- 也是未来应拆成 `PreparedConversationBuilder` 的最优位置

##### Layer D：system/context 注入层

**文件**

- `services/agent-gateway/src/routes/stream-system-prompts.ts`

**职责**

- 注入 workspace / route / memory / tool-output-guidance 等系统上下文

**当前关键事实**

- 这里不是剔除信息，而是新增系统上下文
- 但它会改变模型实际收到的总上下文语义，应纳入审计
- `hasToolOutputReference()` 会反向影响 `buildRoundSystemMessages()` 是否附加“读回工具输出”的系统指导
- `syntheticContinuationPrompt` 会在 conversation 之后再额外插入一条 user continuation

##### Layer E：provider body transform 层

**文件**

- `services/agent-gateway/src/routes/upstream-request.ts`
- `packages/agent-core/src/provider/utils.ts`

**职责**

- protocol 分支
- thinking/reasoning 参数映射
- omitBodyKeys
- requestOverrides 合并

**当前关键事实**

- 这是“消息仍然还在，但 body 字段可能变化/删除”的层
- 未来应拆成 `ProviderMessageTransform` + `RequestBodyBuilder`
- 顺序必须明确记录：`requestOverrides` → `include_usage`/protocol options → `thinking config`
- `omitBodyKeys` 不是 send pipeline 的最后一步，后续 thinking config 仍可能再次写入 body 字段

##### Layer F：上游交互与回写层

**文件**

- `services/agent-gateway/src/routes/stream-model-round.ts`
- `services/agent-gateway/src/routes/stream-protocol.ts`

**职责**

- 发 HTTP 请求
- 解析流式 chunk
- 组装 assistant final content 并写回 session

**当前关键事实**

- 这层决定“如何从 provider 输出回写到本地 canonical history”
- 它本身不负责选择历史，但负责最终落库形态

#### T-01.2 当前 send pipeline 的关键瓶颈

1. **Layer A 和 Layer C 之间没有 raw/display 分离的显式边界**
2. **Layer C 同时承担了“过滤 / 裁窗 / compaction / 映射”四种职责，耦合过高**
3. **Layer D 与 Layer E 的上下文注入 / provider 兼容没有独立审计输出**
4. **当前 pipeline 没有统一 transformation report，无法回答‘这一轮到底丢了什么、补了什么’**

### T-01 当前 upstream send pipeline（基线）

#### A. 用户消息写入会话

入口：`services/agent-gateway/src/stream-session-title.ts:13-24`

当前行为：

1. `persistStreamUserMessage(input)` 被调用
2. 实际写入 session 的文本是：

```ts
const text = input.displayMessage ?? input.message;
```

3. `appendSessionMessage()` 将该文本作为 `user` message 入库
4. 同时 `maybeAutoTitle()` 用同一份文本生成会话标题

#### B. 主轮次发送前取历史

入口：`services/agent-gateway/src/routes/stream-model-round.ts:183-200`

当前行为：

1. `runModelRound()` 调用 `listSessionMessages()`
2. 仅取 `statuses: ['final']`
3. 得到 `finalMessages`
4. 调用 `buildPreparedUpstreamConversation(finalMessages, ...)`

#### C. 会话历史准备为上游 conversation

入口：`services/agent-gateway/src/session-message-store.ts:435-477`

当前行为：

1. 过滤 context artifacts：

```ts
const normalizedMessages = messages.filter((message) => !isContextArtifactMessage(message));
```

2. 根据 compaction marker / persistedMemory 选择 compaction boundary 之后的历史
3. 如果未显式给 `contextWindow`，则调用 `selectSafeConversationWindow()` 做窗口裁剪
4. 将历史映射为 `UpstreamChatMessage[]`
5. 如果存在 compaction summary，则额外 prepend 一条 system message：
   - `[COMPACT BOUNDARY]`
   - `Earlier conversation history has been compacted...`

#### D. 历史消息转上游消息

入口：`services/agent-gateway/src/session-message-store.ts:492-561`

当前行为：

1. `tool` role 仅发送 `tool_result`
2. `assistant` role：
   - 过滤 assistant UI event text
   - 保留 text
   - 注入 modified_files_summary 上下文
   - 序列化 tool_calls
3. `user` role：只发送合并后的 text 内容

#### E. 组装最终上游输入

入口：`services/agent-gateway/src/routes/stream-model-round.ts:201-237`

当前行为：

1. 前置 system prompt 来自 `buildRoundSystemMessages()`
2. 中间拼上 prepared conversation
3. 若有 syntheticContinuationPrompt，再拼一条 user continuation
4. 最终交给 `buildUpstreamRequestBody()`

#### F. 构造 provider request body

入口：`services/agent-gateway/src/routes/upstream-request.ts:114-145, 148-233, 259+`

当前行为：

1. 根据协议选择 `/responses` 或 `/chat/completions`
2. 应用 request overrides
3. 根据 providerType 注入 thinking/reasoning 参数
4. 删除 `omitBodyKeys`
5. 最终生成可直接 POST 的 upstream body

### T-02 当前“信息变换清单”

> 说明：这里的“替换/替代”不只指 `displayMessage ?? message` 这种显式 raw/display 替代，也包括“原始内容被结构化引用或占位文本替代”的等价行为，例如大 tool output → `tool_output_reference`、旧 tool_result → compaction placeholder。

| 编号 | 变换点 | 代码位置 | 当前行为 | 影响对象 |
|---|---|---|---|---|
| X-01 | display 替代 raw | `stream-session-title.ts:13-24` | `displayMessage ?? message` | 用户原始输入 |
| X-02 | artifact 过滤 | `session-message-store.ts:447-457` | `isContextArtifactMessage()` 过滤 | UI/internal messages |
| X-03 | compaction boundary | `session-message-store.ts:448-456` | 只取 boundary 后历史 | 较早历史 |
| X-04 | safe window 裁窗 | `session-message-store.ts:453-456`, `1158+` | `selectSafeConversationWindow()` | 长会话历史 |
| X-05 | summary 替代历史 | `session-message-store.ts:463-475` | prepend compact summary system message | 被摘要的旧历史 |
| X-06 | assistant UI 文本过滤 | `session-message-store.ts:512-521` | `isAssistantUiEventTextForMessage()` | assistant text |
| X-07 | modified_files_summary 注入 | `session-message-store.ts:523-530` | 将文件摘要并入 assistantContextText | assistant outbound content |
| X-08 | tool output 序列化/引用化 | `session-message-store.ts:499-507`, `933+` | `serializeToolOutput()`，大输出 reference 化 | tool_result |
| X-09 | compaction prune | `session-compaction.ts:43-82` | 旧 tool_result 替换 placeholder | compaction 输入 |
| X-10 | only-final selection | `stream-model-round.ts:183-189` | 仅取 `final` messages | 非 final 历史 |
| X-11 | omitBodyKeys | `upstream-request.ts:141-143` + provider utils | 删除 body 字段 | provider request body |
| X-12 | provider-specific thinking transform | `upstream-request.ts:148-233` | 不同 provider 不同 thinking/reasoning 映射 | 上游 body 语义 |
| X-13 | responses 协议消息形态转换 | `upstream-request.ts:259+` | chat 风格消息转为 `input_text` / `output_text` / `function_call_output` | 上游协议表示 |
| X-14 | system/context 注入 | `stream-model-round.ts:201-214` + `stream-system-prompts.ts` | route/workspace/request/memory/tool-output-guidance 注入上游 system messages | 上游上下文 |
| X-15 | syntheticContinuationPrompt 注入 | `stream-model-round.ts:210-214` | 在 conversation 末尾再附加一条 user continuation | 上游对话末尾 |
| X-16 | legacy hydration side effect | `session-message-store.ts:286-295` | legacy messages 读取前可能先 hydrate 到正式消息表 | send 前历史来源 |

### T-03 当前分类建议（A/B/C）

#### A 类：正常且建议保留

- A-01：artifact 过滤（X-02）
- A-02：assistant UI 文本过滤（X-06）
- A-03：provider-specific thinking transform（X-12）

**原因**：这些变换是为了防止 UI/internal 噪音污染模型，或适配 provider 协议，属于底层系统应当承担的职责。

#### B 类：允许存在，但必须可关闭 / 可审计

- B-01：safe window 裁窗（X-04）
- B-02：summary 替代历史（X-05）
- B-03：tool output 序列化/引用化（X-08）
- B-04：compaction prune（X-09）
- B-05：only-final selection（X-10）
- B-06：omitBodyKeys（X-11）
- B-07：responses 协议消息形态转换（X-13）
- B-08：system/context 注入（X-14）
- B-09：syntheticContinuationPrompt 注入（X-15）
- B-10：legacy hydration side effect（X-16）

**原因**：这些都可能导致“发送给上游的信息不完整”，但未必应该一刀切去掉；正确做法是让它们可配置、可关闭、可审计。

#### C 类：高风险，建议优先整改或澄清

- C-01：`displayMessage ?? message`（X-01）
- C-02：modified_files_summary / provenance 注入（X-07）
- C-03：原始 tool output 被 reference/placeholder 替代但缺少统一审计可见性（X-08 / X-09）

**原因**：

- C-01 可能导致真正入会话、再入上游的不是原始用户输入
- C-02 会在 assistant 文本之外再额外拼接工程上下文；这一项是“可争议 C 类”：若按 provenance 混入看应维持 C，若仅按信息丢失看可降到 B，但无论如何都必须显式标记来源
- C-03 虽然在策略上可能合理，但当前没有统一 transformation report 时，用户很难知道“模型看到的是全文、引用还是占位”，这会直接影响“发送是否完整”的判断

### T-01/T-02/T-03 的建议产出物

1. 一张 send pipeline 图（函数级）
2. 一张信息变换清单表
3. 一张 A/B/C 分类表
4. 一份后续 Phase 1/2 的输入决策：
   - 哪些行为转为 configurable
   - 哪些行为必须进入 transformation report
   - 哪些行为必须改 canonical schema 才能消解

### T-01/T-02 顺序依赖补充

1. `listSessionMessages()` 不是严格纯读；legacy hydration 可能在 send path 之前发生写回，因此 send pipeline 的“历史来源”必须同时记录 hydrated 与 persisted 两种来源。
2. `buildPreparedUpstreamConversation()` 同时服务：
   - 普通 send path
   - compaction LLM path
   后续重构时不能只看主聊天链路。
3. `selectSafeConversationWindow()` 不只是裁消息数量，它还会：
   - 保 tool_call / tool_result 配对
   - 补回最新 user message
   所以不能简单把它归类为粗暴 truncation。
4. `hasToolOutputReference()` 会反向影响 system prompt 注入（是否提醒模型读回工具输出），因此 X-08 与 X-14 是联动变换，后续 transformation report 应同时记录。

## Notes

- 当前不建议先做 installer/doctor；那是 overlay 产品化阶段工作，不是架构收敛第一步
- 当前不建议把 oh-my-opencode 的 agents/hooks 原样搬进 OpenAWork；应先建立 ABI，再逐步迁入最有价值的增强能力
- 当前建议优先处理发送链路的可观测性，否则后续很难判断“是否完整发送”
