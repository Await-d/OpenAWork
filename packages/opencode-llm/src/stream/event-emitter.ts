/**
 * 类型安全的事件发射器
 *
 * 提供强类型的事件订阅和发射机制，支持流式事件处理场景。
 */

import { Effect } from 'effect';
import { LLMError } from '../schema/index.js';
import { streamError } from './utils.js';

/**
 * 事件监听器函数类型
 */
export type EventListener<T> = (event: T) => void | Promise<void>;

/**
 * 错误监听器函数类型
 */
export type ErrorListener = (error: LLMError) => void | Promise<void>;

/**
 * 事件映射类型
 */
export interface EventMap {
  [event: string]: unknown;
}

/**
 * 监听器配置
 */
export interface ListenerOptions {
  /** 是否只执行一次 */
  once?: boolean;
  /** 执行优先级（数字越大优先级越高） */
  priority?: number;
  /** 是否异步执行 */
  async?: boolean;
}

/**
 * 内部监听器包装
 */
interface ListenerWrapper<T> {
  listener: EventListener<T>;
  options: Required<ListenerOptions>;
  id: number;
}

/**
 * 类型安全的事件发射器
 *
 * @template T 事件映射类型
 *
 * @example
 * ```ts
 * interface MyEvents {
 *   data: { value: string };
 *   error: Error;
 *   complete: void;
 * }
 *
 * const emitter = new EventEmitter<MyEvents>();
 *
 * emitter.on('data', (event) => {
 *   console.log(event.value); // 类型安全
 * });
 *
 * emitter.emit('data', { value: 'hello' });
 * ```
 */
export class EventEmitter<T extends EventMap = EventMap> {
  private listeners: Map<keyof T, ListenerWrapper<T[keyof T]>[]>;
  private errorListeners: ErrorListener[];
  private nextListenerId: number;
  private maxListeners: number;
  private emittedEvents: Map<keyof T, T[keyof T][]>;
  private captureHistory: boolean;
  private historyLimit: number;

  constructor(options?: {
    /** 单个事件的最大监听器数量 */
    maxListeners?: number;
    /** 是否捕获事件历史 */
    captureHistory?: boolean;
    /** 历史记录最大数量 */
    historyLimit?: number;
  }) {
    this.listeners = new Map();
    this.errorListeners = [];
    this.nextListenerId = 1;
    this.maxListeners = options?.maxListeners ?? 100;
    this.emittedEvents = new Map();
    this.captureHistory = options?.captureHistory ?? false;
    this.historyLimit = options?.historyLimit ?? 100;
  }

  /**
   * 注册事件监听器
   *
   * @param event 事件名称
   * @param listener 监听器函数
   * @param options 监听器选项
   * @returns 取消监听的函数
   */
  public on<K extends keyof T>(
    event: K,
    listener: EventListener<T[K]>,
    options?: ListenerOptions,
  ): () => void {
    const wrapper: ListenerWrapper<T[K]> = {
      listener,
      options: {
        once: options?.once ?? false,
        priority: options?.priority ?? 0,
        async: options?.async ?? false,
      },
      id: this.nextListenerId++,
    };

    const eventListeners = this.listeners.get(event) ?? [];

    // 检查监听器数量限制
    if (eventListeners.length >= this.maxListeners) {
      throw streamError(
        `Max listeners (${this.maxListeners}) exceeded for event "${String(event)}"`,
      );
    }

    // 按优先级插入
    eventListeners.push(wrapper as ListenerWrapper<T[keyof T]>);
    eventListeners.sort((a, b) => b.options.priority - a.options.priority);

    this.listeners.set(event, eventListeners);

    // 返回取消函数
    return () => this.off(event, wrapper.id);
  }

  /**
   * 注册一次性事件监听器
   */
  public once<K extends keyof T>(event: K, listener: EventListener<T[K]>): () => void {
    return this.on(event, listener, { once: true });
  }

  /**
   * 移除事件监听器
   */
  public off<K extends keyof T>(event: K, listenerId?: number): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;

