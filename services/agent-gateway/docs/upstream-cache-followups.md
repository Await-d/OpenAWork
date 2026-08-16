# 上游缓存与推理回放后续事项

原上游兼容层已由原生 OpenCode LLM 运行时替代。本记录保留仍适用于当前实现的行为约束，避免引用已删除的桥接模块。

## 仍需保持的约束

- 对已签名的 Anthropic 推理块，保留签名元数据并在后续请求中按供应商选项传递。
- OpenAI Responses 的 `itemId` 必须跨工具调用回合持久化，确保 `function_call.id` 与提示缓存前缀稳定。
- 相邻的已签名推理块之间保留一个文本结构分隔符，避免上游拒绝空内容序列。
- 工具结果必须以当前原生消息内容格式传递给 OpenAI-compatible 路由。

## 相关实现

- `src/v2-runtime/upstream/native-message-bridge.ts`
- `src/v2-runtime/upstream/message-transforms.ts`
- `src/v2-runtime/upstream/provider-options.ts`
- `src/routes/stream-model-round.ts`

变更上述路径时，应运行消息转换、工具回放和流式 Responses 聚焦测试，确认签名、工具调用标识与缓存前缀均可跨回合重放。
