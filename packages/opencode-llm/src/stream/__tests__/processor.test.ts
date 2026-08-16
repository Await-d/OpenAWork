/**
 * 流处理器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Effect, Stream } from 'effect';
import { StreamProcessor } from '../processor.js';
import { LLMEvent } from '../../schema/index.js';
import { streamError } from '../utils.js';

describe('StreamProcessor', () => {
  let processor: StreamProcessor;

  beforeEach(() => {
    processor = new StreamProcessor({
      incrementalJson: true,
      maxBufferSize: 1024 * 1024, // 1MB
      idleTimeout: 5000,
    });
  });

  describe('基本流处理', () => {
    it('应该处理完整的 SSE 流', async () => {
      // 模拟 SSE 字节流
      const sseData = [
        'data: {"type":"text-delta","text":"Hello"}\n\n',
        'data: {"type":"text-delta","text":" World"}\n\n',
        'data: {"type":"finish","reason":"stop"}\n\n',
      ];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const events: LLMEvent[] = [];
      const eventStream = processor.process(byteStream);

      await Effect.runPromise(
        Stream.runForEach(eventStream, (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );

      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject({ type: 'text-delta', text: 'Hello' });
      expect(events[1]).toMatchObject({ type: 'text-delta', text: ' World' });
      expect(events[2]).toMatchObject({ type: 'finish', reason: 'stop' });
    });

    it('应该处理分块的 SSE 数据', async () => {
      // 模拟分块到达的数据
      const chunks = [
        'data: {"type":"text-',
        'delta","text":"H',
        'ello"}\n\n',
        'data: {"type":"finish"',
        ',"reason":"stop"}\n\n',
      ];

      const byteStream = Stream.fromIterable(chunks.map((s) => new TextEncoder().encode(s)));

      const events: LLMEvent[] = [];
      const eventStream = processor.process(byteStream);

      await Effect.runPromise(
        Stream.runForEach(eventStream, (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'text-delta', text: 'Hello' });
      expect(events[1]).toMatchObject({ type: 'finish', reason: 'stop' });
    });

    it('应该处理空数据流', async () => {
      const byteStream = Stream.empty;

      const events: LLMEvent[] = [];
      const eventStream = processor.process(byteStream);

      await Effect.runPromise(
        Stream.runForEach(eventStream, (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );

      expect(events).toHaveLength(0);
    });
  });

  describe('事件回调', () => {
    it('应该调用 onEvent 回调', async () => {
      const onEvent = vi.fn();
      const processorWithCallback = new StreamProcessor({ onEvent });

      const sseData = ['data: {"type":"text-delta","text":"test"}\n\n'];
      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const eventStream = processorWithCallback.process(byteStream);
      await Effect.runPromise(Stream.runDrain(eventStream));

      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text-delta', text: 'test' }),
      );
    });

    it('应该调用 onComplete 回调', async () => {
      const onComplete = vi.fn();
      const processorWithCallback = new StreamProcessor({ onComplete });

      const sseData = ['data: {"type":"finish","reason":"stop"}\n\n'];
      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const eventStream = processorWithCallback.process(byteStream);
      await Effect.runPromise(Stream.runDrain(eventStream));

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('应该调用 onError 回调', async () => {
      const onError = vi.fn();
      const processorWithCallback = new StreamProcessor({ onError });

      // 创建会失败的流
      const byteStream = Stream.fail(streamError('Test error'));

      const eventStream = processorWithCallback.process(byteStream);

      try {
        await Effect.runPromise(Stream.runDrain(eventStream));
      } catch {
        // 预期的错误
      }

      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe('增量 JSON 解析', () => {
    it('应该正确处理增量 JSON', async () => {
      const processorWithJson = new StreamProcessor({ incrementalJson: true });

      const sseData = [
        'data: {"type":"text-delta","text":"part1"}\n\n',
        'data: {"type":"text-delta","text":"part2"}\n\n',
      ];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const events: LLMEvent[] = [];
      const eventStream = processorWithJson.process(byteStream);

      await Effect.runPromise(
        Stream.runForEach(eventStream, (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );

      expect(events).toHaveLength(2);
    });

    it('应该在禁用增量 JSON 时直接解析', async () => {
      const processorNonIncremental = new StreamProcessor({ incrementalJson: false });

      const sseData = ['data: {"type":"text-delta","text":"test"}\n\n'];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const events: LLMEvent[] = [];
      const eventStream = processorNonIncremental.process(byteStream);

      await Effect.runPromise(
        Stream.runForEach(eventStream, (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'text-delta', text: 'test' });
    });
  });

  describe('缓冲区限制', () => {
    it('应该在超过缓冲区限制时失败', async () => {
      const smallBufferProcessor = new StreamProcessor({
        incrementalJson: true,
        maxBufferSize: 100, // 很小的缓冲区
      });

      // 创建一个超过缓冲区大小的不完整 JSON
      const largeIncomplete = 'data: {"type":"text-delta","text":"' + 'x'.repeat(200);
      const byteStream = Stream.fromIterable([new TextEncoder().encode(largeIncomplete)]);

      const eventStream = smallBufferProcessor.process(byteStream);

      await expect(Effect.runPromise(Stream.runDrain(eventStream))).rejects.toThrow(
        /buffer size.*exceeds/i,
      );
    });
  });

  describe('统计信息', () => {
    it('应该跟踪事件数量', async () => {
      const sseData = [
        'data: {"type":"text-delta","text":"1"}\n\n',
        'data: {"type":"text-delta","text":"2"}\n\n',
        'data: {"type":"text-delta","text":"3"}\n\n',
      ];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const eventStream = processor.process(byteStream);
      await Effect.runPromise(Stream.runDrain(eventStream));

      const stats = processor.getStats();
      expect(stats.eventCount).toBe(3);
    });

    it('应该跟踪字节数', async () => {
      const sseData = ['data: {"type":"text-delta","text":"test"}\n\n'];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const eventStream = processor.process(byteStream);
      await Effect.runPromise(Stream.runDrain(eventStream));

      const stats = processor.getStats();
      expect(stats.bytesProcessed).toBeGreaterThan(0);
    });

    it('应该计算处理时长', async () => {
      const sseData = ['data: {"type":"text-delta","text":"test"}\n\n'];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const eventStream = processor.process(byteStream);
      await Effect.runPromise(Stream.runDrain(eventStream));

      const stats = processor.getStats();
      expect(stats.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('状态管理', () => {
    it('应该正确重置状态', async () => {
      const sseData = ['data: {"type":"text-delta","text":"test"}\n\n'];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const eventStream = processor.process(byteStream);
      await Effect.runPromise(Stream.runDrain(eventStream));

      expect(processor.getStats().eventCount).toBe(1);

      processor.reset();

      expect(processor.getStats().eventCount).toBe(0);
      expect(processor.getStats().bytesProcessed).toBe(0);
    });

    it('应该正确销毁处理器', () => {
      processor.dispose();

      const stats = processor.getStats();
      expect(stats.eventCount).toBe(0);
      expect(stats.bytesProcessed).toBe(0);
    });
  });

  describe('错误处理', () => {
    it('应该处理无效的 JSON', async () => {
      const sseData = ['data: {invalid json}\n\n'];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const eventStream = processor.process(byteStream);

      await expect(Effect.runPromise(Stream.runDrain(eventStream))).rejects.toThrow();
    });

    it('应该处理缺少 type 字段的事件', async () => {
      const sseData = ['data: {"text":"test"}\n\n'];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const eventStream = processor.process(byteStream);

      await expect(Effect.runPromise(Stream.runDrain(eventStream))).rejects.toThrow(
        /missing type/i,
      );
    });

    it('应该处理流错误', async () => {
      const errorStream = Stream.fail(streamError('Stream error'));

      const eventStream = processor.process(errorStream);

      await expect(Effect.runPromise(Stream.runDrain(eventStream))).rejects.toThrow(
        /stream error/i,
      );
    });
  });

  describe('复杂场景', () => {
    it('应该处理包含多种事件类型的流', async () => {
      const sseData = [
        'data: {"type":"text-start"}\n\n',
        'data: {"type":"text-delta","text":"Hello"}\n\n',
        'data: {"type":"text-delta","text":" "}\n\n',
        'data: {"type":"text-delta","text":"World"}\n\n',
        'data: {"type":"text-end"}\n\n',
        'data: {"type":"finish","reason":"stop"}\n\n',
      ];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const events: LLMEvent[] = [];
      const eventStream = processor.process(byteStream);

      await Effect.runPromise(
        Stream.runForEach(eventStream, (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );

      expect(events).toHaveLength(6);
      expect(events[0].type).toBe('text-start');
      expect(events[5].type).toBe('finish');
    });

    it('应该处理带有嵌套对象的事件', async () => {
      const sseData = [
        'data: {"type":"tool-call","id":"1","name":"test","input":{"nested":{"value":"data"}}}\n\n',
      ];

      const byteStream = Stream.fromIterable(sseData.map((s) => new TextEncoder().encode(s)));

      const events: LLMEvent[] = [];
      const eventStream = processor.process(byteStream);

      await Effect.runPromise(
        Stream.runForEach(eventStream, (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool-call',
        id: '1',
        name: 'test',
        input: { nested: { value: 'data' } },
      });
    });
  });
});
