import { useCallback, useMemo } from 'react';
import type { RunEvent } from '@openAwork/shared';
import type { ComposerWorkspaceCatalog } from '../../hooks/useComposerWorkspaceCatalog.js';
import { type AssistantEventKind, type ChatMessage } from './support.js';

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
    }>,
  ) => void;
  appendAssistantEventMessages: (
    events: RunEvent[],
    options?: { excludeCompaction?: boolean },
  ) => void;
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
    (_contents: Array<{ content: string; createdAt?: number }>) => {
      // Operational/status cards no longer append into the main chat transcript.
    },
    [],
  );

  const appendAssistantEventMessages = useCallback(
    (_events: RunEvent[], _options?: { excludeCompaction?: boolean }) => {
      // Operational/status events are surfaced via side panels and task/sub-session views,
      // not mirrored into the main transcript.
    },
    [],
  );

  return {
    resolveAssistantCapabilityKind,
    resolveAssistantEventKind,
    appendAssistantDerivedMessages,
    appendAssistantEventMessages,
  };
}
