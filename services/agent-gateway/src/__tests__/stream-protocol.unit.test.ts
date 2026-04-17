import { describe, expect, it, vi } from 'vitest';
import {
  applyRequestOverridesToBody,
  buildUpstreamRequestBody,
  sanitizeUpstreamConversation,
  type UpstreamChatMessage,
} from '../routes/upstream-request.js';

vi.mock('../tool-definitions.js', () => ({
  buildGatewayToolDefinitions: () => [
    { function: { name: 'web_search', description: 'web search', parameters: { type: 'object' } } },
    {
      function: {
        name: 'lsp_diagnostics',
        description: 'lsp diagnostics',
        parameters: { type: 'object' },
      },
    },
    { function: { name: 'lsp_touch', description: 'lsp touch', parameters: { type: 'object' } } },
    {
      function: {
        name: 'workspace_tree',
        description: 'workspace tree',
        parameters: { type: 'object' },
      },
    },
    {
      function: {
        name: 'workspace_read_file',
        description: 'workspace read file',
        parameters: { type: 'object' },
      },
    },
  ],
}));

const {
  ResponsesUpstreamEventError,
  buildGatewayToolDefinitions,
  createStreamParseState,
  parseUpstreamDataLine,
  parseUpstreamFrame,
} = await import('../routes/stream-protocol.js');

describe('buildGatewayToolDefinitions', () => {
  it('exposes upstream tools for the gateway sandbox', () => {
    const tools = buildGatewayToolDefinitions();

    expect(tools.map((tool) => tool.function.name)).toEqual([
      'web_search',
      'lsp_diagnostics',
      'lsp_touch',
      'workspace_tree',
      'workspace_read_file',
    ]);
  });
});

describe('applyRequestOverridesToBody', () => {
  it('merges body overrides and omits incompatible keys', () => {
    const body = applyRequestOverridesToBody(
      {
        model: 'gpt-5',
        max_tokens: 2048,
        temperature: 1,
        stream: true,
      },
      {
        topP: 0.95,
        body: { service_tier: 'flex' },
        omitBodyKeys: ['temperature'],
      },
    );

    expect(body).toMatchObject({
      model: 'gpt-5',
      max_tokens: 2048,
      top_p: 0.95,
      service_tier: 'flex',
      stream: true,
    });
    expect(body).not.toHaveProperty('temperature');
  });

  it('maps maxTokens to max_output_tokens for responses protocol', () => {
    const body = applyRequestOverridesToBody(
      { model: 'team-model-alias', max_output_tokens: 1024 },
      { maxTokens: 2048 },
      'responses',
    );

    expect(body['max_output_tokens']).toBe(2048);
    expect(body).not.toHaveProperty('max_tokens');
  });
});

