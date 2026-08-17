import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_MANAGEMENT_BETA,
  runRealAnthropic,
  OFFICIAL_BASE_URL,
} from '../../verification/verify-compaction-parity-gate.js';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_TEST_MODEL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_BASE_URL',
] as const;
const ENV_BACKUP = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ENV_BACKUP[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configure(key?: string, model?: string, baseUrl?: string): void {
  if (key === undefined) delete process.env['ANTHROPIC_API_KEY'];
  else process.env['ANTHROPIC_API_KEY'] = key;
  if (model === undefined) delete process.env['ANTHROPIC_TEST_MODEL'];
  else process.env['ANTHROPIC_TEST_MODEL'] = model;
  if (baseUrl === undefined) delete process.env['ANTHROPIC_BASE_URL'];
  else process.env['ANTHROPIC_BASE_URL'] = baseUrl;
  delete process.env['ANTHROPIC_API_BASE_URL'];
}

const SUCCESS_STREAM = [
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

describe('verify-compaction-parity external gate', () => {
  it('keeps missing credentials pending even for a non-official relay URL', async () => {
    configure(undefined, undefined, 'https://relay.example.invalid/v1');
    let called = false;
    const result = await runRealAnthropic(async () => {
      called = true;
      return new Response();
    });

    expect(result.outcome).toBe('external-gate-pending');
    expect(called).toBe(false);
  });

  it('keeps an explicit model and key pending until the official base URL is configured', async () => {
    configure('redacted-test-key', 'claude-test');
    let called = false;
    const result = await runRealAnthropic(async () => {
      called = true;
      return new Response();
    });

    expect(result.outcome).toBe('external-gate-pending');
    expect(called).toBe(false);
  });

  it('rejects a non-official URL when credentials are present without making a request', async () => {
    configure('redacted-test-key', 'claude-test', 'https://relay.example.invalid/v1');
    let called = false;
    const result = await runRealAnthropic(async () => {
      called = true;
      return new Response();
    });

    expect(result.outcome).toBe('gate_outcome=non_official_base_url');
    expect(called).toBe(false);
  });

  it('proves the official request contract and complete streamed response', async () => {
    configure('redacted-test-key', 'claude-test', OFFICIAL_BASE_URL);
    let request: RequestInit | undefined;
    const result = await runRealAnthropic(async (_input, init) => {
      request = init;
      return new Response(SUCCESS_STREAM, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const headers = new Headers(request?.headers);
    const body = JSON.parse(String(request?.body ?? '{}')) as Record<string, unknown>;
    expect(result.outcome).toBe('real_provider_success');
    expect(headers.get('anthropic-beta')).toBe(CONTEXT_MANAGEMENT_BETA);
    expect(body['context_management']).toEqual({
      edits: [
        { type: 'clear_thinking_20251015', keep: { type: 'thinking_turns', value: 2 } },
        {
          type: 'clear_tool_uses_20250919',
          trigger: { type: 'input_tokens', value: 50_000 },
          keep: { type: 'tool_uses', value: 5 },
        },
      ],
    });
    expect(result.response).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
      stopReason: 'end_turn',
      sawMessageStop: true,
    });
  });

  it('keeps unauthorized, invalid-model, and disconnected-stream outcomes explicit', async () => {
    configure('redacted-test-key', 'claude-test', OFFICIAL_BASE_URL);
    const unauthorized = await runRealAnthropic(async () => new Response('', { status: 401 }));
    const invalidModel = await runRealAnthropic(async () => new Response('', { status: 400 }));
    const disconnected = await runRealAnthropic(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"message_start"}\n'));
          controller.error(new Error('connection closed'));
        },
      });
      return new Response(body, { status: 200 });
    });

    expect(unauthorized.outcome).toBe('gate_outcome=unauthorized_401');
    expect(invalidModel.outcome).toBe('gate_outcome=invalid_model');
    expect(disconnected.outcome).toBe('gate_outcome=disconnected_stream');
  });
});
