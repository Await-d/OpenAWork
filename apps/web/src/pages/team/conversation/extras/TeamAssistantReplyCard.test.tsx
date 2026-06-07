// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TeamAssistantReplyCard } from './TeamAssistantReplyCard.js';
import { TeamAssistantProcessOutline } from './TeamAssistantProcessOutline.js';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';

afterEach(() => cleanup());

describe('TeamAssistantReplyCard', () => {
  it('默认突出结论与下一步，并把处理过程收进折叠区', () => {
    const message: ChatMessage = {
      id: 'team-assistant-1',
      role: 'assistant',
      content: '已完成方案收敛。\n\n下一步：安排执行层开始落地。',
      parts: [
        { id: 'r1', type: 'reasoning', text: '先判断入口路由' },
        {
          id: 't1',
          type: 'tool',
          toolCallId: 'tool-read',
          toolName: 'read',
          input: { filePath: 'apps/web/src/pages/team/conversation/TeamConversationView.tsx' },
          status: 'completed',
        },
      ],
    };

    render(
      <TeamAssistantReplyCard
        message={message}
        processContent={<TeamAssistantProcessOutline message={message} />}
      />,
    );

    expect(screen.getByText('结论')).toBeTruthy();
    expect(screen.getByText('下一步')).toBeTruthy();
    expect(screen.getByText('安排执行层开始落地。')).toBeTruthy();

    const summary = screen.getByText('处理过程（已折叠）');
    expect(summary).toBeTruthy();
    const details = summary.closest('details');
    expect(details?.hasAttribute('open')).toBe(false);
  });
});
