import type { DialogueMode } from '@openAwork/shared';
import { HttpError } from './sessions.js';
import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

/**
 * 用户在界面上显式确认「方案设计完成」并切换到编程模式的结果。
 * `switched: false` 表示会话本来就不在澄清模式（幂等空操作），此时 `dialogueMode`
 * 为服务端当前模式。
 */
export interface ConfirmClarifySwitchResult {
  dialogueMode?: DialogueMode;
  switched: boolean;
}

export interface DialogueModeClient {
  confirmClarifySwitch(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ConfirmClarifySwitchResult>;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function toDialogueMode(value: unknown): DialogueMode | undefined {
  return value === 'clarify' || value === 'coding' || value === 'programmer' ? value : undefined;
}

function buildActionErrorMessage(
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
    return `目标会话不存在，无法${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function normalizeError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericFetchErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

export function createDialogueModeClient(gatewayUrl: string): DialogueModeClient {
  return {
    async confirmClarifySwitch(token, sessionId, options) {
      try {
        const res = await fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/clarify/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(token) },
          signal: options?.signal,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as JsonErrorData | null;
          throw new HttpError(
            buildActionErrorMessage('确认切换到编程模式', res.status, data ?? undefined),
            res.status,
            data ?? undefined,
          );
        }

        const payload = (await res.json().catch(() => null)) as {
          dialogueMode?: unknown;
          ok?: unknown;
          switched?: unknown;
        } | null;
        const dialogueMode = toDialogueMode(payload?.dialogueMode);
        return {
          switched: payload?.switched === true,
          ...(dialogueMode ? { dialogueMode } : {}),
        };
      } catch (error) {
        throw normalizeError('确认切换到编程模式', error);
      }
    },
  };
}
