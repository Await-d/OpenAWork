/**
 * Session Interruption Detector Tests
 */

import { describe, it, expect } from 'vitest';
import { detectTurnInterruption } from '../session-interruption-detector.js';
import type { Message } from '@openAwork/shared';

describe('session-interruption-detector', () => {
  describe('detectTurnInterruption', () => {
    it('应检测到用户发送后未响应的中断 (interrupted_prompt)', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          createdAt: Date.now(),
        },
      ];

      const result = detectTurnInterruption(messages);

      expect(result.kind).toBe('interrupted_prompt');
      expect(result.message).toBeDefined();
      expect(result.message?.role).toBe('user');
    });

    it('应检测到响应中被打断的中断 (interrupted_turn)', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              toolCallId: 'tool_123',
              toolName: 'search',
              input: {},
            },
          ],
          createdAt: Date.now(),
        },
        {
          id: '2',
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolCallId: 'tool_123',
              output: 'Search result',
              isError: false,
            },
          ],
          createdAt: Date.now(),
        },
      ];

      const result = detectTurnInterruption(messages);

      expect(result.kind).toBe('interrupted_turn');
    });

    it('正常结束的对话不应检测到中断', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          createdAt: Date.now(),
        },
        {
          id: '2',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi there!' }],
          createdAt: Date.now(),
        },
      ];

      const result = detectTurnInterruption(messages);

      expect(result.kind).toBe('none');
    });

    it('空消息列表应返回 none', () => {
      const messages: Message[] = [];

      const result = detectTurnInterruption(messages);

      expect(result.kind).toBe('none');
    });

    it('应跳过系统消息查找最后相关消息', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          createdAt: Date.now(),
        },
        {
          id: '2',
          role: 'system',
          content: [{ type: 'text', text: 'System message' }],
          createdAt: Date.now(),
        },
      ];

      const result = detectTurnInterruption(messages);

      expect(result.kind).toBe('interrupted_prompt');
    });

    it('Brief 工具调用后不应检测为中断', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              toolCallId: 'tool_123',
              toolName: 'brief',
              input: {},
            },
          ],
          createdAt: Date.now(),
        },
        {
          id: '2',
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolCallId: 'tool_123',
              output: 'Brief result',
              isError: false,
            },
          ],
          createdAt: Date.now(),
        },
      ];

      const result = detectTurnInterruption(messages);

      expect(result.kind).toBe('none');
    });

    it('send_user_file 工具调用后不应检测为中断', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              toolCallId: 'tool_123',
              toolName: 'send_user_file',
              input: {},
            },
          ],
          createdAt: Date.now(),
        },
        {
          id: '2',
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolCallId: 'tool_123',
              output: 'File sent',
              isError: false,
            },
          ],
          createdAt: Date.now(),
        },
      ];

      const result = detectTurnInterruption(messages);

      expect(result.kind).toBe('none');
    });

    it('普通工具调用后无响应应检测为中断', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              toolCallId: 'tool_123',
              toolName: 'read_file',
              input: {},
            },
          ],
          createdAt: Date.now(),
        },
        {
          id: '2',
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolCallId: 'tool_123',
              output: 'File content',
              isError: false,
            },
          ],
          createdAt: Date.now(),
        },
      ];

      const result = detectTurnInterruption(messages);

      expect(result.kind).toBe('interrupted_turn');
    });
  });
});
