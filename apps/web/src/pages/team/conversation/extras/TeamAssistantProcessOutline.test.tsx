// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { TeamAssistantProcessOutline } from './TeamAssistantProcessOutline.js';

afterEach(() => cleanup());

describe('TeamAssistantProcessOutline', () => {
  it('重复工具摘要时不会触发 duplicate key 警告', () => {
    const message: ChatMessage = {
      id: 'team-process-outline-1',
      role: 'assistant',
      content: '已读取所需上下文。',
      parts: [
        {
          id: 'tool-1',
          type: 'tool',
          toolCallId: 'session-read-1',
          toolName: 'session_read',
          input: {},
          status: 'completed',
        },
        {
          id: 'tool-2',
          type: 'tool',
          toolCallId: 'session-read-2',
          toolName: 'session_read',
          input: {},
          status: 'completed',
        },
      ],
    };

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(<TeamAssistantProcessOutline message={message} />);

      expect(screen.getAllByText('读取上下文 · session_read')).toHaveLength(2);
      expect(
        consoleErrorSpy.mock.calls.some(
          ([firstArg]) =>
            typeof firstArg === 'string' &&
            firstArg.includes('Encountered two children with the same key'),
        ),
      ).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
