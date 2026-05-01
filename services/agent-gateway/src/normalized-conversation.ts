export interface UpstreamChatMessage {
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
  reasoning?: {
    text?: string;
    encryptedContent?: string;
    summary?: string;
    responseId?: string;
  };
}

export type NormalizedConversationMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      reasoning?: {
        text?: string;
        encryptedContent?: string;
        summary?: string;
        responseId?: string;
      };
    }
  | { role: 'tool'; toolCallId: string; content: string };

export function normalizeUpstreamChatMessages(
  messages: UpstreamChatMessage[],
): NormalizedConversationMessage[] {
  return messages.flatMap<NormalizedConversationMessage>((message) => {
    if (message.role === 'assistant') {
      return [
        {
          role: 'assistant' as const,
          content: message.content,
          ...(message.tool_calls
            ? {
                toolCalls: message.tool_calls.map((toolCall) => ({
                  id: toolCall.id,
                  name: toolCall.function.name,
                  arguments: toolCall.function.arguments,
                })),
              }
            : {}),
          ...(message.reasoning ? { reasoning: message.reasoning } : {}),
        },
      ];
    }

    if (message.role === 'tool') {
      if (!message.tool_call_id || message.content == null) {
        return [];
      }
      return [
        { role: 'tool' as const, toolCallId: message.tool_call_id, content: message.content },
      ];
    }

    if (message.content == null) {
      return [];
    }

    return [
      {
        role: message.role,
        content: message.content,
      },
    ];
  });
}

export function renderNormalizedConversationToUpstreamChatMessages(
  messages: NormalizedConversationMessage[],
): UpstreamChatMessage[] {
  return messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function' as const,
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              })),
            }
          : {}),
        ...(message.reasoning ? { reasoning: message.reasoning } : {}),
      };
    }

    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}
