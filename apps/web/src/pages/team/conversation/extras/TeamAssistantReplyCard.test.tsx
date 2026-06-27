// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TeamAssistantReplyCard } from './TeamAssistantReplyCard.js';
import { TeamAssistantProcessOutline } from './TeamAssistantProcessOutline.js';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';

vi.mock('../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

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

  it('消息无工具调用和推理时不渲染折叠区', () => {
    const message: ChatMessage = {
      id: 'team-assistant-2',
      role: 'assistant',
      content: '已完成分析，结论如下。',
    };

    render(
      <TeamAssistantReplyCard
        message={message}
        processContent={<TeamAssistantProcessOutline message={message} />}
      />,
    );

    expect(screen.getByText('结论')).toBeTruthy();
    expect(screen.queryByText('处理过程（已折叠）')).toBeNull();
  });

  it('结论和下一步都会复用统一富文本渲染规则', () => {
    const message: ChatMessage = {
      id: 'team-assistant-3',
      role: 'assistant',
      content: [
        '## 当前结论',
        '',
        '- 已完成 markdown 渲染收口',
        '',
        '下一步：{"summary":"继续补 run events 预览","count":1}',
      ].join('\n'),
    };

    const { container } = render(<TeamAssistantReplyCard message={message} />);

    const markdownBlocks = screen.getAllByTestId('md');
    expect(markdownBlocks[0]?.textContent).toContain('## 当前结论');
    expect(markdownBlocks[0]?.textContent).toContain('- 已完成 markdown 渲染收口');

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('"summary": "继续补 run events 预览"');
  });
});