describe('buildUpstreamRequestBody', () => {
  it('builds a Responses payload for alias models while preserving tools', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'responses',
      model: 'team-model-alias',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      tools: [
        {
          type: 'function',
          function: {
            name: 'lsp_diagnostics',
            description: 'Run diagnostics',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'hello responses' },
      ],
    });

    expect(body['input']).toEqual([
      { role: 'system', content: [{ type: 'input_text', text: 'system prompt' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'hello responses' }] },
    ]);
    expect(body['max_output_tokens']).toBe(2048);
    expect(body).not.toHaveProperty('messages');
    expect(body['tools']).toEqual([
      {
        type: 'function',
        name: 'lsp_diagnostics',
        description: 'Run diagnostics',
        parameters: { type: 'object', properties: {} },
        strict: false,
      },
    ]);
  });

  it('enables usage chunks for chat completion streams', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'kimi-k2.5',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      tools: [],
      messages: [{ role: 'user', content: 'hello chat usage' }],
    });

    expect(body['stream_options']).toEqual({ include_usage: true });
  });

  it('preserves include_usage when chat request overrides provide stream_options', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'kimi-k2.5',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {
        body: {
          stream_options: {
            include_obfuscation: true,
            include_usage: false,
          },
        },
      },
      tools: [],
      messages: [{ role: 'user', content: 'hello overridden chat usage' }],
    });

    expect(body['stream_options']).toEqual({
      include_obfuscation: true,
      include_usage: true,
    });
  });

  it('maps OpenAI thinking settings into Responses reasoning payloads', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'responses',
      model: 'o3',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: true,
        effort: 'high',
        providerType: 'openai',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '需要深度推理' }],
    });

    expect(body['reasoning']).toEqual({ effort: 'high', summary: 'auto' });
  });

  it('maps DeepSeek thinking settings for non-reasoner chat models', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'deepseek-chat',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: true,
        effort: 'medium',
        providerType: 'deepseek',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '请展示推理过程' }],
    });

    expect(body['thinking']).toEqual({ type: 'enabled' });
  });

  it('maps Moonshot toggle settings for kimi-k2.5', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'kimi-k2.5',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: false,
        effort: 'medium',
        providerType: 'moonshot',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '关闭思考' }],
    });

    expect(body['thinking']).toEqual({ type: 'disabled' });
  });

  it('maps Anthropic thinking settings into Claude thinking payloads', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'claude-sonnet-4-0',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: true,
        effort: 'xhigh',
        providerType: 'anthropic',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '请给出详细思考过程' }],
    });

    expect(body['thinking']).toEqual({
      type: 'enabled',
      budget_tokens: 31999,
    });
  });

  it('maps Gemini thinking settings into openai-compatible extra_body payloads', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'gemini-2.5-pro',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: true,
        effort: 'high',
        providerType: 'gemini',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '请展开推理' }],
    });

    expect(body['extra_body']).toEqual({
      google: {
        thinking_config: {
          include_thoughts: true,
          thinking_budget: 16000,
        },
      },
    });
  });

  it('uses zero thinking budget when Gemini request disables thinking', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'gemini-2.5-flash',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: false,
        effort: 'medium',
        providerType: 'gemini',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '关闭思考' }],
    });

    expect(body['extra_body']).toEqual({
      google: {
        thinking_config: {
          thinking_budget: 0,
        },
      },
    });
  });

  it('maps OpenRouter reasoning settings into reasoning payloads', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'openai/gpt-4.1',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: true,
        effort: 'high',
        providerType: 'openrouter',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '请展示 reasoning' }],
    });

    expect(body['reasoning']).toEqual({ effort: 'high' });
  });

  it('skips OpenRouter reasoning payloads for unsupported model families', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'deepseek/deepseek-chat-v3-0324',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: true,
        effort: 'high',
        providerType: 'openrouter',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '不应附加 reasoning 字段' }],
    });

    expect(body).not.toHaveProperty('reasoning');
  });

  it('maps Qwen thinking toggle into enable_thinking payloads', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'qwen3-235b-a22b',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: true,
        effort: 'medium',
        providerType: 'qwen',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '开启千问思考' }],
    });

    expect(body['enable_thinking']).toBe(true);
  });

  it('matches Moonshot thinking models case-insensitively', () => {
    const body = buildUpstreamRequestBody({
      protocol: 'chat_completions',
      model: 'KIMI-K2.5',
      maxTokens: 2048,
      temperature: 1,
      requestOverrides: {},
      thinking: {
        enabled: true,
        effort: 'medium',
        providerType: 'moonshot',
        supportsThinking: true,
      },
      tools: [],
      messages: [{ role: 'user', content: '开启 Kimi 思考' }],
    });

    expect(body['thinking']).toEqual({ type: 'enabled' });
  });
});

