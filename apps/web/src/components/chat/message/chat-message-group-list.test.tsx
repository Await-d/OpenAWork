import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatMessageGroupList,
  resolveGroupHeight,
  type ChatRenderGroup,
} from './chat-message-group-list.js';
import {
  buildSubagentNoticeGroups,
  mergeNoticeGroupsIntoRenderGroups,
} from '../../conversation-runtime/messages/subagent-notice-groups.js';

function createToolOnlyEntry(messageId: string, toolCallId: string) {
  return {
    message: {
      id: messageId,
      role: 'assistant' as const,
      content: '',
      status: 'completed' as const,
      parts: [
        {
          id: toolCallId,
          type: 'tool' as const,
          toolCallId,
          toolName: 'bash',
          input: {},
          status: 'completed' as const,
        },
      ],
    },
    renderContent: (message: { parts?: Array<{ id: string }> }) => (
      <>
        {message.parts?.map((part) => (
          <span key={part.id} data-rendered-tool={part.id} />
        ))}
      </>
    ),
  };
}

describe('ChatMessageGroupList', () => {
  it('renders trailing content before the bottom scroll anchor', () => {
    // Given
    const bottomRef = createRef<HTMLDivElement>();

    // When
    const markup = renderToStaticMarkup(
      <ChatMessageGroupList
        activeModelId="gpt-5.4"
        activeProviderId="openai"
        bottomRef={bottomRef}
        currentUserEmail="user@example.com"
        groups={[]}
        scrollRegionRef={createRef<HTMLDivElement>()}
        trailingContent={<div data-testid="chat-remote-stream-placeholder" />}
      />,
    );

    // Then
    const placeholderIndex = markup.indexOf('chat-remote-stream-placeholder');
    const bottomSpacerIndex = markup.indexOf('flex-shrink:0');

    expect(placeholderIndex).toBeGreaterThan(-1);
    expect(bottomSpacerIndex).toBeGreaterThan(placeholderIndex);
  });

  it('renders trailing content before the bottom scroll anchor when virtualized', () => {
    // Given
    const bottomRef = createRef<HTMLDivElement>();
    const groups: ChatRenderGroup[] = Array.from({ length: 32 }, (_, index) => ({
      kind: 'messages',
      entries: [],
      key: `group-${index}`,
      role: 'assistant',
    }));

    // When
    const markup = renderToStaticMarkup(
      <ChatMessageGroupList
        activeModelId="gpt-5.4"
        activeProviderId="openai"
        bottomRef={bottomRef}
        currentUserEmail="user@example.com"
        groups={groups}
        scrollRegionRef={createRef<HTMLDivElement>()}
        trailingContent={<div data-testid="chat-remote-stream-placeholder" />}
      />,
    );

    // Then
    const placeholderIndex = markup.indexOf('chat-remote-stream-placeholder');
    const bottomSpacerIndex = markup.indexOf('flex-shrink:0');

    expect(placeholderIndex).toBeGreaterThan(-1);
    expect(bottomSpacerIndex).toBeGreaterThan(placeholderIndex);
  });

  it('keeps consecutive tool-only messages at their original message positions', () => {
    const groups: ChatRenderGroup[] = [
      {
        kind: 'messages',
        entries: [
          createToolOnlyEntry('assistant-tool-1', 'tool-1'),
          createToolOnlyEntry('assistant-tool-2', 'tool-2'),
        ],
        key: 'assistant-tools',
        role: 'assistant',
      },
    ];

    const markup = renderToStaticMarkup(
      <ChatMessageGroupList
        activeModelId="gpt-5.4"
        activeProviderId="openai"
        bottomRef={createRef<HTMLDivElement>()}
        currentUserEmail="user@example.com"
        groups={groups}
        scrollRegionRef={createRef<HTMLDivElement>()}
      />,
    );

    const firstIndex = markup.indexOf('data-rendered-tool="tool-1"');
    const secondIndex = markup.indexOf('data-rendered-tool="tool-2"');
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it('通知落在同一助手群组的条目之间时渲染在两条消息之间（而非整组之后）', () => {
    const messageGroups: ChatRenderGroup[] = [
      {
        kind: 'messages',
        key: 'turn-1',
        role: 'assistant',
        entries: [
          {
            message: { id: 'a-1', role: 'assistant', content: '', createdAt: 1_000 },
            renderContent: () => <span data-rendered-message="a-1" />,
          },
          {
            message: { id: 'a-2', role: 'assistant', content: '', createdAt: 9_000 },
            renderContent: () => <span data-rendered-message="a-2" />,
          },
        ],
      },
    ];
    const groups = mergeNoticeGroupsIntoRenderGroups({
      messageGroups,
      noticeGroups: buildSubagentNoticeGroups([
        {
          id: 'n-1',
          agent: 'scout',
          state: 'done',
          description: '国际时事最新新闻',
          text: 'scout 已完成 · 国际时事最新新闻',
          createdAt: 5_000,
        },
      ]),
    });

    const markup = renderToStaticMarkup(
      <ChatMessageGroupList
        activeModelId="gpt-5.4"
        activeProviderId="openai"
        bottomRef={createRef<HTMLDivElement>()}
        currentUserEmail="user@example.com"
        groups={groups}
        scrollRegionRef={createRef<HTMLDivElement>()}
      />,
    );

    const firstIndex = markup.indexOf('data-rendered-message="a-1"');
    const noticeIndex = markup.indexOf('data-component="subagent-notice"');
    const secondIndex = markup.indexOf('data-rendered-message="a-2"');
    expect(firstIndex).toBeGreaterThan(-1);
    expect(noticeIndex).toBeGreaterThan(firstIndex);
    expect(secondIndex).toBeGreaterThan(noticeIndex);
    // 通知行必须复用消息行的列结构（占位头像 + 同一条 flex gap），
    // 否则文本会落在头像槽位下方、与消息正文差 40px（真实几何由浏览器验证）。
    expect(markup).toContain('chat-message-row--notice');
    expect(markup).toContain('chat-message-avatar-spacer');
  });
});

describe('resolveGroupHeight', () => {
  it('uses the last measured height for an observed group when its signature changed', () => {
    // Given: 屏幕内、已有实测高度的组，内容签名变化（流式每帧新增 token）
    // When
    const height = resolveGroupHeight({
      hasObservedNode: true,
      signatureMatches: false,
      measuredHeight: 7200,
      estimateHeight: 408,
    });

    // Then: 必须沿用实测高度；回退封顶估算会让后续所有组整体上移并重叠
    expect(height).toBe(7200);
  });

  it('falls back to the estimate for an observed group without a prior measurement', () => {
    // Given: 屏幕内的组还没测过高度
    // When
    const height = resolveGroupHeight({
      hasObservedNode: true,
      signatureMatches: false,
      measuredHeight: undefined,
      estimateHeight: 408,
    });

    // Then: 没有可信实测只能先用估算，等 RO 回报真实高度
    expect(height).toBe(408);
  });

  it('ignores a stale measurement for a group without a node', () => {
    // Given: 离屏组，留存的高度来自已变化的内容
    // When
    const height = resolveGroupHeight({
      hasObservedNode: false,
      signatureMatches: false,
      measuredHeight: 7200,
      estimateHeight: 408,
    });

    // Then: 离屏组的实测可能过期，签名门禁仍然生效
    expect(height).toBe(408);
  });

  it('does not reuse a larger stale measurement when content shrinks without a node', () => {
    // Given: 内容缩水后的离屏组，旧实测偏大
    // When
    const height = resolveGroupHeight({
      hasObservedNode: false,
      signatureMatches: false,
      measuredHeight: 7200,
      estimateHeight: 120,
    });

    // Then: 不得复用偏大的旧值，必须回退估算等待重新测量
    expect(height).toBe(120);
  });

  it('trusts the measurement while the signature still matches', () => {
    // Given: 签名一致的组，即使离屏也信任实测
    // When
    const height = resolveGroupHeight({
      hasObservedNode: false,
      signatureMatches: true,
      measuredHeight: 500,
      estimateHeight: 408,
    });

    // Then
    expect(height).toBe(500);
  });
});

const STREAMING_GROUP_KEY = 'group-0';
const VIRTUALIZATION_GROUP_COUNT = 32;
const GROUP_GAP_PX = 24;
const MEASURED_STREAMING_HEIGHT = 5000;
const FILLER_MEASURED_HEIGHT = 166;

class MockResizeObserver {
  readonly observed = new Set<Element>();

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }
}

function createDomRect(height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: 800,
    top: 0,
    width: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function installVirtualizationMocks(): void {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const key = this.dataset.virtualGroupKey;
    const height = key === STREAMING_GROUP_KEY ? MEASURED_STREAMING_HEIGHT : FILLER_MEASURED_HEIGHT;
    return createDomRect(key ? height : 0);
  });
}

