# 上游缓存命中率：剩余的 opencode 对齐项

> 这次已经落地的修复请参看 commit log：
>
> - 断点 rolling window (`slice(-2)`)
> - 上游 normalizeMessages (sanitizeSurrogates / dropEmptyContent / scrubClaudeToolIds / splitAnthropicAssistantToolCallText / scrubMistralToolIds + Mistral `tool→user` 间插 / withDeepSeekReasoning)
> - provider `promptCacheKey` / `prompt_cache_key` / `gateway.caching=auto`
> - 2-segment system (stable + dynamic)
> - 移除 wall-clock tool-result 裁剪
> - **Anthropic 扩展思维 signature 全链路** (流解析 → ReasoningBlock → ReasoningPart.metadata.anthropic.signature → unified-message-bridge providerOptions)
> - **`differentModel` reasoning 元数据回放策略** (toModelMessages currentModel 选项)
> - **空 text + 已签名 reasoning 单空格分隔符保护** (unified-message-bridge)
>
> 本文记录尚未实施、但与缓存命中或扩展思维正确性相关的差异，按影响排序。

## ✅ ~~1) Anthropic 扩展思维 `signature` 全链路丢失~~ — 已修复

实现：

- `stream-protocol.ts`: `content_block_delta` 的 `signature_delta` 分支累计到 `state.anthropicThinkingSignatures`，在 `content_block_stop` 与 `message_stop` 兜底时透出到 `thinking_end.providerMetadata.signature`
- `stream-runner.ts`: `reasoning-end` 读取 AI SDK `part.providerMetadata.anthropic.signature` 转发到 `thinking_end`
- `reasoning-blocks.ts`: `ReasoningBlock.signature` + `markReasoningBlockEnded` 接收 `chunk.providerMetadata.signature`
- `stream-model-round.ts buildAssistantContent`/`buildOrderedAssistantContent`: 把 `block.signature` 写入 `ReasoningContent.signature`
- `message-schema.ts`: `ReasoningContent.signature?: string`
- `message-v2-adapter.ts`: v1↔v2 双向桥接 `metadata.anthropic.signature`
- `message-to-model-messages.ts`: `AssistantReasoning.blocks?: AssistantReasoningBlock[]` (per-block `text + signature`)
- `unified-message-bridge.ts`: 当 `reasoning.blocks` 存在，每个 block emit 一个 `{type:'reasoning', text, providerOptions:{anthropic:{signature}}}`，让 AI SDK Anthropic adapter 自动序列化为 `{type:'thinking', thinking, signature}`

回归测试：`reasoning-blocks.test.ts` (signature 透传)、`v2-runtime-unified-bridge.test.ts` (per-block providerOptions + 单空格分隔符)。

## ✅ ~~1-legacy) Anthropic 扩展思维 `signature` 详细 todo~~ (已完成)

<details>
<summary>原始详细分析（保留作为变更上下文）</summary>

**历史症状**

- Claude 3.7+ 启用 extended thinking 后，多轮对话每轮都重新「想」一遍，浪费 reasoning tokens；
- 在 thinking → tool_use 序列里，下一轮重放时 Anthropic 报 `Expected 'thinking' block to have a 'signature'`，触发现有的 `thinking_block_order` recovery 兜底；
- 即使没报错，因为重放路径其实丢失了 thinking，Anthropic 的「thinking 缓存」会失效，用户感受到「跨轮思维不连贯」。

**根因**

| 环节        | 代码位置                                                                             | 问题                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 流解析      | `services/agent-gateway/src/routes/stream-protocol.ts:535-558`                       | 只取 `delta.type === 'thinking_delta'` 的文本，忽略 `delta.type === 'signature_delta'` 的 `delta.signature` |
| 内存模型    | `services/agent-gateway/src/reasoning-blocks.ts:3-10`                                | `ReasoningBlock` 没有 `signature` 字段                                                                      |
| 持久化      | `services/agent-gateway/src/message-v2-schema.ts:79-86`                              | `ReasoningPart.metadata` 已存在，但没有路径写入 `metadata.anthropic.signature`                              |
| 重放        | `services/agent-gateway/src/render-anthropic-messages.ts:153-158`                    | 用 `msg.reasoning.summary`（OpenAI Responses-API 概念），Anthropic 流根本不会塞进 `summary`                 |
| AI SDK 路径 | `services/agent-gateway/src/v2-runtime/upstream/normalized-message-bridge.ts:80-100` | `reasoning` 仅折成 `{type: 'reasoning', text}`，无 providerMetadata 透传                                    |

**修复步骤**

1. `stream-protocol.ts` 中 `case 'content_block_delta'` 增加 `signature_delta` 分支：
   ```ts
   if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
     return [
       {
         type: 'thinking_signature',
         signature: delta.signature,
         outputIndex: payload.index,
         ...createChunkMeta(state),
       },
     ];
   }
   ```
2. `reasoning-blocks.ts` 中 `ReasoningBlock` 加 `signature?: string`，`appendReasoningChunk` 根据 chunk 类型决定 append text / set signature。
3. `stream-model-round.ts` 处理 `thinking_signature` chunk，把 signature 落到对应 ReasoningBlock；持久化时写入 `ReasoningPart.metadata.anthropic.signature`。
4. `render-anthropic-messages.ts` 优先用 `reasoning.text + signature` 渲染 `{type:'thinking', thinking, signature}`；fallback 才用 `summary`。
5. `normalized-message-bridge.ts` 把 `reasoning.text + metadata` 透传给 AI SDK ReasoningPart 的 `providerOptions.anthropic.signature`，让 AI SDK 上游适配器自然 emit signed thinking。

