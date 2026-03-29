// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  publishSessionPendingPermission,
  subscribeSessionPendingPermission,
  type SessionPendingPermissionState,
} from './session-list-events.js';

function buildPermission(requestId: string): SessionPendingPermissionState {
  return {
    requestId,
    toolName: 'bash',
    scope: 'workspace:/repo',
    reason: '执行命令',
    riskLevel: 'high',
    targetSessionId: 'child-session',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('publishSessionPendingPermission', () => {
  it('coalesces same-session updates within the same microtask', async () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSessionPendingPermission(onChange);

    publishSessionPendingPermission('session-1', buildPermission('req-1'));
    publishSessionPendingPermission('session-1', buildPermission('req-2'));

    await Promise.resolve();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('session-1', buildPermission('req-2'));

    unsubscribe();
  });

  it('keeps separate sessions isolated when batching updates', async () => {
    const seen: Array<{ sessionId: string; requestId: string | null }> = [];
    const unsubscribe = subscribeSessionPendingPermission((sessionId, permission) => {
      seen.push({ sessionId, requestId: permission?.requestId ?? null });
    });

    publishSessionPendingPermission('session-1', buildPermission('req-1'));
    publishSessionPendingPermission('session-2', buildPermission('req-2'));

    await Promise.resolve();

    expect(seen).toEqual([
      { sessionId: 'session-1', requestId: 'req-1' },
      { sessionId: 'session-2', requestId: 'req-2' },
    ]);

    unsubscribe();
  });
});