describe('parseUpstreamDataLine', () => {
  it('parses chat text deltas into text_delta chunks', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({ choices: [{ delta: { content: '你好' } }] }),
      state,
    );

    expect(chunks[0]).toMatchObject({ type: 'text_delta', delta: '你好', runId: 'run-test' });
  });

  it('extracts text from structured chat delta content without leaking object strings', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({
        choices: [
          {
            delta: {
              content: [
                { type: 'output_text', text: '# 文档标题\n\n' },
                { markdown: '第一段\n' },
                '/home/await/project/OpenAWork\n',
                { value: 'pnpm install' },
              ],
            },
          },
        ],
      }),
      state,
    );

    expect(chunks[0]).toMatchObject({
      type: 'text_delta',
      delta: '# 文档标题\n\n第一段\n/home/await/project/OpenAWork\npnpm install',
      runId: 'run-test',
    });
  });

  it('parses chat tool call deltas into tool_call_delta chunks', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'web_search', arguments: '{"query":"上海天气"}' },
                },
              ],
            },
          },
        ],
      }),
      state,
    );

    expect(chunks[0]).toMatchObject({
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '{"query":"上海天气"}',
    });
  });

  it('maps chat finish reasons to done chunks', () => {
    const state = createStreamParseState('run-test');
    parseUpstreamDataLine(
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      state,
    );

    const doneChunks = parseUpstreamDataLine('[DONE]', state);
    expect(doneChunks[0]).toMatchObject({ type: 'done', stopReason: 'tool_use' });
  });

  it('infers tool_use on [DONE] when tool calls streamed without finish_reason', () => {
    const state = createStreamParseState('run-test');

    parseUpstreamDataLine(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'web_search', arguments: '{"query":"上海天气"}' },
                },
              ],
            },
          },
        ],
      }),
      state,
    );

    const doneChunks = parseUpstreamDataLine('[DONE]', state);
    expect(doneChunks[0]).toMatchObject({ type: 'done', stopReason: 'tool_use' });
  });

  it('parses DeepSeek reasoning_content into thinking_delta chunks', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({
        choices: [{ delta: { reasoning_content: '先分析需求边界。' } }],
      }),
      state,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'thinking_delta',
      delta: '先分析需求边界。',
      runId: 'run-test',
    });
  });

  it('emits both text_delta and thinking_delta when reasoning_content and content coexist', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({
        choices: [{ delta: { content: '结论是', reasoning_content: '因为A大于B' } }],
      }),
      state,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ type: 'text_delta', delta: '结论是' });
    expect(chunks[1]).toMatchObject({ type: 'thinking_delta', delta: '因为A大于B' });
  });

  it('separates Anthropic thinking content blocks from text content blocks', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({
        choices: [
          {
            delta: {
              content: [
                { type: 'thinking', thinking: '让我想想这个问题。' },
                { type: 'text', text: '答案如下：' },
              ],
            },
          },
        ],
      }),
      state,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ type: 'text_delta', delta: '答案如下：' });
    expect(chunks[1]).toMatchObject({ type: 'thinking_delta', delta: '让我想想这个问题。' });
  });

  it('handles standalone Anthropic thinking block without text blocks', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({
        choices: [
          {
            delta: {
              content: [{ type: 'thinking', thinking: '分析约束条件。' }],
            },
          },
        ],
      }),
      state,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'thinking_delta', delta: '分析约束条件。' });
  });

  it('handles reasoning-typed content block with text field as thinking', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({
        choices: [
          {
            delta: {
              content: [{ type: 'reasoning', text: '逐步推导。' }],
            },
          },
        ],
      }),
      state,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'thinking_delta', delta: '逐步推导。' });
  });

  it('treats Gemini thought-flagged text blocks as thinking deltas', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({
        choices: [
          {
            delta: {
              content: [{ type: 'text', text: '先检验边界条件。', thought: true }],
            },
          },
        ],
      }),
      state,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'thinking_delta',
      delta: '先检验边界条件。',
    });
  });

  it('ignores empty reasoning_content', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamDataLine(
      JSON.stringify({
        choices: [{ delta: { content: '你好', reasoning_content: '' } }],
      }),
      state,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'text_delta', delta: '你好' });
  });
});