function createVirtualizedGroups(streamingContent: string): ChatRenderGroup[] {
  const streamingGroup: ChatRenderGroup = {
    kind: 'messages',
    entries: [
      {
        message: {
          content: streamingContent,
          id: 'streaming-assistant',
          role: 'assistant',
          status: 'streaming',
        },
        renderContent: () => <span />,
      },
    ],
    key: STREAMING_GROUP_KEY,
    role: 'assistant',
  };

  const fillerGroups: ChatRenderGroup[] = Array.from(
    { length: VIRTUALIZATION_GROUP_COUNT - 1 },
    (_, index) => ({
      kind: 'messages',
      entries: [
        {
          message: {
            content: 'x'.repeat(90),
            id: `filler-assistant-${index + 1}`,
            role: 'assistant',
            status: 'completed',
          },
          renderContent: () => <span />,
        },
      ],
      key: `group-${index + 1}`,
      role: 'assistant',
    }),
  );

  return [streamingGroup, ...fillerGroups];
}

function buildVirtualizedList(streamingContent: string) {
  return (
    <ChatMessageGroupList
      activeModelId="gpt-5.4"
      activeProviderId="openai"
      bottomRef={createRef<HTMLDivElement>()}
      currentUserEmail="user@example.com"
      groups={createVirtualizedGroups(streamingContent)}
      scrollRegionRef={createRef<HTMLDivElement>()}
    />
  );
}

describe('ChatMessageGroupList virtualized offsets', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps later groups offset by the measured height while a streamed group keeps growing', () => {
    // Given: 屏幕内首个组已有远大于封顶估算的实测高度
    installVirtualizationMocks();
    const view = render(buildVirtualizedList('start of the answer'));

    expect(
      view.container.querySelector<HTMLElement>('[data-virtual-group-key="group-0"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelector<HTMLElement>('[data-virtual-group-key="group-1"]')?.style.top,
    ).toBe(`${MEASURED_STREAMING_HEIGHT + GROUP_GAP_PX}px`);

    // When: 该组签名因流式内容增长而变化
    view.rerender(buildVirtualizedList('start of the answer, now much longer while streaming'));

    // Then: 后续组仍按实测高度偏移，不会整体上移并与首个组重叠
    expect(
      view.container.querySelector<HTMLElement>('[data-virtual-group-key="group-1"]')?.style.top,
    ).toBe(`${MEASURED_STREAMING_HEIGHT + GROUP_GAP_PX}px`);
  });
});
