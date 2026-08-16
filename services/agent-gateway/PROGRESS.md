# agent-gateway 原生上游迁移状态

`v2-runtime/upstream` 已完成切换至 `@openAwork/opencode-llm` 的原生模型、请求与流接口。网关不再依赖第三方上游适配层。

## 当前路径

- 非流式调用：`run-upstream-generate.ts` 构造原生 `LLMRequest`，并通过 `LLMClient.layer` 与 `RequestExecutor.fetchLayer` 执行。
- 流式调用：`stream-runner.ts` 产出 Effect `Stream`，保留文本、推理、工具调用、终止原因、用量与上游错误事件。
- 模型路由：`native-model.ts` 根据 provider、协议、密钥、端点与请求头构造原生模型。
- 消息转换：`message-transforms.ts`、`native-message-bridge.ts` 将会话消息映射为原生消息与系统提示。
- 工具声明：`tool-adapter.ts` 将网关工具转换为原生 JSON Schema 声明，实际执行仍由网关 agent loop 管理。
- 思考配置：`provider-options.ts` 为各供应商生成原生 provider options，并保留 OpenAI Responses 与 Anthropic Messages 协议覆盖。

## 已移除的兼容层

- 旧 provider 工厂与消息桥接模块。
- 旧缓存断点辅助模块。
- 旧工具声明包装与其专用测试。

## 验证命令

```bash
pnpm --filter @openAwork/agent-gateway typecheck
pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/v2-runtime
pnpm --filter @openAwork/agent-gateway test
```

完整网关检查可能同时覆盖其他进行中的 Effect 迁移；排障时应先运行与修改面对应的聚焦测试。
