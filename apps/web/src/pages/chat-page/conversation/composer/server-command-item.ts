import type { CommandDescriptor, CommandResultCard, RunEvent } from '@openAwork/shared';
import { createCommandsClient } from '@openAwork/web-client';
import type { SlashCommandItem } from '../../../../components/conversation-runtime/messages/support.js';

interface ExecuteServerCommandParams {
  command: CommandDescriptor;
  currentSessionId: string | null;
  gatewayUrl: string;
  rawInput: string;
  token: string | null;
  unavailableMessage: string;
  unavailableTitle: string;
  onCard: (card: CommandResultCard) => void;
  onEvents: (events: RunEvent[]) => void;
  onOpenRightPanel: () => void;
}

function isCompactionCommand(command: CommandDescriptor): boolean {
  return command.action.kind === 'compact_session';
}

function buildCommandRunId(sessionId: string, commandId: string, executionId: string): string {
  return `command:${sessionId}:${commandId}:${executionId}`;
}

function buildOptimisticCommandEvents(
  command: CommandDescriptor,
  sessionId: string,
  executionId: string,
): RunEvent[] {
  if (!isCompactionCommand(command)) {
    return [];
  }

  const runId = buildCommandRunId(sessionId, command.id, executionId);
  return [
    {
      type: 'compaction',
      summary: '正在压缩会话上下文。',
      trigger: 'manual',
      phase: 'started',
      cause: 'manual',
      strategy: 'runtime_replace',
      runId,
      eventId: `${sessionId}:${command.id}:${executionId}:compaction:started`,
      occurredAt: Date.now(),
    },
  ];
}

function buildCommandFailureEvents(
  command: CommandDescriptor,
  sessionId: string,
  executionId: string,
  message: string,
): RunEvent[] {
  if (!isCompactionCommand(command)) {
    return [];
  }

  const runId = buildCommandRunId(sessionId, command.id, executionId);
  return [
    {
      type: 'compaction',
      summary: message,
      trigger: 'manual',
      phase: 'failed',
      cause: 'manual',
      strategy: 'runtime_replace',
      runId,
      eventId: `${sessionId}:${command.id}:${executionId}:compaction:request-failed`,
      occurredAt: Date.now(),
    },
  ];
}

function buildCommandFailureCard(command: CommandDescriptor, message: string): CommandResultCard {
  if (isCompactionCommand(command)) {
    return {
      type: 'status',
      title: '压缩未完成',
      message,
      tone: 'warning',
    };
  }

  return {
    type: 'status',
    title: `${resolveCommandDisplayLabel(command)} 执行失败`,
    message,
    tone: 'warning',
  };
}

function resolveCommandDisplayLabel(command: CommandDescriptor): string {
  if (command.action.kind === 'compact_session') {
    return 'compact';
  }

  return command.label;
}

export function createServerSlashCommandItem(command: CommandDescriptor): SlashCommandItem {
  return {
    id: command.id,
    kind: 'slash',
    source: 'command',
    type: 'insert',
    label: resolveCommandDisplayLabel(command),
    description: command.description ?? '',
    badgeLabel: '命令',
    insertText: `${command.label} `,
    onSelect: async () => undefined,
  };
}

export async function executeServerCommand(params: ExecuteServerCommandParams): Promise<void> {
  const sid = params.currentSessionId;
  if (!sid) {
    params.onCard({
      type: 'status',
      title: params.unavailableTitle,
      message: params.unavailableMessage,
      tone: 'warning',
    });
    return;
  }
  params.onOpenRightPanel();

  const executionId = isCompactionCommand(params.command) ? crypto.randomUUID() : undefined;
  const optimisticEvents = executionId
    ? buildOptimisticCommandEvents(params.command, sid, executionId)
    : [];
  if (optimisticEvents.length > 0) {
    params.onEvents(optimisticEvents);
  }

  try {
    const result = await createCommandsClient(params.gatewayUrl).execute(
      params.token ?? '',
      sid,
      params.command.id,
      {
        rawInput: params.rawInput,
        ...(executionId ? { executionId } : {}),
      },
    );

    params.onEvents(result.events);

    if (result.card && !isCompactionCommand(params.command)) {
      params.onCard(result.card);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '执行命令失败。';
    const failureEvents = executionId
      ? buildCommandFailureEvents(params.command, sid, executionId, message)
      : [];
    if (failureEvents.length > 0) {
      params.onEvents(failureEvents);
    }
    if (!isCompactionCommand(params.command)) {
      params.onCard(buildCommandFailureCard(params.command, message));
    }
  }
}
