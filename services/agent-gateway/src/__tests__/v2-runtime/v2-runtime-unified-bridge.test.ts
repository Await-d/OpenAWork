import { describe, expect, it } from 'vitest';
import {
  unifiedConversationToModelMessages,
  unifiedMessageToModelMessages,
  wrapGatewayToolsForAiSdkDeclarationsOnly,
  wrapToolsForAiSdkDeclarationsOnly,
  type GatewayToolFunctionShape,
} from '../../v2-runtime/upstream/index.js';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

describe('unifiedMessageToModelMessages', () => {
  it('passes system messages through verbatim', () => {
    const result = unifiedMessageToModelMessages({ role: 'system', content: 'sys' });
    expect(result).toEqual([{ role: 'system', content: 'sys' }]);
  });

  it('passes plain user messages as a single string', () => {
    const result = unifiedMessageToModelMessages({ role: 'user', content: 'hi' });
    expect(result).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('emits TextPart + ImagePart array when user has imageUrl', () => {
    const result = unifiedMessageToModelMessages({
      role: 'user',
      content: 'see this',
      images: [{ imageUrl: 'https://x/y.png', mimeType: 'image/png' }],
    });
    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', image: 'https://x/y.png', mediaType: 'image/png' },
        ],
      },
    ]);
  });

  it('falls back to bare content when images carry no usable url', () => {
    const result = unifiedMessageToModelMessages({
      role: 'user',
      content: 'no-url image',
      images: [{ artifactId: 'x' }],
    });
    expect(result).toEqual([{ role: 'user', content: 'no-url image' }]);
  });

  it('builds [reasoning, text, ...toolCalls] for assistant turns with all parts', () => {
    const result = unifiedMessageToModelMessages({
      role: 'assistant',
      content: 'OK',
      reasoning: { text: 'thinking' },
      toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }],
    });
    expect(result).toHaveLength(1);
    const assistant = result[0]!;
    expect(assistant.role).toBe('assistant');
    expect(Array.isArray(assistant.content)).toBe(true);
    expect(assistant.content).toEqual([
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'OK' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: 'a.ts' } },
    ]);
  });

  it('emits per-block reasoning with anthropic.signature in providerOptions when blocks present', () => {
    const result = unifiedMessageToModelMessages({
      role: 'assistant',
      content: 'OK',
      reasoning: {
        text: 'b1\n\nb2',
        blocks: [
          { text: 'b1', signature: 'sig-1' },
          { text: 'b2', signature: 'sig-2' },
        ],
      },
    });
    const parts = result[0]!.content as unknown as Array<Record<string, unknown>>;
    // [reasoning(b1, sig-1), text(' '), reasoning(b2, sig-2), text('OK')]
    expect(parts).toHaveLength(4);
    expect(parts[0]).toMatchObject({
      type: 'reasoning',
      text: 'b1',
      providerOptions: { anthropic: { signature: 'sig-1' } },
    });
    expect(parts[1]).toEqual({ type: 'text', text: ' ' });
    expect(parts[2]).toMatchObject({
      type: 'reasoning',
      text: 'b2',
      providerOptions: { anthropic: { signature: 'sig-2' } },
    });
    expect(parts[3]).toEqual({ type: 'text', text: 'OK' });
  });

  it('does not insert single-space separator when blocks are unsigned', () => {
    const result = unifiedMessageToModelMessages({
      role: 'assistant',
      content: null,
      reasoning: {
        text: 'a\n\nb',
        blocks: [{ text: 'a' }, { text: 'b' }],
      },
    });
    const parts = result[0]!.content as unknown as Array<Record<string, unknown>>;
    expect(parts.map((p) => p['type'])).toEqual(['reasoning', 'reasoning']);
  });

  it('drops empty assistant turns', () => {
    const result = unifiedMessageToModelMessages({
      role: 'assistant',
      content: null,
    });
    expect(result).toEqual([]);
  });

  // Regression: OpenAI Responses API requires `function_call.id`
  // (`fc_xxx`) on round-2 input or it re-keys the item and the
  // upstream prompt-cache prefix from this point on misses on every
  // subsequent request. The persisted `tool-call.providerMetadata`
  // (e.g. `openai.itemId`) must round-trip into AI SDK's
  // `tool-call.providerOptions` so the OpenAI Responses adapter
  // rebuilds the original `id` rather than falling back to the
  // call_id (`call_xxx`).
  it('forwards tool-call.providerMetadata into ToolCallPart.providerOptions', () => {
    const result = unifiedMessageToModelMessages({
      role: 'assistant',
      content: null,
      toolCalls: [
        {
          id: 'call_websearch',
          name: 'web_search',
          arguments: '{"query":"React 19"}',
          providerMetadata: { openai: { itemId: 'fc_websearch_001' } },
        },
      ],
    });
    expect(result).toHaveLength(1);
    const assistant = result[0]!;
    expect(assistant.role).toBe('assistant');
    if (!Array.isArray(assistant.content)) throw new Error('expected array content');
    const toolCallPart = assistant.content.find((p) => p.type === 'tool-call');
    expect(toolCallPart).toBeDefined();
    if (toolCallPart && toolCallPart.type === 'tool-call') {
      expect(toolCallPart.toolCallId).toBe('call_websearch');
      expect(toolCallPart.providerOptions).toEqual({
        openai: { itemId: 'fc_websearch_001' },
      });
    }
  });

  it('omits providerOptions when no tool-call providerMetadata is supplied', () => {
    const result = unifiedMessageToModelMessages({
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }],
    });
    if (!Array.isArray(result[0]!.content)) throw new Error('expected array content');
    const toolCallPart = result[0]!.content.find((p) => p.type === 'tool-call');
    expect(toolCallPart).toBeDefined();
    if (toolCallPart && toolCallPart.type === 'tool-call') {
      expect(toolCallPart.providerOptions).toBeUndefined();
    }
  });

  it('falls back to raw arguments when JSON parsing fails', () => {
    const result = unifiedMessageToModelMessages({
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'c2', name: 'noop', arguments: 'not-json' }],
    });
    expect((result[0]!.content as Array<{ type: string; input?: unknown }>)[0]).toMatchObject({
      type: 'tool-call',
      input: 'not-json',
    });
  });

  it('renders tool messages as a single tool-result part', () => {
    const result = unifiedMessageToModelMessages({
      role: 'tool',
      toolCallId: 'c1',
      toolName: 'read',
      content: 'output',
    });
    expect(result).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'read',
            output: { type: 'text', value: 'output' },
          },
        ],
      },
    ]);
  });
});

