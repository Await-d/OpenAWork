/**
 * 流处理集成测试
 *
 * 测试完整的流式处理流程，包括 SSE 解析、JSON 处理、错误重试和背压控制的集成。
 */

import { describe, it, expect, vi } from 'vitest';
import { Effect, Stream } from 'effect';
import { StreamProcessor } from '../processor.js';
import { RetryHandler } from '../retry-handler.js';
import { BackpressureController } from '../backpressure.js';
import { IncrementalJsonParser } from '../incremental-json-parser.js';

describe('Stream Integration Tests', () => {
  describe('端到端流处理', () => {
    it('应该完整处理一个典型的 LLM 流式响应', async () => {
      const processor = new StreamProcessor({
        incrementalJson: true,
        idleTimeout: 5000,
      });

      // 模拟真实的 OpenAI 流式响应
      const streamData = [
        'data: {"type":"step-start"}\n\n',
        'data: {"type":"text-start","id":"text_0"}\n\n',
        'data: {"type":"text-delta","id":"text_0","text":"Hello"}\n\n',
        'data: {"type":"text-delta","id":"text_0","text":" "}\n\n',
        'data: {"type":"text-delta","id":"text_0","text":"world"}\n\n',
        'data: {"type":"text-end","id":"text_0"}\n\n',
        'data: {"type":"step-finish","usage":{"inputTokens":10,"outputTokens":5}}\n\n',
        'data: {"type":"finish","reason":"stop"}\n\n',
      ];

      const chunks = streamData.map((data) => new TextEncoder().encode(data));
      const byteStream = Stream.fromIterable(chunks);

      const events: any[] = [];
      await Effect.runPromise(
        Stream.runForEach(processor.process(byteStream), (event) =>
          Effect.sync(() => events.push(event)),
        ),
      );

      expect(events).toHaveLength(8);
      expect(events[0].type).toBe('step-start');
      expect(events[1].type).toBe('text-start');
      expect(events[2].type).toBe('text-delta');
      expect(events[7].type).toBe('finish');

      const stats = processor.getStats();
      expect(stats.eventCount).toBe(8);
      expect(stats.bytesProcessed).toBeGreaterThan(0);
    });

    it('应该处理带工具调用的流', async () => {
      const processor = new StreamProcessor();

      const streamData = [
        'data: {"type":"tool-input-start","id":"call_1","name":"search"}\n\n',
        'data: {"type":"tool-input-delta","id":"call_1","text":"{\\"query\\":"}\n\n',
        'data: {"type":"tool-input-delta","id":"call_1","text":"\\"test\\"}"}\n\n',
        'data: {"type":"tool-input-end","id":"call_1"}\n\n',
        'data: {"type":"tool-call","id":"call_1","name":"search","input":{"query":"test"}}\n\n',
        'data: {"type":"finish","reason":"tool-calls"}\n\n',
      ];

      const chunks = streamData.map((data) => new TextEncoder().encode(data));
      const byteStream = Stream.fromIterable(chunks);

      const events: any[] = [];
      await Effect.runPromise(
        Stream.runForEach(processor.process(byteStream), (event) =>
          Effect.sync(() => events.push(event)),
        ),
      );

      expect(events).toHaveLength(6);
      expect(events.find((e) => e.type === 'tool-call')).toBeDefined();
    });
  });

  describe('增量 JSON 解析集成', () => {
    it('应该处理跨多个 SSE 事件的 JSON', async () => {
      const processor = new StreamProcessor({ incrementalJson: true });

      // JSON 被分割到多个 SSE 事件中
      const streamData = [
        'data: {"type":"text-delta",\n',
        'data: "id":"text_0",\n',
        'data: "text":"hello"}\n\n',
      ];

      const chunks = streamData.map((data) => new TextEncoder().encode(data));
      const byteStream = Stream.fromIterable(chunks);

      const events: any[] = [];
      await Effect.runPromise(
        Stream.runForEach(processor.process(byteStream), (event) =>
          Effect.sync(() => events.push(event)),
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text-delta',
        id: 'text_0',
        text: 'hello',
      });
    });

    it('应该处理单个 SSE 事件中的多个 JSON 对象', async () => {
      const parser = new IncrementalJsonParser();

      const multiJson = '{"type":"a"}{"type":"b"}{"type":"c"}';
      const result = await Effect.runPromise(parser.append(multiJson));

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'a' });
      expect(result[1]).toEqual({ type: 'b' });
      expect(result[2]).toEqual({ type: 'c' });
    });
  });

  describe('错误恢复和重试', () => {
    it('应该在网络错误后重试', async () => {
      let attemptCount = 0;
      const fetchData = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Network timeout');
        }
        return 'success';
      };

      const handler = new RetryHandler({
        maxRetries: 5,
        baseDelay: 10,
        maxDelay: 100,
      });

      const result = await Effect.runPromise(handler.execute(fetchData));

      expect(result).toBe('success');
      expect(attemptCount).toBe(3);
    });

    it('应该在非可重试错误时立即失败', async () => {
      const handler = new RetryHandler({ maxRetries: 3, baseDelay: 10 });

      let attemptCount = 0;
      const fetchData = async () => {
        attemptCount++;
        throw new Error('Authentication failed');
      };

      await expect(Effect.runPromise(handler.execute(fetchData))).rejects.toThrow();
      expect(attemptCount).toBe(1);
    });
  });

  describe('背压控制集成', () => {
    it('应该在队列满时暂停', async () => {
      const controller = new BackpressureController<string>({
        maxQueueSize: 5,
        maxBufferBytes: 1000,
        highWaterMark: 0.8,
        lowWaterMark: 0.2,
      });

      // 推送到 80% (4 个元素)
      for (let i = 0; i < 4; i++) {
        await Effect.runPromise(controller.push(`item${i}`, 100));
      }

      expect(controller.isPaused()).toBe(true);

      // 拉取一些元素
      await Effect.runPromise(controller.pull());
      await Effect.runPromise(controller.pull());
      await Effect.runPromise(controller.pull());

      expect(controller.isPaused()).toBe(false);
    });

    it('应该正确管理缓冲区大小', async () => {
      const controller = new BackpressureController<string>({
        maxQueueSize: 100,
        maxBufferBytes: 1000,
        highWaterMark: 0.8,
        lowWaterMark: 0.2,
      });

      // 推送接近缓冲区限制
      await Effect.runPromise(controller.push('large-item-1', 400));
      await Effect.runPromise(controller.push('large-item-2', 400));

      expect(controller.isPaused()).toBe(true);
      expect(controller.getBufferBytes()).toBe(800);
    });
  });

  describe('性能和压力测试', () => {
    it('应该高效处理大量事件', async () => {
      const processor = new StreamProcessor({ incrementalJson: true });

      // 生成 1000 个事件
      const streamData = Array.from(
        { length: 1000 },
        (_, i) => `data: {"type":"text-delta","id":"text_0","text":"${i}"}\n\n`,
      ).join('');

      const bytes = new TextEncoder().encode(streamData);
      const byteStream = Stream.succeed(bytes);

      const startTime = Date.now();
      const events: any[] = [];

      await Effect.runPromise(
        Stream.runForEach(processor.process(byteStream), (event) =>
          Effect.sync(() => events.push(event)),
        ),
      );

      const duration = Date.now() - startTime;

      expect(events).toHaveLength(1000);
      expect(duration).toBeLessThan(1000); // 应该在 1 秒内完成

      const stats = processor.getStats();
      expect(stats.eventCount).toBe(1000);
      expect(stats.eventsPerSecond).toBeGreaterThan(1000);
    });

    it('应该处理大型 JSON 对象', async () => {
      const parser = new IncrementalJsonParser();

      // 10KB 的 JSON 对象
      const largeObject = {
        type: 'text-delta',
        text: 'x'.repeat(10000),
      };

      const json = JSON.stringify(largeObject);
      const result = await Effect.runPromise(parser.append(json));

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(largeObject);
    });
  });

  describe('边界条件', () => {
    it('应该处理空流', async () => {
      const processor = new StreamProcessor();
      const byteStream = Stream.empty;

      const events: any[] = [];
      await Effect.runPromise(
        Stream.runForEach(processor.process(byteStream), (event) =>
          Effect.sync(() => events.push(event)),
        ),
      );

      expect(events).toHaveLength(0);
    });

    it('应该处理只有空白的流', async () => {
      const processor = new StreamProcessor();

      const sseData = '   \n\n   \n\n   \n\n';
      const bytes = new TextEncoder().encode(sseData);
      const byteStream = Stream.succeed(bytes);

      const events: any[] = [];
      await Effect.runPromise(
        Stream.runForEach(processor.process(byteStream), (event) =>
          Effect.sync(() => events.push(event)),
        ),
      );

      expect(events).toHaveLength(0);
    });

    it('应该处理 Unicode 和特殊字符', async () => {
      const processor = new StreamProcessor();

      const sseData = 'data: {"type":"text-delta","text":"Hello 世界 😀 \\u0041"}\n\n';
      const bytes = new TextEncoder().encode(sseData);
      const byteStream = Stream.succeed(bytes);

      const events: any[] = [];
      await Effect.runPromise(
        Stream.runForEach(processor.process(byteStream), (event) =>
          Effect.sync(() => events.push(event)),
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0].text).toBe('Hello 世界 😀 A');
    });
  });
});
