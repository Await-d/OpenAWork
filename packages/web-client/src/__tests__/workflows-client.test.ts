import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowsClient } from '../workflows.js';

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('workflows client metadata support', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists workflow templates with metadata', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, [
        {
          id: 'workflow-1',
          name: '研究团队模板',
          description: 'team-playbook',
          category: 'team-playbook',
          metadata: {
            teamTemplate: {
              defaultProvider: 'claude-code',
              optionalAgentIds: ['atlas'],
              requiredRoles: ['planner', 'researcher'],
            },
          },
          nodes: [],
          edges: [],
        },
      ]),
    );

    const client = createWorkflowsClient('http://gateway.test');
    const templates = await client.listTemplates('token-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(templates[0]?.metadata?.teamTemplate?.defaultProvider).toBe('claude-code');
    expect(templates[0]?.metadata?.teamTemplate?.optionalAgentIds).toEqual(['atlas']);
  });

  it('creates workflow templates with metadata payload', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(201, {
        id: 'workflow-2',
        name: '研究团队模板',
        description: 'team-playbook',
        category: 'team-playbook',
        metadata: {
          teamTemplate: {
            defaultProvider: 'claude-code',
            optionalAgentIds: ['atlas'],
            requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
          },
        },
        nodes: [],
        edges: [],
      }),
    );

    const client = createWorkflowsClient('http://gateway.test');
    const template = await client.createTemplate('token-1', {
      name: '研究团队模板',
      category: 'team-playbook',
      metadata: {
        teamTemplate: {
          defaultProvider: 'claude-code',
          optionalAgentIds: ['atlas'],
          requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
        },
      },
      nodes: [],
      edges: [],
    });

    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    expect(JSON.parse(requestBody as string)).toMatchObject({
      metadata: {
        teamTemplate: {
          defaultProvider: 'claude-code',
          optionalAgentIds: ['atlas'],
        },
      },
    });
    expect(template.metadata?.teamTemplate?.requiredRoles).toEqual([
      'planner',
      'researcher',
      'executor',
      'reviewer',
    ]);
  });
});
