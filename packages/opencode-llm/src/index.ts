export { LLMClient } from './route/client.js';
export { RequestExecutor } from './route/executor.js';
export { Auth } from './route/auth.js';
export { Provider } from './provider.js';
export { isContextOverflow, isContextOverflowFailure } from './provider-error.js';
export type {
  RouteModelInput,
  RouteRoutedModelInput,
  Interface as LLMClientShape,
  Service as LLMClientService,
  StreamOptions,
} from './route/client.js';
export type { HttpHandler, HttpMiddleware } from './route/transport/index.js';
export type {
  Interface as RequestExecutorShape,
  Service as RequestExecutorService,
} from './route/executor.js';
export * from './schema/index.js';
export { Tool, ToolFailure, toDefinitions } from './tool.js';
export { ToolRuntime } from './tool-runtime.js';
export type { DispatchResult as ToolDispatchResult, ToolSettlement } from './tool-runtime.js';
export type {
  AnyExecutableTool,
  AnyTool,
  ExecutableTool,
  ExecutableTools,
  Tool as ToolShape,
  ToolExecute,
  ToolExecuteContext,
  ToolModelOutputInput,
  Tools as ToolsType,
  ToolSchema,
  ToolToModelOutput,
} from './tool.js';
export * as LLM from './llm.js';
export type {
  Definition as ProviderDefinition,
  ModelFactory as ProviderModelFactory,
  ModelOptions as ProviderModelOptions,
} from './provider.js';
export * from './provider/index.js';
export * as Providers from './providers/index.js';

// 错误处理与容错（已对齐 Effect 4.0 API）：
// 智能重试（指数退避 + 抖动）、断路器、优雅降级、统一错误处理器
export * from './error/index.js';

// 工具调用协议适配
export * as Tools from './tools/index.js';

// 流式 tool_call arguments 的容错解析:支持半截 JSON 恢复。
// 网关侧累积 delta 文本后需要同样的恢复能力(见 stream-model-round.ts),
// 故在包入口导出,消费方不得直接引用内部模块路径。
export { parseJSON as parsePartialJSON } from './protocols/utils/partial-json.js';
