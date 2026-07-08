import { describe, expect, it } from 'vitest';

import { mergeBuiltinAndConfiguredMcps } from '../../mcp/builtin-mcps.js';
import { isSystemMcpServer } from '../../mcp/mcp-server-authorization.js';
import { sanitizePersistedMcpServers } from '../../mcp/mcp-settings-schemas.js';

describe('mcp settings sanitizer', () => {
  it('sanitizes stale persisted codegraph rows by canonical protected id', () => {
    const sanitized = sanitizePersistedMcpServers([
      {
        id: 'codegraph',
        name: 'stale-codegraph-user-source',
        transport: 'stdio',
        source: 'user',
        command: 'malicious-codegraph-command',
        url: 'https://fake.invalid/codegraph',
        enabled: false,
        disabledTools: ['codegraph_status', 'codegraph_status'],
      },
      {
        id: 'codegraph',
        name: 'stale-codegraph-omitted-source',
        type: 'stdio',
        command: 'another-malicious-command',
        url: 'https://fake.invalid/again',
        enabled: true,
        disabledTools: ['codegraph_search'],
      },
    ]);

    expect(sanitized).toEqual([
      {
        id: 'codegraph',
        name: 'codegraph',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'virtual',
        source: 'user',
        enabled: false,
        disabledTools: ['codegraph_status'],
      },
      {
        id: 'codegraph',
        name: 'codegraph',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'virtual',
        source: 'system',
        enabled: true,
        disabledTools: ['codegraph_search'],
      },
    ]);
  });

  it.each([
    {
      source: 'user',
      enabled: true,
      disabledTools: ['omo_list_agents', 'omo_list_agents'],
      expectedDisabledTools: ['omo_list_agents'],
      expectedSystem: false,
    },
    {
      source: 'plugin',
      enabled: false,
      disabledTools: ['omo_agent_sessions'],
      expectedDisabledTools: ['omo_agent_sessions'],
      expectedSystem: false,
    },
    {
      source: 'system',
      enabled: true,
      disabledTools: ['omo_read_session'],
      expectedDisabledTools: ['omo_read_session'],
      expectedSystem: true,
    },
  ] as const)(
    'keeps $source protected OMO trust boundary while stripping fake endpoints',
    ({ source, enabled, disabledTools, expectedDisabledTools, expectedSystem }) => {
      const sanitized = sanitizePersistedMcpServers([
        {
          id: 'omo',
          name: `${source}-omo`,
          transport: 'stdio',
          source,
          command: `malicious-${source}-omo-command`,
          url: `https://fake.invalid/${source}-omo`,
          enabled,
          disabledTools,
        },
      ]);
      const merged = mergeBuiltinAndConfiguredMcps(sanitized).find((server) => server.id === 'omo');

      expect(sanitized).toEqual([
        {
          id: 'omo',
          name: 'omo',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'adapter',
          source,
          enabled,
          disabledTools: expectedDisabledTools,
        },
      ]);
      expect(sanitized[0]).not.toHaveProperty('command');
      expect(sanitized[0]).not.toHaveProperty('url');
      expect(merged).toMatchObject({
        id: 'omo',
        source,
        enabled,
        disabledTools: expectedDisabledTools,
      });
      expect(merged ? isSystemMcpServer(merged) : null).toBe(expectedSystem);
    },
  );

  it('downgrades non-builtin persisted source system spoof before scope checks', () => {
    const sanitized = sanitizePersistedMcpServers([
      {
        id: 'fs',
        name: 'fake-system-fs',
        transport: 'stdio',
        source: 'system',
        command: 'filesystem-mcp',
        enabled: true,
      },
    ]);

    const merged = mergeBuiltinAndConfiguredMcps(sanitized).find((server) => server.id === 'fs');

    expect(sanitized[0]).toMatchObject({ id: 'fs', source: 'user' });
    expect(merged).toMatchObject({ id: 'fs', source: 'user' });
    expect(merged ? isSystemMcpServer(merged) : null).toBe(false);
  });

  it('keeps ordinary persisted user endpoint fields', () => {
    const sanitized = sanitizePersistedMcpServers([
      {
        id: 'local-user-stdio',
        name: 'Local user stdio',
        transport: 'stdio',
        source: 'user',
        enabled: true,
        command: 'node',
        args: ['server.js'],
      },
      {
        id: 'remote-user-sse',
        name: 'Remote user sse',
        transport: 'sse',
        source: 'user',
        enabled: true,
        url: 'https://example.com/mcp',
      },
    ]);

    expect(sanitized).toEqual([
      {
        id: 'local-user-stdio',
        name: 'Local user stdio',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        source: 'user',
        enabled: true,
      },
      {
        id: 'remote-user-sse',
        name: 'Remote user sse',
        transport: 'sse',
        url: 'https://example.com/mcp',
        source: 'user',
        enabled: true,
      },
    ]);
  });
});
