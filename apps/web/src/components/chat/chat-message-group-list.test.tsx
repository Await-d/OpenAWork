// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageGroupList, type ChatRenderGroup } from './chat-message-group-list.js';

const renderCountByMessageId = new Map<string, number>();

vi.mock('./ChatPageSections.js', () => {
  return {
    MessageRow: ({
      message,
      renderContent,
    }: {
      message: { content: string; id: string };
      renderContent: (message: { content: string; id: string }) => React.ReactNode;
    }) => {
      renderCountByMessageId.set(message.id, (renderCountByMessageId.get(message.id) ?? 0) + 1);
      return <div data-testid={`message-row-${message.id}`}>{renderContent(message)}</div>;
    },
    sharedUiThemeVars: {},
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let observeMock = vi.fn<(element: Element) => void>();
let unobserveMock = vi.fn<(element: Element) => void>();
let disconnectMock = vi.fn<() => void>();

function createGroups(count: number): ChatRenderGroup[] {
  return Array.from({ length: count }, (_, index) => ({
    entries: [
      {
        message: {
          content: `第 ${index + 1} 组消息内容`,
          id: `message-${index + 1}`,
          role: index % 2 === 0 ? 'assistant' : 'user',
        },
        renderContent: (message) => <span>{message.content}</span>,
      },
    ],
    key: `group-${index + 1}`,
    role: index % 2 === 0 ? 'assistant' : 'user',
  }));
}

describe('ChatMessageGroupList', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    renderCountByMessageId.clear();

    observeMock = vi.fn<(element: Element) => void>();
    unobserveMock = vi.fn<(element: Element) => void>();
    disconnectMock = vi.fn<() => void>();

    class MockResizeObserver implements ResizeObserver {
      public observe = observeMock;
      public unobserve = unobserveMock;
      public disconnect = disconnectMock;

      public constructor(_callback: ResizeObserverCallback) {}
    }

    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: MockResizeObserver,
    });
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

  it('keeps virtualized measurement refs stable across parent rerenders', async () => {
    const groups = createGroups(40);
    const bottomRef = React.createRef<HTMLDivElement>();
    const scrollRegion = document.createElement('div');
    Object.defineProperty(scrollRegion, 'clientHeight', {
      configurable: true,
      value: 840,
    });
    Object.defineProperty(scrollRegion, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });
    const scrollRegionRef = {
      current: scrollRegion,
    } as React.RefObject<HTMLDivElement | null>;

    await act(async () => {
      root!.render(
        <ChatMessageGroupList
          activeModelId="model-a"
          activeProviderId="provider-a"
          bottomRef={bottomRef}
          currentUserEmail="hephaestus@example.com"
          groups={groups}
          scrollRegionRef={scrollRegionRef}
        />,
      );
    });

    expect(container?.querySelector('[data-testid="chat-virtualized-group-list"]')).not.toBeNull();
    const initialObserveCount = observeMock.mock.calls.length;
    expect(initialObserveCount).toBeGreaterThan(0);
    const initialUnobserveCount = unobserveMock.mock.calls.length;

    await act(async () => {
      root!.render(
        <ChatMessageGroupList
          activeModelId="model-b"
          activeProviderId="provider-a"
          bottomRef={bottomRef}
          currentUserEmail="hephaestus@example.com"
          groups={groups}
          scrollRegionRef={scrollRegionRef}
        />,
      );
    });

    expect(observeMock).toHaveBeenCalledTimes(initialObserveCount);
    expect(unobserveMock).toHaveBeenCalledTimes(initialUnobserveCount);
  });

  it('does not rerender unchanged historical groups during parent rerenders', async () => {
    const groups = createGroups(40);
    const bottomRef = React.createRef<HTMLDivElement>();
    const scrollRegion = document.createElement('div');
    Object.defineProperty(scrollRegion, 'clientHeight', {
      configurable: true,
      value: 840,
    });
    Object.defineProperty(scrollRegion, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });
    const scrollRegionRef = {
      current: scrollRegion,
    } as React.RefObject<HTMLDivElement | null>;

    await act(async () => {
      root!.render(
        <ChatMessageGroupList
          activeModelId="model-a"
          activeProviderId="provider-a"
          bottomRef={bottomRef}
          currentUserEmail="hephaestus@example.com"
          groups={groups}
          scrollRegionRef={scrollRegionRef}
        />,
      );
    });

    const firstRenderCount = renderCountByMessageId.get('message-1');
    expect(firstRenderCount).toBe(1);

    await act(async () => {
      root!.render(
        <ChatMessageGroupList
          activeModelId="model-a"
          activeProviderId="provider-a"
          bottomRef={bottomRef}
          currentUserEmail="hephaestus@example.com"
          groups={groups}
          scrollRegionRef={scrollRegionRef}
        />,
      );
    });

    expect(renderCountByMessageId.get('message-1')).toBe(1);
  });
});
