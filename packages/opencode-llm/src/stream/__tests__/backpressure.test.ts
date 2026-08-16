/**
 * 背压控制器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Effect } from 'effect';
import { BackpressureController } from '../backpressure.js';

describe('BackpressureController', () => {
  let controller: BackpressureController<string>;

  beforeEach(() => {
    controller = new BackpressureController<string>({
      maxQueueSize: 10,
      maxBufferBytes: 1000,
      highWaterMark: 0.8,
      lowWaterMark: 0.2,
      dropOnOverflow: false,
    });
  });

  describe('基本功能', () => {
    it('应该推送和拉取数据', async () => {
      await Effect.runPromise(controller.push('item1', 10));
      await Effect.runPromise(controller.push('item2', 10));

      const item1 = await Effect.runPromise(controller.pull());
      const item2 = await Effect.runPromise(controller.pull());

      expect(item1).toBe('item1');
      expect(item2).toBe('item2');
    });

    it('应该在队列为空时返回 undefined', async () => {
      const item = await Effect.runPromise(controller.pull());
      expect(item).toBeUndefined();
    });

    it('应该正确跟踪队列大小', async () => {
      await Effect.runPromise(controller.push('item1', 10));
      await Effect.runPromise(controller.push('item2', 20));

      expect(controller.getQueueSize()).toBe(2);
      expect(controller.getBufferBytes()).toBe(30);
    });
  });

  describe('容量限制', () => {
    it('应该在队列满时抛出错误', async () => {
      const ctrl = new BackpressureController<string>({
        maxQueueSize: 2,
        maxBufferBytes: 1000,
        dropOnOverflow: false,
      });

      await Effect.runPromise(ctrl.push('item1', 10));
      await Effect.runPromise(ctrl.push('item2', 10));

      await expect(Effect.runPromise(ctrl.push('item3', 10))).rejects.toThrow(/queue overflow/i);
    });

    it('应该在缓冲区满时抛出错误', async () => {
      const ctrl = new BackpressureController<string>({
        maxQueueSize: 100,
        maxBufferBytes: 50,
        dropOnOverflow: false,
      });

      await Effect.runPromise(ctrl.push('item1', 40));

      await expect(Effect.runPromise(ctrl.push('item2', 20))).rejects.toThrow(/buffer overflow/i);
    });

    it('应该在溢出时丢弃数据（如果配置）', async () => {
      const ctrl = new BackpressureController<string>({
        maxQueueSize: 2,
        maxBufferBytes: 1000,
        dropOnOverflow: true,
      });

      await Effect.runPromise(ctrl.push('item1', 10));
      await Effect.runPromise(ctrl.push('item2', 10));
      const pushed = await Effect.runPromise(ctrl.push('item3', 10));

      expect(pushed).toBe(false);
      expect(ctrl.getState().droppedCount).toBe(1);
    });
  });

  describe('背压控制', () => {
    it('应该在高水位标记时触发暂停', async () => {
      const onBackpressure = vi.fn();
      const ctrl = new BackpressureController<string>({
        maxQueueSize: 10,
        maxBufferBytes: 1000,
        highWaterMark: 0.8,
        lowWaterMark: 0.2,
        onBackpressure,
      });

      // 推送到 80% (8 个元素)
      for (let i = 0; i < 8; i++) {
        await Effect.runPromise(ctrl.push(`item${i}`, 10));
      }

      expect(ctrl.isPaused()).toBe(true);
      expect(onBackpressure).toHaveBeenCalled();
    });

    it('应该在低水位标记时恢复', async () => {
      const ctrl = new BackpressureController<string>({
        maxQueueSize: 10,
        maxBufferBytes: 1000,
        highWaterMark: 0.8,
        lowWaterMark: 0.2,
      });

      // 推送到 80%
      for (let i = 0; i < 8; i++) {
        await Effect.runPromise(ctrl.push(`item${i}`, 10));
      }

      expect(ctrl.isPaused()).toBe(true);

      // 拉取到 20% 以下
      for (let i = 0; i < 6; i++) {
        await Effect.runPromise(ctrl.pull());
      }

      expect(ctrl.isPaused()).toBe(false);
    });

    it('应该正确计算利用率', async () => {
      const ctrl = new BackpressureController<string>({
        maxQueueSize: 10,
        maxBufferBytes: 100,
      });

      await Effect.runPromise(ctrl.push('item1', 25));
      await Effect.runPromise(ctrl.push('item2', 25));

      const state = ctrl.getState();
      expect(state.queueUtilization).toBe(0.2); // 2/10
      expect(state.bufferUtilization).toBe(0.5); // 50/100
    });
  });

  describe('批量操作', () => {
    it('应该批量拉取数据', async () => {
      await Effect.runPromise(controller.push('item1', 10));
      await Effect.runPromise(controller.push('item2', 10));
      await Effect.runPromise(controller.push('item3', 10));

      const items = await Effect.runPromise(controller.pullBatch(2));

      expect(items).toEqual(['item1', 'item2']);
      expect(controller.getQueueSize()).toBe(1);
    });

    it('应该处理超过队列大小的批量请求', async () => {
      await Effect.runPromise(controller.push('item1', 10));
      await Effect.runPromise(controller.push('item2', 10));

      const items = await Effect.runPromise(controller.pullBatch(5));

      expect(items).toEqual(['item1', 'item2']);
      expect(controller.getQueueSize()).toBe(0);
    });
  });

  describe('状态管理', () => {
    it('应该提供完整的状态信息', async () => {
      await Effect.runPromise(controller.push('item1', 10));

      const state = controller.getState();

      expect(state).toMatchObject({
        queueSize: 1,
        bufferBytes: 10,
        paused: false,
        droppedCount: 0,
        queueUtilization: expect.any(Number),
        bufferUtilization: expect.any(Number),
      });
    });

    it('应该正确清空队列', async () => {
      await Effect.runPromise(controller.push('item1', 10));
      await Effect.runPromise(controller.push('item2', 20));

      controller.clear();

      expect(controller.getQueueSize()).toBe(0);
      expect(controller.getBufferBytes()).toBe(0);
      expect(controller.isPaused()).toBe(false);
    });
  });

  describe('边界情况', () => {
    it('应该处理零字节大小的项目', async () => {
      const pushed = await Effect.runPromise(controller.push('empty', 0));

      expect(pushed).toBe(true);
      expect(controller.getQueueSize()).toBe(1);
      expect(controller.getBufferBytes()).toBe(0);
    });

    it('应该处理非常大的项目', async () => {
      const ctrl = new BackpressureController<string>({
        maxQueueSize: 10,
        maxBufferBytes: 100,
        dropOnOverflow: true,
      });

      const pushed = await Effect.runPromise(ctrl.push('large', 150));

      expect(pushed).toBe(false);
    });

    it('应该在并发推送时保持一致性', async () => {
      const ctrl = new BackpressureController<string>({
        maxQueueSize: 100,
        maxBufferBytes: 10000,
      });

      // 并发推送
      await Promise.all(
        Array.from({ length: 50 }, (_, i) => Effect.runPromise(ctrl.push(`item${i}`, 10))),
      );

      expect(ctrl.getQueueSize()).toBe(50);
      expect(ctrl.getBufferBytes()).toBe(500);
    });
  });
});
