import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '../../components/conversation-runtime/messages/support.js';
import {
  detectDuplicateMessages,
  deduplicateMessages,
} from './message-duplication-detector.js';

describe('message-duplication-detector', () => {
  describe('detectDuplicateMessages', () => {
    it('应该检测到重复的消息 ID', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi',
          createdAt: Date.now(),
        },
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
        },
      ];

      const report = detectDuplicateMessages(messages);

      expect(report.hasDuplicates).toBe(true);
      expect(report.duplicateIds).toEqual(['msg-1']);
      expect(report.duplicateDetails).toHaveLength(1);
      expect(report.duplicateDetails[0]?.count).toBe(2);
      expect(report.duplicateDetails[0]?.indices).toEqual([0, 2]);
      expect(report.totalMessages).toBe(3);
    });

    it('应该返回无重复结果', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi',
          createdAt: Date.now(),
        },
      ];

      const report = detectDuplicateMessages(messages);

      expect(report.hasDuplicates).toBe(false);
      expect(report.duplicateIds).toEqual([]);
      expect(report.duplicateDetails).toHaveLength(0);
      expect(report.totalMessages).toBe(2);
    });

    it('应该检测到多个不同 ID 的重复', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'A', createdAt: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'B', createdAt: Date.now() },
        { id: 'msg-1', role: 'user', content: 'A', createdAt: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'B', createdAt: Date.now() },
      ];

      const report = detectDuplicateMessages(messages);

      expect(report.hasDuplicates).toBe(true);
      expect(report.duplicateIds.sort()).toEqual(['msg-1', 'msg-2']);
      expect(report.duplicateDetails).toHaveLength(2);
    });
  });

  describe('deduplicateMessages', () => {
    it('应该移除重复的消息，保留第一次出现的', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi',
          createdAt: Date.now(),
        },
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello duplicate',
          createdAt: Date.now(),
        },
      ];

      const result = deduplicateMessages(messages);

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('msg-1');
      expect(result[0]?.content).toBe('Hello'); // 保留第一次出现的
      expect(result[1]?.id).toBe('msg-2');
    });

    it('应该保持无重复消息列表不变', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi',
          createdAt: Date.now(),
        },
      ];

      const result = deduplicateMessages(messages);

      expect(result).toHaveLength(2);
      expect(result).toEqual(messages);
    });

    it('应该处理空数组', () => {
      const result = deduplicateMessages([]);
      expect(result).toEqual([]);
    });

    it('应该处理大量重复消息', () => {
      const messages: ChatMessage[] = Array.from({ length: 100 }, (_, i) => ({
        id: `msg-${i % 10}`,
        role: 'user' as const,
        content: `Message ${i}`,
        createdAt: Date.now(),
      }));

      const result = deduplicateMessages(messages);

      // 应该只保留 10 条唯一消息（msg-0 到 msg-9）
      expect(result).toHaveLength(10);
      const ids = result.map((m) => m.id);
      expect(new Set(ids).size).toBe(10);
    });
  });
});
