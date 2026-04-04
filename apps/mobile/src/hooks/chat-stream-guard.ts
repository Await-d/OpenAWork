export function buildChatStreamToken(
  sessionId: string | undefined,
  requestVersion: number,
): string {
  return `${sessionId ?? 'no-session'}:${requestVersion}`;
}

export function shouldApplyChatSessionMutation(options: {
  currentSessionId: string | undefined;
  mounted: boolean;
  requestSessionId: string | undefined;
}): boolean {
  return options.mounted && options.currentSessionId === options.requestSessionId;
}

export function shouldApplyChatStreamMutation(options: {
  activeToken: string | null;
  callbackToken: string;
  currentSessionId: string | undefined;
  mounted: boolean;
  requestSessionId: string | undefined;
}): boolean {
  return (
    shouldApplyChatSessionMutation({
      currentSessionId: options.currentSessionId,
      mounted: options.mounted,
      requestSessionId: options.requestSessionId,
    }) && options.activeToken === options.callbackToken
  );
}
