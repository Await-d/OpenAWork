import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const chatRoutePath = resolve(currentDir, '../../app/chat/[sessionId].tsx');

describe('Expo chat route session guard wiring', () => {
  it('keeps history loading guarded against stale session callbacks', () => {
    const source = readFileSync(chatRoutePath, 'utf8');

    expect(source).toContain('shouldApplyChatSessionMutation');
    expect(source).toContain('buildChatRouteHistoryResetState');
    expect(source).toContain('buildChatRouteHistoryLocalHydrationState');
    expect(source).toContain('buildChatRouteHistoryReadyState');
    expect(source).toContain('const canApplySessionMutation =');
    expect(source).toContain('const applyHistoryState = useCallback(');
    expect(source).toContain('latestSessionIdRef.current = sessionId;');
    expect(source).toContain('if (!canApplySessionMutation(requestSessionId)) {');
    expect(source).toContain(
      'applyHistoryState(buildChatRouteHistoryResetState({ hasSessionId: true }));',
    );
  });
});
