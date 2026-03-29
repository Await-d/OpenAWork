export interface InFlightStreamRequestEntry {
  abortController: AbortController;
  clientRequestId: string;
  execution: Promise<{ statusCode: number }>;
  userId: string;
}

const inFlightStreamRequests = new Map<string, InFlightStreamRequestEntry>();

function getStreamRequestKey(sessionId: string, clientRequestId: string): string {
  return `${sessionId}:${clientRequestId}`;
}

export function getInFlightStreamRequest(
  sessionId: string,
  clientRequestId: string,
): InFlightStreamRequestEntry | undefined {
  return inFlightStreamRequests.get(getStreamRequestKey(sessionId, clientRequestId));
}

export function registerInFlightStreamRequest(input: {
  abortController: AbortController;
  clientRequestId: string;
  execution: Promise<{ statusCode: number }>;
  sessionId: string;
  userId: string;
}): void {
  inFlightStreamRequests.set(getStreamRequestKey(input.sessionId, input.clientRequestId), {
    abortController: input.abortController,
    clientRequestId: input.clientRequestId,
    execution: input.execution,
    userId: input.userId,
  });
}

export function getAnyInFlightStreamRequestForSession(input: {
  excludeClientRequestId?: string;
  sessionId: string;
  userId: string;
}): InFlightStreamRequestEntry | undefined {
  for (const [key, entry] of inFlightStreamRequests.entries()) {
    if (!key.startsWith(`${input.sessionId}:`) || entry.userId !== input.userId) {
      continue;
    }

    if (input.excludeClientRequestId && entry.clientRequestId === input.excludeClientRequestId) {
      continue;
    }

    return entry;
  }

  return undefined;
}

export function clearInFlightStreamRequest(input: {
  clientRequestId: string;
  execution: Promise<{ statusCode: number }>;
  sessionId: string;
}): void {
  const key = getStreamRequestKey(input.sessionId, input.clientRequestId);
  const current = inFlightStreamRequests.get(key);
  if (current?.execution === input.execution) {
    inFlightStreamRequests.delete(key);
  }
}

export async function stopInFlightStreamRequest(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): Promise<boolean> {
  const current = getInFlightStreamRequest(input.sessionId, input.clientRequestId);
  if (!current || current.userId !== input.userId) {
    return false;
  }

  current.abortController.abort();
  await current.execution.catch(() => undefined);
  return true;
}

export async function stopAnyInFlightStreamRequestForSession(input: {
  sessionId: string;
  userId: string;
}): Promise<boolean> {
  const current = getAnyInFlightStreamRequestForSession(input);
  if (!current) {
    return false;
  }

  current.abortController.abort();
  await current.execution.catch(() => undefined);
  return true;
}
