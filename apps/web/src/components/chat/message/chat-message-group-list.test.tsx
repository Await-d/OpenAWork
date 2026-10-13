import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
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

  it('子代理通知正文按 Markdown 渲染（加粗标记不再裸露）', () => {
    const groups = buildSubagentNoticeGroups([
      {
        id: 'n-md',
        agent: 'explore',
        state: 'done',
        description: '结构梳理',
        text: [
          '<results>',
          '<answer>',
          '**结论**：状态机核心实现已确认。',
          '</answer>',
          '</results>',
        ].join('\n'),
        createdAt: 1_000,
      },
    ]);

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

    expect(markup).toContain('<strong>结论</strong>');
    expect(markup).not.toContain('**结论**');
  });

  it('传入 onOpenSubagentChild 时通知行可点击并回传子会话 id', () => {
    const onOpenSubagentChild = vi.fn();
    const groups = buildSubagentNoticeGroups([
      {
        id: 'n-click',
        agent: 'web-researcher',
        state: 'done',
        description: '请联网检索科技行业新动态',
        text: '<subagent sessionID="child-1" state="completed">子代理已完成</subagent>',
        childSessionId: 'child-1',
        createdAt: 1_000,
      },
    ]);

    const { container } = render(
      <ChatMessageGroupList
        activeModelId="gpt-5.4"
        activeProviderId="openai"
        bottomRef={createRef<HTMLDivElement>()}
        currentUserEmail="user@example.com"
        groups={groups}
        onOpenSubagentChild={onOpenSubagentChild}
        scrollRegionRef={createRef<HTMLDivElement>()}
      />,
    );

    const heading = container.querySelector('[data-subagent-notice-heading="true"]');
    expect(heading).not.toBeNull();
    fireEvent.click(heading as HTMLElement);

    expect(onOpenSubagentChild).toHaveBeenCalledWith('child-1');
  });

  it('未传 onOpenSubagentChild 时通知行不可点击（不渲染按钮）', () => {
    const groups = buildSubagentNoticeGroups([
      {
        id: 'n-no-click',
        agent: 'web-researcher',
        state: 'done',
        description: '请联网检索科技行业新动态',
        text: '<subagent sessionID="child-1" state="completed">子代理已完成</subagent>',
        childSessionId: 'child-1',
        createdAt: 1_000,
      },
    ]);

    const { container } = render(
      <ChatMessageGroupList
        activeModelId="gpt-5.4"
        activeProviderId="openai"
        bottomRef={createRef<HTMLDivElement>()}
        currentUserEmail="user@example.com"
        groups={groups}
        scrollRegionRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(container.querySelector('[data-subagent-notice-heading="true"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
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

const COARSE_SCROLL_VIEWPORT_HEIGHT = 600;
const COARSE_SCROLL_CONTENT_HEIGHT = 8000;
const COARSE_SCROLL_TARGET_INDEX = 20;
/** 与组件内部 `OVERSCAN_PX` 对齐：挂载窗口 = 视口 ± overscan。 */
const VIRTUAL_OVERSCAN_PX = 720;

/**
 * 所有组高度一致：虚拟视口无论走实测还是估算，偏移都均匀递增，
 * 断言只依赖「目标落进视口」这一结果，不绑定具体估算公式。
 */
function installUniformHeightMocks(): void {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return createDomRect(this.dataset.virtualGroupKey ? FILLER_MEASURED_HEIGHT : 0);
  });
}

function createScrollRegion(): HTMLDivElement {
  const region = document.createElement('div');
  Object.defineProperty(region, 'clientHeight', {
    configurable: true,
    value: COARSE_SCROLL_VIEWPORT_HEIGHT,
  });
  Object.defineProperty(region, 'scrollHeight', {
    configurable: true,
    value: COARSE_SCROLL_CONTENT_HEIGHT,
  });
  Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: 0 });
  document.body.appendChild(region);
  return region;
}

function createCoarseScrollGroups(): ChatRenderGroup[] {
  return Array.from({ length: VIRTUALIZATION_GROUP_COUNT }, (_, index) => ({
    kind: 'messages' as const,
    entries: [
      {
        message: {
          content: 'x'.repeat(90),
          id: `scroll-target-${index}`,
          role: 'assistant' as const,
          status: 'completed' as const,
        },
        renderContent: () => <span />,
      },
    ],
    key: `group-${index}`,
    role: 'assistant' as const,
  }));
}

function buildCoarseScrollList(
  scrollRegionRef: React.RefObject<HTMLDivElement | null>,
  nonce: number,
) {
  return (
    <ChatMessageGroupList
      activeModelId="gpt-5.4"
      activeProviderId="openai"
      bottomRef={createRef<HTMLDivElement>()}
      currentUserEmail="user@example.com"
      groups={createCoarseScrollGroups()}
      pendingMessageScroll={{ messageId: `scroll-target-${COARSE_SCROLL_TARGET_INDEX}`, nonce }}
      scrollRegionRef={scrollRegionRef}
    />
  );
}

describe('ChatMessageGroupList pendingMessageScroll', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('按目标组偏移粗滚动，把离屏目标带进挂载窗口', () => {
    // Given: 32 组虚拟列表 + 位于挂载窗口之外的目标（索引 20）
    installUniformHeightMocks();
    const region = createScrollRegion();
    const scrollRegionRef = createRef<HTMLDivElement>();
    scrollRegionRef.current = region;

    // When
    const view = render(buildCoarseScrollList(scrollRegionRef, 1));
    act(() => {
      region.dispatchEvent(new Event('scroll'));
    });

    // Then: 目标组已挂载,且落在虚拟视口的渲染窗口内(粗滚动的目的)。
    // 注意:目标挂载后由实测高度替换估算高度,偏移会回缩,因此最终位置可能略偏
    // 视口上方——精确居中由调用方的 scrollIntoView 负责,这里只保证目标被挂载。
    const targetNode = view.container.querySelector<HTMLElement>(
      `[data-virtual-group-key="group-${COARSE_SCROLL_TARGET_INDEX}"]`,
    );
    expect(targetNode).not.toBeNull();
    const targetTop = Number.parseFloat(targetNode?.style.top ?? '0');
    const targetBottom = targetTop + FILLER_MEASURED_HEIGHT;
    expect(region.scrollTop).toBeGreaterThan(0);
    expect(targetTop).toBeLessThanOrEqual(
      region.scrollTop + COARSE_SCROLL_VIEWPORT_HEIGHT + VIRTUAL_OVERSCAN_PX,
    );
    expect(targetBottom).toBeGreaterThanOrEqual(region.scrollTop - VIRTUAL_OVERSCAN_PX);
  });

  it('同一 nonce 重复渲染不会再次滚动', () => {
    // Given: 已消费过一次请求（nonce = 7）
    installUniformHeightMocks();
    const region = createScrollRegion();
    const scrollRegionRef = createRef<HTMLDivElement>();
    scrollRegionRef.current = region;
    const view = render(buildCoarseScrollList(scrollRegionRef, 7));
    expect(region.scrollTop).toBeGreaterThan(0);

    // When: 同一 nonce 重新渲染（例如流式更新触发的重渲染）
    region.scrollTop = 0;
    view.rerender(buildCoarseScrollList(scrollRegionRef, 7));

    // Then: 不应再次抢滚动
    expect(region.scrollTop).toBe(0);
  });
});
