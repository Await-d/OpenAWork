import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

const LONG_FENCE_LINE_COUNT = 150;
const MARKDOWN_PREVIEW_LINE_COUNT = 20;

/** 未闭合的围栏：流式期间整段落在 activeTail，走到 `streaming` 渲染分支。 */
function buildUnclosedCodeFence(lineCount: number): string {
  const body = Array.from({ length: lineCount }, (_, index) => `const value${index} = ${index};`);
  return ['```ts', ...body].join('\n');
}

/** 已闭合的 markdown 围栏：流式期间会被切成 stableBlock，走到非 streaming 分支。 */
function buildClosedMarkdownFence(lineCount: number): string {
  const body = Array.from({ length: lineCount }, (_, index) => `第 ${index} 行文档内容`);
  return ['```markdown', ...body, '```'].join('\n');
}

function findPreviewClamp(container: HTMLElement): Element | null {
  return (
    [...container.querySelectorAll('div')].find((element) => element.style.maxHeight === '300px') ??
    null
  );
}

describe('流式期间的围栏折叠策略', () => {
  it('>100 行围栏在流式期间不折叠', async () => {
    const { container } = render(
      <StreamingMarkdownContent content={buildUnclosedCodeFence(LONG_FENCE_LINE_COUNT)} />,
    );

    await waitFor(() => {
      expect(container.querySelector('.chat-markdown-code-block')).toBeTruthy();
    });

    expect(container.querySelector('.chat-markdown-code-block[data-collapsed="true"]')).toBeNull();
    expect(screen.queryByTestId('chat-markdown-code-expand')).toBeNull();
  });

  it('同一条围栏在 finalize 后仍会折叠', () => {
    const { container } = render(
      <MarkdownMessageContent content={buildUnclosedCodeFence(LONG_FENCE_LINE_COUNT)} />,
    );

    expect(
      container.querySelector('.chat-markdown-code-block[data-collapsed="true"]'),
    ).toBeTruthy();
    expect(screen.getByTestId('chat-markdown-code-expand')).toBeTruthy();
  });

  it('markdown 预览块在流式期间不折叠', async () => {
    const { container } = render(
      <StreamingMarkdownContent content={buildClosedMarkdownFence(MARKDOWN_PREVIEW_LINE_COUNT)} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-markdown-preview-toggle')).toBeTruthy();
    });

    expect(screen.queryByText('展开全部')).toBeNull();
    expect(findPreviewClamp(container)).toBeNull();
  });

  it('markdown 预览块在 finalize 后仍会折叠', () => {
    const { container } = render(
      <MarkdownMessageContent content={buildClosedMarkdownFence(MARKDOWN_PREVIEW_LINE_COUNT)} />,
    );

    expect(screen.getByText('展开全部')).toBeTruthy();
    expect(findPreviewClamp(container)).toBeTruthy();
  });
});

/** ```thinking 围栏：思考围栏块自带「展开思考 / 收起思考」。 */
function buildThinkingFence(lineCount: number): string {
  const body = Array.from({ length: lineCount }, (_, index) => `思考第 ${index + 1} 行内容`);
  return ['```thinking', ...body, '```'].join('\n');
}

describe('思考围栏块的折叠归属', () => {
  it('长正文里的思考围栏块不自折叠：只保留消息级「展开全部」一层提示', () => {
    const filler = Array.from(
      { length: 60 },
      (_, index) => `正文段落 ${index + 1}：用于把正文推过 1500 字符阈值。`,
    ).join('\n\n');
    const content = `${filler}\n\n${buildThinkingFence(6)}`;

    render(
      <CollapsibleAssistantContent content={content} messageId="long-thinking-1">
        <MarkdownMessageContent content={content} />
      </CollapsibleAssistantContent>,
    );

    expect(screen.getByText(/展开全部 ·/)).toBeTruthy();
    expect(screen.queryByText('展开思考')).toBeNull();
  });

  it('短正文里的思考围栏块保留自带折叠（此时没有外层折叠）', () => {
    const content = `先想一下。\n\n${buildThinkingFence(6)}`;

    render(<MarkdownMessageContent content={content} />);

    expect(screen.queryByText(/展开全部 ·/)).toBeNull();
    expect(screen.getByText('展开思考')).toBeTruthy();
  });
});

describe('最新一条已完成回复的围栏折叠策略', () => {
  it('最新一条已完成回复的围栏块不折叠', () => {
    const longFenceContent = buildUnclosedCodeFence(LONG_FENCE_LINE_COUNT);
    const { container } = render(
      <LatestAssistantMessageContext value="latest-1">
        <CollapsibleAssistantContent content={longFenceContent} messageId="latest-1">
          <MarkdownMessageContent content={longFenceContent} />
        </CollapsibleAssistantContent>
      </LatestAssistantMessageContext>,
    );

    expect(container.querySelector('.chat-markdown-code-block')).toBeTruthy();
    expect(container.querySelector('.chat-markdown-code-block[data-collapsed="true"]')).toBeNull();
    expect(screen.queryByTestId('chat-markdown-code-expand')).toBeNull();
  });

  it('非最新回复的长围栏块仍会折叠', () => {
    const longFenceContent = buildUnclosedCodeFence(LONG_FENCE_LINE_COUNT);
    const { container } = render(
      <LatestAssistantMessageContext value="other">
        <CollapsibleAssistantContent content={longFenceContent} messageId="latest-1">
          <MarkdownMessageContent content={longFenceContent} />
        </CollapsibleAssistantContent>
      </LatestAssistantMessageContext>,
    );

    expect(
      container.querySelector('.chat-markdown-code-block[data-collapsed="true"]'),
    ).toBeTruthy();
  });

  it('最新一条已完成回复的思考围栏块不折叠', () => {
    const content = `先想一下。\n\n${buildThinkingFence(6)}`;
    render(
      <LatestAssistantMessageContext value="latest-2">
        <CollapsibleAssistantContent content={content} messageId="latest-2">
          <MarkdownMessageContent content={content} />
        </CollapsibleAssistantContent>
      </LatestAssistantMessageContext>,
    );

    expect(screen.queryByText('展开思考')).toBeNull();
  });
});
