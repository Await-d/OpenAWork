import { HttpError } from './sessions.js';

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

async function readJsonErrorData<T>(response: Response): Promise<T | undefined> {
  const data = (await response.json().catch(() => null)) as T | null;
  return data ?? undefined;
}

export function createQuestionsClient(gatewayUrl: string): QuestionsClient {
  return {
    async listPending(token, sessionId, options) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/questions/pending`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        const data = await readJsonErrorData<{ error?: string }>(res);
        throw new HttpError(`Failed to list pending questions: ${res.status}`, res.status, data);
      }
      const data = (await res.json()) as { requests?: PendingQuestionRequest[] };
      return data.requests ?? [];
    },

    async reply(token, sessionId, payload) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/questions/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await readJsonErrorData<{ error?: string }>(res);
        throw new HttpError(`Failed to reply question request: ${res.status}`, res.status, data);
      }
    },
  };
}
