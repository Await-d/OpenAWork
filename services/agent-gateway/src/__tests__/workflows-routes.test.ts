import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteGetMock, sqliteRunMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
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
  sqliteGet: sqliteGetMock,
  sqliteRun: sqliteRunMock,
}));

vi.mock('../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: vi.fn(),
}));

import { workflowRoutes } from '../routes/workflows.js';

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();
  sqliteAllMock.mockReturnValue([
    {
      id: 'workflow-1',
      name: '研究团队模板',
      description: 'team-playbook',
      category: 'team-playbook',
      metadata_json: JSON.stringify({
        teamTemplate: {
          defaultProvider: 'claude-code',
          optionalAgentIds: ['atlas'],
          requiredRoles: ['planner', 'researcher'],
        },
      }),
      nodes_json: '[]',
      edges_json: '[]',
      created_at: '2026-04-16 00:00:00',
      updated_at: '2026-04-16 00:00:00',
    },
  ]);
  sqliteGetMock.mockReturnValue({ id: 'workflow-1' });

  app = Fastify();
  app.decorateRequest('user', {
    getter() {
      return { sub: 'user-1', email: 'owner@openawork.local' };
    },
  });
  await app.register(workflowRoutes);
  await app.ready();
});

describe('workflowRoutes metadata support', () => {
  it('lists workflow templates with metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/workflows/templates' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({
        category: 'team-playbook',
        metadata: {
          teamTemplate: {
            defaultProvider: 'claude-code',
            optionalAgentIds: ['atlas'],
            requiredRoles: ['planner', 'researcher'],
          },
        },
      }),
    ]);
  });

  it('creates workflow templates with metadata_json persisted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workflows/templates',
      payload: {
        name: '研究团队模板',
        category: 'team-playbook',
        metadata: {
          teamTemplate: {
            defaultBindings: {
              planner: 'oracle',
              researcher: 'librarian',
              executor: 'hephaestus',
              reviewer: 'momus',
            },
            defaultProvider: 'claude-code',
            optionalAgentIds: ['atlas'],
            requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
          },
        },
        nodes: [],
        edges: [],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(sqliteRunMock).toHaveBeenCalled();
    expect(sqliteRunMock.mock.calls[0]?.[1]?.[5]).toBe(
      JSON.stringify({
        teamTemplate: {
          defaultBindings: {
            planner: 'oracle',
            researcher: 'librarian',
            executor: 'hephaestus',
            reviewer: 'momus',
          },
          defaultProvider: 'claude-code',
          optionalAgentIds: ['atlas'],
          requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
        },
      }),
    );
    expect(res.json()).toEqual(
      expect.objectContaining({
        metadata: {
          teamTemplate: {
            defaultBindings: {
              planner: 'oracle',
              researcher: 'librarian',
              executor: 'hephaestus',
              reviewer: 'momus',
            },
            defaultProvider: 'claude-code',
            optionalAgentIds: ['atlas'],
            requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
          },
        },
      }),
    );
  });

  it('normalizes team-playbook template bindings to the fixed system defaults', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workflows/templates',
      payload: {
        name: '缺失默认绑定模板',
        category: 'team-playbook',
        metadata: {
          teamTemplate: {
            defaultBindings: {
              planner: 'oracle',
              researcher: 'librarian',
              executor: 'hephaestus',
            },
            defaultProvider: 'claude-code',
            optionalAgentIds: ['atlas'],
            requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
          },
        },
        nodes: [],
        edges: [],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(sqliteRunMock).toHaveBeenCalled();
    expect(JSON.parse(String(sqliteRunMock.mock.calls.at(-1)?.[1]?.[5]))).toEqual(
      expect.objectContaining({
        teamTemplate: expect.objectContaining({
          defaultBindings: {
            planner: 'oracle',
            researcher: 'librarian',
            executor: 'hephaestus',
            reviewer: 'momus',
          },
          requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
        }),
      }),
    );
  });
});
