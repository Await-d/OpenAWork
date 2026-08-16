export interface ActiveLocalStreamPreservationInput {
  readonly activeSessionId: string | null;
  readonly isStreaming: boolean;
  readonly loadedSessionId?: string | null;
  readonly requestedSessionId: string | null;
}

export function shouldPreserveActiveLocalStream(
  input: ActiveLocalStreamPreservationInput,
): boolean {
  return (
    input.isStreaming &&
    input.requestedSessionId !== null &&
    input.requestedSessionId === (input.loadedSessionId ?? input.activeSessionId)
  );
}
