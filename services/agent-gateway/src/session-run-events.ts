import type { RunEvent } from '@openAwork/shared';

type RunEventHandler = (event: RunEvent) => void;

const sessionHandlers = new Map<string, Set<RunEventHandler>>();

export function subscribeSessionRunEvents(sessionId: string, handler: RunEventHandler): () => void {
  const handlers = sessionHandlers.get(sessionId) ?? new Set<RunEventHandler>();
  handlers.add(handler);
  sessionHandlers.set(sessionId, handlers);

  return () => {
    const current = sessionHandlers.get(sessionId);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      sessionHandlers.delete(sessionId);
    }
  };
}

export function publishSessionRunEvent(sessionId: string, event: RunEvent): void {
  const handlers = sessionHandlers.get(sessionId);
  if (!handlers) return;
  handlers.forEach((handler) => {
    handler(event);
  });
}