    if (listenerId === undefined) {
      // 移除所有监听器
      this.listeners.delete(event);
    } else {
      // 移除特定监听器
      const filtered = eventListeners.filter((w) => w.id !== listenerId);
      if (filtered.length === 0) {
        this.listeners.delete(event);
      } else {
        this.listeners.set(event, filtered);
      }
    }
  }

  /**
   * 发射事件
   */
  public emit<K extends keyof T>(event: K, data: T[K]): Effect.Effect<void, LLMError> {
    return Effect.tryPromise({
      try: async () => {
        if (this.captureHistory) {
          this.captureEvent(event, data);
        }

        const eventListeners = this.listeners.get(event);
        if (!eventListeners || eventListeners.length === 0) {
          return;
        }

        const toRemove: number[] = [];

        for (const wrapper of eventListeners) {
          try {
            if (wrapper.options.async) {
              void Promise.resolve(wrapper.listener(data)).catch((error) => {
                this.handleDetachedListenerError(error, event);
              });
            } else {
              await wrapper.listener(data);
            }

            if (wrapper.options.once) {
              toRemove.push(wrapper.id);
            }
          } catch (error) {
            this.handleListenerError(error, event);
          }
        }

        for (const id of toRemove) {
          this.off(event, id);
        }
      },
      catch: (error) =>
        error instanceof LLMError
          ? error
          : streamError(
              `Event listener dispatch failed for event "${String(event)}": ${error instanceof Error ? error.message : String(error)}`,
            ),
    });
  }

  /**
   * 同步发射事件（不返回 Promise）
   */
  public emitSync<K extends keyof T>(event: K, data: T[K]): void {
    void Effect.runPromise(this.emit(event, data)).catch((error) => {
      console.error(`Event dispatch failed for event "${String(event)}":`, error);
    });
  }

  /**
   * 注册错误监听器
   */
  public onError(listener: ErrorListener): () => void {
    this.errorListeners.push(listener);
    return () => {
      const index = this.errorListeners.indexOf(listener);
      if (index !== -1) {
        this.errorListeners.splice(index, 1);
      }
    };
  }

  /**
   * 发射错误事件
   */
  public emitError(error: LLMError): void {
    if (this.errorListeners.length === 0) {
      // 没有错误监听器，抛出错误
      throw error;
    }

    for (const listener of this.errorListeners) {
      try {
        void Promise.resolve(listener(error)).catch((err) => {
          console.error('Error in error listener:', err);
        });
      } catch (err) {
        console.error('Error in error listener:', err);
      }
    }
  }

  /**
   * 处理监听器错误
   */
  private handleListenerError(error: unknown, event: keyof T): void {
    const llmError =
      error instanceof LLMError
        ? error
        : streamError(
            `Listener error for event "${String(event)}": ${error instanceof Error ? error.message : String(error)}`,
          );
    this.emitError(llmError);
  }

  private handleDetachedListenerError(error: unknown, event: keyof T): void {
    try {
      this.handleListenerError(error, event);
    } catch (handlerError) {
      console.error(`Error in detached listener for event "${String(event)}":`, handlerError);
    }
  }

  /**
   * 捕获事件到历史记录
   */
  private captureEvent<K extends keyof T>(event: K, data: T[K]): void {
    const history = this.emittedEvents.get(event) ?? [];
    history.push(data);

    // 限制历史记录大小
    if (history.length > this.historyLimit) {
      history.shift();
    }

    this.emittedEvents.set(event, history);
  }

  /**
   * 获取事件历史记录
   */
  public getHistory<K extends keyof T>(event: K): T[K][] {
    const history = this.emittedEvents.get(event) ?? [];
    return [...history] as T[K][];
  }

  /**
   * 清空事件历史记录
   */
  public clearHistory<K extends keyof T>(event?: K): void {
    if (event) {
      this.emittedEvents.delete(event);
    } else {
      this.emittedEvents.clear();
    }
  }

  /**
   * 等待特定事件
   */
  public waitFor<K extends keyof T>(event: K, timeout?: number): Effect.Effect<T[K], LLMError> {
    return Effect.callback<T[K], LLMError>((resume) => {
      let timeoutId: NodeJS.Timeout | undefined;

      const unsubscribe = this.once(event, (data) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resume(Effect.succeed(data));
      });

      if (timeout !== undefined && timeout > 0) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          resume(
            Effect.fail(
              streamError(`Timeout waiting for event "${String(event)}" after ${timeout}ms`),
            ),
          );
        }, timeout);
      }

      return Effect.sync(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        unsubscribe();
      });
    });
  }

  /**
   * 检查是否有监听器
   */
  public hasListeners<K extends keyof T>(event: K): boolean {
    const eventListeners = this.listeners.get(event);
    return eventListeners !== undefined && eventListeners.length > 0;
  }

  /**
   * 获取监听器数量
   */
  public listenerCount<K extends keyof T>(event: K): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  /**
   * 获取所有事件名称
   */
  public eventNames(): Array<keyof T> {
    return Array.from(this.listeners.keys());
  }

  /**
   * 移除所有监听器
   */
  public removeAllListeners<K extends keyof T>(event?: K): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
      this.errorListeners = [];
    }
  }

  /**
   * 设置最大监听器数量
   */
  public setMaxListeners(n: number): void {
    this.maxListeners = n;
  }

  /**
   * 获取最大监听器数量
   */
  public getMaxListeners(): number {
    return this.maxListeners;
  }

  /**
   * 销毁发射器
   */
  public dispose(): void {
    this.removeAllListeners();
    this.emittedEvents.clear();
  }
}
