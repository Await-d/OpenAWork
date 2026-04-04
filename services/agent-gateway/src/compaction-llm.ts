import type { ModelRouteConfig } from './model-router.js';
import type { UpstreamChatMessage } from './session-message-store.js';
import type { UpstreamProtocol } from './routes/upstream-protocol.js';
import { applyRequestOverridesToBody } from './routes/upstream-request.js';

const COMPACTION_SYSTEM_PROMPT = `你是一个专门负责会话摘要的 AI 助手。

当被要求总结时，请提供详细但简洁的会话摘要。
聚焦于对继续对话有帮助的信息，包括：
- 已经做了什么
- 当前正在进行的工作
- 正在修改的文件
- 接下来需要做什么
- 用户的关键请求、约束或偏好
- 重要的技术决策及其原因

你的摘要将被用于让另一个 AI 助手能够阅读并继续这项工作。
不要回应对话中的任何问题，只输出摘要。
使用用户在对话中使用的语言进行回复。

构建摘要时，请遵循以下模板：
---
## 目标

[用户想要完成什么目标？]

## 指令

- [用户给出的重要指令]
- [如果有计划或规范，包含相关信息以便下一个助手继续使用]

## 发现

[在对话中发现的重要信息，对下一个助手继续工作有用]

## 已完成

[已完成的工作、正在进行的工作、以及剩余的工作]

## 相关文件/目录

[构建一个与当前任务相关的文件结构化列表：已读取、已编辑或已创建的文件。如果一个目录中的所有文件都相关，包含目录路径即可。]
---`;

const COMPACTION_USER_PROMPT =
  '请详细总结以上对话，生成一份可供另一个助手继续工作的上下文摘要。\n不要调用任何工具，只输出摘要文本。';

export interface CompactionLlmInput {
  conversationMessages: UpstreamChatMessage[];
  route: ModelRouteConfig;
  signal?: AbortSignal;
}

export interface CompactionLlmResult {
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callCompactionLlm(input: CompactionLlmInput): Promise<CompactionLlmResult> {
  const protocol = input.route.upstreamProtocol;
  const messages: UpstreamChatMessage[] = [
    { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
    ...input.conversationMessages,
    { role: 'user', content: COMPACTION_USER_PROMPT },
  ];

  const body = buildNonStreamingRequestBody({
    protocol,
    model: input.route.model,
    maxTokens: input.route.maxTokens,
    messages,
    requestOverrides: input.route.requestOverrides,
  });

  const upstreamPath = protocol === 'responses' ? '/responses' : '/chat/completions';
  const url = `${input.route.apiBaseUrl}${upstreamPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(input.route.requestOverrides.headers ?? {}),
  };

  if (input.route.apiKey) {
    if (input.route.providerType === 'anthropic') {
      headers['x-api-key'] = input.route.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${input.route.apiKey}`;
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: input.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Compaction LLM call failed (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  return parseCompactionResponse(json, protocol);
}

function buildNonStreamingRequestBody(input: {
  protocol: UpstreamProtocol;
  model: string;
  maxTokens: number;
  messages: UpstreamChatMessage[];
  requestOverrides: ModelRouteConfig['requestOverrides'];
}): Record<string, unknown> {
  const baseBody: Record<string, unknown> =
    input.protocol === 'responses'
      ? {
          model: input.model,
          input: input.messages.map((msg) => ({
            role: msg.role === 'system' ? 'developer' : msg.role,
            content:
              typeof msg.content === 'string'
                ? [{ type: 'input_text', text: msg.content }]
                : msg.content,
          })),
          max_output_tokens: input.maxTokens,
          temperature: 0,
          stream: false,
        }
      : {
          model: input.model,
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: 0,
          stream: false,
        };

  return applyRequestOverridesToBody(baseBody, input.requestOverrides, input.protocol);
}

function parseCompactionResponse(
  json: Record<string, unknown>,
  protocol: UpstreamProtocol,
): CompactionLlmResult {
  if (protocol === 'responses') {
    return parseResponsesApiResult(json);
  }

  return parseChatCompletionsResult(json);
}

function parseChatCompletionsResult(json: Record<string, unknown>): CompactionLlmResult {
  const choices = json['choices'] as Array<Record<string, unknown>> | undefined;
  const firstChoice = choices?.[0];
  const message = firstChoice?.['message'] as Record<string, unknown> | undefined;
  const content = message?.['content'];
  const summary = typeof content === 'string' ? content.trim() : '';

  const usage = json['usage'] as Record<string, unknown> | undefined;
  const inputTokens = typeof usage?.['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0;
  const outputTokens =
    typeof usage?.['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0;

  if (!summary) {
    throw new Error('Compaction LLM returned empty summary');
  }

  return { summary, inputTokens, outputTokens };
}

function parseResponsesApiResult(json: Record<string, unknown>): CompactionLlmResult {
  const output = json['output'] as Array<Record<string, unknown>> | undefined;
  let summary = '';
  for (const item of output ?? []) {
    if (item['type'] === 'message') {
      const content = item['content'] as Array<Record<string, unknown>> | undefined;
      for (const part of content ?? []) {
        if (part['type'] === 'output_text' && typeof part['text'] === 'string') {
          summary += part['text'];
        }
      }
    }
  }

  summary = summary.trim();
  const usage = json['usage'] as Record<string, unknown> | undefined;
  const inputTokens = typeof usage?.['input_tokens'] === 'number' ? usage['input_tokens'] : 0;
  const outputTokens = typeof usage?.['output_tokens'] === 'number' ? usage['output_tokens'] : 0;

  if (!summary) {
    throw new Error('Compaction LLM returned empty summary');
  }

  return { summary, inputTokens, outputTokens };
}
