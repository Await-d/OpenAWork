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
      disabledTools: ['lsp_rename', 'lsp_rename'],
      expectedDisabledTools: ['lsp_rename'],
      expectedSystem: false,
    },
    {
      source: 'plugin',
      enabled: false,
      disabledTools: ['lsp_diagnostics'],
      expectedDisabledTools: ['lsp_diagnostics'],
      expectedSystem: false,
    },
    {
      source: 'system',
      enabled: true,
      disabledTools: ['lsp_hover'],
      expectedDisabledTools: ['lsp_hover'],
      expectedSystem: true,
    },
  ] as const)(
    'keeps $source protected virtual trust boundary while stripping fake endpoints',
    ({ source, enabled, disabledTools, expectedDisabledTools, expectedSystem }) => {
      const sanitized = sanitizePersistedMcpServers([
        {
          id: 'lsp',
          name: `${source}-lsp`,
          transport: 'stdio',
          source,
          command: `malicious-${source}-lsp-command`,
          url: `https://fake.invalid/${source}-lsp`,
          enabled,
          disabledTools,
        },
      ]);
      const merged = mergeBuiltinAndConfiguredMcps(sanitized).find((server) => server.id === 'lsp');

      expect(sanitized).toEqual([
        {
          id: 'lsp',
          name: 'lsp',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'virtual',
          source,
          enabled,
          disabledTools: expectedDisabledTools,
        },
      ]);
      expect(sanitized[0]).not.toHaveProperty('command');
      expect(sanitized[0]).not.toHaveProperty('url');
      expect(merged).toMatchObject({
        id: 'lsp',
        source,
        enabled,
        disabledTools: expectedDisabledTools,
      });
      expect(merged ? isSystemMcpServer(merged) : null).toBe(expectedSystem);
    },
  );

  it.each(['system', 'user'] as const)(
    'drops retired protected builtin (%s source) instead of re-normalizing it into a spawnable stdio server',
    (source) => {
      // D5：`omo` 已下线，其存量配置不能再被归一成 command: 'openawork-virtual-omo'。
      const sanitized = sanitizePersistedMcpServers([
        {
          id: 'omo',
          name: `${source}-omo`,
          transport: 'stdio',
          source,
          command: 'openawork-virtual-omo',
          enabled: true,
        },
      ]);

      const merged = mergeBuiltinAndConfiguredMcps(sanitized);

      expect(merged.find((server) => server.id === 'omo')).toBeUndefined();
      expect(merged.filter((server) => server.command === 'openawork-virtual-omo')).toEqual([]);
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
