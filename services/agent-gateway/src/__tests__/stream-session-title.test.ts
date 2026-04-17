import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendSessionMessage: vi.fn(),
  maybeAutoTitle: vi.fn(),
}));

vi.mock('../message-v2-adapter.js', () => ({
  appendSessionMessageV2: mocks.appendSessionMessage,
}));

vi.mock('../session-title.js', () => ({
  maybeAutoTitle: mocks.maybeAutoTitle,
}));

import { persistStreamUserMessage } from '../stream-session-title.js';

describe('persistStreamUserMessage', () => {
  beforeEach(() => {
    mocks.appendSessionMessage.mockReset();
    mocks.maybeAutoTitle.mockReset();
  });

  it('prefers displayMessage for persisted user text and auto title input', () => {
    const text = persistStreamUserMessage({
      clientRequestId: 'req-1',
      displayMessage: 'Please fix the session title length in the chat sidebar',
      legacyMessagesJson: '[]',
      message: '系统包装后的内部消息',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(text).toBe('Please fix the session title length in the chat sidebar');
    expect(mocks.appendSessionMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'user',
      content: [{ type: 'text', text: 'Please fix the session title length in the chat sidebar' }],
      legacyMessagesJson: '[]',
      clientRequestId: 'req-1',
    });
    expect(mocks.maybeAutoTitle).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'user-1',
      text: 'Please fix the session title length in the chat sidebar',
    });
  });

  it('falls back to message when displayMessage is absent', () => {
    const text = persistStreamUserMessage({
      clientRequestId: 'req-2',
      legacyMessagesJson: '[]',
      message: '请帮我修复会话标题太长的问题',
      sessionId: 'session-2',
      userId: 'user-2',
    });

    expect(text).toBe('请帮我修复会话标题太长的问题');
    expect(mocks.appendSessionMessage).toHaveBeenCalledWith({
      sessionId: 'session-2',
      userId: 'user-2',
      role: 'user',
      content: [{ type: 'text', text: '请帮我修复会话标题太长的问题' }],
      legacyMessagesJson: '[]',
      clientRequestId: 'req-2',
    });
    expect(mocks.maybeAutoTitle).toHaveBeenCalledWith({
      sessionId: 'session-2',
      userId: 'user-2',
      text: '请帮我修复会话标题太长的问题',
    });
  });
});
