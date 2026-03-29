import type { RequestOverrides } from '@openAwork/agent-core';
import type { UpstreamProtocol } from './upstream-protocol.js';

export type UpstreamRequestBody = Record<string, unknown>;
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

interface UpstreamChatMessage {
  role: 'assistant' | 'system' | 'tool' | 'user';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface UpstreamFunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

interface UpstreamThinkingConfig {
  enabled: boolean;
  effort: ReasoningEffort;
  providerType?: string;
  supportsThinking: boolean;
}

export function applyRequestOverridesToBody(
  body: UpstreamRequestBody,
  requestOverrides: RequestOverrides,
  protocol: UpstreamProtocol = 'chat_completions',
): UpstreamRequestBody {
  const nextBody: UpstreamRequestBody = { ...body };

  if (requestOverrides.maxTokens !== undefined) {
    nextBody[protocol === 'responses' ? 'max_output_tokens' : 'max_tokens'] =
      requestOverrides.maxTokens;
  }
  if (requestOverrides.temperature !== undefined) {
    nextBody['temperature'] = requestOverrides.temperature;
  }
  if (requestOverrides.topP !== undefined) {
    nextBody['top_p'] = requestOverrides.topP;
  }
  if (requestOverrides.frequencyPenalty !== undefined) {
    nextBody['frequency_penalty'] = requestOverrides.frequencyPenalty;
  }
  if (requestOverrides.presencePenalty !== undefined) {
    nextBody['presence_penalty'] = requestOverrides.presencePenalty;
  }
  if (requestOverrides.body) {
    Object.assign(nextBody, requestOverrides.body);
  }

  for (const key of requestOverrides.omitBodyKeys ?? []) {
    delete nextBody[key];
  }

  return nextBody;
}

function applyThinkingConfigToBody(
  body: UpstreamRequestBody,
  thinking: UpstreamThinkingConfig | undefined,
  protocol: UpstreamProtocol,
): UpstreamRequestBody {
  if (!thinking || !thinking.supportsThinking) {
    return body;
  }

  const nextBody: UpstreamRequestBody = { ...body };
  const model = typeof nextBody['model'] === 'string' ? nextBody['model'] : '';

  switch (thinking.providerType) {
    case 'openai':
      if (protocol === 'responses') {
        if (thinking.enabled) {
          nextBody['reasoning'] = { effort: thinking.effort };
        } else {
          delete nextBody['reasoning'];
        }
        return nextBody;
      }

      if (thinking.enabled) {
        nextBody['reasoning_effort'] = thinking.effort;
      } else {
        delete nextBody['reasoning_effort'];
      }
      return nextBody;
    case 'deepseek':
      if (thinking.enabled && !model.includes('reasoner')) {
        nextBody['thinking'] = { type: 'enabled' };
      } else {
        delete nextBody['thinking'];
      }
      return nextBody;
    case 'moonshot':
      if (model === 'kimi-k2.5') {
        nextBody['thinking'] = { type: thinking.enabled ? 'enabled' : 'disabled' };
      }
      return nextBody;
    default:
      return nextBody;
  }
}

export function buildUpstreamRequestBody(input: {
  protocol: UpstreamProtocol;
  model: string;
  maxTokens: number;
  temperature: number;
  messages: UpstreamChatMessage[];
  tools: UpstreamFunctionToolDefinition[];
  requestOverrides: RequestOverrides;
  thinking?: UpstreamThinkingConfig;
}): UpstreamRequestBody {
  const baseBody: UpstreamRequestBody =
    input.protocol === 'responses'
      ? {
          model: input.model,
          input: convertConversationToResponsesInput(input.messages, input.model),
          max_output_tokens: input.maxTokens,
          temperature: input.temperature,
          stream: true,
          ...(input.tools.length > 0
            ? {
                tools: convertToolsToResponsesTools(input.tools),
                tool_choice: 'auto' as const,
              }
            : {}),
        }
      : {
          model: input.model,
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
          stream: true,
          ...(input.tools.length > 0 ? { tools: input.tools, tool_choice: 'auto' as const } : {}),
        };

  const overriddenBody = applyRequestOverridesToBody(
    baseBody,
    input.requestOverrides,
    input.protocol,
  );

  return applyThinkingConfigToBody(overriddenBody, input.thinking, input.protocol);
}

function convertConversationToResponsesInput(
  messages: UpstreamChatMessage[],
  model: string,
): unknown[] {
  const systemRole = isReasoningModel(model) ? 'developer' : 'system';
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'user') {
      if (!message.content) continue;
      input.push({
        role: message.role === 'system' ? systemRole : message.role,
        content: [{ type: 'input_text', text: message.content }],
      });
      continue;
    }

    if (message.role === 'assistant') {
      if (message.content) {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: message.content }],
        });
      }

      for (const toolCall of message.tool_calls ?? []) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        });
      }
      continue;
    }

    if (message.role === 'tool' && message.tool_call_id && message.content) {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content,
      });
    }
  }

  return input;
}

function convertToolsToResponsesTools(tools: UpstreamFunctionToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters ?? { type: 'object', properties: {} },
    strict: tool.function.strict ?? false,
  }));
}

function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[134]|codex-?)/i.test(model);
}
