// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { getTeamMessagePreviewText, TeamMessageBody } from './team-message-content.js';

vi.mock('../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

afterEach(() => cleanup());

describe('team-message-content', () => {
  it('摘要预览会去掉 markdown 语法，只保留可读文本', () => {
    const message: ChatMessage = {
      id: 'preview-markdown',
      role: 'assistant',
      content:
        '# 阶段结论\n- 完成接口联调\n- 补充 `team-message-content.tsx`\n[查看详情](https://example.com)',
    };

    const preview = getTeamMessagePreviewText(message, 200);
    expect(preview).toContain('阶段结论');
    expect(preview).toContain('完成接口联调');
    expect(preview).toContain('补充 team-message-content.tsx');
    expect(preview).toContain('查看详情');
    expect(preview).not.toContain('#');
    expect(preview).not.toContain('`');
    expect(preview).not.toContain('https://example.com');
  });

  it('普通 assistant 文本会走 markdown 渲染链路', () => {
    const message: ChatMessage = {
      id: 'markdown-body',
      role: 'assistant',
      content: '## 结果\n\n- 已完成\n- 待验证',
    };

    render(<TeamMessageBody message={message} />);
    expect(screen.getByTestId('md').textContent).toBe('## 结果\n\n- 已完成\n- 待验证');
  });

  it('JSON 文本会渲染为格式化代码块', () => {
    const message: ChatMessage = {
      id: 'json-body',
      role: 'assistant',
      content: '{"summary":"已完成技术选型","count":2}',
    };

    const { container } = render(<TeamMessageBody message={message} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('"summary": "已完成技术选型"');
    expect(pre?.textContent).toContain('"count": 2');
  });

  it('incident JSON 会渲染为结构化事件卡片', () => {
    const message: ChatMessage = {
      id: 'incident-body',
      role: 'assistant',
      content: JSON.stringify({
        category: 'runtime_incident',
        severity: 'warning',
        message: '共享线程状态不一致',
        context: { sessionId: 'session-1234567890', roleLayer: 'pm2' },
      }),
    };

    render(<TeamMessageBody message={message} />);
    expect(screen.getByText('运行异常')).toBeTruthy();
    expect(screen.getByText('警告')).toBeTruthy();
    expect(screen.getByText('共享线程状态不一致')).toBeTruthy();
    expect(screen.getByText(/角色: pm2/)).toBeTruthy();
  });
});
