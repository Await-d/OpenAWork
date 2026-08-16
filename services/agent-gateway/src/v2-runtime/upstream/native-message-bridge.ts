import {
  Message,
  SystemPart,
  ToolCallPart,
  ToolResultPart,
  type ContentPart,
  type LLMRequest,
  type ProviderMetadata,
} from '@openAwork/opencode-llm';
import type {
  AssistantMessageUnified,
  ToolResultMessage,
  UnifiedMessage,
  UserMessageUnified,
} from '../../message/message-to-model-messages.js';

const parseArguments = (value: string): unknown => {
  if (value.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return value;
  }
};

const mediaType = (value: string | undefined): string =>
  value?.toLowerCase() === 'image/jpg' ? 'image/jpeg' : (value ?? 'image/*');

const mergeProviderMetadata = (
  ...values: ReadonlyArray<ProviderMetadata | undefined>
): ProviderMetadata | undefined => {
  const present = values.filter((value): value is ProviderMetadata => value !== undefined);
  if (present.length === 0) return undefined;
  const merged: Record<string, Record<string, unknown>> = {};
  for (const value of present) {
    for (const [provider, metadata] of Object.entries(value)) {
      merged[provider] = { ...(merged[provider] ?? {}), ...metadata };
    }
  }
  return merged;
};

const openAIReasoningMetadata = (
  reasoning: NonNullable<AssistantMessageUnified['reasoning']>,
): ProviderMetadata | undefined => {
  const metadata: Record<string, unknown> = {};
  if (typeof reasoning.itemId === 'string' && reasoning.itemId.length > 0) {
    metadata.itemId = reasoning.itemId;
  }
  if (typeof reasoning.encryptedContent === 'string' && reasoning.encryptedContent.length > 0) {
    metadata.reasoningEncryptedContent = reasoning.encryptedContent;
  }
  if (typeof reasoning.responseId === 'string' && reasoning.responseId.length > 0) {
    metadata.responseId = reasoning.responseId;
  }
  if (typeof reasoning.summary === 'string' && reasoning.summary.length > 0) {
    metadata.summary = reasoning.summary;
  }
  return Object.keys(metadata).length === 0 ? undefined : { openai: metadata };
};

const userMessage = (message: UserMessageUnified): Message => {
  const parts: ContentPart[] = [];
  if (message.content.length > 0) parts.push({ type: 'text', text: message.content });
  for (const image of message.images ?? []) {
    if (typeof image.imageUrl !== 'string' || image.imageUrl.length === 0) continue;
    parts.push({ type: 'media', mediaType: mediaType(image.mimeType), data: image.imageUrl });
  }
  return Message.make({
    role: 'user',
    content: parts.length === 0 ? [{ type: 'text', text: '' }] : parts,
  });
};

const assistantMessage = (message: AssistantMessageUnified): Message | undefined => {
  const parts: ContentPart[] = [];
  const blocks = message.reasoning?.blocks ?? [];
  if (blocks.length > 0) {
    for (const [index, block] of blocks.entries()) {
      const providerMetadata = mergeProviderMetadata(
        block.signature === undefined ? undefined : { anthropic: { signature: block.signature } },
        index === 0 && message.reasoning !== undefined
          ? openAIReasoningMetadata(message.reasoning)
          : undefined,
      );
      parts.push({
        type: 'reasoning',
        text: block.text,
        ...(providerMetadata === undefined ? {} : { providerMetadata }),
      });
    }
  } else if (
    message.reasoning?.text ||
    message.reasoning?.encryptedContent ||
    message.reasoning?.summary ||
    message.reasoning?.responseId
  ) {
    const providerMetadata =
      message.reasoning === undefined ? undefined : openAIReasoningMetadata(message.reasoning);
    parts.push({
      type: 'reasoning',
      text: message.reasoning.text ?? message.reasoning.summary ?? '',
      ...(providerMetadata === undefined ? {} : { providerMetadata }),
    });
  }
  if (typeof message.content === 'string' && message.content.length > 0) {
    parts.push({ type: 'text', text: message.content });
  }
  for (const call of message.toolCalls ?? []) {
    parts.push(
      ToolCallPart.make({
        id: call.id,
        name: call.name,
        input: parseArguments(call.arguments),
        ...(call.providerMetadata === undefined ? {} : { providerMetadata: call.providerMetadata }),
      }),
    );
  }
  return parts.length === 0 ? undefined : Message.make({ role: 'assistant', content: parts });
};

const toolMessage = (message: ToolResultMessage): Message =>
  Message.tool(
    ToolResultPart.make({
      id: message.toolCallId,
      name: message.toolName ?? '',
      result: message.content,
      resultType: message.isError === true ? 'error' : 'text',
    }),
  );

const convert = (message: UnifiedMessage): Message | undefined => {
  switch (message.role) {
    case 'system':
      return undefined;
    case 'user':
      return userMessage(message);
    case 'assistant':
      return assistantMessage(message);
    case 'tool':
      return toolMessage(message);
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
};

export function unifiedConversationToNativeMessages(
  messages: readonly UnifiedMessage[],
): Message[] {
  return messages.flatMap((message) => {
    const converted = convert(message);
    return converted === undefined ? [] : [converted];
  });
}

export function extractNativeSystemFromUnifiedMessages(messages: readonly UnifiedMessage[]): {
  readonly system: SystemPart[];
  readonly messages: Message[];
} {
  const system: SystemPart[] = [];
  const remaining: UnifiedMessage[] = [];
  let foundNonSystem = false;
  for (const message of messages) {
    if (message.role === 'system' && !foundNonSystem) {
      system.push(SystemPart.make(message.content));
      continue;
    }
    foundNonSystem = true;
    remaining.push(message);
  }
  return { system, messages: unifiedConversationToNativeMessages(remaining) } satisfies Pick<
    LLMRequest,
    'system' | 'messages'
  >;
}
