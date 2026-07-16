// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../conversation-runtime/messages/support.js';
import { MessageRow } from './message-row.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';

afterEach(() => {
  cleanup();
  useDisplayPreferencesStore.getState().resetToDefaults();
});

describe('MessageRow', () => {
  it('用户消息优先展示当前用户昵称', () => {
    const message: ChatMessage = {
      id: 'msg-user-1',
      role: 'user',
      content: '你好，帮我看下这个问题',
      createdAt: Date.now(),
    };

    render(
      <MessageRow
        message={message}
        providerId="openai"
        modelId="gpt-5"
        email="user@example.com"
        currentUserDisplayName="林雾"
        renderContent={(entry) => entry.content}
        sharedUiThemeVars={{}}
      />,
    );

    expect(screen.getByText('林雾')).toBeTruthy();
    expect(screen.queryByText('user@example.com')).toBeNull();
    expect(screen.getByText('林')).toBeTruthy();
  });
});
