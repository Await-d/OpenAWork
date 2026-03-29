import { describe, expect, it, vi } from 'vitest';
import type {
  PendingPermissionRequest,
  Session,
  SessionTask,
  SessionTodoLanes,
} from '@openAwork/web-client';

const getChildrenMock = vi.fn();
const getTasksMock = vi.fn();
const getTodoLanesMock = vi.fn();
const listPendingMock = vi.fn();

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({
    getChildren: getChildrenMock,
    getTasks: getTasksMock,
    getTodoLanes: getTodoLanesMock,
  }),
  createPermissionsClient: () => ({
    listPending: listPendingMock,
  }),
}));

import { fetchSessionRuntimeSnapshot, toSessionPendingPermissionState } from './session-runtime.js';

function createPermission(
  overrides: Partial<PendingPermissionRequest> = {},
): PendingPermissionRequest {
  return {
    requestId: overrides.requestId ?? 'req-parent',
    sessionId: overrides.sessionId ?? 'session-parent',
    toolName: overrides.toolName ?? 'bash',
    reason: overrides.reason ?? '执行命令',
    scope: overrides.scope ?? 'workspace:/repo',
    riskLevel: overrides.riskLevel ?? 'medium',
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? '2026-03-28T00:00:00.000Z',
    previewAction: overrides.previewAction,
    decision: overrides.decision,
  };
}

describe('session-runtime', () => {
  it('aggregates pending permissions from the parent and child sessions', async () => {
    getTodoLanesMock.mockResolvedValue({ main: [], temp: [] } satisfies SessionTodoLanes);
    getChildrenMock.mockResolvedValue([{ id: 'child-1', title: '子代理' } satisfies Session]);
    getTasksMock.mockResolvedValue([] as SessionTask[]);
    listPendingMock
      .mockResolvedValueOnce([
        createPermission({ requestId: 'req-parent', sessionId: 'session-parent' }),
      ])
      .mockResolvedValueOnce([createPermission({ requestId: 'req-child', sessionId: 'child-1' })]);

    const snapshot = await fetchSessionRuntimeSnapshot({
      gatewayUrl: 'http://gateway',
      sessionId: 'session-parent',
      token: 'token-123',
    });

    expect(snapshot.pendingPermissionsResult.status).toBe('fulfilled');
    if (snapshot.pendingPermissionsResult.status !== 'fulfilled') {
      throw new Error('expected fulfilled pending permissions result');
    }

    expect(
      snapshot.pendingPermissionsResult.value.map((permission) => permission.requestId),
    ).toEqual(['req-child', 'req-parent']);
    expect(listPendingMock).toHaveBeenNthCalledWith(1, 'token-123', 'session-parent', {
      signal: undefined,
    });
    expect(listPendingMock).toHaveBeenNthCalledWith(2, 'token-123', 'child-1', {
      signal: undefined,
    });
  });

  it('exposes the target session id for permission replies', () => {
    const permissionState = toSessionPendingPermissionState([
      createPermission({ requestId: 'req-child', sessionId: 'child-1' }),
    ]);

    expect(permissionState).toMatchObject({
      requestId: 'req-child',
      targetSessionId: 'child-1',
      toolName: 'bash',
    });
  });
});