describe('parseUpstreamFrame', () => {
  it('accepts chat completion data lines without a space after the colon', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamFrame(
      ['data:{"choices":[{"delta":{"content":"你好"}}]}', 'data:[DONE]'].join('\n\n'),
      'chat_completions',
      state,
    );

    expect(chunks[0]).toMatchObject({ type: 'text_delta', delta: '你好', runId: 'run-test' });
    expect(chunks[1]).toMatchObject({ type: 'done', stopReason: 'end_turn', runId: 'run-test' });
  });

  it('parses Responses text delta frames into text_delta chunks', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamFrame(
      ['event: response.output_text.delta', 'data: {"delta":"你好"}'].join('\n'),
      'responses',
      state,
    );

    expect(chunks[0]).toMatchObject({ type: 'text_delta', delta: '你好', runId: 'run-test' });
  });

  it('parses Responses reasoning summary frames into thinking_delta chunks', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamFrame(
      [
        'event: response.reasoning_summary_text.delta',
        'data: {"item_id":"rs_1","output_index":0,"summary_index":0,"delta":"先比较方案差异。"}',
      ].join('\n'),
      'responses',
      state,
    );

    expect(chunks[0]).toMatchObject({
      type: 'thinking_delta',
      delta: '先比较方案差异。',
      itemId: 'rs_1',
      outputIndex: 0,
      summaryIndex: 0,
      runId: 'run-test',
    });
  });

  it('parses Responses function call frames into tool deltas and tool_use done', () => {
    const state = createStreamParseState('run-test');

    const addedChunks = parseUpstreamFrame(
      [
        'event: response.output_item.added',
        'data: {"output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"web_search","arguments":""}}',
      ].join('\n'),
      'responses',
      state,
    );
    expect(addedChunks[0]).toMatchObject({
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '',
    });

    const deltaChunks = parseUpstreamFrame(
      [
        'event: response.function_call_arguments.delta',
        'data: {"output_index":0,"delta":"{\\"query\\":\\"上海天气\\"}"}',
      ].join('\n'),
      'responses',
      state,
    );
    expect(deltaChunks[0]).toMatchObject({
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '{"query":"上海天气"}',
    });

    const doneChunks = parseUpstreamFrame(
      [
        'event: response.completed',
        'data: {"response":{"output":[{"type":"function_call","id":"fc_1","call_id":"call_1","name":"web_search","arguments":"{\\"query\\":\\"上海天气\\"}"}]}}',
      ].join('\n'),
      'responses',
      state,
    );
    expect(doneChunks[0]).toMatchObject({ type: 'done', stopReason: 'tool_use' });
  });

  it('backfills Responses tool_call_delta when arguments arrive before tool metadata', () => {
    const state = createStreamParseState('run-test');

    expect(
      parseUpstreamFrame(
        [
          'event: response.function_call_arguments.delta',
          'data: {"output_index":0,"delta":"{\\"query\\":\\"上海天气\\"}"}',
        ].join('\n'),
        'responses',
        state,
      ),
    ).toHaveLength(0);

    const addedChunks = parseUpstreamFrame(
      [
        'event: response.output_item.added',
        'data: {"output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"web_search"}}',
      ].join('\n'),
      'responses',
      state,
    );

    expect(addedChunks[0]).toMatchObject({
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '{"query":"上海天气"}',
    });
  });

  it('emits trailing arguments from response.function_call_arguments.done', () => {
    const state = createStreamParseState('run-test');

    parseUpstreamFrame(
      [
        'event: response.output_item.added',
        'data: {"output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"web_search","arguments":"{\\"query\\":"}}',
      ].join('\n'),
      'responses',
      state,
    );

    const doneChunks = parseUpstreamFrame(
      [
        'event: response.function_call_arguments.done',
        'data: {"output_index":0,"arguments":"{\\"query\\":\\"上海天气\\"}"}',
      ].join('\n'),
      'responses',
      state,
    );

    expect(doneChunks[0]).toMatchObject({
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '"上海天气"}',
    });
  });

  it('maps Responses incomplete max_output_tokens to max_tokens done chunk', () => {
    const state = createStreamParseState('run-test');
    const chunks = parseUpstreamFrame(
      [
        'event: response.incomplete',
        'data: {"response":{"incomplete_details":{"reason":"max_output_tokens"}}}',
      ].join('\n'),
      'responses',
      state,
    );

    expect(chunks[0]).toMatchObject({ type: 'done', stopReason: 'max_tokens' });
  });

  it('captures Responses usage from response.completed into parse state', () => {
    const state = createStreamParseState('run-test');

    parseUpstreamFrame(
      [
        'event: response.completed',
        'data: {"response":{"output":[{"type":"message","id":"msg_1"}],"usage":{"input_tokens":12,"output_tokens":34,"total_tokens":46}}}',
      ].join('\n'),
      'responses',
      state,
    );

    expect(state).toMatchObject({
      usage: {
        inputTokens: 12,
        outputTokens: 34,
        totalTokens: 46,
      },
    });
  });

  it('captures chat completion usage chunks into parse state when upstream provides them', () => {
    const state = createStreamParseState('run-test');

    parseUpstreamDataLine(
      JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 21,
          completion_tokens: 13,
          total_tokens: 34,
        },
      }),
      state,
    );

    expect(state).toMatchObject({
      usage: {
        inputTokens: 21,
        outputTokens: 13,
        totalTokens: 34,
      },
    });
  });

  it('throws structured errors for response.error frames', () => {
    const state = createStreamParseState('run-test');

    expect(() =>
      parseUpstreamFrame(
        [
          'event: response.error',
          'data: {"error":{"code":"MODEL_ERROR","message":"upstream exploded"}}',
        ].join('\n'),
        'responses',
        state,
      ),
    ).toThrowError(ResponsesUpstreamEventError);
  });
});