describe('unifiedConversationToModelMessages', () => {
  it('flat-maps the whole conversation in order, dropping empty turns', () => {
    const messages: UnifiedMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null },
      { role: 'assistant', content: 'a' },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'r' },
    ];
    const result = unifiedConversationToModelMessages(messages);
    expect(result.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
  });

  it('preserves tool-to-user adjacency without injecting assistant acknowledgements', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'r' },
      { role: 'user', content: 'next' },
    ];
    const result = unifiedConversationToModelMessages(messages);
    expect(result.map((m) => m.role)).toEqual(['assistant', 'tool', 'user']);
  });
});

describe('wrapToolsForAiSdkDeclarationsOnly', () => {
  it('produces tools without an execute fn so AI SDK stops on tool-calls', () => {
    const def: ToolDefinition = {
      name: 'echo',
      description: 'echo desc',
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.string(),
      execute: async () => 'unused',
    };
    const set = wrapToolsForAiSdkDeclarationsOnly([def]);
    const echo = set['echo'];
    expect(echo).toBeDefined();
    expect(echo!.description).toBe('echo desc');
    expect(echo!.execute).toBeUndefined();
  });

  it('keeps last-write-wins semantics for duplicate tool names', () => {
    const a: ToolDefinition = {
      name: 'tool',
      description: 'a',
      inputSchema: z.object({}),
      outputSchema: z.null(),
      execute: async () => null,
    };
    const b: ToolDefinition = {
      name: 'tool',
      description: 'b',
      inputSchema: z.object({}),
      outputSchema: z.null(),
      execute: async () => null,
    };
    const set = wrapToolsForAiSdkDeclarationsOnly([a, b]);
    expect(set['tool']!.description).toBe('b');
  });
});

describe('wrapGatewayToolsForAiSdkDeclarationsOnly', () => {
  function buildGatewayTool(name: string, description: string): GatewayToolFunctionShape {
    return {
      type: 'function',
      function: {
        name,
        description,
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
        strict: false,
      },
    };
  }

  it('builds AI SDK tools without execute from JSON-schema gateway defs', () => {
    const set = wrapGatewayToolsForAiSdkDeclarationsOnly([
      buildGatewayTool('echo', 'echo gateway'),
    ]);
    const echo = set['echo'];
    expect(echo).toBeDefined();
    expect(echo!.description).toBe('echo gateway');
    expect(echo!.execute).toBeUndefined();
  });

  it('keeps last-write-wins semantics for duplicate tool names', () => {
    const set = wrapGatewayToolsForAiSdkDeclarationsOnly([
      buildGatewayTool('dup', 'first'),
      buildGatewayTool('dup', 'second'),
    ]);
    expect(set['dup']!.description).toBe('second');
  });
});
