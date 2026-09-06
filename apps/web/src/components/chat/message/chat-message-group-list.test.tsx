import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatMessageGroupList, type ChatRenderGroup } from './chat-message-group-list.js';

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
});
