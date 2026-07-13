// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createAssistantTraceContent,
  type ChatMessage,
} from '../../conversation-runtime/messages/support.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import { renderChatMessageContentWithOptions } from './ChatPageSections.js';

afterEach(() => {
  cleanup();
  useDisplayPreferencesStore.setState({ showReasoningBlock: true });
});

describe('renderChatMessageContentWithOptions', () => {
  it('chat 模式隐藏推理时仍保留简化后的占位提示', () => {
    useDisplayPreferencesStore.setState({ showReasoningBlock: false });

    const message: ChatMessage = {
      id: 'assistant-parts-chat',
      role: 'assistant',
      content: '',
      parts: [{ id: 'reasoning-1', type: 'reasoning', text: '先判断入口，再确认渲染分支。' }],
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>);

    expect(screen.getByText('思考过程')).not.toBeNull();
    expect(screen.getByText('已简化展示')).not.toBeNull();
  });

  it('team 模式隐藏推理时不展示 chat 专属占位提示', () => {
    useDisplayPreferencesStore.setState({ showReasoningBlock: false });

    const message: ChatMessage = {
      id: 'assistant-trace-team',
      role: 'assistant',
      content: createAssistantTraceContent({
        reasoningBlocks: ['先整理上下文，再继续执行。'],
        text: '',
        toolCalls: [],
      }),
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'team' })}</>);

    expect(screen.queryByText('思考过程')).toBeNull();
    expect(screen.queryByText('已简化展示')).toBeNull();
  });
});
