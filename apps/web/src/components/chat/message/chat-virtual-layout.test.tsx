import { createRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageGroupList, type ChatRenderMessageGroup } from './chat-message-group-list.js';
import { buildChatVirtualBlocks, ChatVirtualLayout } from './chat-virtual-layout.js';

vi.mock('../session/ChatPageSections.js', () => ({
  InlinePermissionQuickBar: () => <div />,
  sharedUiThemeVars: {},
  MessageRow: ({
    message,
    groupedWithPrevious,
    actions,
    identityOverride,
  }: {
    message: { id: string; content: string };
    groupedWithPrevious: boolean;
    actions?: Array<{ id: string }>;
    identityOverride?: { displayName: string };
  }) => (
    <div
      data-message-id={message.id}
      data-grouped={String(groupedWithPrevious)}
      data-actions={actions?.map((action) => action.id).join(',')}
      data-identity={identityOverride?.displayName}
    >
      {message.content}
    </div>
  ),
}));

function createGroup(count: number): ChatRenderMessageGroup {
  return {
    kind: 'messages',
    key: 'one-turn',
    role: 'assistant',
    actions: [{ id: 'group-action', label: '操作', onClick: vi.fn() }],
    entries: Array.from({ length: count }, (_, i) => ({
      message: { id: `message-${i}`, role: 'assistant', content: `text-${i}`, createdAt: 1000 },
      identityOverride: { displayName: '助手身份' },
      renderContent: () => null,
    })),
  };
}

function list(group: ChatRenderMessageGroup, region: HTMLDivElement, target?: string) {
  return (
    <ChatMessageGroupList
      activeModelId="model"
      activeProviderId="provider"
      currentUserEmail="user@example.com"
      bottomRef={createRef<HTMLDivElement>()}
      scrollRegionRef={{ current: region }}
      groups={[group]}
      pendingMessageScroll={target ? { messageId: target, nonce: 1 } : undefined}
    />
  );
}

function createRegion() {
  const region = document.createElement('div');
  Object.defineProperty(region, 'clientHeight', { value: 600 });
  Object.defineProperty(region, 'scrollHeight', { value: 100000 });
  return region;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatVirtualLayout', () => {
  it('二分定位含边界、间隔与表尾，并增量修正实测偏移', () => {
    const layout = new ChatVirtualLayout();
    layout.reconcile(['a', 'b', 'c'], () => 100);
    expect([0, 100, 101, 200, 301].map((value) => layout.lowerBound(value))).toEqual([
      0, 0, 1, 1, 3,
    ]);
    layout.update('a', 250);
    expect(layout.offset(2)).toBe(350);
    expect(layout.totalHeight).toBe(450);
    expect(layout.lowerBound(251)).toBe(1);
  });

  it('深历史定位仅需对数次索引读取，更新单块不重建全表', () => {
    const layout = new ChatVirtualLayout();
    const readHeight = vi.fn(() => 100);
    layout.reconcile(
      Array.from({ length: 100000 }, (_, i) => String(i)),
      readHeight,
    );
    readHeight.mockClear();
    layout.update('99999', 200);
    expect(layout.lowerBound(9999901)).toBe(99999);
    expect(layout.totalHeight).toBe(10000100);
    expect(readHeight).not.toHaveBeenCalled();
  });

  it('尾部流式更新复用未变化子块，且每块最多八条消息', () => {
    const group = createGroup(80);
    const blocks = buildChatVirtualBlocks([group]);
    const entries = [...group.entries];
    entries[79] = { ...entries[79]!, message: { ...entries[79]!.message, content: 'new token' } };
    const next = buildChatVirtualBlocks(
      [{ ...group, entries, actions: [...group.actions!] }],
      blocks,
    );
    expect(next).toHaveLength(10);
    expect(next[0]?.group).not.toBe(blocks[0]?.group);
    expect(next[1]?.group).toBe(blocks[1]?.group);
    expect(next[9]?.group).not.toBe(blocks[9]?.group);
    expect(
      next.every(({ group: block }) => block.kind === 'messages' && block.entries.length <= 8),
    ).toBe(true);
  });
});

describe('single large visual group virtualization', () => {
  it('不足32组也只挂载有界子块，续块保持身份、组内样式且不复制组操作或时间分隔', () => {
    const region = createRegion();
    const view = render(list(createGroup(800), region));
    expect(
      view.container.querySelector('[data-testid="chat-virtualized-group-list"]'),
    ).not.toBeNull();
    const rows = view.container.querySelectorAll('[data-message-id]');
    expect(rows.length).toBeGreaterThan(8);
    expect(rows.length).toBeLessThanOrEqual(32);
    expect(
      view.container.querySelector('[data-message-id="message-8"]')?.getAttribute('data-grouped'),
    ).toBe('true');
    expect(view.container.querySelectorAll('[data-actions="group-action"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('.chat-time-divider')).toHaveLength(1);
    expect(
      view.container.querySelector('[data-message-id="message-8"]')?.getAttribute('data-identity'),
    ).toBe('助手身份');
    expect(view.container.querySelectorAll('[data-group-key="one-turn"]').length).toBeGreaterThan(
      1,
    );
  });

  it('离屏子块内容增长后不在下一帧复活过期实测高度', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return {
        height: this.dataset.virtualGroupKey === 'one-turn:virtual:0' ? 5000 : 100,
      } as DOMRect;
    });
    const region = createRegion();
    const group = createGroup(800);
    const view = render(list(group, region));
    act(() => {
      region.scrollTop = 20000;
      fireEvent.scroll(region);
    });
    expect(view.container.querySelector('[data-message-id="message-0"]')).toBeNull();
    const entries = [...group.entries];
    entries[0] = {
      ...entries[0]!,
      message: { ...entries[0]!.message, content: 'longer streamed content'.repeat(50) },
    };
    const grown = { ...group, entries };
    view.rerender(list(grown, region));
    const height = view.container.querySelector<HTMLElement>(
      '[data-testid="chat-virtualized-group-list"]',
    )?.style.minHeight;
    view.rerender(list({ ...grown }, region));
    expect(
      view.container.querySelector<HTMLElement>('[data-testid="chat-virtualized-group-list"]')
        ?.style.minHeight,
    ).toBe(height);
  });

  it('消息锚点定位到大组的目标子块而非整组中点，并保留尾部流式更新', () => {
    const region = createRegion();
    const group = createGroup(800);
    const view = render(list(group, region, 'message-799'));
    expect(region.scrollTop).toBeGreaterThan(0);
    expect(view.container.querySelector('[data-message-id="message-799"]')).not.toBeNull();
    const entries = [...group.entries];
    entries[799] = {
      ...entries[799]!,
      message: { ...entries[799]!.message, content: 'streamed tail', status: 'streaming' },
    };
    act(() => {
      fireEvent.scroll(region);
    });
    view.rerender(list({ ...group, entries }, region, 'message-799'));
    expect(view.container.querySelector('[data-message-id="message-799"]')?.textContent).toBe(
      'streamed tail',
    );
    expect(view.container.querySelectorAll('[data-message-id]').length).toBeLessThanOrEqual(32);
  });
});
