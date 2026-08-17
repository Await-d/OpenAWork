/**
 * 流处理器
 *
 * 核心流式响应处理类，整合 SSE 解析、增量 JSON 处理、错误重试和背压控制。
 */

import { Effect, Stream } from 'effect';
import type { LLMEvent } from '../schema/index.js';
import { LLMError } from '../schema/index.js';
import { sseFraming } from '../protocols/shared.js';
import { IncrementalJsonParser } from './incremental-json-parser.js';
import { RetryHandler, type RetryConfig } from './retry-handler.js';
import { BackpressureController, type BackpressureConfig } from './backpressure.js';
import { streamError } from './utils.js';

/**
 * 流处理器配置
 */
export interface StreamProcessorConfig {
  /** 重试配置 */
  retry?: Partial<RetryConfig>;
  /** 背压控制配置 */
  backpressure?: Partial<BackpressureConfig>;
  /** 是否启用增量 JSON 解析 */
  incrementalJson?: boolean;
  /** 最大缓冲区大小（字节） */
  maxBufferSize?: number;
  /** 空闲超时时间（毫秒） */
  idleTimeout?: number;
  /** 事件处理回调 */
  onEvent?: (event: LLMEvent) => void;
  /** 错误处理回调 */
  onError?: (error: LLMError) => void;
  /** 完成回调 */
  onComplete?: () => void;
}

/**
 * 默认流处理器配置
 */
export const DEFAULT_PROCESSOR_CONFIG: Required<StreamProcessorConfig> = {
  retry: {},
  backpressure: {},
  incrementalJson: true,
  maxBufferSize: 5 * 1024 * 1024, // 5MB
  idleTimeout: 60000, // 60秒
  onEvent: () => {},
  onError: () => {},
  onComplete: () => {},
};

/**
 * 流处理器状态
 */
interface ProcessorState {
  /** 是否正在处理 */
  processing: boolean;
  /** 已处理的事件数 */
  eventCount: number;
  /** 已处理的字节数 */
  bytesProcessed: number;
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 最后活动时间 */
  lastActivityTime?: number;
}

/**
 * 流处理器
 */
export class StreamProcessor {
  private config: Required<StreamProcessorConfig>;
  private state: ProcessorState;
  private jsonParser?: IncrementalJsonParser;
  private retryHandler: RetryHandler;
  private backpressureController?: BackpressureController<LLMEvent>;
  private idleTimer?: NodeJS.Timeout;

  constructor(config: StreamProcessorConfig = {}) {
    this.config = {
      ...DEFAULT_PROCESSOR_CONFIG,
      ...config,
    };

    this.state = {
      processing: false,
      eventCount: 0,
      bytesProcessed: 0,
    };

    // 初始化组件
    if (this.config.incrementalJson) {
      this.jsonParser = new IncrementalJsonParser();
    }

    this.retryHandler = new RetryHandler(this.config.retry);

    if (this.config.backpressure) {
      this.backpressureController = new BackpressureController<LLMEvent>(this.config.backpressure);
    }
  }

  /**
   * 处理字节流，返回 LLMEvent 流
   */
  public process(
    byteStream: Stream.Stream<Uint8Array, LLMError>,
  ): Stream.Stream<LLMEvent, LLMError> {
    return Stream.fromAsyncIterable(this.processAsync(byteStream), (error) =>
      error instanceof LLMError ? error : streamError(String(error)),
    );
  }

