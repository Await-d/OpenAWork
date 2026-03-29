import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteRunMock, sqliteGetMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  sqliteGetMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({ requireAuth: async () => undefined }));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    workflowLogger: { succeed: () => undefined, fail: () => undefined },
    step: { succeed: () => undefined, fail: () => undefined },
    child: () => ({ succeed: () => undefined, fail: () => undefined }),
  }),
}));

vi.mock('../db.js', () => ({
  sqliteAll: sqliteAllMock,
  sqliteRun: sqliteRunMock,
  sqliteGet: sqliteGetMock,
}));

import { teamRoutes } from '../routes/team.js';

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();
  sqliteAllMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM team_tasks')) {
      return [
        {
          id: 'task-1',
          title: '实现协同状态流',
          assignee_id: null,
          status: 'pending',
          priority: 'high',
          result: null,
          created_at: '2026-03-22T00:00:00.000Z',
          updated_at: '2026-03-22T00:00:00.000Z',
        },
      ];
    }
    if (sql.includes('FROM team_messages')) {
      return [
        {
          id: 'msg-1',
          sender_id: 'member-1',
          content: '任务已认领',
          type: 'update',
          created_at: '2026-03-22T00:00:00.000Z',
        },
      ];
    }
    return [];
  });
  sqliteGetMock.mockReturnValue({ id: 'task-1' });

  app = Fastify();
  app.decorateRequest('user', {
    getter() {
      return { sub: 'user-1' };
    },
  });
  await app.register(teamRoutes);
  await app.ready();
});

describe('teamRoutes collaboration slice', () => {
  it('updates a team task with assignee/status/result', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/tasks/task-1',
      payload: {
        assigneeId: 'member-1',
        status: 'in_progress',
        result: '开始处理',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sqliteRunMock).toHaveBeenCalled();
  });

  it('creates a typed team message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/team/messages',
      payload: {
        senderId: 'member-1',
        content: '我来认领这个任务',
        type: 'question',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(sqliteRunMock).toHaveBeenCalled();
  });

  it('returns shared-ui-compatible creation payloads', async () => {
    const taskRes = await app.inject({
      method: 'POST',
      url: '/team/tasks',
      payload: {
        title: '实现协同状态流',
        priority: 'high',
        status: 'pending',
      },
    });
    const messageRes = await app.inject({
      method: 'POST',
      url: '/team/messages',
      payload: {
        senderId: 'member-1',
        content: '我来认领这个任务',
        type: 'question',
      },
    });

    expect(JSON.parse(taskRes.body)).toMatchObject({
      title: '实现协同状态流',
      status: 'pending',
      result: null,
    });
    expect(JSON.parse(messageRes.body)).toMatchObject({
      id: expect.any(String),
      memberId: 'member-1',
      type: 'question',
      timestamp: expect.any(Number),
    });
  });
});
