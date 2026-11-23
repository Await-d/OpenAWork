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

  it('默认「仅最新消息」下，历史消息不渲染统计行', () => {
    render(
      <MessageRow
        message={{
          id: 'msg-assistant-old',
          role: 'assistant',
          content: '这一轮已经结束',
          status: 'completed',
        }}
        providerId="openai"
        modelId="gpt-5"
        email="user@example.com"
        renderContent={(entry) => entry.content}
        sharedUiThemeVars={{}}
        usageDetails={{
          requestIndex: 2,
          totalTokens: 1200,
          inputTokens: 800,
          outputTokens: 400,
          durationMs: 5200,
        }}
        isLatestMessage={false}
      />,
    );

    expect(screen.queryByText('请求 2')).toBeNull();
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it('最新消息始终渲染统计行', () => {
    render(
      <MessageRow
        message={{
          id: 'msg-assistant-latest',
          role: 'assistant',
          content: '刚生成完的一轮',
          status: 'completed',
        }}
        providerId="openai"
        modelId="gpt-5"
        email="user@example.com"
        renderContent={(entry) => entry.content}
        sharedUiThemeVars={{}}
        usageDetails={{
          requestIndex: 7,
          totalTokens: 1200,
          inputTokens: 800,
          outputTokens: 400,
          durationMs: 5200,
        }}
        isLatestMessage
      />,
    );

    expect(screen.getByText('请求 7')).toBeTruthy();
  });

  it('历史消息即使隐藏统计，也保留异常状态提示', () => {
    render(
      <MessageRow
        message={{
          id: 'msg-assistant-error',
          role: 'assistant',
          content: '',
          status: 'error',
        }}
        providerId="openai"
        modelId="gpt-5"
        email="user@example.com"
        renderContent={(entry) => entry.content}
        sharedUiThemeVars={{}}
        isLatestMessage={false}
      />,
    );

    expect(screen.getByText('错误')).toBeTruthy();
  });

  it('切到「全部消息」后历史消息也展示统计信息', () => {
    useDisplayPreferencesStore.getState().setMetaLineScope('all');

    render(
      <MessageRow
        message={{
          id: 'msg-assistant-all',
          role: 'assistant',
          content: '历史的一轮',
          status: 'completed',
        }}
        providerId="openai"
        modelId="gpt-5"
        email="user@example.com"
        renderContent={(entry) => entry.content}
        sharedUiThemeVars={{}}
        usageDetails={{
          requestIndex: 3,
          totalTokens: 1200,
          inputTokens: 800,
          outputTokens: 400,
          durationMs: 5200,
        }}
        isLatestMessage={false}
      />,
    );

    expect(screen.getByText('请求 3')).toBeTruthy();
  });

  /*
   * 压缩提示是会话级系统事件，不是模型发言：不能顶着头像、模型名、时间与复制按钮。
   * 它此前走完整消息行，左侧 28px 头像 + 12px 间距把它推到整行中线右侧约 20px，
   * 一条系统提示被画成了「某个模型说的一句话」。
   */
  it('压缩提示走通栏：不渲染头像列、消息头与元信息行', () => {
    const compactionMessage: ChatMessage = {
      id: 'msg-compaction',
      role: 'assistant',
      content: JSON.stringify({
        type: 'compaction',
        payload: { summary: '压缩了 12 条消息', phase: 'completed' },
      }),
      status: 'completed',
      createdAt: Date.now(),
    };

    const { container } = render(
      <MessageRow
        message={compactionMessage}
        providerId="openai"
        modelId="gpt-5"
        email="user@example.com"
        renderContent={() => <span>已自动压缩上下文</span>}
        sharedUiThemeVars={{}}
        isLatestMessage={false}
      />,
    );

    const row = container.querySelector('.chat-message-row');
    expect(row?.getAttribute('data-layout')).toBe('compact-bar');
    expect(container.querySelector('.chat-message-header')).toBeNull();
    expect(container.querySelector('.chat-message-meta-row')).toBeNull();
  });
});
