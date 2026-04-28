import { describe, expect, it } from 'vitest';
import {
  makeMessageId,
  makePartId,
  type MessageWithParts,
} from '../message-v2-schema.js';
import { toModelMessages } from '../message-to-model-messages.js';
import { renderResponsesApi } from '../render-responses-api.js';
import { renderChatCompletions } from '../render-chat-completions.js';
import { renderAnthropicMessages } from '../render-anthropic-messages.js';

function createUserMessageWithImage(): MessageWithParts {
  const messageId = makeMessageId();
  return {
    info: {
      id: messageId,
      sessionID: 'session-1',
      role: 'user',
      time: { created: 1 },
    },
    parts: [
      {
        id: makePartId(),
        sessionID: 'session-1',
        messageID: messageId,
        type: 'text',
        text: '请描述这张图片',
      },
      {
        id: makePartId(),
        sessionID: 'session-1',
        messageID: messageId,
        type: 'file',
        inputType: 'input_image',
        mime: 'image/png',
        filename: 'whale.png',
        url: 'data:image/png;base64,abc123',
        detail: 'high',
      },
    ],
  };
}

const renderOptions = {
  protocol: 'responses' as const,
  cache: undefined,
  maxTokens: 2048,
  model: 'gpt-4.1',
  requestOverrides: {},
  temperature: 1,
  thinking: undefined,
  tools: [],
  variant: undefined,
};

describe('multimodal user renderers', () => {
  it('keeps input_image data when converting message parts to unified messages', () => {
    const unified = toModelMessages([createUserMessageWithImage()]);

    expect(unified).toEqual([
      {
        role: 'user',
        content: '请描述这张图片',
        images: [
          {
            imageUrl: 'data:image/png;base64,abc123',
            fileName: 'whale.png',
            mimeType: 'image/png',
            detail: 'high',
          },
        ],
      },
    ]);
  });

  it('renders Responses API user content with input_image blocks', () => {
    const unified = toModelMessages([createUserMessageWithImage()]);
    const body = renderResponsesApi(unified, renderOptions) as { input: Array<{ content: unknown[] }> };

    expect(body.input[0]?.content).toEqual([
      { type: 'input_text', text: '请描述这张图片' },
      { type: 'input_image', image_url: 'data:image/png;base64,abc123', detail: 'high' },
    ]);
  });

  it('renders Chat Completions user content with image_url blocks', () => {
    const unified = toModelMessages([createUserMessageWithImage()]);
    const body = renderChatCompletions(unified, renderOptions) as { messages: Array<{ content: unknown[] }> };

    expect(body.messages[0]?.content).toEqual([
      { type: 'text', text: '请描述这张图片' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123', detail: 'high' } },
    ]);
  });

  it('renders Anthropic user content with base64 image blocks', () => {
    const unified = toModelMessages([createUserMessageWithImage()]);
    const body = renderAnthropicMessages(unified, {
      ...renderOptions,
      protocol: 'anthropic_messages' as const,
    }) as { messages: Array<{ content: unknown[] }> };

    expect(body.messages[0]?.content).toEqual([
      expect.objectContaining({ type: 'text', text: '请描述这张图片' }),
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'abc123',
        },
      },
    ]);
  });
});
