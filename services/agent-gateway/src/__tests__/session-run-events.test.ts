import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  sqliteAllMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteAll: mocks.sqliteAllMock,
}));

import { publishSessionRunEvent, subscribeSessionRunEvents } from '../session-run-events.js';

describe('session run events', () => {
  it('publishes events to active subscribers and stops after unsubscribe', () => {
    mocks.sqliteGetMock.mockReturnValue({ user_id: 'user-a' });
    const handler = vi.fn();
    const unsubscribe = subscribeSessionRunEvents('session-1', handler);

    publishSessionRunEvent('session-1', {
      type: 'permission_asked',
      requestId: 'perm-1',
      toolName: 'bash',
      scope: 'workspace',
      reason: '需要运行命令',
      riskLevel: 'medium',
    });

    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    publishSessionRunEvent('session-1', {
      type: 'permission_replied',
      requestId: 'perm-1',
      decision: 'once',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(2);
  });
});
