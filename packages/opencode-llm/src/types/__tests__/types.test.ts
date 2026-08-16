import { describe, it, expect } from 'vitest';
import {
  // Message types
  MessageSchema,
  MessageRoleSchema,
  ToolCallSchema,
  ToolDefinitionSchema,
  ToolChoiceSchema,
  ResponseFormatSchema,
  // Completion types
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
  UsageSchema,
  FinishReasonSchema,
  // Stream types
  ChatCompletionChunkSchema,
  StreamEventSchema,
  // Error types
  APIErrorResponseSchema,
  OpenAIError,
  InvalidRequestError,
  RateLimitError,
  // Provider types
  ProviderConfigSchema,
  OpenAIConfigSchema,
  AnthropicConfigSchema,
  createProviderConfig,
  validateProviderConfig,
} from '../index.js';

describe('Message Types', () => {
  it('should validate message role', () => {
    const result = MessageRoleSchema.safeParse('assistant');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('assistant');
    }
  });

  it('should validate system message', () => {
    const result = MessageSchema.safeParse({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
    expect(result.success).toBe(true);
  });

  it('should validate user message with string content', () => {
    const result = MessageSchema.safeParse({
      role: 'user',
      content: 'Hello, how are you?',
    });
    expect(result.success).toBe(true);
  });

  it('should validate user message with array content', () => {
    const result = MessageSchema.safeParse({
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should validate assistant message with tool calls', () => {
    const result = MessageSchema.safeParse({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"location":"San Francisco"}',
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should validate tool message', () => {
    const result = MessageSchema.safeParse({
      role: 'tool',
      content: '{"temperature":72}',
      tool_call_id: 'call_123',
    });
    expect(result.success).toBe(true);
  });
});

describe('Tool Types', () => {
  it('should validate tool definition', () => {
    const result = ToolDefinitionSchema.safeParse({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
          required: ['location'],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should validate tool choice auto', () => {
    const result = ToolChoiceSchema.safeParse('auto');
    expect(result.success).toBe(true);
  });

  it('should validate tool choice named', () => {
    const result = ToolChoiceSchema.safeParse({
      type: 'function',
      function: { name: 'get_weather' },
    });
    expect(result.success).toBe(true);
  });
});

describe('Response Format Types', () => {
  it('should validate text response format', () => {
    const result = ResponseFormatSchema.safeParse({ type: 'text' });
    expect(result.success).toBe(true);
  });

  it('should validate json_object response format', () => {
    const result = ResponseFormatSchema.safeParse({ type: 'json_object' });
    expect(result.success).toBe(true);
  });

  it('should validate json_schema response format', () => {
    const result = ResponseFormatSchema.safeParse({
      type: 'json_schema',
      json_schema: {
        name: 'weather_response',
        schema: {
          type: 'object',
          properties: {
            temperature: { type: 'number' },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('Completion Types', () => {
  it('should validate chat completion request', () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello!' }],
      temperature: 0.7,
      max_tokens: 100,
    });
    expect(result.success).toBe(true);
  });

  it('should validate chat completion response', () => {
    const result = ChatCompletionResponseSchema.safeParse({
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1677652288,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello! How can I help you?',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    expect(result.success).toBe(true);
  });

  it('should validate finish reasons', () => {
    expect(FinishReasonSchema.safeParse('stop').success).toBe(true);
    expect(FinishReasonSchema.safeParse('length').success).toBe(true);
    expect(FinishReasonSchema.safeParse('tool_calls').success).toBe(true);
    expect(FinishReasonSchema.safeParse('content_filter').success).toBe(true);
  });
});

describe('Stream Types', () => {
  it('should validate chat completion chunk', () => {
    const result = ChatCompletionChunkSchema.safeParse({
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1677652288,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: 'Hello',
          },
          finish_reason: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should validate stream events', () => {
    const contentDelta = StreamEventSchema.safeParse({
      type: 'content.delta',
      index: 0,
      delta: 'Hello',
    });
    expect(contentDelta.success).toBe(true);

    const done = StreamEventSchema.safeParse({
      type: 'done',
      finish_reason: 'stop',
    });
    expect(done.success).toBe(true);
  });
});

describe('Error Types', () => {
  it('should validate API error response', () => {
    const result = APIErrorResponseSchema.safeParse({
      error: {
        message: 'Invalid API key',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should create OpenAIError instances', () => {
    const error = new OpenAIError('Test error', {
      type: 'api_error',
      code: 'server_error',
      status: 500,
      retryable: true,
    });

    expect(error.message).toBe('Test error');
    expect(error.type).toBe('api_error');
    expect(error.code).toBe('server_error');
    expect(error.status).toBe(500);
    expect(error.retryable).toBe(true);
  });

  it('should create specific error types', () => {
    const authError = new InvalidRequestError('Bad request', 'model');
    expect(authError.type).toBe('invalid_request_error');
    expect(authError.status).toBe(400);

    const rateLimit = new RateLimitError('Rate limited', {
      retryAfter: 60000,
      rateLimit: { limit: 100, remaining: 0, reset: Date.now() + 60000 },
    });
    expect(rateLimit.type).toBe('rate_limit_error');
    expect(rateLimit.retryable).toBe(true);
  });
});

describe('Provider Types', () => {
  it('should validate OpenAI config', () => {
    const result = OpenAIConfigSchema.safeParse({
      type: 'openai',
      auth: {
        apiKey: 'sk-test123',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should validate Anthropic config', () => {
    const result = AnthropicConfigSchema.safeParse({
      type: 'anthropic',
      auth: {
        apiKey: 'sk-ant-test123',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should create provider config with helper', () => {
    const config = createProviderConfig('openai', {
      auth: { apiKey: 'sk-test' },
      defaultModel: 'gpt-4',
    });

    expect(config.type).toBe('openai');
    expect(config.auth.apiKey).toBe('sk-test');
    expect(config.defaultModel).toBe('gpt-4');
  });

  it('should validate provider config', () => {
    const validConfig = {
      type: 'openai',
      auth: { apiKey: 'sk-test' },
    };
    expect(validateProviderConfig(validConfig)).toBe(true);

    const invalidConfig = {
      type: 'invalid',
      auth: {},
    };
    expect(validateProviderConfig(invalidConfig)).toBe(false);
  });
});
