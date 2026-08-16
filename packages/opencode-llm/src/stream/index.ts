/**
 * 流式响应处理模块
 *
 * 提供 SSE 流解析、增量 JSON 处理、错误重试和背压控制功能。
 */

export { StreamProcessor } from './processor.js';
export { IncrementalJsonParser } from './incremental-json-parser.js';
export { RetryHandler, type RetryConfig } from './retry-handler.js';
export { BackpressureController, type BackpressureConfig } from './backpressure.js';
export {
  EventEmitter,
  type EventMap,
  type EventListener,
  type ErrorListener,
} from './event-emitter.js';
export * as StreamUtils from './utils.js';
