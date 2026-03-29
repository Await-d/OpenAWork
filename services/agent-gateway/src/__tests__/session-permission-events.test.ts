import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqliteAllMock = vi.fn();

vi.mock('../db.js', () => ({
  sqliteAll: sqliteAllMock,
}));

describe('session permission events', () => {
  beforeEach(() => {
    sqliteAllMock.mockReset();
  });

  it('maps stored permission rows into asked and replied run events', async () => {
    sqliteAllMock.mockReturnValue([
      {
        id: 'perm-1',
        session_id: 'session-1',
        tool_name: 'bash',
        scope: 'workspace',
        reason: '需要运行命令',
        risk_level: 'medium',
        preview_action: 'pnpm test',
        status: 'approved',
        decision: 'once',
        created_at: '2026-03-24T00:00:00.000Z',
        updated_at: '2026-03-24T00:01:00.000Z',
      },
    ]);

    const { listSessionPermissionRunEvents } = await import('../session-permission-events.js');
    const events = listSessionPermissionRunEvents('session-1');

    expect(events).toEqual([
      {
        type: 'permission_asked',
        requestId: 'perm-1',
        toolName: 'bash',
        scope: 'workspace',
        reason: '需要运行命令',
        riskLevel: 'medium',
        previewAction: 'pnpm test',
        eventId: 'permission:perm-1:asked',
        runId: 'permission:perm-1',
        occurredAt: Date.parse('2026-03-24T00:00:00.000Z'),
      },
      {
        type: 'permission_replied',
        requestId: 'perm-1',
        decision: 'once',
        eventId: 'permission:perm-1:replied',
        runId: 'permission:perm-1',
        occurredAt: Date.parse('2026-03-24T00:01:00.000Z'),
      },
    ]);
  });

  it('omits replied events for still-pending permission requests', async () => {
    sqliteAllMock.mockReturnValue([
      {
        id: 'perm-2',
        session_id: 'session-1',
        tool_name: 'read',
        scope: 'file',
        reason: '需要读取文件',
        risk_level: 'low',
        preview_action: null,
        status: 'pending',
        decision: null,
        created_at: '2026-03-24T00:02:00.000Z',
        updated_at: '2026-03-24T00:02:00.000Z',
      },
    ]);

    const { listSessionPermissionRunEvents } = await import('../session-permission-events.js');
    const events = listSessionPermissionRunEvents('session-1');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'permission_asked', requestId: 'perm-2' });
  });
});
