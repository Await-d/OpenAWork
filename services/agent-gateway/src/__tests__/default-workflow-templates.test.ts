import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteRunMock, randomUUIDMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  randomUUIDMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: sqliteAllMock,
  sqliteRun: sqliteRunMock,
}));

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

import {
  DEFAULT_WORKFLOW_TEMPLATE_SEEDS,
  ensureDefaultWorkflowTemplates,
  ensureDefaultWorkflowTemplatesForAllUsers,
} from '../default-workflow-templates.js';

describe('default workflow template seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    randomUUIDMock.mockImplementation(() => `seed-${randomUUIDMock.mock.calls.length + 1}`);
  });

  it('inserts every default development template for a new user', () => {
    sqliteAllMock.mockReturnValue([]);

    ensureDefaultWorkflowTemplates('user-1');

    expect(sqliteAllMock).toHaveBeenCalledWith(
      'SELECT id, metadata_json FROM workflow_templates WHERE user_id = ?',
      ['user-1'],
    );
    expect(sqliteRunMock).toHaveBeenCalledTimes(DEFAULT_WORKFLOW_TEMPLATE_SEEDS.length);

    const insertedMetadata = sqliteRunMock.mock.calls.map(
      (call) =>
        JSON.parse(call[1]?.[5] as string) as {
          origin: string;
          seedKey: string;
          templateKind: string;
        },
    );

    expect(insertedMetadata).toEqual(
      DEFAULT_WORKFLOW_TEMPLATE_SEEDS.map((template) =>
        expect.objectContaining({
          origin: 'seed',
          seedKey: template.seedKey,
          templateKind: 'default-dev',
        }),
      ),
    );
  });

  it('ships complete default bindings for every core role in each seed template', () => {
    for (const template of DEFAULT_WORKFLOW_TEMPLATE_SEEDS) {
      expect(template.metadata.teamTemplate.defaultBindings).toMatchObject({
        leader: expect.objectContaining({ agentId: expect.any(String) }),
        planner: expect.objectContaining({ agentId: expect.any(String) }),
        researcher: expect.objectContaining({ agentId: expect.any(String) }),
        executor: expect.objectContaining({ agentId: expect.any(String) }),
        reviewer: expect.objectContaining({ agentId: expect.any(String) }),
      });
    }
  });

  it('populates nodes and edges for every seed template', () => {
    for (const template of DEFAULT_WORKFLOW_TEMPLATE_SEEDS) {
      expect(template.nodes.length).toBeGreaterThan(0);
      expect(template.edges.length).toBeGreaterThan(0);
      // Should have start, one subagent per required role, and end nodes
      const requiredCount = template.metadata.teamTemplate.requiredRoles.length;
      expect(template.nodes.filter((n) => n.type === 'subagent')).toHaveLength(requiredCount);
      expect(template.nodes[0]?.type).toBe('start');
      expect(template.nodes[template.nodes.length - 1]?.type).toBe('end');
      // Edges should connect sequentially: start → role1 → ... → end
      expect(template.edges).toHaveLength(requiredCount + 1);
    }
  });

  it('ships distinct template scales and use-case metadata for default development templates', () => {
    expect(
      DEFAULT_WORKFLOW_TEMPLATE_SEEDS.map(
        (template) => template.metadata.teamTemplate.templateScale,
      ),
    ).toEqual(['full', 'large', 'medium', 'small']);
    expect(
      DEFAULT_WORKFLOW_TEMPLATE_SEEDS.map(
        (template) => template.metadata.teamTemplate.recommendedFor,
      ),
    ).toEqual([
      expect.stringContaining('复杂跨模块'),
      expect.stringContaining('复杂功能开发'),
      expect.stringContaining('常规功能开发'),
      expect.stringContaining('小需求'),
    ]);
    expect(
      DEFAULT_WORKFLOW_TEMPLATE_SEEDS.map(
        (template) => template.metadata.teamTemplate.templatePriority,
      ),
    ).toEqual([2, 4, 1, 3]);
    expect(
      DEFAULT_WORKFLOW_TEMPLATE_SEEDS.filter(
        (template) => template.metadata.teamTemplate.recommendedDefault,
      ).map((template) => template.seedKey),
    ).toEqual(['dev-team-medium']);
  });

  it('updates seeded templates in place when matching seed keys already exist', () => {
    sqliteAllMock.mockReturnValue([
      {
        id: 'existing-full',
        metadata_json: JSON.stringify({ seedKey: 'dev-team-full', origin: 'seed' }),
      },
      {
        id: 'existing-small',
        metadata_json: JSON.stringify({ seedKey: 'dev-team-small', origin: 'seed' }),
      },
    ]);

    ensureDefaultWorkflowTemplates('user-1');

    const updateCalls = sqliteRunMock.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('UPDATE workflow_templates'),
    );
    const insertCalls = sqliteRunMock.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO workflow_templates'),
    );

    expect(updateCalls).toHaveLength(2);
    expect(insertCalls).toHaveLength(DEFAULT_WORKFLOW_TEMPLATE_SEEDS.length - 2);
    expect(updateCalls.map((call) => call[1]?.[6])).toEqual(['existing-full', 'existing-small']);
  });

  it('backfills default templates for every existing user', () => {
    sqliteAllMock
      .mockReturnValueOnce([{ id: 'user-1' }, { id: 'user-2' }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    ensureDefaultWorkflowTemplatesForAllUsers();

    expect(sqliteAllMock).toHaveBeenNthCalledWith(1, 'SELECT id FROM users');
    expect(sqliteAllMock).toHaveBeenNthCalledWith(
      2,
      'SELECT id, metadata_json FROM workflow_templates WHERE user_id = ?',
      ['user-1'],
    );
    expect(sqliteAllMock).toHaveBeenNthCalledWith(
      3,
      'SELECT id, metadata_json FROM workflow_templates WHERE user_id = ?',
      ['user-2'],
    );
    expect(sqliteRunMock).toHaveBeenCalledTimes(DEFAULT_WORKFLOW_TEMPLATE_SEEDS.length * 2);
  });
});
