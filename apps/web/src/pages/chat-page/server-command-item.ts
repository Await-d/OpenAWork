import type { CommandDescriptor, CommandResultCard, RunEvent } from '@openAwork/shared';
import { createCommandsClient } from '@openAwork/web-client';
import type { SlashCommandItem } from './support.js';

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

export function createServerSlashCommandItem(command: CommandDescriptor): SlashCommandItem {
  return {
    id: command.id,
    kind: 'slash',
    source: 'command',
    type: 'insert',
    label: command.label,
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

  const result = await createCommandsClient(params.gatewayUrl).execute(
    params.token ?? '',
    sid,
    params.command.id,
    {
      rawInput: params.rawInput,
    },
  );

  params.onEvents(result.events);
  params.onOpenRightPanel();

  if (result.card) {
    params.onCard(result.card);
  }
}