  private async *processAsync(
    byteStream: Stream.Stream<Uint8Array, LLMError>,
  ): AsyncGenerator<LLMEvent, void, unknown> {
    this.startProcessing();

    try {
      // 应用 SSE 解码
      const boundedByteStream = byteStream.pipe(
        Stream.tap((bytes) =>
          bytes.byteLength > this.config.maxBufferSize
            ? Effect.fail(
                streamError(
                  `Buffer size ${bytes.byteLength} exceeds max ${this.config.maxBufferSize}`,
                ),
              )
            : Effect.void,
        ),
      );
      const sseStream = sseFraming(boundedByteStream);

      // 将 Effect Stream 转换为 AsyncIterable
      const asyncIterable = Stream.toAsyncIterable(sseStream);

      // 处理 SSE 流
      for await (const chunk of asyncIterable) {
        this.updateActivity();
        this.state.bytesProcessed += Buffer.byteLength(chunk, 'utf8');

        // 解析 JSON
        let data: unknown;
        if (this.config.incrementalJson && this.jsonParser) {
          // 增量 JSON 解析
          if (this.jsonParser.getBufferSize() > this.config.maxBufferSize) {
            throw streamError(
              `Buffer size ${this.jsonParser.getBufferSize()} exceeds max ${this.config.maxBufferSize}`,
            );
          }

          const objects = await Effect.runPromise(this.jsonParser.append(chunk));
          if (this.jsonParser.getBufferSize() > this.config.maxBufferSize) {
            throw streamError(
              `Buffer size ${this.jsonParser.getBufferSize()} exceeds max ${this.config.maxBufferSize}`,
            );
          }
          for (const obj of objects) {
            const event = this.parseEventSync(obj);
            this.handleEvent(event);
            yield event;
          }
        } else {
          // 直接 JSON 解析
          try {
            data = JSON.parse(chunk);
            const event = this.parseEventSync(data);
            this.handleEvent(event);
            yield event;
          } catch (error) {
            throw streamError(
              `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
              chunk,
            );
          }
        }
      }

      if (this.config.incrementalJson && this.jsonParser) {
        const trailing = await Effect.runPromise(this.jsonParser.finish());
        for (const obj of trailing) {
          const event = this.parseEventSync(obj);
          this.handleEvent(event);
          yield event;
        }
      }

      this.stopProcessing();
      this.config.onComplete();
    } catch (error) {
      const llmError = error instanceof LLMError ? error : streamError(String(error));
      this.handleError(llmError);
      throw llmError;
    } finally {
      this.stopIdleMonitor();
    }
  }

  /**
   * 解析事件数据为 LLMEvent (同步版本)
   */
  private parseEventSync(data: unknown): LLMEvent {
    // 验证数据结构
    if (typeof data !== 'object' || data === null) {
      throw streamError('Invalid event data: expected object', JSON.stringify(data));
    }

    const obj = data as Record<string, unknown>;

    // 检查必需的 type 字段
    if (typeof obj.type !== 'string') {
      throw streamError('Invalid event data: missing type field', JSON.stringify(data));
    }

    // 这里可以添加更多的验证逻辑
    // 目前简单地将数据转换为 LLMEvent
    return obj as LLMEvent;
  }

  /**
   * 启动空闲监控
   */
  private startIdleMonitor(): void {
    this.resetIdleTimer();
  }

  /**
   * 重置空闲计时器
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.handleError(streamError(`Stream idle timeout after ${this.config.idleTimeout}ms`));
    }, this.config.idleTimeout);
  }

  /**
   * 停止空闲监控
   */
  private stopIdleMonitor(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  /**
   * 开始处理
   */
  private startProcessing(): void {
    this.state.processing = true;
    this.state.startTime = Date.now();
    this.state.lastActivityTime = Date.now();
  }

  /**
   * 停止处理
   */
  private stopProcessing(): void {
    this.state.processing = false;
    this.state.endTime = Date.now();
    this.stopIdleMonitor();
  }

  /**
   * 更新活动时间
   */
  private updateActivity(): void {
    this.state.lastActivityTime = Date.now();
  }

  /**
   * 处理事件
   */
  private handleEvent(event: LLMEvent): void {
    this.state.eventCount++;
    this.config.onEvent(event);
  }

  /**
   * 处理错误
   */
  private handleError(error: LLMError): void {
    this.config.onError(error);
  }

  /**
   * 获取处理统计信息
   */
  public getStats(): {
    eventCount: number;
    bytesProcessed: number;
    duration: number | undefined;
    eventsPerSecond: number | undefined;
    bytesPerSecond: number | undefined;
  } {
    const duration =
      this.state.startTime && this.state.endTime
        ? this.state.endTime - this.state.startTime
        : this.state.startTime
          ? Date.now() - this.state.startTime
          : undefined;

    const eventsPerSecond =
      duration && duration > 0 ? (this.state.eventCount / duration) * 1000 : undefined;

    const bytesPerSecond =
      duration && duration > 0 ? (this.state.bytesProcessed / duration) * 1000 : undefined;

    return {
      eventCount: this.state.eventCount,
      bytesProcessed: this.state.bytesProcessed,
      duration,
      eventsPerSecond,
      bytesPerSecond,
    };
  }

  /**
   * 重置处理器状态
   */
  public reset(): void {
    this.state = {
      processing: false,
      eventCount: 0,
      bytesProcessed: 0,
    };

    if (this.jsonParser) {
      this.jsonParser.clear();
    }

    if (this.backpressureController) {
      this.backpressureController.clear();
    }

    this.retryHandler.reset();
    this.stopIdleMonitor();
  }

  /**
   * 销毁处理器
   */
  public dispose(): void {
    this.stopProcessing();
    this.reset();
  }
}
