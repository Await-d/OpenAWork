// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { TeamLayerChatPanel } from './TeamLayerChatPanel.js';
import type { LayerMessages } from './TeamMultiLayerPanel.js';

vi.mock('../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

afterEach(() => cleanup());

function createLayerMessages(message: ChatMessage): LayerMessages[] {
  return [
    {
      layer: 'pm2',
      messages: [message],
      sessionIds: ['session-pm2-1'],
      isActive: true,
      displayName: '产品经理二号',
    },
  ];
}

function createShortMessage(index: number): ChatMessage {
  return {
    id: `message-${index + 1}`,
    role: 'assistant',
    createdAt: Date.parse('2026-06-21T12:00:00.000Z') + index * 60_000,
    content: `历史消息 ${index + 1}`,
  };
}

describe('TeamLayerChatPanel', () => {
  it('长 markdown 消息默认显示纯文本预览，展开后使用 markdown 渲染', () => {
    const message: ChatMessage = {
      id: 'assistant-long-markdown',
      role: 'assistant',
      createdAt: Date.parse('2026-06-21T12:00:00.000Z'),
      content: [
        '# 结论',
        '',
        '- 已完成接口联调',
        '- 已补齐 `team-message-content.tsx`',
        '- 已把 JSON / incident / Markdown 统一进团队消息渲染链路',
        '',
        '> 后续继续补面板级回归测试，确保不会再退回原始字符串显示。',
        '',
        '补充说明：这一段只是为了把消息拉长到折叠阈值以上，确保先看到摘要预览，再点击展开查看完整 markdown 内容。',
      ].join('\n'),
    };

    render(
      <TeamLayerChatPanel
        activeLayer="pm2"
        currentSessionId={null}
        layers={createLayerMessages(message)}
      />,
    );

    expect(screen.queryByTestId('md')).toBeNull();
    expect(screen.getByText(/已完成接口联调/)).toBeTruthy();
    expect(screen.queryByText(/^# 结论$/)).toBeNull();

    fireEvent.click(screen.getByText('展开全部 ↓'));

    expect(screen.getByTestId('md').textContent).toContain('# 结论');
    expect(screen.getByTestId('md').textContent).toContain('- 已完成接口联调');
    expect(screen.getByText('收起 ↑')).toBeTruthy();
  });

  it('默认只展示最近五十条，滚动到顶部后自动加载更早消息', async () => {
    const layers: LayerMessages[] = [
      {
        layer: 'pm2',
        messages: Array.from({ length: 60 }, (_, index) => createShortMessage(index)),
        sessionIds: ['session-pm2-1'],
        isActive: true,
        displayName: '产品经理二号',
      },
    ];

    render(<TeamLayerChatPanel activeLayer="pm2" currentSessionId={null} layers={layers} />);

    expect(screen.getByText('已显示最近 50 / 60 条消息')).toBeTruthy();
    expect(screen.getByText('上滑继续加载更早 50 条')).toBeTruthy();
    expect(screen.queryByText('历史消息 1')).toBeNull();
    expect(screen.getByText('历史消息 11')).toBeTruthy();
    expect(screen.getByText('历史消息 60')).toBeTruthy();

    const log = screen.getByRole('log', { name: '团队层级消息汇总' });
    Object.defineProperty(log, 'scrollHeight', {
      configurable: true,
      value: 1200,
      writable: true,
    });
    Object.defineProperty(log, 'clientHeight', {
      configurable: true,
      value: 320,
      writable: true,
    });
    Object.defineProperty(log, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.scroll(log, { target: { scrollTop: 0 } });

    await waitFor(() => {
      expect(screen.getByText('已显示全部 60 条消息')).toBeTruthy();
    });
    expect(screen.queryByText('上滑继续加载更早 50 条')).toBeNull();
    expect(screen.getByText('历史消息 1')).toBeTruthy();
  });
});
