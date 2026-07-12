import { describe, expect, it } from 'vitest';

import {
  buildSettingsBuiltinMcpServers,
  mcpServersBodySchema,
} from '../../mcp/mcp-settings-schemas.js';

describe('mcp settings schemas', () => {
  it('GET settings builtins exposes runtime builtin ids without editable virtual commands', () => {
    const builtins = buildSettingsBuiltinMcpServers();

    expect(builtins.map((server) => server.id)).toEqual([
      'open_websearch',
      'websearch',
      'grep_app',
      'codegraph',
      'git_bash',
      'lsp',
      'omo',
    ]);
    expect(builtins.find((server) => server.id === 'open_websearch')).toMatchObject({
      builtin: true,
      builtinKind: 'adapter',
      source: 'system',
    });
    expect(builtins.find((server) => server.id === 'open_websearch')?.command).toBeUndefined();
    expect(builtins.find((server) => server.id === 'websearch')).toMatchObject({
      builtin: true,
      builtinKind: 'system',
      source: 'system',
      url: 'https://mcp.exa.ai/mcp?tools=web_search_exa',
      enabled: false,
    });
    for (const serverId of ['codegraph', 'git_bash', 'lsp']) {
      expect(builtins.find((server) => server.id === serverId)).toMatchObject({
        builtin: true,
        builtinKind: 'virtual',
        source: 'system',
      });
      expect(builtins.find((server) => server.id === serverId)?.command).toBeUndefined();
    }
    for (const serverId of ['omo']) {
      expect(builtins.find((server) => server.id === serverId)).toMatchObject({
        builtin: true,
        builtinKind: 'adapter',
        source: 'system',
      });
      expect(builtins.find((server) => server.id === serverId)?.command).toBeUndefined();
    }
  });

  it('accepts adapter builtin management patches for open_websearch while stripping fake endpoints', () => {
    const parsed = mcpServersBodySchema.parse({
      servers: [
        {
          id: 'open_websearch',
          name: 'Open WebSearch',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'adapter',
          source: 'system',
          enabled: false,
          command: 'malicious-command-that-must-not-persist',
          url: 'https://fake.invalid/sse',
          disabledTools: ['search', 'search'],
        },
      ],
    });

    expect(parsed.servers).toEqual([
      {
        id: 'open_websearch',
        name: 'Open WebSearch',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'adapter',
        source: 'system',
        enabled: false,
        disabledTools: ['search'],
      },
    ]);
  });

  it('accepts virtual builtin management patches while stripping fake command edits', () => {
    const parsed = mcpServersBodySchema.parse({
      servers: [
        {
          id: 'omo',
          name: 'omo',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'adapter',
          source: 'system',
          enabled: true,
          command: 'malicious-command-that-must-not-persist',
          url: 'https://fake.invalid/sse',
          disabledTools: ['omo_list_agents', 'omo_list_agents'],
        },
      ],
    });

    expect(parsed.servers).toEqual([
      {
        id: 'omo',
        name: 'omo',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'adapter',
        source: 'system',
        enabled: true,
        disabledTools: ['omo_list_agents'],
      },
    ]);
  });

  it('strips fake endpoint fields from adapter builtins even when source is forged as user', () => {
    const parsed = mcpServersBodySchema.parse({
      servers: [
        {
          id: 'omo',
          name: 'omo',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'adapter',
          source: 'user',
          enabled: true,
          command: 'malicious-fake-command',
          url: 'https://fake.invalid/sse',
          disabledTools: ['omo_list_agents'],
        },
      ],
    });

    expect(parsed.servers[0]).toEqual({
      id: 'omo',
      name: 'omo',
      transport: 'stdio',
      builtin: true,
      builtinKind: 'adapter',
      source: 'user',
      enabled: true,
      disabledTools: ['omo_list_agents'],
    });
  });

  it('strips fake endpoint fields from virtual builtins when source is omitted', () => {
    const parsed = mcpServersBodySchema.parse({
      servers: [
        {
          id: 'codegraph',
          name: 'codegraph',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'virtual',
          enabled: true,
          command: 'malicious-fake-command',
          url: 'https://fake.invalid/sse',
          disabledTools: ['codegraph_status'],
        },
      ],
    });

    expect(parsed.servers[0]).toEqual({
      id: 'codegraph',
      name: 'codegraph',
      transport: 'stdio',
      builtin: true,
      builtinKind: 'virtual',
      source: 'system',
      enabled: true,
      disabledTools: ['codegraph_status'],
    });
  });

  it('keeps endpoint fields for ordinary user MCP servers', () => {
    const parsed = mcpServersBodySchema.parse({
      servers: [
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
      ],
    });

    expect(parsed.servers).toEqual([
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

  it('rejects forged protected builtin metadata for unknown ids without an endpoint', () => {
    expect(() =>
      mcpServersBodySchema.parse({
        servers: [
          {
            id: 'fake-virtual',
            name: 'Fake virtual',
            transport: 'stdio',
            builtin: true,
            builtinKind: 'virtual',
            source: 'system',
            enabled: true,
          },
        ],
      }),
    ).toThrow(/command/);
  });

  it('downgrades forged system builtin metadata on ordinary user MCP servers', () => {
    const parsed = mcpServersBodySchema.parse({
      servers: [
        {
          id: 'fake-virtual',
          name: 'Fake virtual',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'virtual',
          source: 'system',
          enabled: true,
          command: 'node',
        },
      ],
    });

    expect(parsed.servers).toEqual([
      {
        id: 'fake-virtual',
        name: 'Fake virtual',
        transport: 'stdio',
        command: 'node',
        source: 'user',
        enabled: true,
      },
    ]);
  });
});
