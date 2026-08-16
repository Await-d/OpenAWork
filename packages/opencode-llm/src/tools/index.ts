/**
 * 工具调用协议适配模块
 *
 * 提供 OpenAWork 工具定义到 OpenCode LLM 格式的转换、
 * 工具结果解析、重试策略、日志记录和执行功能
 */

export { ToolAdapter, createToolAdapter } from './adapter.js';
export type {
  OpenAWorkToolDefinition,
  ZodToJsonSchemaOptions,
  ToolAdapterConfig,
} from './adapter.js';

export { ToolResultParser, createToolResultParser } from './result-parser.js';
export type { RawToolResult, ParsedToolResult, ParserConfig } from './result-parser.js';

export { ToolCallRetry, createToolCallRetry, executeWithRetry } from './retry.js';
export type {
  RetryStrategy,
  FallbackStrategy,
  RetryConfig,
  RetryContext,
  RetryResult,
} from './retry.js';

export {
  ToolCallLogger,
  createToolCallLogger,
  getGlobalLogger,
  setGlobalLogger,
} from './logger.js';
export type { LogLevel, ToolCallPhase, LogEntry, ToolCallStats, LoggerConfig } from './logger.js';

export { ToolExecutor, createToolExecutor } from './tool-executor.js';
export type {
  ToolExecutionRequest,
  ToolExecutionResult,
  BatchExecutionResult,
  ToolExecutorConfig,
} from './tool-executor.js';
