import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => true),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 320 180"><text>d</text></svg>' })),
  },
}));

import MarkdownMessageContent from './markdown-message-content.js';
import StreamingMarkdownContent from './streaming-markdown-content.js';
import {
  CollapsibleAssistantContent,
  LatestAssistantMessageContext,
} from '../message/collapsible-assistant-content.js';

afterEach(cleanup);

const MESSAGE_ID = 'parity-message';

interface ParityFixture {
  content: string;
  name: string;
}

const FIXTURES: ParityFixture[] = [
  { name: '纯段落', content: '第一段正文。\n\n第二段正文。' },
  { name: '标题 + 段落', content: '## 小标题\n\n正文段落。' },
  { name: '已闭合代码块', content: '```ts\nconst answer = 42;\n```' },
  { name: '行内公式', content: '公式 $x + y = 7$ 结束。' },
  { name: '路径引用', content: '查看 apps/web/src/foo.ts:30 的实现。' },
  { name: '独立 <br> 行', content: '第一段\n\n<br>\n\n第二段' },
  { name: 'GFM 表格', content: '| 项目 | 金额 |\n| --- | ---: |\n| 合计 | 1200 |' },
];

function StaticAssistantMessage({ content }: { content: string }) {
  return (
    <LatestAssistantMessageContext value={MESSAGE_ID}>
      <CollapsibleAssistantContent content={content} messageId={MESSAGE_ID}>
        <MarkdownMessageContent content={content} />
      </CollapsibleAssistantContent>
    </LatestAssistantMessageContext>
  );
}

function readMarkdownHtml(container: HTMLElement): string {
  const markdown = container.querySelector('.chat-markdown');
  if (!markdown) {
    return '';
  }
  return markdown.innerHTML
    .replace(/<span class="assistant-rich-content-cursor"[^>]*><\/span>/gu, '')
    .replace(/\sdata-streaming="true"/gu, '')
    .replace(/>\s*\n\s*</gu, '><')
    .trim();
}

describe.each(FIXTURES)('流式 / 静态渲染一致性 · $name', ({ content }) => {
  it('同一内容在两条管线下产出相同的 .chat-markdown innerHTML', async () => {
    const staticView = render(<StaticAssistantMessage content={content} />);
    const streamingView = render(<StreamingMarkdownContent content={content} />);

    const staticHtml = readMarkdownHtml(staticView.container);
    expect(staticHtml).not.toBe('');

    await waitFor(() => {
      expect(readMarkdownHtml(streamingView.container)).toBe(staticHtml);
    });
  });
});

describe('流式渲染的 DOM 契约', () => {
  it('流式输出只有一个 .chat-markdown 外壳，且带 data-streaming 标记', () => {
    const { container } = render(<StreamingMarkdownContent content={'第一段\n\n第二段'} />);

    expect(container.querySelectorAll('.chat-markdown')).toHaveLength(1);
    expect(container.querySelector('.chat-markdown')?.getAttribute('data-streaming')).toBe('true');
    expect(container.querySelector('.assistant-rich-content-cursor')).not.toBeNull();
  });
});
