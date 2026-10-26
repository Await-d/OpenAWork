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
  // OpenAI Chat 家族：思维链字段名 + 结构化条目（历史回传时按同名写回）。
  if (typeof reasoning.reasoningField === 'string' && reasoning.reasoningField.length > 0) {
    metadata.reasoningField = reasoning.reasoningField;
  }
  if (Array.isArray(reasoning.reasoningDetails) && reasoning.reasoningDetails.length > 0) {
    metadata.reasoningDetails = reasoning.reasoningDetails;
  }
  // 命名空间：路由 `providerMetadataKey`（缺省 `openai`），与协议侧读写一致。
  return Object.keys(metadata).length === 0
    ? undefined
    : { [reasoning.providerMetadataKey ?? 'openai']: metadata };
};

/** 与协议层 `validateMedia` 同形态的 base64 校验（只做形态判定，不解码）。 */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * 只有内联图片（base64 编码的 `data:` URL 或裸 base64）能作为 `media` part 下发。
 *
 * 远程 `http(s)://` / `blob:` 地址、相对 / 绝对文件路径都不是 base64，直接塞进
 * `data` 会让多模态协议层在校验阶段拒绝**整个请求**（2026-10-22 排障包：
 * `ProviderShared.request: OpenAI Chat media must contain valid base64`，
 * 单条历史里的远程图片地址即可打死整轮对话）。这类图片应由渠道 enrich 阶段
 * 下载成 base64（见 `channels/wecom-media.ts`）；漏网时在此跳过，退化为
 * 「本轮看不到这张图」，而不是让对话无法继续。
 */
const isInlineImageSource = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (/^data:/i.test(trimmed)) {
    // `data:image/svg+xml,<svg…>` 这类文本编码的 data URL 同样会校验失败。
    return /^data:[^;,]+;base64,/i.test(trimmed);
  }
  // 任何带 scheme 的值（http/blob/file/...）都不是内联 payload。
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  // 裸串必须是合法 base64 形态，否则 `/abs/a.png` 这类工具返回的文件路径
  // 会被当成 base64 送上游（字节解码成功，但内容是垃圾）。
  return trimmed.length % 4 === 0 && BASE64_PATTERN.test(trimmed);
};

const userMessage = (message: UserMessageUnified): Message => {
  const parts: ContentPart[] = [];
  if (message.content.length > 0) parts.push({ type: 'text', text: message.content });
  for (const image of message.images ?? []) {
    if (typeof image.imageUrl !== 'string' || !isInlineImageSource(image.imageUrl)) continue;
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
    case 'synthetic':
      // D-1: gateway-injected notices are model-visible but must not be
      // rendered as user input on the client. Upstream protocols only know
      // user/assistant/tool turns, so downgrade to a `user` turn. The
      // `syntheticKind` tag is gateway-side metadata and is dropped here.
      return userMessage({ role: 'user', content: message.content });
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
