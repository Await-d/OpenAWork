import type { CommandDescriptor, CommandExecutionResult, Message } from '@openAwork/shared';
import { HttpError } from './sessions.js';

export interface CommandsClient {
  list(token: string): Promise<CommandDescriptor[]>;
  execute(
    token: string,
    sessionId: string,
    commandId: string,
    payload?: { messages?: Message[]; rawInput?: string },
  ): Promise<CommandExecutionResult>;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export function createCommandsClient(gatewayUrl: string): CommandsClient {
  return {
    async list(token) {
      const res = await fetch(`${gatewayUrl}/commands`, {
        headers: authHeader(token),
      });
      if (!res.ok) throw new HttpError(`Failed to list commands: ${res.status}`, res.status);
      const data = (await res.json()) as { commands?: CommandDescriptor[] };
      return data.commands ?? [];
    },

    async execute(token, sessionId, commandId, payload = {}) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/commands/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify({ commandId, ...payload }),
      });
      if (!res.ok) throw new HttpError(`Failed to execute command: ${res.status}`, res.status);
      const data = (await res.json()) as { result?: CommandExecutionResult };
      return data.result ?? { events: [] };
    },
  };
}
