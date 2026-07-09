import { afterEach, describe, expect, it, vi } from 'vitest';

import { RESOURCE_USAGE_DEFAULTS, createResourcesClient } from './resources.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('resource usage defaults', () => {
  it('按资源 area 契约回填缺失的用途字段', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          resources: {
            skills: [{ id: 'skill-1', name: 'skill-1', description: 'skill', path: 'skill.md' }],
            agents: [{ id: 'agent-1', name: 'agent-1', description: 'agent', path: 'agent.md' }],
            agentTemplates: [
              {
                id: 'template-1',
                name: 'AGENTS',
                description: 'template',
                path: 'AGENTS.md',
                content: '# AGENTS',
              },
            ],
            commands: [
              {
                id: 'command-1',
                name: 'review',
                description: 'command',
                path: 'review.md',
                content: '# review',
              },
            ],
            souls: [
              {
                id: 'soul-1',
                name: 'balanced',
                description: 'soul',
                path: 'soul.md',
                content: '# soul',
              },
            ],
            prompts: [
              {
                id: 'prompt-1',
                name: 'prompt',
                description: 'prompt',
                path: 'prompt.md',
                content: '# prompt',
              },
            ],
            extensions: [
              {
                id: 'extension-1',
                name: 'extension',
                description: 'extension',
                path: 'extension',
                files: [],
              },
            ],
            mcps: [{ id: 'mcp-1', name: 'mcp', description: 'mcp', path: 'mcp.json' }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const client = createResourcesClient('http://localhost:3000');
    const result = await client.listResult('token-123');

    expect(result.ok).toBe(true);
    expect(result.resources.skills[0]).toMatchObject(RESOURCE_USAGE_DEFAULTS.skills);
    expect(result.resources.agents[0]).toMatchObject(RESOURCE_USAGE_DEFAULTS.agents);
    expect(result.resources.agentTemplates[0]).toMatchObject(
      RESOURCE_USAGE_DEFAULTS.agentTemplates,
    );
    expect(result.resources.commands[0]).toMatchObject(RESOURCE_USAGE_DEFAULTS.commands);
    expect(result.resources.souls[0]).toMatchObject(RESOURCE_USAGE_DEFAULTS.souls);
    expect(result.resources.prompts[0]).toMatchObject(RESOURCE_USAGE_DEFAULTS.prompts);
    expect(result.resources.extensions[0]).toMatchObject(RESOURCE_USAGE_DEFAULTS.extensions);
    expect(result.resources.mcps[0]).toMatchObject(RESOURCE_USAGE_DEFAULTS.mcps);
  });
});
