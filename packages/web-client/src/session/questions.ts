import { HttpError } from './sessions.js';
import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

export interface PendingQuestionOption {
  label: string;
  description: string;
}

export interface PendingQuestionItem {
  header: string;
  multiple?: boolean;
  options: PendingQuestionOption[];
  question: string;
}

export interface PendingQuestionRequest {
  createdAt: string;
  questions: PendingQuestionItem[];
  requestId: string;
  sessionId: string;
  status: 'pending' | 'answered' | 'dismissed';
  title: string;
  toolName: string;
}

export interface QuestionsClient {
  listPending(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PendingQuestionRequest[]>;
  reply(
    token: string,
    sessionId: string,
    payload: { answers?: string[][]; requestId: string; status: 'answered' | 'dismissed' },
  ): Promise<void>;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function buildQuestionsActionErrorMessage(
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
    return `目标问题请求资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericQuestionsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeQuestionsError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericQuestionsNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performQuestionsRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const res = await input.request();
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as JsonErrorData | null;
      throw new HttpError(
        buildQuestionsActionErrorMessage(input.actionLabel, res.status, data ?? undefined),
        res.status,
        data ?? undefined,
      );
    }
    if (input.parseJson === false || res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  } catch (error) {
    throw normalizeQuestionsError(input.actionLabel, error);
  }
}

export function createQuestionsClient(gatewayUrl: string): QuestionsClient {
  return {
    async listPending(token, sessionId, options) {
      const data = await performQuestionsRequest<{ requests?: PendingQuestionRequest[] }>({
        actionLabel: '读取待处理问题请求',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/questions/pending`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.requests ?? [];
    },

    async reply(token, sessionId, payload) {
      await performQuestionsRequest({
        actionLabel: '回复问题请求',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/questions/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify(payload),
          }),
      });
    },
  };
}
