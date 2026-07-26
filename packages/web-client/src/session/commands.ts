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
  listResult(token: string): Promise<CommandsListResult>;
  execute(
    token: string,
    sessionId: string,
    commandId: string,
    payload?: { executionId?: string; messages?: Message[]; rawInput?: string },
  ): Promise<CommandExecutionResult>;
}

export interface CommandsListResult {
  commands: CommandDescriptor[];
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

const DEFAULT_COMMAND_EXECUTE_TIMEOUT_MS = 120_000;

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

function isRetryableCommandsStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildCommandsListErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取命令列表。';
  }
  return `读取命令列表失败（HTTP ${status}）。`;
}

function normalizeCommandsError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage(
      (error.data ?? undefined) as JsonErrorData | undefined,
    );
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
  const listResult = async (token: string): Promise<CommandsListResult> => {
    try {
      const response = await fetchWithTimeout(`${gatewayUrl}/commands`, {
        headers: authHeader(token),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          commands: [],
          ok: false,
          retryable: isRetryableCommandsStatus(response.status),
          errorMessage: buildCommandsListErrorMessage(response.status, data),
          status: response.status,
        };
      }
      const data = (await response.json()) as { commands?: CommandDescriptor[] };
      return {
        commands: data.commands ?? [],
        ok: true,
        retryable: false,
      };
    } catch (error: unknown) {
      return {
        commands: [],
        ok: false,
        retryable: true,
        errorMessage: normalizeCommandsError('读取命令列表', error).message,
      };
    }
  };

  return {
    async list(token) {
      const result = await listResult(token);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '读取命令列表失败');
      }
      return result.commands;
    },

    listResult,

    async execute(token, sessionId, commandId, payload = {}) {
      const data = await performCommandsRequest<{ result?: CommandExecutionResult }>({
        actionLabel: '执行命令',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/commands/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({ commandId, ...payload }),
            timeoutMs: DEFAULT_COMMAND_EXECUTE_TIMEOUT_MS,
          }),
      });
      return data.result ?? { events: [] };
    },
  };
}