**验证**

- 新增 `__tests__/anthropic-signed-thinking.test.ts`：构造一段 SSE 含 `thinking_delta` + `signature_delta`，断言：
  - 持久化后的 `ReasoningPart.metadata.anthropic.signature` 与流中一致；
  - `renderAnthropicMessages` 重放时 `body.messages[i].content[j]` 包含 `{type:'thinking', thinking, signature}`；
  - 跨模型场景（model swap）下 signature 被丢弃。

</details>

## ✅ ~~2) `differentModel` reasoning 元数据回放~~ — 已修复

实现：

- `toModelMessages(input, { currentModel: { providerID, modelID } })`
- 当 `info.providerID/modelID` ≠ currentModel 时，丢弃 `signature/encryptedContent/summary/responseId/blocks`，保留纯 `text`
- `stream-model-round.ts` 在调用处注入 `input.route.providerType` + `input.route.model`

## ✅ ~~3) Anthropic 「空 text + 已签名 reasoning」单空格分隔符~~ — 已修复

实现：`unified-message-bridge.ts` 在 `reasoning.blocks` 中存在 ≥1 个签名块时，对每两个相邻 block 之间插入 `{type:'text', text:' '}`(单空格)，作为相邻 signed reasoning 的结构分隔符。

## ~~legacy 详细分析(低优先级，备查)~~

<details>
<summary>原 #2/#3 详细分析（保留作为变更上下文）</summary>

### 2) `differentModel` reasoning 元数据回放（中优先级，依赖 #1）

opencode `message-v2.ts:840` 检测「当前 model ≠ 历史消息的 model」时，丢弃 `providerMetadata` 与 `callProviderMetadata`，把 reasoning 转成纯 text part。

**OpenAWork 现状**

- `toModelMessages` 没有任何 model 上下文，无法做这层判断；
- `AssistantMessage` 在 `message-v2-schema.ts` 已经记录了 `providerID` / `modelID`，所以信息存在。

**修复步骤**

1. `toModelMessages(input, options)` 接收当前 `{providerID, modelID}`；
2. 对每条 assistant 消息比较 `info.providerID/modelID` 与当前调用的 model；
3. 不一致时：
   - 丢弃 `reasoning.encryptedContent` / `summary` / `signature`；
   - 仅保留 `reasoning.text` 作为普通文本（拼到 `content` 前），与 opencode `differentModel` 行 959-965 对齐。
4. 在 `stream-model-round.ts` 调用处把 `input.route.model` 与 `route.providerType` 注入。

## 3) Anthropic 「空 text + 已签名 reasoning」单空格分隔符（低优先级，依赖 #1）

opencode `message-v2.ts:874-880`：当某条 assistant 消息含已签名 reasoning 时，空 text part 保留为 `' '`（单空格），作为相邻两段 signed reasoning 之间的结构分隔符；空字符串会被 AI SDK 过滤、被 Anthropic 拒绝。

**OpenAWork 现状**

- `buildAssistantParts` 用 `\n` 拼 text 后 `trim()`，空 part 直接被吞，导致 `[step-start, reasoning(signed), text(""), step-start, reasoning(signed)]` 序列错位。

**修复步骤**

- `buildAssistantParts` 检测 `parts.some(p => p.type === 'reasoning' && p.metadata?.anthropic?.signature)`，true 时把空 text part 替换为单空格 `' '` 而非丢弃。

</details>

## 4) tool_result 附件按 provider 分流（低优先级 / 体验优化）

opencode `message-v2.ts:898-901`：仅在 `!supportsMediaInToolResults`（OpenAI-compatible 等）时才把 tool 输出里的 image 附件走「合成 user 消息」；Anthropic / OpenAI / Bedrock / Vertex 直接把附件嵌进 `tool_result.content`。

**OpenAWork 现状**

- `message-to-model-messages.ts:273-285` 不论 provider 都追加合成 user 消息。Anthropic 路径每条带图 tool_result 都多一条 user 消息，token 略冗余；不影响缓存（字节稳定）。

**修复步骤**

1. 扩展 `ToolResultMessage` schema，加 `attachments?: Array<{ mime, url, detail? }>`；
2. `pushToolResult` 把 attachments 写到 ToolResultMessage 而非合成 user；
3. `render-anthropic-messages.ts` tool 分支把 attachments 转成 Anthropic `image` 块嵌进 `tool_result.content` 数组；
4. `normalized-message-bridge.ts` 对 OpenAI-compatible 路径生成 `{type:'content', value:[...]}` ToolResultPart（让 AI SDK 自动处理）；
5. 旧合成路径仅在 provider capability 检测为不支持时使用。

## 5) opencode 风格的 `prune` 步骤（中优先级）

我们已经移除了基于墙钟的运行时年龄裁剪，缓存稳定性恢复。但旧 tool 输出的「持久化压缩」缺失，长 session 在触发 compaction 之前可能因总 token 超限而 overflow。

**修复步骤**（参考 opencode `compaction.ts:300-344`）

- 在 `session-compaction.ts` 加 `prune({sessionId})`：从最新往老遍历 tool parts，累计 token 直到 `PRUNE_PROTECT` 阈值；之外的 completed tool parts 持久化写入 `part.state.time.compacted = Date.now()`，并 emit `PartV2 update` 事件；
- 在 overflow recovery 与 auto-compaction 触发点先调用 `prune`，给 compaction 留出缓冲；
- 这样 `resolveToolOutput` 的 `if (part.state.time.compacted)` 分支会自然命中，渲染端改动为 0。
