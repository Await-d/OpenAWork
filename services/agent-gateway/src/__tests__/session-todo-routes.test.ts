import type { FastifyReply, FastifyRequest } from 'fastify';
import type * as TodoToolsModule from '../todo-tools.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TodoItem = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
};

const sqliteGetMock = vi.hoisted(() => vi.fn());
const sqliteAllMock = vi.hoisted(() => vi.fn(() => []));
const sqliteRunMock = vi.hoisted(() => vi.fn());
const listSessionMessagesMock = vi.hoisted(() => vi.fn(() => []));
const listSessionTodosMock = vi.hoisted(() => vi.fn<() => TodoItem[]>(() => []));
const listSessionTodoLanesMock = vi.hoisted(() =>
  vi.fn<() => { main: TodoItem[]; temp: TodoItem[] }>(() => ({ main: [], temp: [] })),
);

function createWorkflowStep() {
  return {
    child: vi.fn(() => createWorkflowStep()),
    fail: vi.fn(),
    succeed: vi.fn(),
  };
}

vi.mock('../auth.js', () => ({
  requireAuth: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { user: { sub: string; email: string } }).user = {
      sub: 'user-1',
      email: 'admin@openAwork.local',
    };
  },
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: true,
  WORKSPACE_ROOT: '/workspace',
  WORKSPACE_ROOTS: ['/workspace'],
  db: {
    exec: vi.fn(),
  },
  sqliteAll: sqliteAllMock,
  sqliteGet: sqliteGetMock,
  sqliteRun: sqliteRunMock,
}));

vi.mock('../session-message-store.js', () => ({
  filterVisibleSessionMessages: vi.fn((messages) => messages),
  listSessionMessages: listSessionMessagesMock,
  truncateSessionMessagesAfter: vi.fn(() => []),
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: vi.fn(() => {
    const step = createWorkflowStep();
    return {
      child: step.child,
      fail: step.fail,
      step,
      succeed: step.succeed,
    };
  }),
}));

vi.mock('../todo-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof TodoToolsModule>();
  return {
    ...actual,
    listSessionTodoLanes: listSessionTodoLanesMock,
    listSessionTodos: listSessionTodosMock,
  };
});

describe('session todo routes', () => {
  beforeEach(() => {
    vi.resetModules();
    sqliteGetMock.mockReset();
    sqliteAllMock.mockReset();
    sqliteRunMock.mockReset();
    listSessionMessagesMock.mockReset();
    listSessionTodosMock.mockReset();
    listSessionTodoLanesMock.mockReset();
    listSessionMessagesMock.mockReturnValue([]);
    sqliteAllMock.mockReturnValue([]);
  });

  it('returns ordered todos both from session detail and the dedicated todo route', async () => {
    const sessionRow = {
      id: 'session-1',
      messages_json: '[]',
      state_status: 'idle',
      metadata_json: '{}',
      title: null,
      created_at: '2026-03-26T00:00:00.000Z',
      updated_at: '2026-03-26T00:00:00.000Z',
    };
    sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM sessions')) {
        return sessionRow;
      }
      return { id: 'session-1' };
    });
    listSessionTodosMock.mockReturnValue([
      { content: 'Inspect gateway sandbox', status: 'in_progress', priority: 'high' },
      { content: 'Add tests', status: 'pending', priority: 'medium' },
    ]);

    const [{ default: Fastify }, { sessionsRoutes }] = await Promise.all([
      import('fastify'),
      import('../routes/sessions.js'),
    ]);

    const app = Fastify();
    await app.register(sessionsRoutes);
    await app.ready();

    const getSessionRes = await app.inject({ method: 'GET', url: '/sessions/session-1' });
    const getTodosRes = await app.inject({ method: 'GET', url: '/sessions/session-1/todos' });

    expect(getSessionRes.statusCode).toBe(200);
    expect(getTodosRes.statusCode).toBe(200);
    expect(JSON.parse(getSessionRes.body)).toEqual({
      session: {
        id: 'session-1',
        messages: [],
        metadata_json: '{}',
        state_status: 'idle',
        title: null,
        created_at: '2026-03-26T00:00:00.000Z',
        updated_at: '2026-03-26T00:00:00.000Z',
        runEvents: [],
        fileChangesSummary: {
          snapshotCount: 0,
          sourceKinds: [],
          totalAdditions: 0,
          totalDeletions: 0,
          totalFileDiffs: 0,
        },
        todos: [
          { content: 'Inspect gateway sandbox', status: 'in_progress', priority: 'high' },
          { content: 'Add tests', status: 'pending', priority: 'medium' },
        ],
      },
    });
    expect(JSON.parse(getTodosRes.body)).toEqual({
      todos: [
        { content: 'Inspect gateway sandbox', status: 'in_progress', priority: 'high' },
        { content: 'Add tests', status: 'pending', priority: 'medium' },
      ],
    });

    await app.close();
  });

  it('keeps temp todos hidden from legacy session detail and legacy todo route', async () => {
    const sessionRow = {
      id: 'session-1',
      messages_json: '[]',
      state_status: 'idle',
      metadata_json: '{}',
      title: null,
      created_at: '2026-03-26T00:00:00.000Z',
      updated_at: '2026-03-26T00:00:00.000Z',
    };
    sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM sessions')) {
        return sessionRow;
      }
      return { id: 'session-1' };
    });
    listSessionTodosMock.mockReturnValue([
      { content: '主待办', status: 'pending', priority: 'high' },
    ]);

    const [{ default: Fastify }, { sessionsRoutes }] = await Promise.all([
      import('fastify'),
      import('../routes/sessions.js'),
    ]);

    const app = Fastify();
    await app.register(sessionsRoutes);
    await app.ready();

    const getSessionRes = await app.inject({ method: 'GET', url: '/sessions/session-1' });
    const getTodosRes = await app.inject({ method: 'GET', url: '/sessions/session-1/todos' });

    expect(getSessionRes.statusCode).toBe(200);
    expect(getTodosRes.statusCode).toBe(200);
    expect(JSON.parse(getSessionRes.body).session.todos).toEqual([
      { content: '主待办', status: 'pending', priority: 'high' },
    ]);
    expect(JSON.parse(getTodosRes.body)).toEqual({
      todos: [{ content: '主待办', status: 'pending', priority: 'high' }],
    });

    await app.close();
  });

  it('returns separated lanes from the dedicated todo-lanes route', async () => {
    sqliteGetMock.mockReturnValue({ id: 'session-1' });
    listSessionTodoLanesMock.mockReturnValue({
      main: [{ content: '主待办', status: 'pending', priority: 'high' }],
      temp: [{ content: '临时待办', status: 'pending', priority: 'low' }],
    });

    const [{ default: Fastify }, { sessionsRoutes }] = await Promise.all([
      import('fastify'),
      import('../routes/sessions.js'),
    ]);

    const app = Fastify();
    await app.register(sessionsRoutes);
    await app.ready();

    const getTodoLanesRes = await app.inject({
      method: 'GET',
      url: '/sessions/session-1/todo-lanes',
    });

    expect(getTodoLanesRes.statusCode).toBe(200);
    expect(JSON.parse(getTodoLanesRes.body)).toEqual({
      main: [{ content: '主待办', status: 'pending', priority: 'high' }],
      temp: [{ content: '临时待办', status: 'pending', priority: 'low' }],
    });

    await app.close();
  });
});
