import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkflowLlmRequest,
  extractWorkflowLlmText,
  requestWorkflowLlmCompletion,
} from '../routes/workflow-llm.js';

describe('buildWorkflowLlmRequest', () => {
  it('builds non-streaming Responses requests for OpenAI-style models', () => {
    const request = buildWorkflowLlmRequest({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      prompt: '你好',
      temperature: 0.7,
    });

    expect(request.providerType).toBe('openai');
    expect(request.upstreamProtocol).toBe('responses');
    expect(request.url).toBe('https://api.openai.com/v1/responses');
    expect(request.body).toMatchObject({
      model: 'gpt-4o',
      max_output_tokens: 2048,
      temperature: 0.7,
      stream: false,
    });
    expect(request.body['input']).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: '你好' }] },
    ]);
    expect(request.body).not.toHaveProperty('messages');
  });

  it('uses provider-aware routing for alias models on OpenAI base URLs', () => {
    const request = buildWorkflowLlmRequest({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'team-model-alias',
      prompt: 'alias model',
      temperature: 0.5,
    });

    expect(request.providerType).toBe('openai');
    expect(request.upstreamProtocol).toBe('responses');
    expect(request.url).toBe('https://api.openai.com/v1/responses');
    expect(request.body).toMatchObject({ stream: false, max_output_tokens: 2048 });
  });

  it('keeps chat completions for non-OpenAI providers', () => {
    const request = buildWorkflowLlmRequest({
      apiBaseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet-20241022',
      prompt: 'hello',
      temperature: 0.3,
    });

    expect(request.providerType).toBe('anthropic');
    expect(request.upstreamProtocol).toBe('chat_completions');
    expect(request.url).toBe('https://api.anthropic.com/v1/chat/completions');
    expect(request.body).toMatchObject({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      temperature: 0.3,
      stream: false,
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(request.body).not.toHaveProperty('input');
  });
});

describe('requestWorkflowLlmCompletion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests JSON Responses payloads without streaming', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ output_text: 'workflow response' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await requestWorkflowLlmCompletion({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'team-model-alias',
      prompt: 'optimize this prompt',
      temperature: 0.7,
    });

    expect(text).toBe('workflow response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error('expected fetch to be called');
    }

    const [url, init] = firstCall;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init).toMatchObject({ method: 'POST' });
    if (typeof init?.body !== 'string') {
      throw new Error('expected request body to be a JSON string');
    }

    const payload = JSON.parse(init.body) as Record<string, unknown>;
    expect(payload['stream']).toBe(false);
    expect(payload['input']).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'optimize this prompt' }] },
    ]);
  });
});

describe('extractWorkflowLlmText', () => {
  it('prefers Responses output_text without duplicating output content', () => {
    expect(
      extractWorkflowLlmText({
        output_text: 'Responses 文本',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '不应重复' }],
          },
        ],
      }),
    ).toBe('Responses 文本');
  });

  it('extracts text from chat completions responses', () => {
    expect(
      extractWorkflowLlmText({
        choices: [{ message: { content: 'Chat 文本' } }],
      }),
    ).toBe('Chat 文本');
  });

  it('falls back to Responses output arrays when output_text is absent', () => {
    expect(
      extractWorkflowLlmText({
        output: [
          {
            type: 'message',
            content: [
              { type: 'output_text', text: '第一段' },
              { type: 'output_text', text: '第二段' },
            ],
          },
        ],
      }),
    ).toBe('第一段第二段');
  });
});
