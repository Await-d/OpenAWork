import type { AIProvider } from '@openAwork/agent-core';
import { buildRequestOverrides } from '@openAwork/agent-core';
import { buildUpstreamRequestBody } from './upstream-request.js';
import { resolveUpstreamProtocol, type UpstreamProtocol } from './upstream-protocol.js';

const WORKFLOW_MAX_OUTPUT_TOKENS = 2048;

export interface WorkflowLlmRequestConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  temperature: number;
}

export interface WorkflowLlmRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  providerType?: AIProvider['type'];
  upstreamProtocol: UpstreamProtocol;
  url: string;
}

export function buildWorkflowLlmRequest(input: WorkflowLlmRequestConfig): WorkflowLlmRequest {
  const providerType = inferWorkflowProviderType(input.apiBaseUrl, input.model);
  const upstreamProtocol = resolveUpstreamProtocol({
    model: input.model,
    providerType,
    baseUrl: input.apiBaseUrl,
  });
  const requestOverrides = buildRequestOverrides(undefined, undefined, input.model);
  const body = {
    ...buildUpstreamRequestBody({
      protocol: upstreamProtocol,
      model: input.model,
      maxTokens: WORKFLOW_MAX_OUTPUT_TOKENS,
      temperature: input.temperature,
      messages: [{ role: 'user', content: input.prompt }],
      tools: [],
      requestOverrides,
    }),
    stream: false,
  };

  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
    },
    providerType,
    upstreamProtocol,
    url: `${input.apiBaseUrl}${upstreamProtocol === 'responses' ? '/responses' : '/chat/completions'}`,
  };
}

function inferWorkflowProviderType(
  apiBaseUrl: string,
  model: string,
): AIProvider['type'] | undefined {
  const hostname = parseHostname(apiBaseUrl);

  switch (hostname) {
    case 'api.openai.com':
      return 'openai';
    case 'api.anthropic.com':
      return 'anthropic';
    case 'api.deepseek.com':
      return 'deepseek';
    case 'generativelanguage.googleapis.com':
      return 'gemini';
    case 'openrouter.ai':
      return 'openrouter';
    case 'dashscope.aliyuncs.com':
      return 'qwen';
    case 'api.moonshot.cn':
      return 'moonshot';
    default:
      return model.startsWith('claude') ? 'anthropic' : undefined;
  }
}

function parseHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function extractWorkflowLlmText(payload: unknown): string {
  return extractWorkflowLlmTextNode(payload);
}

function extractWorkflowLlmTextNode(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractWorkflowLlmTextNode(item)).join('');
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record['output_text'],
    record['choices'],
    record['output'],
    record['message'],
    record['content'],
    record['text'],
    record['value'],
  ];

  for (const candidate of candidates) {
    const text = extractWorkflowLlmTextNode(candidate);
    if (text.length > 0) {
      return text;
    }
  }

  return '';
}

export async function requestWorkflowLlmCompletion(
  input: WorkflowLlmRequestConfig,
): Promise<string> {
  const request = buildWorkflowLlmRequest(input);
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LLM request failed: ${detail || response.status}`);
  }

  return extractWorkflowLlmText((await response.json()) as unknown);
}
