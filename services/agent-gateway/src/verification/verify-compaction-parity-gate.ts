export const OFFICIAL_BASE_URL = 'https://api.anthropic.com/v1';
export const CONTEXT_MANAGEMENT_BETA = 'context-management-2025-06-27';
const CONTEXT_MANAGEMENT = {
  edits: [
    { type: 'clear_thinking_20251015', keep: { type: 'thinking_turns', value: 2 } },
    {
      type: 'clear_tool_uses_20250919',
      trigger: { type: 'input_tokens', value: 50_000 },
      keep: { type: 'tool_uses', value: 5 },
    },
  ],
} as const;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type StreamObservation = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly sawMessageStart: boolean;
  readonly sawMessageDelta: boolean;
  readonly stopReason?: string;
  readonly sawMessageStop: boolean;
};

export type AnthropicGateResult = {
  readonly outcome: string;
  readonly request: {
    readonly officialBaseUrl: boolean;
    readonly contextManagement: boolean;
    readonly betaHeader: string;
  };
  readonly response?: {
    readonly status: number;
    readonly sawMessageStart: boolean;
    readonly sawMessageDelta: boolean;
    readonly sawMessageStop: boolean;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly stopReason?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value) || typeof value[key] !== 'number') return undefined;
  return value[key];
}

function streamEvent(observation: StreamObservation, payload: unknown): StreamObservation {
  if (!isRecord(payload) || typeof payload.type !== 'string') return observation;
  if (payload.type === 'message_start') {
    const message = isRecord(payload.message) ? payload.message : undefined;
    return { ...observation, sawMessageStart: true, inputTokens: numberField(message?.usage, 'input_tokens') };
  }
  if (payload.type === 'message_delta') {
    const delta = isRecord(payload.delta) ? payload.delta : undefined;
    return {
      ...observation,
      sawMessageDelta: true,
      outputTokens: numberField(payload.usage, 'output_tokens'),
      stopReason: typeof delta?.stop_reason === 'string' ? delta.stop_reason : undefined,
    };
  }
  return payload.type === 'message_stop' ? { ...observation, sawMessageStop: true } : observation;
}

async function readAnthropicStream(response: Response): Promise<StreamObservation | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let observation: StreamObservation = {
    sawMessageStart: false,
    sawMessageDelta: false,
    sawMessageStop: false,
  };
  const consume = (line: string): void => {
    if (!line.startsWith('data:')) return;
    const data = line.slice('data:'.length).trim();
    if (!data || data === '[DONE]') return;
    try {
      observation = streamEvent(observation, JSON.parse(data) as unknown);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    pending += decoder.decode();
    if (pending.length > 0) consume(pending);
    return observation;
  } catch (error: unknown) {
    if (error instanceof Error) return undefined;
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function configuredBaseUrl(): string | undefined {
  const values = [process.env['ANTHROPIC_BASE_URL'], process.env['ANTHROPIC_API_BASE_URL']];
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

export function isOfficialAnthropicBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'api.anthropic.com' &&
      parsed.port === '' &&
      parsed.pathname.replace(/\/+$/, '') === '/v1'
    );
  } catch (error: unknown) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function responseEvidence(status: number, stream?: StreamObservation): AnthropicGateResult['response'] {
  return {
    status,
    sawMessageStart: stream?.sawMessageStart ?? false,
    sawMessageDelta: stream?.sawMessageDelta ?? false,
    sawMessageStop: stream?.sawMessageStop ?? false,
    inputTokens: stream?.inputTokens,
    outputTokens: stream?.outputTokens,
    stopReason: stream?.stopReason,
  };
}

export async function runRealAnthropic(fetcher: Fetcher = globalThis.fetch): Promise<AnthropicGateResult> {
  const key = process.env['ANTHROPIC_API_KEY']?.trim();
  const model = process.env['ANTHROPIC_TEST_MODEL']?.trim();
  if (!key || !model) {
    return {
      outcome: 'external-gate-pending',
      request: {
        officialBaseUrl: false,
        contextManagement: true,
        betaHeader: CONTEXT_MANAGEMENT_BETA,
      },
    };
  }
  const baseUrl = configuredBaseUrl();
  if (!baseUrl) {
    return {
      outcome: 'external-gate-pending',
      request: {
        officialBaseUrl: false,
        contextManagement: true,
        betaHeader: CONTEXT_MANAGEMENT_BETA,
      },
    };
  }
  const officialBaseUrl = isOfficialAnthropicBaseUrl(baseUrl);
  const request = {
    officialBaseUrl,
    contextManagement: true,
    betaHeader: CONTEXT_MANAGEMENT_BETA,
  } as const;
  if (!officialBaseUrl) return { outcome: 'gate_outcome=non_official_base_url', request };
  try {
    const response = await fetcher(`${OFFICIAL_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': CONTEXT_MANAGEMENT_BETA,
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        stream: true,
        context_management: CONTEXT_MANAGEMENT,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const responseBase = (outcome: string, stream?: StreamObservation): AnthropicGateResult => ({
      outcome,
      request,
      response: responseEvidence(response.status, stream),
    });
    if (response.status === 401) return responseBase('gate_outcome=unauthorized_401');
    if (response.status === 400) return responseBase('gate_outcome=invalid_model');
    if (response.status !== 200) return responseBase(`gate_outcome=http_${response.status}`);
    const stream = await readAnthropicStream(response);
    if (!stream) return responseBase('gate_outcome=disconnected_stream');
    if (!stream.sawMessageStart || stream.inputTokens === undefined || stream.outputTokens === undefined) {
      return responseBase('gate_outcome=missing_response_usage', stream);
    }
    if (!stream.sawMessageDelta || !stream.stopReason) {
      return responseBase('gate_outcome=missing_stream_stop_reason', stream);
    }
    if (!stream.sawMessageStop) return responseBase('gate_outcome=missing_stream_stop', stream);
    return responseBase('real_provider_success', stream);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { outcome: 'gate_outcome=disconnected_stream', request };
    }
    if (error instanceof Error) return { outcome: 'gate_outcome=disconnected_stream', request };
    throw error;
  }
}
