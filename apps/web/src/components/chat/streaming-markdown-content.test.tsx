// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StreamingMarkdownContent from './streaming-markdown-content.js';

const markdownRenderSpy = vi.fn<(content: string) => void>();

vi.mock('./markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => {
    markdownRenderSpy(content);
    return <div data-testid="markdown-content">{content}</div>;
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

describe('StreamingMarkdownContent', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    markdownRenderSpy.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it('renders the latest active tail immediately after content updates', async () => {
    await act(async () => {
      root!.render(<StreamingMarkdownContent content={'第一段'} />);
    });

    expect(container?.textContent).toContain('第一段');

    await act(async () => {
      root!.render(<StreamingMarkdownContent content={'第一段\n\n第二段进行中'} />);
    });

    expect(container?.textContent).toContain('第一段');
    expect(container?.textContent).toContain('第二段进行中');
  });

  it('renders long plain streaming tails without invoking markdown parsing', async () => {
    const longParagraph = '这是一个持续流式输出的长段落'.repeat(24);

    await act(async () => {
      root!.render(<StreamingMarkdownContent content={longParagraph} />);
    });

    expect(container?.querySelector('.chat-markdown-streaming')?.textContent).toBe(longParagraph);
    expect(markdownRenderSpy).not.toHaveBeenCalled();
  });

  it('routes completed thinking fences through markdown rendering during streaming', async () => {
    const content = '```thinking\n先比较约束\n再检查边界\n```';

    await act(async () => {
      root!.render(<StreamingMarkdownContent content={content} />);
    });

    expect(markdownRenderSpy).toHaveBeenCalledWith(content);
    expect(container?.querySelector('.chat-markdown-streaming')).toBeNull();
  });
});
