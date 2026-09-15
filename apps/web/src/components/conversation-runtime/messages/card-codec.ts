import type { AssistantEventPayload } from './message-model.js';

export type StatusTone = 'info' | 'success' | 'warning' | 'error';

export function createAssistantEventCardContent(payload: AssistantEventPayload): string {
  return JSON.stringify({
    source: 'openawork_internal',
    type: 'assistant_event',
    payload,
  });
}

export function parseAssistantEventContent(content: string): AssistantEventPayload | null {
  try {
    const parsed = JSON.parse(content) as {
      payload?: Record<string, unknown>;
      type?: unknown;
    };

    if (parsed?.type !== 'assistant_event') {
      return null;
    }

    const payload = parsed.payload ?? {};
    const kind =
      payload['kind'] === 'agent' ||
      payload['kind'] === 'audit' ||
      payload['kind'] === 'compaction' ||
      payload['kind'] === 'mcp' ||
      payload['kind'] === 'permission' ||
      payload['kind'] === 'skill' ||
      payload['kind'] === 'task' ||
      payload['kind'] === 'tool'
        ? payload['kind']
        : null;
    const status =
      payload['status'] === 'error' ||
      payload['status'] === 'paused' ||
      payload['status'] === 'running' ||
      payload['status'] === 'success'
        ? payload['status']
        : null;

    if (
      !kind ||
      !status ||
      typeof payload['title'] !== 'string' ||
      typeof payload['message'] !== 'string'
    ) {
      return null;
    }

    return {
      kind,
      message: payload['message'],
      requestId: typeof payload['requestId'] === 'string' ? payload['requestId'] : undefined,
      status,
      title: payload['title'],
    };
  } catch {
    return null;
  }
}

export function createStatusCardContent(payload: {
  title: string;
  message: string;
  tone: StatusTone;
}): string {
  return JSON.stringify({
    type: 'status',
    payload,
  });
}

export function createCompactionCardContent(payload: {
  phase?: 'started' | 'completed' | 'failed';
  summary: string;
  title: string;
  trigger: 'manual' | 'automatic';
}): string {
  return JSON.stringify({
    type: 'compaction',
    payload,
  });
}

export function parseCompactionCardContent(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as {
      payload?: Record<string, unknown>;
      type?: unknown;
    };

    if (parsed?.type === 'compaction') {
      const payload = parsed.payload ?? {};
      if (
        typeof payload['title'] !== 'string' ||
        typeof payload['summary'] !== 'string' ||
        (payload['trigger'] !== 'manual' && payload['trigger'] !== 'automatic')
      ) {
        return null;
      }

      return createCompactionCardContent({
        title: payload['title'],
        summary: payload['summary'],
        trigger: payload['trigger'],
        ...(payload['phase'] === 'started' ||
        payload['phase'] === 'completed' ||
        payload['phase'] === 'failed'
          ? { phase: payload['phase'] }
          : {}),
      });
    }

    if (parsed?.type !== 'compaction_marker') {
      return null;
    }

    const payload = parsed.payload ?? {};
    if (typeof payload['summary'] !== 'string') {
      return null;
    }

    return createCompactionCardContent({
      title:
        typeof payload['title'] === 'string' && payload['title'].trim().length > 0
          ? payload['title']
          : 'compact',
      summary: payload['summary'],
      trigger: payload['trigger'] === 'automatic' ? 'automatic' : 'manual',
      ...(payload['phase'] === 'started' ||
      payload['phase'] === 'completed' ||
      payload['phase'] === 'failed'
        ? { phase: payload['phase'] }
        : {}),
    });
  } catch {
    return null;
  }
}
