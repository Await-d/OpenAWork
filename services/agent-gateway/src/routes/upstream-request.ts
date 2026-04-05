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

const ANTHROPIC_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16000,
  xhigh: 31999,
};

const GEMINI_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16000,
  xhigh: 24576,
};

function readObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function mergeGeminiThinkingConfig(
  body: UpstreamRequestBody,
  value: Record<string, unknown>,
): void {
  const extraBody = readObjectRecord(body['extra_body']);
  const googleBody = readObjectRecord(extraBody['google']);

  body['extra_body'] = {
    ...extraBody,
    google: {
      ...googleBody,
      thinking_config: {
        ...readObjectRecord(googleBody['thinking_config']),
        ...value,
      },
    },
  };
}

function mapAnthropicThinkingBudget(effort: ReasoningEffort): number {
  return ANTHROPIC_THINKING_BUDGETS[effort];
}

function mapGeminiThinkingBudget(effort: ReasoningEffort): number {
  return GEMINI_THINKING_BUDGETS[effort];
}

function mapGeminiThinkingLevel(effort: ReasoningEffort): 'low' | 'medium' | 'high' {
  if (effort === 'minimal' || effort === 'low') {
    return 'low';
  }

  if (effort === 'xhigh') {
    return 'high';
  }

  return effort;
}

function supportsOpenRouterReasoning(model: string): boolean {
  return model.includes('gpt') || model.includes('claude') || model.includes('gemini-3');
}

function isMoonshotThinkingModel(model: string): boolean {
  return (
    model.includes('kimi-k2.5') ||
    model.includes('kimi-k2-thinking') ||
    model.includes('kimi-k2p5') ||
    model.includes('kimi-k2-5')
  );
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
  const modelValue = typeof nextBody['model'] === 'string' ? nextBody['model'] : '';
  const model = modelValue.toLowerCase();

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
    case 'anthropic':
      if (thinking.enabled) {
        nextBody['thinking'] = {
          type: 'enabled',
          budget_tokens: mapAnthropicThinkingBudget(thinking.effort),
        };
      } else {
        delete nextBody['thinking'];
      }
      return nextBody;
    case 'gemini':
      if (!thinking.enabled) {
        mergeGeminiThinkingConfig(nextBody, {
          thinking_budget: 0,
        });
        return nextBody;
      }

      if (model.includes('gemini-3')) {
        mergeGeminiThinkingConfig(nextBody, {
          include_thoughts: true,
          thinking_level: mapGeminiThinkingLevel(thinking.effort),
        });
        return nextBody;
      }

      mergeGeminiThinkingConfig(nextBody, {
        include_thoughts: true,
        thinking_budget: mapGeminiThinkingBudget(thinking.effort),
      });
      return nextBody;
    case 'openrouter':
      if (!supportsOpenRouterReasoning(model)) {
        return nextBody;
      }

      nextBody['reasoning'] = thinking.enabled ? { effort: thinking.effort } : { enabled: false };
      return nextBody;
    case 'qwen':
      nextBody['enable_thinking'] = thinking.enabled;
      return nextBody;
    case 'moonshot':
      if (isMoonshotThinkingModel(model)) {
        nextBody['thinking'] = { type: thinking.enabled ? 'enabled' : 'disabled' };
      }
      return nextBody;
    default:
      return nextBody;
  }
}

function applyChatStreamUsageOptions(
  body: UpstreamRequestBody,
  protocol: UpstreamProtocol,
): UpstreamRequestBody {
  if (protocol !== 'chat_completions' || body['stream'] !== true) {
    return body;
  }

  const streamOptions = body['stream_options'];
  const streamOptionsRecord =
    streamOptions && typeof streamOptions === 'object' && !Array.isArray(streamOptions)
      ? (streamOptions as Record<string, unknown>)
      : {};

  return {
    ...body,
    stream_options: {
      ...streamOptionsRecord,
      include_usage: true,
    },
  };
}

export function buildUpstreamRequestBody(input: {
  protocol: UpstreamProtocol;
  model: string;
  variant?: string;
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
          ...(input.variant ? { variant: input.variant } : {}),
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
          ...(input.variant ? { variant: input.variant } : {}),
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
          stream: true,
          stream_options: {
            include_usage: true,
          },
          ...(input.tools.length > 0 ? { tools: input.tools, tool_choice: 'auto' as const } : {}),
        };

  const overriddenBody = applyRequestOverridesToBody(
    baseBody,
    input.requestOverrides,
    input.protocol,
  );
  const usageAwareBody = applyChatStreamUsageOptions(overriddenBody, input.protocol);

  return applyThinkingConfigToBody(usageAwareBody, input.thinking, input.protocol);
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
