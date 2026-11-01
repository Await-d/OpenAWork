import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QueuedSendBubbles } from './queued-send-bubbles.js';
import type { QueuedComposerPreview } from './queued-composer-state.js';

function createPreview(overrides: Partial<QueuedComposerPreview> = {}): QueuedComposerPreview {
  return {
    attachmentCount: 0,
    id: 'queue-1',
    label: '跑通类型检查',
    requiresAttachmentRebind: false,
    text: '把整个仓库的类型检查跑通',
    title: '把整个仓库的类型检查跑通',
    ...overrides,
  };
}

describe('QueuedSendBubbles', () => {
  it('队列为空时不渲染任何内容', () => {
    expect(renderToStaticMarkup(<QueuedSendBubbles items={[]} />)).toBe('');
  });

  it('渲染待发全文与条数说明', () => {
    const markup = renderToStaticMarkup(<QueuedSendBubbles items={[createPreview()]} />);

    expect(markup).toContain('把整个仓库的类型检查跑通');
    expect(markup).toContain('已收到 1 条待发消息');
    expect(markup).toContain('待发');
  });

  it('多条待发按条数渲染', () => {
    const markup = renderToStaticMarkup(
      <QueuedSendBubbles
        items={[createPreview({ id: 'a' }), createPreview({ id: 'b', text: '第二条' })]}
      />,
    );

    expect(markup).toContain('已收到 2 条待发消息');
    expect(markup).toContain('第二条');
  });

  it('显示附件数与需要重新选择附件的提示', () => {
    const markup = renderToStaticMarkup(
      <QueuedSendBubbles
        items={[createPreview({ attachmentCount: 2, requiresAttachmentRebind: true })]}
      />,
    );

    expect(markup).toContain('2 个附件');
    expect(markup).toContain('需重新选择附件');
  });

  it('仅附件的条目不留空文本块', () => {
    const markup = renderToStaticMarkup(
      <QueuedSendBubbles items={[createPreview({ attachmentCount: 1, text: '   ' })]} />,
    );

    expect(markup).toContain('（仅附件）');
    expect(markup).toContain('1 个附件');
  });
});
