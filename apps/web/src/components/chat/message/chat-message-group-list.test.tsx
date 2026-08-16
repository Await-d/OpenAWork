import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatMessageGroupList, type ChatRenderGroup } from './chat-message-group-list.js';

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
});
