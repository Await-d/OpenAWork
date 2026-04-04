import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appendMessage as dbAppendMessage } from '../db/session-store.js';
import { useGatewayClient } from './useGatewayClient.js';
import type { MobileChatMessage } from '../chat-message-content.js';
import { buildChatStreamToken, shouldApplyChatStreamMutation } from './chat-stream-guard.js';

export function useChatStreamState({
  accessToken,
  gatewayUrl,
  sessionId,
}: {
  accessToken: string | null;
  gatewayUrl: string;
  sessionId: string | undefined;
}) {
  const [messages, setMessages] = useState<MobileChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [streamThinkingBuffer, setStreamThinkingBuffer] = useState<string[]>([]);
  const { stream } = useGatewayClient(gatewayUrl, accessToken);
  const isMountedRef = useRef(true);
  const latestSessionIdRef = useRef(sessionId);
  const streamRequestVersionRef = useRef(0);
  const activeStreamTokenRef = useRef<string | null>(null);

  useEffect(() => {
    latestSessionIdRef.current = sessionId;
    streamRequestVersionRef.current += 1;
    activeStreamTokenRef.current = null;
    setStreaming(false);
    setStreamBuffer('');
    setStreamThinkingBuffer([]);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      streamRequestVersionRef.current += 1;
      activeStreamTokenRef.current = null;
    };
  }, []);

  const replaceMessages = useCallback((nextMessages: MobileChatMessage[]) => {
    setMessages(nextMessages);
  }, []);

  const sendMessage = useCallback(
    (input: string): boolean => {
      if (!input.trim() || streaming || !sessionId) {
        return false;
      }

      const text = input.trim();
      const userMsg: MobileChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };

      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);
      setStreamBuffer('');
      setStreamThinkingBuffer([]);
      void dbAppendMessage(sessionId, { id: userMsg.id, role: 'user', content: text });

      let accumulated = '';
      let accumulatedThinking = '';
      const effectiveAgentId: string | undefined = undefined;
      const requestVersion = streamRequestVersionRef.current + 1;
      streamRequestVersionRef.current = requestVersion;
      const requestSessionId = sessionId;
      const requestToken = buildChatStreamToken(requestSessionId, requestVersion);
      activeStreamTokenRef.current = requestToken;

      const canApplyMutation = () =>
        shouldApplyChatStreamMutation({
          activeToken: activeStreamTokenRef.current,
          callbackToken: requestToken,
          currentSessionId: latestSessionIdRef.current,
          mounted: isMountedRef.current,
          requestSessionId,
        });

      stream(
        sessionId,
        text,
        {
          onDelta: (delta) => {
            if (!canApplyMutation()) {
              return;
            }
            accumulated += delta;
            setStreamBuffer(accumulated);
          },
          onThinkingDelta: (delta) => {
            if (!canApplyMutation()) {
              return;
            }
            accumulatedThinking += delta;
            setStreamThinkingBuffer(
              accumulatedThinking.trim().length > 0 ? [accumulatedThinking] : [],
            );
          },
          onDone: () => {
            if (!canApplyMutation()) {
              return;
            }
            const assistantMsg: MobileChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: accumulated,
              ...(accumulatedThinking.trim().length > 0
                ? { reasoningBlocks: [accumulatedThinking] }
                : {}),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            void dbAppendMessage(sessionId, {
              id: assistantMsg.id,
              role: 'assistant',
              content: accumulated,
              ...(assistantMsg.reasoningBlocks
                ? { reasoningBlocks: assistantMsg.reasoningBlocks }
                : {}),
            });
            activeStreamTokenRef.current = null;
            setStreamBuffer('');
            setStreamThinkingBuffer([]);
            setStreaming(false);
          },
          onError: (code) => {
            if (!canApplyMutation()) {
              return;
            }
            const assistantMsg: MobileChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `[Error: ${code}]`,
              ...(accumulatedThinking.trim().length > 0
                ? { reasoningBlocks: [accumulatedThinking] }
                : {}),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            void dbAppendMessage(sessionId, {
              id: assistantMsg.id,
              role: 'assistant',
              content: assistantMsg.content,
              ...(assistantMsg.reasoningBlocks
                ? { reasoningBlocks: assistantMsg.reasoningBlocks }
                : {}),
            });
            activeStreamTokenRef.current = null;
            setStreamBuffer('');
            setStreamThinkingBuffer([]);
            setStreaming(false);
          },
        },
        { agentId: effectiveAgentId },
      );

      return true;
    },
    [sessionId, stream, streaming],
  );

  const renderedMessages = useMemo<MobileChatMessage[]>(() => {
    if (streamBuffer.length === 0 && streamThinkingBuffer.length === 0) {
      return messages;
    }

    return [
      ...messages,
      {
        id: '__streaming__',
        role: 'assistant',
        content: streamBuffer,
        ...(streamThinkingBuffer.length > 0 ? { reasoningBlocks: streamThinkingBuffer } : {}),
      },
    ];
  }, [messages, streamBuffer, streamThinkingBuffer]);

  return {
    messages,
    renderedMessages,
    replaceMessages,
    sendMessage,
    streaming,
  };
}
