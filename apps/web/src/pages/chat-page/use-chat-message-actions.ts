import { useCallback } from 'react';
import type { SessionMessageRatingRecord, SessionMessageRatingValue } from '@openAwork/web-client';
import type { GenerativeUIMessage } from '@openAwork/shared-ui';
import type { ChatMessage } from './support.js';
import { parseAssistantEventContent, parseAssistantTraceContent } from './support.js';

export interface HistoryEditPrompt {
  hasCodeMarkers: boolean;
  messageId: string;
  text: string;
}

export interface RetryPrompt {
  sourceMessageId: string;
  text: string;
}

export interface MessageActionItem {
  id: string;
  label: string;
  onClick: () => void;
}

export interface UseChatMessageActionsOptions {
  messages: ChatMessage[];
  messageRatings: Record<string, SessionMessageRatingRecord>;
  onToggleMessageRating: (message: ChatMessage, rating: SessionMessageRatingValue) => void;
  focusComposerWithText: (text: string) => void;
  setHistoryEditPrompt: React.Dispatch<React.SetStateAction<HistoryEditPrompt | null>>;
  setRetryPrompt: React.Dispatch<React.SetStateAction<RetryPrompt | null>>;
}

export interface UseChatMessageActionsReturn {
  getCopyableMessageText: (message: ChatMessage) => string;
  handleCopyMessage: (message: ChatMessage) => void;
  handleCopyMessageGroup: (groupMessages: ChatMessage[]) => void;
  handleEditRetryMessage: (message: ChatMessage) => void;
  handleRetryMessage: (messageId: string) => void;
  findRetrySource: (messageId: string) => { id: string; text: string } | null;
  isHistoricalUserMessage: (messageId: string) => boolean;
  containsCodeMarkers: (text: string) => boolean;
  buildMessageActions: (message: ChatMessage) => MessageActionItem[];
}

