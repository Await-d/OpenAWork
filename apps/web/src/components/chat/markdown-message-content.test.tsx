// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownMessageContent from './markdown-message-content.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const writeClipboardMock = vi.fn(async () => undefined);

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeClipboardMock },
  });
  writeClipboardMock.mockClear();
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe('MarkdownMessageContent', () => {
  it('renders highlighted code blocks without coercing React nodes to object strings', async () => {
    await act(async () => {
      root!.render(<MarkdownMessageContent content={'```json\n{\n  "platform": "Web"\n}\n```'} />);
    });

    expect(container?.querySelector('.chat-markdown-code-label')?.textContent).toBe('JSON');
    expect(container?.textContent).toContain('platform');
    expect(container?.textContent).toContain('Web');
    expect(container?.textContent).not.toContain('[object Object]');
  });

  it('copies fenced code block content with the inline copy button', async () => {
    await act(async () => {
      root!.render(<MarkdownMessageContent content={'```json\n{\n  "platform": "Web"\n}\n```'} />);
    });

    const copyButton = container?.querySelector(
      '[data-testid="chat-markdown-code-copy"]',
    ) as HTMLButtonElement | null;

    act(() => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeClipboardMock).toHaveBeenCalledWith(`{
  "platform": "Web"
}`);
  });

  it('shows thinking fenced blocks expanded by default and lets users collapse to the summary view', async () => {
    await act(async () => {
      root!.render(
        <MarkdownMessageContent
          content={'```thinking\n这里是思考过程\n继续补充第二步\n```\n\n这是最终正文。'}
        />,
      );
    });

    const thinkingBlock = container?.querySelector(
      '.chat-markdown-thinking-block',
    ) as HTMLDivElement | null;
    const toggleButton = container?.querySelector(
      '[data-testid="chat-markdown-thinking-summary"]',
    ) as HTMLButtonElement | null;

    expect(thinkingBlock).not.toBeNull();
    expect(thinkingBlock?.dataset.open).toBe('true');
    expect(container?.textContent).toContain('思考内容');
    expect(container?.textContent).toContain('这里是思考过程');
    expect(container?.textContent).toContain('继续补充第二步');
    expect(container?.textContent).toContain('收起 ·');
    expect(container?.textContent).toContain('这是最终正文。');
    expect(container?.querySelector('.assistant-reasoning-preview')).toBeNull();
    expect(container?.textContent).not.toContain('已显示摘要');

    act(() => {
      toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(thinkingBlock?.dataset.open).toBe('false');
    expect(container?.textContent).toContain('已显示摘要 ·');
    expect(container?.querySelector('.assistant-reasoning-preview')?.textContent).toBe(
      '继续补充第二步',
    );
    expect(thinkingBlock?.querySelector('.assistant-reasoning-body')).toBeNull();

    act(() => {
      toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(thinkingBlock?.dataset.open).toBe('true');
    expect(container?.textContent).toContain('这里是思考过程');
    expect(container?.textContent).toContain('继续补充第二步');
  });

  it('renders HTML fenced blocks with a safe preview tab', async () => {
    await act(async () => {
      root!.render(
        <MarkdownMessageContent content={'```html\n<div class="demo-card">预览内容</div>\n```'} />,
      );
    });

    const previewToggle = container?.querySelector(
      '[data-testid="chat-markdown-preview-toggle"]',
    ) as HTMLButtonElement | null;

    expect(previewToggle).not.toBeNull();
    expect(previewToggle?.textContent).toContain('查看预览');
    expect(container?.querySelector('[data-testid="chat-markdown-html-preview"]')).toBeNull();

    act(() => {
      previewToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const previewFrame = container?.querySelector(
      '[data-testid="chat-markdown-html-preview"]',
    ) as HTMLIFrameElement | null;

    expect(previewFrame).not.toBeNull();
    expect(previewFrame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(previewFrame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(previewFrame?.style.minHeight).toBe('360px');
    expect(previewFrame?.style.height).toBe('360px');
    expect(previewFrame?.getAttribute('srcdoc')).toContain(
      '<base href="about:srcdoc" target="_blank">',
    );
    expect(previewFrame?.getAttribute('srcdoc')).toContain('预览内容');
  });

  it('renders CSS fenced blocks with a static style preview shell', async () => {
    await act(async () => {
      root!.render(
        <MarkdownMessageContent content={'```css\n.demo-card { color: rgb(255, 0, 0); }\n```'} />,
      );
    });

    const previewToggle = container?.querySelector(
      '[data-testid="chat-markdown-preview-toggle"]',
    ) as HTMLButtonElement | null;

    expect(previewToggle).not.toBeNull();

    act(() => {
      previewToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const previewFrame = container?.querySelector(
      '[data-testid="chat-markdown-html-preview"]',
    ) as HTMLIFrameElement | null;

    expect(previewFrame).not.toBeNull();
    expect(previewFrame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(previewFrame?.getAttribute('srcdoc')).toContain('.demo-card { color: rgb(255, 0, 0); }');
    expect(previewFrame?.getAttribute('srcdoc')).toContain('前端样式效果预览');
    expect(previewFrame?.getAttribute('srcdoc')).toContain('CSS Preview');
  });

  it('renders javascript fenced blocks inside an isolated script sandbox', async () => {
    await act(async () => {
      root!.render(
        <MarkdownMessageContent
          content={
            '```javascript\ndocument.getElementById("preview-title").textContent = "脚本已生效";\n```'
          }
        />,
      );
    });

    const previewToggle = container?.querySelector(
      '[data-testid="chat-markdown-preview-toggle"]',
    ) as HTMLButtonElement | null;

    expect(previewToggle).not.toBeNull();

    act(() => {
      previewToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const previewFrame = container?.querySelector(
      '[data-testid="chat-markdown-html-preview"]',
    ) as HTMLIFrameElement | null;

    expect(previewFrame).not.toBeNull();
    expect(previewFrame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(previewFrame?.getAttribute('srcdoc')).toContain('脚本预览基座');
    expect(previewFrame?.getAttribute('srcdoc')).toContain('脚本已生效');
  });

  it('keeps tsx fenced blocks in code mode without preview entry', async () => {
    await act(async () => {
      root!.render(
        <MarkdownMessageContent
          content={'```tsx\nexport function Demo() { return <div />; }\n```'}
        />,
      );
    });

    expect(container?.querySelector('[data-testid="chat-markdown-preview-toggle"]')).toBeNull();
    expect(container?.querySelector('[data-testid="chat-markdown-code-copy"]')).not.toBeNull();
    expect(container?.querySelector('.chat-markdown-code-label')?.textContent).toBe('TSX');
  });
});
