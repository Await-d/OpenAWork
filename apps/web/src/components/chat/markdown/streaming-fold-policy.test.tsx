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
