/**
 * 事件发射器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Effect } from 'effect';
import { EventEmitter } from '../event-emitter.js';

interface TestEvents {
  data: { value: string };
  number: number;
  error: Error;
  complete: void;
}

describe('EventEmitter', () => {
  let emitter: EventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEvents>();
  });

  describe('基本功能', () => {
    it('应该注册和触发事件监听器', async () => {
      const listener = vi.fn();
      emitter.on('data', listener);

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ value: 'test' });
    });

    it('应该支持多个监听器', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on('data', listener1);
      emitter.on('data', listener2);

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('应该支持不同类型的事件', async () => {
      const dataListener = vi.fn();
      const numberListener = vi.fn();

      emitter.on('data', dataListener);
      emitter.on('number', numberListener);

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));
      await Effect.runPromise(emitter.emit('number', 42));

      expect(dataListener).toHaveBeenCalledWith({ value: 'test' });
      expect(numberListener).toHaveBeenCalledWith(42);
    });

    it('应该支持 void 类型事件', async () => {
      const listener = vi.fn();
      emitter.on('complete', listener);

      await Effect.runPromise(emitter.emit('complete', undefined));

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('once 监听器', () => {
    it('应该只执行一次', async () => {
      const listener = vi.fn();
      emitter.once('data', listener);

      await Effect.runPromise(emitter.emit('data', { value: 'first' }));
      await Effect.runPromise(emitter.emit('data', { value: 'second' }));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ value: 'first' });
    });

    it('应该通过 on 方法的 once 选项工作', async () => {
      const listener = vi.fn();
      emitter.on('data', listener, { once: true });

      await Effect.runPromise(emitter.emit('data', { value: 'first' }));
      await Effect.runPromise(emitter.emit('data', { value: 'second' }));

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('监听器移除', () => {
    it('应该通过返回的取消函数移除监听器', async () => {
      const listener = vi.fn();
      const unsubscribe = emitter.on('data', listener);

      await Effect.runPromise(emitter.emit('data', { value: 'first' }));
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      await Effect.runPromise(emitter.emit('data', { value: 'second' }));
      expect(listener).toHaveBeenCalledTimes(1); // 没有增加
    });

    it('应该通过 off 方法移除所有监听器', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on('data', listener1);
      emitter.on('data', listener2);

      emitter.off('data');

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('应该通过 removeAllListeners 移除所有事件的监听器', async () => {
      const dataListener = vi.fn();
      const numberListener = vi.fn();

      emitter.on('data', dataListener);
      emitter.on('number', numberListener);

      emitter.removeAllListeners();

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));
      await Effect.runPromise(emitter.emit('number', 42));

      expect(dataListener).not.toHaveBeenCalled();
      expect(numberListener).not.toHaveBeenCalled();
    });
  });

  describe('监听器优先级', () => {
    it('应该按优先级顺序执行监听器', async () => {
      const order: number[] = [];

      emitter.on('data', () => order.push(1), { priority: 1 });
      emitter.on('data', () => order.push(3), { priority: 3 });
      emitter.on('data', () => order.push(2), { priority: 2 });

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));

      expect(order).toEqual([3, 2, 1]);
    });

    it('应该在相同优先级时按注册顺序执行', async () => {
      const order: number[] = [];

      emitter.on('data', () => order.push(1));
      emitter.on('data', () => order.push(2));
      emitter.on('data', () => order.push(3));

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('异步监听器', () => {
    it('应该支持异步监听器', async () => {
      const listener = vi.fn().mockResolvedValue(undefined);

      emitter.on('data', listener);

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));

      expect(listener).toHaveBeenCalled();
    });

    it('应该通过 async 选项异步执行监听器', async () => {
      const order: string[] = [];
      let resolveAsync: (() => void) | undefined;
      const asyncCompletion = new Promise<void>((resolve) => {
        resolveAsync = resolve;
      });

      emitter.on(
        'data',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          order.push('async');
          resolveAsync?.();
        },
        { async: true },
      );

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));
      order.push('after-emit');
      await asyncCompletion;

      expect(order).toEqual(['after-emit', 'async']);
    });

    it('应该收口 detached 监听器 rejection', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
        void args;
      });

      try {
        emitter.on(
          'data',
          async () => {
            throw new Error('Detached listener error');
          },
          { async: true },
        );

        await Effect.runPromise(emitter.emit('data', { value: 'test' }));
        await Promise.resolve();

        expect(consoleError).toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  describe('错误处理', () => {
    it('应该捕获监听器错误并触发错误监听器', async () => {
      const errorListener = vi.fn();
      const error = new Error('Listener error');

      emitter.onError(errorListener);
      emitter.on('data', () => {
        throw error;
      });

      await Effect.runPromise(emitter.emit('data', { value: 'test' }));

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'Stream',
        }),
      );
    });

    it('应该在没有错误监听器时抛出错误', () => {
      const error = new Error('Test error');
      const llmError = expect.objectContaining({ module: 'Stream' });

      expect(() => emitter.emitError(llmError as any)).toThrow();
    });

    it('应该通过 onError 返回的函数移除错误监听器', () => {
      const errorListener = vi.fn();
      const unsubscribe = emitter.onError(errorListener);

      unsubscribe();

      expect(() => emitter.emitError(expect.any(Object) as any)).toThrow();
    });
  });

  describe('事件历史', () => {
    it('应该捕获事件历史', async () => {
      const emitterWithHistory = new EventEmitter<TestEvents>({
        captureHistory: true,
      });

      await Effect.runPromise(emitterWithHistory.emit('data', { value: 'first' }));
      await Effect.runPromise(emitterWithHistory.emit('data', { value: 'second' }));

      const history = emitterWithHistory.getHistory('data');
      expect(history).toEqual([{ value: 'first' }, { value: 'second' }]);
    });

    it('应该限制历史记录大小', async () => {
      const emitterWithHistory = new EventEmitter<TestEvents>({
        captureHistory: true,
        historyLimit: 2,
      });

      await Effect.runPromise(emitterWithHistory.emit('number', 1));
      await Effect.runPromise(emitterWithHistory.emit('number', 2));
      await Effect.runPromise(emitterWithHistory.emit('number', 3));

      const history = emitterWithHistory.getHistory('number');
      expect(history).toEqual([2, 3]);
    });

    it('应该清空特定事件的历史记录', async () => {
      const emitterWithHistory = new EventEmitter<TestEvents>({
        captureHistory: true,
      });

      await Effect.runPromise(emitterWithHistory.emit('data', { value: 'test' }));
      await Effect.runPromise(emitterWithHistory.emit('number', 42));

      emitterWithHistory.clearHistory('data');

      expect(emitterWithHistory.getHistory('data')).toEqual([]);
      expect(emitterWithHistory.getHistory('number')).toEqual([42]);
    });

    it('应该清空所有历史记录', async () => {
      const emitterWithHistory = new EventEmitter<TestEvents>({
        captureHistory: true,
      });

      await Effect.runPromise(emitterWithHistory.emit('data', { value: 'test' }));
      await Effect.runPromise(emitterWithHistory.emit('number', 42));

      emitterWithHistory.clearHistory();

      expect(emitterWithHistory.getHistory('data')).toEqual([]);
      expect(emitterWithHistory.getHistory('number')).toEqual([]);
    });
  });

  describe('waitFor', () => {
    it('应该等待特定事件', async () => {
      setTimeout(() => {
        emitter.emitSync('data', { value: 'test' });
      }, 10);

      const result = await Effect.runPromise(emitter.waitFor('data'));
      expect(result).toEqual({ value: 'test' });
    });

    it('应该在超时后失败', async () => {
      await expect(Effect.runPromise(emitter.waitFor('data', 10))).rejects.toThrow(/timeout/i);
    });

    it('应该在事件触发后清除超时', async () => {
      setTimeout(() => {
        emitter.emitSync('data', { value: 'test' });
      }, 5);

      const result = await Effect.runPromise(emitter.waitFor('data', 100));
      expect(result).toEqual({ value: 'test' });
    });
  });

  describe('查询方法', () => {
    it('应该检查是否有监听器', () => {
      expect(emitter.hasListeners('data')).toBe(false);

      emitter.on('data', () => {});
      expect(emitter.hasListeners('data')).toBe(true);
    });

    it('应该返回监听器数量', () => {
      expect(emitter.listenerCount('data')).toBe(0);

      emitter.on('data', () => {});
      emitter.on('data', () => {});

      expect(emitter.listenerCount('data')).toBe(2);
    });

    it('应该返回所有事件名称', () => {
      emitter.on('data', () => {});
      emitter.on('number', () => {});

      const names = emitter.eventNames();
      expect(names).toContain('data');
      expect(names).toContain('number');
      expect(names).toHaveLength(2);
    });
  });

  describe('最大监听器限制', () => {
    it('应该在超过限制时抛出错误', () => {
      const smallEmitter = new EventEmitter<TestEvents>({ maxListeners: 2 });

      smallEmitter.on('data', () => {});
      smallEmitter.on('data', () => {});

      expect(() => smallEmitter.on('data', () => {})).toThrow(/max listeners/i);
    });

    it('应该支持动态修改最大监听器数量', () => {
      emitter.setMaxListeners(5);
      expect(emitter.getMaxListeners()).toBe(5);

      for (let i = 0; i < 5; i++) {
        emitter.on('data', () => {});
      }

      expect(() => emitter.on('data', () => {})).toThrow(/max listeners/i);
    });
  });

  describe('同步发射', () => {
    it('应该通过 emitSync 同步发射事件', () => {
      const listener = vi.fn();
      emitter.on('data', listener);

      emitter.emitSync('data', { value: 'test' });

      expect(listener).toHaveBeenCalledWith({ value: 'test' });
    });
  });

  describe('dispose', () => {
    it('应该清理所有资源', async () => {
      const emitterWithHistory = new EventEmitter<TestEvents>({
        captureHistory: true,
      });

      emitterWithHistory.on('data', () => {});
      emitterWithHistory.onError(() => {});
      await Effect.runPromise(emitterWithHistory.emit('data', { value: 'test' }));

      emitterWithHistory.dispose();

      expect(emitterWithHistory.listenerCount('data')).toBe(0);
      expect(emitterWithHistory.getHistory('data')).toEqual([]);
      expect(emitterWithHistory.eventNames()).toHaveLength(0);
    });
  });
});
