import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqliteGetMock = vi.fn();

vi.mock('@openAwork/shared', () => ({
  REFERENCE_AGENT_ROLE_METADATA: {
    oracle: {
      canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
      aliases: ['architect', 'debugger', 'code-reviewer', 'init-architect'],
    },
    explore: {
      canonicalRole: { coreRole: 'researcher', preset: 'explore', confidence: 'high' },
      aliases: ['explorer'],
    },
  },
}));

vi.mock('../db.js', () => ({
  sqliteGet: sqliteGetMock,
  WORKSPACE_ACCESS_RESTRICTED: true,
  WORKSPACE_ROOT: tmpdir(),
  WORKSPACE_ROOTS: [tmpdir()],
}));

vi.mock('../auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../routes/command-descriptors.js', () => ({
  buildCommandDescriptors: () => [],
}));

vi.mock('../tool-definitions.js', () => ({
  buildGatewayToolDefinitions: () => [
    {
      type: 'function',
      function: {
        name: 'list',
        description: 'list alias',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'webfetch',
        description: 'webfetch tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'read alias',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'glob',
        description: 'glob tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit',
        description: 'edit tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'batch',
        description: 'batch tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill',
        description: 'skill tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'bash',
        description: 'bash tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'apply_patch',
        description: 'apply patch tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'question',
        description: 'question tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'task',
        description: 'task tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'background_output',
        description: 'background output tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'background_cancel',
        description: 'background cancel tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep',
        description: 'grep alias',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'write',
        description: 'write alias',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'websearch',
        description: 'websearch alias',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
    {
      type: 'function',
      function: {
        name: 'lsp_diagnostics',
        description: 'lsp diagnostics',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
    },
  ],
}));

vi.mock('@openAwork/skills', () => ({
  BUILTIN_SKILLS: [],
}));

describe('listCapabilitiesForUser', () => {
  beforeEach(() => {
    sqliteGetMock.mockReset();
    sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('installed_skills')) {
        return { value: '[]' };
      }

      if (query.includes("key = 'mcp_servers'")) {
        return { value: '[]' };
      }

      if (query.includes("key = 'agent_catalog'")) {
        return undefined;
      }

      if (query.includes("key = 'agent_preferences'")) {
        return undefined;
      }

      return undefined;
    });
  });

  it('prefers runtime tools over same-name reference entries', async () => {
    const { listCapabilitiesForUser } = await import('../routes/capabilities.js');

    const capabilities = listCapabilitiesForUser('user-1');
    const listTools = capabilities.filter((item) => item.kind === 'tool' && item.label === 'list');
    const webfetchTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'webfetch',
    );
    const readTools = capabilities.filter((item) => item.kind === 'tool' && item.label === 'read');
    const globTools = capabilities.filter((item) => item.kind === 'tool' && item.label === 'glob');
    const editTools = capabilities.filter((item) => item.kind === 'tool' && item.label === 'edit');
    const batchTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'batch',
    );
    const skillTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'skill',
    );
    const bashTools = capabilities.filter((item) => item.kind === 'tool' && item.label === 'bash');
    const applyPatchTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'apply_patch',
    );
    const questionTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'question',
    );
    const taskTools = capabilities.filter((item) => item.kind === 'tool' && item.label === 'task');
    const backgroundOutputTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'background_output',
    );
    const backgroundCancelTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'background_cancel',
    );
    const grepTools = capabilities.filter((item) => item.kind === 'tool' && item.label === 'grep');
    const writeTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'write',
    );
    const websearchTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'websearch',
    );
    const lspDiagnosticsTools = capabilities.filter(
      (item) => item.kind === 'tool' && item.label === 'lsp_diagnostics',
    );

    expect(listTools).toHaveLength(1);
    expect(listTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(webfetchTools).toHaveLength(1);
    expect(webfetchTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(readTools).toHaveLength(1);
    expect(readTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(globTools).toHaveLength(1);
    expect(globTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(editTools).toHaveLength(1);
    expect(editTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(batchTools).toHaveLength(1);
    expect(batchTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(skillTools).toHaveLength(1);
    expect(skillTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(bashTools).toHaveLength(1);
    expect(bashTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(applyPatchTools).toHaveLength(1);
    expect(applyPatchTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(questionTools).toHaveLength(1);
    expect(questionTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(taskTools).toHaveLength(1);
    expect(taskTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(backgroundOutputTools).toHaveLength(1);
    expect(backgroundOutputTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(backgroundCancelTools).toHaveLength(1);
    expect(backgroundCancelTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(grepTools).toHaveLength(1);
    expect(grepTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(writeTools).toHaveLength(1);
    expect(writeTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(websearchTools).toHaveLength(1);
    expect(websearchTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(lspDiagnosticsTools).toHaveLength(1);
    expect(lspDiagnosticsTools[0]).toMatchObject({ source: 'runtime', callable: true });
    expect(
      capabilities.filter((item) => item.kind === 'tool' && item.label === 'apply_patch'),
    ).toHaveLength(1);
  });

  it('exposes canonical role metadata for built-in reference agents', async () => {
    const { listCapabilitiesForUser } = await import('../routes/capabilities.js');

    const capabilities = listCapabilitiesForUser('user-1');
    const oracle = capabilities.find((item) => item.kind === 'agent' && item.label === 'oracle');
    const explore = capabilities.find((item) => item.kind === 'agent' && item.label === 'explore');

    expect(oracle).toMatchObject({
      canonicalRole: {
        coreRole: 'planner',
        preset: 'architect',
        confidence: 'medium',
      },
    });
    expect(oracle?.aliases).toEqual(
      expect.arrayContaining(['architect', 'debugger', 'code-reviewer']),
    );
    expect(explore).toMatchObject({
      canonicalRole: {
        coreRole: 'researcher',
        preset: 'explore',
        confidence: 'high',
      },
    });
  });

  it('filters session-disabled tools when a sessionId is provided', async () => {
    sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('installed_skills')) {
        return { value: '[]' };
      }

      if (query.includes("key = 'mcp_servers'")) {
        return { value: '[]' };
      }

      if (query.includes('FROM sessions WHERE id = ? AND user_id = ? LIMIT 1')) {
        return {
          metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'parent-1' }),
        };
      }

      return undefined;
    });

    const { listCapabilitiesForUser } = await import('../routes/capabilities.js');
    const capabilities = listCapabilitiesForUser('user-1', 'child-session-1');

    expect(capabilities.some((item) => item.kind === 'tool' && item.label === 'task')).toBe(false);
    expect(capabilities.some((item) => item.kind === 'tool' && item.label === 'question')).toBe(
      false,
    );
    expect(capabilities.some((item) => item.kind === 'tool' && item.label === 'read')).toBe(true);
  });

  it('includes enabled custom agents and omits disabled builtin agents', async () => {
    sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('installed_skills')) {
        return { value: '[]' };
      }

      if (query.includes("key = 'mcp_servers'")) {
        return { value: '[]' };
      }

      if (query.includes("key = 'agent_catalog'")) {
        return {
          value: JSON.stringify({
            builtinOverrides: {
              oracle: { enabled: false, updatedAt: '2026-03-26T00:00:00.000Z' },
            },
            customAgents: {
              'custom-debugger': {
                id: 'custom-debugger',
                enabled: true,
                createdAt: '2026-03-26T00:00:00.000Z',
                updatedAt: '2026-03-26T00:00:00.000Z',
                current: {
                  label: '自定义调试助手',
                  description: '用于排查复杂问题',
                  aliases: ['debug-pro'],
                  canonicalRole: {
                    coreRole: 'executor',
                    preset: 'debugger',
                    confidence: 'high',
                  },
                },
                defaultBody: {
                  label: '自定义调试助手',
                  description: '用于排查复杂问题',
                  aliases: ['debug-pro'],
                  canonicalRole: {
                    coreRole: 'executor',
                    preset: 'debugger',
                    confidence: 'high',
                  },
                },
              },
            },
          }),
        };
      }

      return undefined;
    });

    const { listCapabilitiesForUser } = await import('../routes/capabilities.js');
    const capabilities = listCapabilitiesForUser('user-1');

    expect(capabilities.some((item) => item.kind === 'agent' && item.id === 'oracle')).toBe(false);
    expect(
      capabilities.some(
        (item) =>
          item.kind === 'agent' &&
          item.id === 'custom-debugger' &&
          item.source === 'custom' &&
          item.label === '自定义调试助手',
      ),
    ).toBe(true);
  });
});
