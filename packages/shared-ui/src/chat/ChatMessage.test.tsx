// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import { ChatMessage } from './ChatMessage.js';

afterEach(() => {
  cleanup();
});

function buildMessage(overrides: Partial<Message>): Message {
  return {
    id: 'm-1',
    role: 'assistant',
    content: [{ type: 'text', text: '内容' }],
    createdAt: 1,
    ...overrides,
  };
}

describe('ChatMessage', () => {
  it('synthetic（网关注入的子代理通知）不渲染为对话气泡', () => {
    const { container } = render(
      <ChatMessage
        message={buildMessage({
          id: 's-1',
          role: 'synthetic',
          content: [{ type: 'text', text: '子代理已完成 · 审计会话唤醒原语' }],
          description: '审计会话唤醒原语',
          metadata: {
            source: 'subagent',
            childID: 'child-1',
            agent: 'explore',
            state: 'completed',
          },
        })}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('助手消息仍渲染为助手气泡内容', () => {
    const { container } = render(<ChatMessage message={buildMessage({})} />);

    expect(container.textContent).toBe('内容');
    expect(container.firstChild).not.toBeNull();
  });
});
