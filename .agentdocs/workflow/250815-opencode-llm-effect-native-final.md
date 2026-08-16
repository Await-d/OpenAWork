# OpenCode LLM 原生 Effect 终态迁移

## 任务概览

在既有 OpenCode LLM 迁移基础上，完成用户明确要求的终态：移除 agent-gateway 对 AI SDK 的生产依赖和调用，所有 upstream、路由、中间件、入口和测试路径统一使用 `@openAwork/opencode-llm` 的 Effect `Model`、`LLMRequest`、`LLMClient.layer` 与 `RequestExecutor.fetchLayer`。

关联原计划：[250109-opencode-llm-full-migration.md](250109-opencode-llm-full-migration.md)

## 当前分析

上一轮保留的 AI SDK `streamText`/`generateText` 兼容路径不是可接受终态。本轮以当前生产调用链为基线，先建立 native Effect contract 和真实 HTTP executor，再迁移调用者；不能用 Promise/AsyncGenerator 包装层伪装完成。

必须保持：消息事件、tool-call、finish/usage、stall/cancel、SSE/WS、错误状态和 replay 语义；必须移除：`ai`、`@ai-sdk/*` 生产依赖、`streamText`、`generateText`、`LanguageModelV4`、AI SDK compat 类型/转换层。

## Complexity Assessment

- 原子步骤：至少 12 个 → +2
- 并行流：是，契约/基础设施/核心/路由/清理/QA 可并行 → +2
- 模块/系统：7+ → +1
- 长步骤：是，stream/layer/全量回归超过 5 分钟 → +1
- 持久化审查：是 → +1
- OpenCode 原生计划工具：不可用 → 0
- **总分**：7
- **选择模式**：Full orchestration
- **路由理由**：跨包、跨 runtime、跨 HTTP 流协议的终态迁移，需要依赖顺序和多代理证据。

## 终态不变量

1. gateway 生产源码中不存在 `ai`、`@ai-sdk/*`、`streamText`、`generateText`、`LanguageModelV4`。
2. stream/generate 使用 `Effect.gen`、`Stream.Stream`、`LLMClient.layer` 和 `RequestExecutor.fetchLayer`，不暴露 `AsyncGenerator`。
3. route/middleware 只消费 Effect 结果和 Stream；HTTP 传输层负责 `Effect.runPromise` 的唯一边界运行。
4. `packages/opencode-llm` typecheck/build、gateway typecheck/build、全量测试和真实 `/health`、`/metrics`、SSE、tool、replay 场景均有证据。
5. 失败优先测试、备份 SHA、依赖清单、删除清单和回滚文档全部落盘。

## 迁移波次

### Wave 0：基线与契约

- [x] N-01：备份并锁定 core/gateway 迁移前状态，建立 native Effect contract failing-first 测试。
- [x] N-02：确认 `Model`/`LLMRequest`/`LLMClient.layer`/`RequestExecutor.fetchLayer` 的最小构造器与依赖 Layer。

### Wave 1：基础设施与模型解析

- [x] N-03：实现 gateway provider 配置到 OpenCode `Model`/`Route` 的解析，不再返回 AI SDK model。
- [x] N-04：修复 gateway Effect 4 beta runtime/service/bus/bridge API，使 native layer 可启动。

### Wave 2：核心 upstream

- [x] N-05：将 `runUpstreamStream` 改为 native Effect `Stream`，保留事件、tool、finish/usage、stall/cancel。
- [x] N-06：将 `runUpstreamGenerate` 改为 native Effect `Effect`，保留生成结果、超时、错误和 usage。

### Wave 3：调用方与传输

- [x] N-07：迁移 `stream-model-round`、session/workflow/compaction 等所有 upstream 调用者。
- [x] N-08：迁移 Fastify SSE/WS/middleware 为 Effect 边界运行，保持 HTTP 错误和 replay 语义。

### Wave 4：移除 AI SDK

- [x] N-09：删除 AI SDK compat 类型/适配器、生产 imports、manifest entries 和 lockfile 残留。
- [x] N-10：迁移/删除所有仅服务 AI SDK 的测试与示例，补 native Effect integration/E2E。

### Wave 5：全量验证与发布门禁

- [x] N-11：全包 typecheck/build/test、gateway verification matrix、SSE/WS/tool/replay/cancel QA。
- [ ] N-12：真实隔离部署、LLM 流负载、回滚演练、临时资源清理、独立审查和最终状态同步（本地代码与 fixture gate 已通过；真实 provider/部署及 exact-SHA 五路 review 仍是外部/人工 gate，详见 `results/backup-receipts.md`、`results/global-review-gate.md`）。

## 明确禁止

- 不得新增 AI SDK 兼容包装层作为终态。
- 不得用 `as any`、`@ts-ignore`、`@ts-expect-error` 或删除失败测试来“过绿”。
- 不得在没有 native Effect layer 和真实 HTTP executor 的情况下将 N-05/N-06 标记完成。

## 验收与证据

每个 N 任务必须写入 `.agentdocs/runtime/250815-opencode-llm-effect-native-final/results/`，包括 failing-first、修改文件、精确命令、真实面 QA、adversarial 类别和清理收据。协调器负责复选框、master plan、ledger、index 和团队生命周期。