export function useChatMessageActions(
  options: UseChatMessageActionsOptions,
): UseChatMessageActionsReturn {
  const {
    messages,
    messageRatings,
    onToggleMessageRating,
    focusComposerWithText,
    setHistoryEditPrompt,
    setRetryPrompt,
  } = options;

  const getCopyableMessageText = useCallback((message: ChatMessage): string => {
    if (message.role === 'user') return message.content;
    const assistantEvent = parseAssistantEventContent(message.content);
    if (assistantEvent) {
      return [assistantEvent.title, assistantEvent.message, `状态：${assistantEvent.status}`]
        .filter((item) => item && item.trim().length > 0)
        .join('\n');
    }
    const assistantTrace = parseAssistantTraceContent(message.content);
    if (assistantTrace) {
      const lines = [
        ...(assistantTrace.reasoningBlocks ?? []).map((item) => `_Thinking:_\n\n${item}`),
        assistantTrace.text,
      ];
      for (const toolCall of assistantTrace.toolCalls) {
        lines.push(`工具：${toolCall.toolName}`);
        lines.push(`输入：${JSON.stringify(toolCall.input, null, 2)}`);
        if (toolCall.output !== undefined) {
          lines.push(`输出：${JSON.stringify(toolCall.output, null, 2)}`);
        }
      }
      return lines.filter((item) => item && item.trim().length > 0).join('\n\n');
    }

    try {
      const parsed = JSON.parse(message.content) as GenerativeUIMessage;
      if (parsed.type === 'status') {
        const payload = parsed.payload as Record<string, unknown>;
        return [payload['title'], payload['message']]
          .filter((item) => typeof item === 'string')
          .join('\n');
      }
      if (parsed.type === 'compaction') {
        const payload = parsed.payload as Record<string, unknown>;
        return [payload['title'], payload['summary']]
          .filter((item) => typeof item === 'string')
          .join('\n');
      }
      if (parsed.type === 'tool_call') {
        const payload = parsed.payload as Record<string, unknown>;
        const lines = [
          typeof payload['toolName'] === 'string' ? `工具：${payload['toolName']}` : undefined,
          payload['input'] !== undefined
            ? `输入：${JSON.stringify(payload['input'], null, 2)}`
            : undefined,
          payload['output'] !== undefined
            ? `输出：${JSON.stringify(payload['output'], null, 2)}`
            : undefined,
        ].filter((item): item is string => Boolean(item));
        return lines.join('\n');
      }
    } catch {
      return message.content;
    }
    return message.content;
  }, []);

  const findRetrySource = useCallback(
    (messageId: string): { id: string; text: string } | null => {
      const index = messages.findIndex((item) => item.id === messageId);
      if (index === -1) return null;
      for (let cursor = index; cursor >= 0; cursor -= 1) {
        const candidate = messages[cursor];
        if (candidate?.role === 'user') {
          return { id: candidate.id, text: candidate.content };
        }
      }
      return null;
    },
    [messages],
  );

  const isHistoricalUserMessage = useCallback(
    (messageId: string): boolean => {
      const index = messages.findIndex((item) => item.id === messageId && item.role === 'user');
      return index !== -1 && index < messages.length - 1;
    },
    [messages],
  );

  const containsCodeMarkers = useCallback((text: string): boolean => {
    return /```|<file\s+name=|diff --git|^\s*(import|export|function|const|let|class)\s+/m.test(
      text,
    );
  }, []);

  const handleCopyMessage = useCallback(
    (message: ChatMessage) => {
      const copyRequest = navigator.clipboard?.writeText(getCopyableMessageText(message));
      void copyRequest?.catch(() => undefined);
    },
    [getCopyableMessageText],
  );

  const handleCopyMessageGroup = useCallback(
    (groupMessages: ChatMessage[]) => {
      const combinedText = groupMessages
        .map((message) => getCopyableMessageText(message))
        .filter((text) => text.trim().length > 0)
        .join('\n\n');

      if (combinedText.length === 0) {
        return;
      }

      const copyRequest = navigator.clipboard?.writeText(combinedText);
      void copyRequest?.catch(() => undefined);
    },
    [getCopyableMessageText],
  );

  const handleEditRetryMessage = useCallback(
    (message: ChatMessage) => {
      if (isHistoricalUserMessage(message.id)) {
        setHistoryEditPrompt({
          messageId: message.id,
          text: message.content,
          hasCodeMarkers: containsCodeMarkers(message.content),
        });
        return;
      }
      focusComposerWithText(message.content);
    },
    [containsCodeMarkers, focusComposerWithText, isHistoricalUserMessage, setHistoryEditPrompt],
  );

  const handleRetryMessage = useCallback(
    (messageId: string) => {
      const retrySource = findRetrySource(messageId);
      if (!retrySource) return;
      setRetryPrompt({ sourceMessageId: retrySource.id, text: retrySource.text });
    },
    [findRetrySource, setRetryPrompt],
  );

  const buildMessageActions = useCallback(
    (message: ChatMessage): MessageActionItem[] => [
      {
        id: 'copy',
        label: '复制',
        onClick: () => handleCopyMessage(message),
      },
      ...(message.role === 'assistant' && message.rawContent
        ? [
            {
              id: 'rate-up',
              label: messageRatings[message.id]?.rating === 'up' ? '👍 已赞' : '👍',
              onClick: () => void onToggleMessageRating(message, 'up'),
            },
            {
              id: 'rate-down',
              label: messageRatings[message.id]?.rating === 'down' ? '👎 已踩' : '👎',
              onClick: () => void onToggleMessageRating(message, 'down'),
            },
          ]
        : []),
      ...(message.role === 'user'
        ? [
            {
              id: 'edit-retry',
              label: '编辑重试',
              onClick: () => handleEditRetryMessage(message),
            },
          ]
        : [
            {
              id: 'retry',
              label: '重试',
              onClick: () => handleRetryMessage(message.id),
            },
          ]),
    ],
    [
      handleCopyMessage,
      handleEditRetryMessage,
      handleRetryMessage,
      messageRatings,
      onToggleMessageRating,
    ],
  );

  return {
    getCopyableMessageText,
    handleCopyMessage,
    handleCopyMessageGroup,
    handleEditRetryMessage,
    handleRetryMessage,
    findRetrySource,
    isHistoricalUserMessage,
    containsCodeMarkers,
    buildMessageActions,
  };
}
