import { useCallback, useMemo } from 'react';
import type { RunEvent } from '@openAwork/shared';
import type { ComposerWorkspaceCatalog } from '../../../../hooks/chat/useComposerWorkspaceCatalog.js';
import { makeOrderedMessageId } from '../../../../components/conversation-runtime/messages/ordered-id.js';
import {
  createAssistantEventContent,
  type AssistantEventKind,
  type ChatMessage,
} from '../../../../components/conversation-runtime/messages/support.js';

export interface AssistantMessageProcessingDeps {
  composerWorkspaceCatalog: ComposerWorkspaceCatalog;
  setMessages: (value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
}

type CapabilityKind = 'agent' | 'mcp' | 'skill' | 'tool';

export interface AssistantMessageProcessingReturn {
  resolveAssistantCapabilityKind: (text: string | undefined) => CapabilityKind | undefined;
  resolveAssistantEventKind: (event: RunEvent) => AssistantEventKind | undefined;
  appendAssistantDerivedMessages: (
    contents: Array<{
      content: string;
      createdAt?: number;
      messageId?: string;
    }>,
  ) => void;
  appendAssistantEventMessages: (
    events: RunEvent[],
    options?: { excludeCompaction?: boolean },
  ) => void;
}

function isDuplicateCompactionContent(
  previous: ChatMessage[],
  content: string,
  createdAt: number,
): boolean {
  // Guard against double-append when a command card and the matching stream
  // event both try to land within the same short window (e.g. /compact).
  for (let index = previous.length - 1; index >= Math.max(0, previous.length - 6); index -= 1) {
    const message = previous[index];
    if (!message || message.role !== 'assistant') continue;
    if (message.content !== content) continue;
    const messageCreatedAt =
      typeof message.createdAt === 'number'
        ? message.createdAt
        : typeof message.createdAt === 'string'
          ? Date.parse(message.createdAt)
          : NaN;
    if (!Number.isFinite(messageCreatedAt) || Math.abs(messageCreatedAt - createdAt) <= 8_000) {
      return true;
    }
  }
  return false;
}

function resolveAssistantEventMessageId(event: RunEvent): string | undefined {
  if (event.type !== 'compaction') {
    return undefined;
  }

  const runId = typeof event.runId === 'string' ? event.runId.trim() : '';
  if (runId.length > 0) {
    return `assistant_event:compaction:${runId}`;
  }

  const eventId = typeof event.eventId === 'string' ? event.eventId.trim() : '';
  if (eventId.length > 0) {
    return `assistant_event:compaction:${eventId}`;
  }

  return undefined;
}

export function useAssistantMessageProcessing(
  deps: AssistantMessageProcessingDeps,
): AssistantMessageProcessingReturn {
  const { composerWorkspaceCatalog, setMessages } = deps;

  const capabilityKindHints = useMemo(
    () =>
      [
        ...composerWorkspaceCatalog.agents.flatMap((item) => [
          { kind: 'agent' as const, value: item.label.trim().toLowerCase() },
          { kind: 'agent' as const, value: item.id.trim().toLowerCase() },
        ]),
        ...composerWorkspaceCatalog.installedSkills.flatMap((item) => [
          { kind: 'skill' as const, value: item.label.trim().toLowerCase() },
          { kind: 'skill' as const, value: item.id.trim().toLowerCase() },
        ]),
        ...composerWorkspaceCatalog.mcpServers.flatMap((item) => [
          { kind: 'mcp' as const, value: item.label.trim().toLowerCase() },
          { kind: 'mcp' as const, value: item.id.trim().toLowerCase() },
        ]),
        ...composerWorkspaceCatalog.agentTools.map((item) => ({
          kind: 'tool' as const,
          value: item.name.trim().toLowerCase(),
        })),
      ].filter((item) => item.value.length > 0),
    [composerWorkspaceCatalog],
  );

  const resolveAssistantCapabilityKind = useCallback(
    (text: string | undefined): CapabilityKind | undefined => {
      const normalized = (text ?? '').trim().toLowerCase();
      if (normalized.length === 0) {
        return undefined;
      }

      const matched = capabilityKindHints.find(
        (item) => normalized === item.value || normalized.includes(item.value),
      );
      return matched?.kind;
    },
    [capabilityKindHints],
  );

  const resolveAssistantEventKind = useCallback(
    (event: RunEvent): AssistantEventKind | undefined => {
      if (event.type === 'compaction') {
        return 'compaction';
      }
      if (event.type === 'permission_asked' || event.type === 'permission_replied') {
        return 'permission';
      }
      if (event.type === 'audit_ref') {
        return resolveAssistantCapabilityKind(event.toolName) ?? 'audit';
      }
      if (event.type === 'task_update') {
        return resolveAssistantCapabilityKind(event.label);
      }
      if (event.type === 'session_child') {
        return resolveAssistantCapabilityKind(event.title ?? event.sessionId);
      }
      return undefined;
    },
    [resolveAssistantCapabilityKind],
  );

  const appendAssistantDerivedMessages = useCallback(
    (contents: Array<{ content: string; createdAt?: number; messageId?: string }>) => {
      if (contents.length === 0) return;

      setMessages((previous) => {
        const nextMessages = [...previous];
        for (const item of contents) {
          const createdAt = item.createdAt ?? Date.now();
          const messageId = typeof item.messageId === 'string' ? item.messageId.trim() : '';
          if (messageId.length > 0) {
            const existingIndex = nextMessages.findIndex((message) => message.id === messageId);
            if (existingIndex >= 0) {
              const existingMessage = nextMessages[existingIndex]!;
              nextMessages[existingIndex] = {
                ...existingMessage,
                content: item.content,
                createdAt: existingMessage.createdAt ?? createdAt,
                status: 'completed',
              };
              continue;
            }
          }
          if (isDuplicateCompactionContent(nextMessages, item.content, createdAt)) {
            continue;
          }
          nextMessages.push({
            id: messageId.length > 0 ? messageId : makeOrderedMessageId(createdAt),
            role: 'assistant',
            content: item.content,
            createdAt,
            status: 'completed',
          });
        }
        return nextMessages;
      });
    },
    [setMessages],
  );

  const appendAssistantEventMessages = useCallback(
    (events: RunEvent[], options?: { excludeCompaction?: boolean }) => {
      // Only compaction is mirrored into the main transcript. Other
      // operational events continue to live in side panels / task views.
      const contents = events.flatMap((event) => {
        if (event.type !== 'compaction') {
          return [];
        }
        if (options?.excludeCompaction) {
          return [];
        }
        const content = createAssistantEventContent(event, {
          kindOverride: resolveAssistantEventKind(event),
        });
        if (!content) {
          return [];
        }
        return [
          {
            content,
            createdAt: event.occurredAt ?? Date.now(),
            messageId: resolveAssistantEventMessageId(event),
          },
        ];
      });

      if (contents.length === 0) {
        return;
      }

      appendAssistantDerivedMessages(contents);
    },
    [appendAssistantDerivedMessages, resolveAssistantEventKind],
  );

  return {
    resolveAssistantCapabilityKind,
    resolveAssistantEventKind,
    appendAssistantDerivedMessages,
    appendAssistantEventMessages,
  };
}
