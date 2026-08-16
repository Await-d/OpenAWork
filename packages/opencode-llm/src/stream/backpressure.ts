/**
 * 背压控制器
 *
 * 管理流式数据的流量控制，防止内存溢出和消费者阻塞。
 */

import { Effect, Queue, Stream } from 'effect';
import { LLMError } from '../schema/index.js';
import { formatBytes, streamError } from './utils.js';

/**
 * 背压配置
 */
export interface BackpressureConfig {
  /** 队列最大容量（元素数量） */
  maxQueueSize: number;
  /** 最大缓冲区大小（字节） */
  maxBufferBytes: number;
  /** 高水位标记（0-1，触发暂停） */
  highWaterMark: number;
  /** 低水位标记（0-1，触发恢复） */
  lowWaterMark: number;
  /** 是否启用自动丢弃策略 */
  dropOnOverflow: boolean;
  /** 背压警告回调 */
  onBackpressure?: (state: BackpressureState) => void;
}

/**
 * 默认背压配置
 */
export const DEFAULT_BACKPRESSURE_CONFIG: BackpressureConfig = {
  maxQueueSize: 1000,
  maxBufferBytes: 10 * 1024 * 1024, // 10MB
  highWaterMark: 0.8,
  lowWaterMark: 0.2,
  dropOnOverflow: false,
};

/**
 * 背压状态
 */
export interface BackpressureState {
  /** 当前队列大小 */
  queueSize: number;
  /** 当前缓冲区字节数 */
  bufferBytes: number;
  /** 是否处于背压状态 */
  paused: boolean;
  /** 已丢弃的元素数量 */
  droppedCount: number;
  /** 队列利用率（0-1） */
  queueUtilization: number;
  /** 缓冲区利用率（0-1） */
  bufferUtilization: number;
}

/**
 * 背压控制器
 */
export class BackpressureController<T> {
  private config: Required<BackpressureConfig>;
  private state: BackpressureState;
  private queue: Array<{ item: T; size: number }>;

  constructor(config: Partial<BackpressureConfig> = {}) {
    this.config = {
      ...DEFAULT_BACKPRESSURE_CONFIG,
      ...config,
      onBackpressure: config.onBackpressure ?? (() => {}),
    };

    this.state = {
      queueSize: 0,
      bufferBytes: 0,
      paused: false,
      droppedCount: 0,
      queueUtilization: 0,
      bufferUtilization: 0,
    };

    this.queue = [];
  }

  /**
   * 推送数据到队列
   */
  public push(item: T, sizeBytes: number): Effect.Effect<boolean, LLMError> {
    return Effect.sync(() => {
      // 检查是否超过容量限制
      if (this.state.queueSize >= this.config.maxQueueSize) {
        if (this.config.dropOnOverflow) {
          this.state.droppedCount++;
          return false;
        }
        throw streamError(
          `Queue overflow: size ${this.state.queueSize} exceeds max ${this.config.maxQueueSize}`,
        );
      }

      if (this.state.bufferBytes + sizeBytes > this.config.maxBufferBytes) {
        if (this.config.dropOnOverflow) {
          this.state.droppedCount++;
          return false;
        }
        throw streamError(
          `Buffer overflow: ${formatBytes(this.state.bufferBytes + sizeBytes)} exceeds max ${formatBytes(this.config.maxBufferBytes)}`,
        );
      }

      // 添加到队列
      this.queue.push({ item, size: sizeBytes });
      this.state.queueSize++;
      this.state.bufferBytes += sizeBytes;

      // 更新利用率
      this.updateUtilization();

      // 检查是否需要触发背压
      if (this.shouldPause()) {
        this.pause();
      }

      return true;
    });
  }

  /**
   * 从队列中取出数据
   */
  public pull(): Effect.Effect<T | undefined, LLMError> {
    return Effect.sync(() => {
      const entry = this.queue.shift();
      if (!entry) return undefined;

      this.state.queueSize--;
      this.state.bufferBytes -= entry.size;

      // 更新利用率
      this.updateUtilization();

      // 检查是否需要恢复
      if (this.shouldResume()) {
        this.resume();
      }

      return entry.item;
    });
  }

  /**
   * 批量取出数据
   */
  public pullBatch(maxCount: number): Effect.Effect<T[], LLMError> {
    return Effect.sync(() => {
      const result: T[] = [];
      const count = Math.min(maxCount, this.queue.length);

      for (let i = 0; i < count; i++) {
        const entry = this.queue.shift();
        if (!entry) break;

        result.push(entry.item);
        this.state.queueSize--;
        this.state.bufferBytes -= entry.size;
      }

      // 更新利用率
      this.updateUtilization();

      // 检查是否需要恢复
      if (this.shouldResume()) {
        this.resume();
      }

      return result;
    });
  }

  /**
   * 判断是否应该暂停
   */
  private shouldPause(): boolean {
    return (
      !this.state.paused &&
      (this.state.queueUtilization >= this.config.highWaterMark ||
        this.state.bufferUtilization >= this.config.highWaterMark)
    );
  }

  /**
   * 判断是否应该恢复
   */
  private shouldResume(): boolean {
    return (
      this.state.paused &&
      this.state.queueUtilization <= this.config.lowWaterMark &&
      this.state.bufferUtilization <= this.config.lowWaterMark
    );
  }

  /**
   * 暂停（触发背压）
   */
  private pause(): void {
    this.state.paused = true;
    this.config.onBackpressure(this.getState());
  }

  /**
   * 恢复
   */
  private resume(): void {
    this.state.paused = false;
  }

  /**
   * 更新利用率
   */
  private updateUtilization(): void {
    this.state.queueUtilization = this.state.queueSize / this.config.maxQueueSize;
    this.state.bufferUtilization = this.state.bufferBytes / this.config.maxBufferBytes;
  }

  /**
   * 获取当前状态
   */
  public getState(): BackpressureState {
    return { ...this.state };
  }

  /**
   * 检查是否处于背压状态
   */
  public isPaused(): boolean {
    return this.state.paused;
  }

  /**
   * 获取队列大小
   */
  public getQueueSize(): number {
    return this.state.queueSize;
  }

  /**
   * 获取缓冲区大小
   */
  public getBufferBytes(): number {
    return this.state.bufferBytes;
  }

  /**
   * 清空队列
   */
  public clear(): void {
    this.queue = [];
    this.state.queueSize = 0;
    this.state.bufferBytes = 0;
    this.state.paused = false;
    this.updateUtilization();
  }

  /**
   * 创建一个带背压控制的 Stream
   */
  public static createStream<T>(
    source: Stream.Stream<T, LLMError>,
    config?: Partial<BackpressureConfig>,
    getSizeBytes?: (item: T) => number,
  ): Stream.Stream<T, LLMError> {
    const controller = new BackpressureController<T>(config);
    const sizeGetter =
      getSizeBytes ?? ((item: T) => Buffer.byteLength(JSON.stringify(item), 'utf8'));

    return Stream.fromAsyncIterable(
      (async function* () {
        for await (const item of Stream.toAsyncIterable(source)) {
          const size = sizeGetter(item);
          const pushed = await Effect.runPromise(controller.push(item, size));

          if (pushed) {
            // 如果处于背压状态，等待恢复
            while (controller.isPaused()) {
              await Effect.runPromise(Effect.sleep('100 millis'));
            }

            // 发射数据
            yield item;
          }
        }
      })(),
      () => streamError('Stream ended unexpectedly'),
    );
  }
}
