import type { CommandDescriptor, CommandExecutionResult, Message } from '@openAwork/shared';
import { HttpError } from './sessions.js';
import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

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

function buildCommandsActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标命令资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericCommandsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeCommandsError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage((error.data ?? undefined) as JsonErrorData | undefined);
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericCommandsNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performCommandsRequest<T>(input: {
  actionLabel: string;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const res = await input.request();
    if (!res.ok) {
      const data = await readJsonErrorData<JsonErrorData>(res);
      throw new HttpError(
        buildCommandsActionErrorMessage(input.actionLabel, res.status, data),
        res.status,
        data,
      );
    }
    return (await res.json()) as T;
  } catch (error) {
    throw normalizeCommandsError(input.actionLabel, error);
  }
}

export function createCommandsClient(gatewayUrl: string): CommandsClient {
  return {
    async list(token) {
      const data = await performCommandsRequest<{ commands?: CommandDescriptor[] }>({
        actionLabel: '读取命令列表',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/commands`, {
            headers: authHeader(token),
          }),
      });
      return data.commands ?? [];
    },

    async execute(token, sessionId, commandId, payload = {}) {
      const data = await performCommandsRequest<{ result?: CommandExecutionResult }>({
        actionLabel: '执行命令',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/commands/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({ commandId, ...payload }),
          }),
      });
      return data.result ?? { events: [] };
    },
  };
}
