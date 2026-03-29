import { describe, expect, it, vi } from 'vitest';
import {
  applyRequestOverridesToBody,
  buildUpstreamRequestBody,
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

    expect(body['reasoning']).toEqual({ effort: 'high' });
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