describe('sanitizeUpstreamConversation', () => {
  it('removes orphaned tool_result with no matching tool_call', () => {
    const messages: UpstreamChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'tool', content: 'orphan result', tool_call_id: 'call_missing' },
    ];

    const result = sanitizeUpstreamConversation(messages);
    expect(result).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('keeps tool_result that matches a preceding tool_call', () => {
    const messages: UpstreamChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'search result', tool_call_id: 'call_1' },
    ];

    const result = sanitizeUpstreamConversation(messages);
    expect(result).toEqual(messages);
  });

  it('removes tool_result appearing before its tool_call', () => {
    const messages: UpstreamChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'tool', content: 'early result', tool_call_id: 'call_1' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
    ];

    const result = sanitizeUpstreamConversation(messages);
    expect(result).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
    ]);
  });

  it('removes empty assistant messages with no content and no tool_calls', () => {
    const messages: UpstreamChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'continue' },
    ];

    const result = sanitizeUpstreamConversation(messages);
    expect(result).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'continue' },
    ]);
  });

  it('removes tool messages with empty content', () => {
    const messages: UpstreamChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: '', tool_call_id: 'call_1' },
    ];

    const result = sanitizeUpstreamConversation(messages);
    expect(result).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
    ]);
  });

  it('removes tool_result without tool_call_id', () => {
    const messages: UpstreamChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'tool', content: 'no id result' },
    ];

    const result = sanitizeUpstreamConversation(messages);
    expect(result).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('preserves valid conversation with multiple tool calls and results', () => {
    const messages: UpstreamChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'search and read' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'web_search', arguments: '{"q":"test"}' },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"/tmp/f"}' },
          },
        ],
      },
      { role: 'tool', content: 'search results', tool_call_id: 'call_1' },
      { role: 'tool', content: 'file contents', tool_call_id: 'call_2' },
      { role: 'assistant', content: 'Here is what I found.' },
    ];

    const result = sanitizeUpstreamConversation(messages);
    expect(result).toEqual(messages);
  });

  it('handles mixed orphaned and valid tool results', () => {
    const messages: UpstreamChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'search' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'valid result', tool_call_id: 'call_1' },
      { role: 'tool', content: 'orphan result', tool_call_id: 'call_orphan' },
      { role: 'assistant', content: 'Done.' },
    ];

    const result = sanitizeUpstreamConversation(messages);
    expect(result).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'search' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'valid result', tool_call_id: 'call_1' },
      { role: 'assistant', content: 'Done.' },
    ]);
  });
});
