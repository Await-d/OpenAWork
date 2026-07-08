// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MCPServerConfig, toPersistedMcpServers, type MCPServerEntry } from '@openAwork/shared-ui';

function readPersistedServer(servers: MCPServerEntry[], index: number): MCPServerEntry {
  const server = servers.at(index);
  if (!server) {
    throw new Error(`Expected persisted MCP server at index ${index}`);
  }
  return server;
}

function readElement(elements: HTMLElement[], index: number): HTMLElement {
  const element = elements.at(index);
  if (!element) {
    throw new Error(`Expected MCPServerConfig element at index ${index}`);
  }
  return element;
}

afterEach(() => {
  cleanup();
});

describe('Settings MCP server config app mock contract integration', () => {
  it('keeps the app vitest shared-ui mock contract for tokenized focus-visible styles', () => {
    render(<MCPServerConfig servers={[]} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()} />);

    const scopedStyle = document.querySelector('[data-openawork-mcp-server-config] style');
    expect(scopedStyle?.textContent).toContain(':focus-visible');
    expect(scopedStyle?.textContent).toContain('outline: 2px solid var(--accent)');
    expect(scopedStyle?.textContent).toContain('box-shadow: 0 0 0 4px var(--accent-subtle)');
    expect(scopedStyle?.textContent).toContain('outline-color: var(--complement)');
  });

  it('keeps the app vitest shared-ui mock contract for locked builtin management fields', () => {
    const onUpdate = vi.fn();
    const servers: MCPServerEntry[] = [
      {
        id: 'codegraph',
        name: 'codegraph',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'virtual',
        source: 'builtin',
        enabled: true,
        disabledTools: ['codegraph_status'],
      },
      {
        id: 'omo',
        name: 'omo',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'adapter',
        source: 'builtin',
        enabled: true,
      },
    ];

    render(
      <MCPServerConfig servers={servers} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={onUpdate} />,
    );

    expect(screen.queryByDisplayValue('openawork-virtual-codegraph')).toBeNull();
    expect(screen.queryByDisplayValue('openawork-virtual-omo')).toBeNull();
    expect(screen.getAllByText('内置桥接')).toHaveLength(2);

    fireEvent.click(readElement(screen.getAllByLabelText('启用'), 0));
    const codegraphPatch = onUpdate.mock.calls[0]?.[1];
    expect(onUpdate.mock.calls[0]?.[0]).toBe('codegraph');
    expect(codegraphPatch).toMatchObject({ enabled: false, transport: 'stdio' });
    expect(codegraphPatch).not.toHaveProperty('command');
    expect(codegraphPatch).not.toHaveProperty('url');

    fireEvent.change(readElement(screen.getAllByLabelText('禁用工具'), 1), {
      target: { value: 'omo_list_agents, omo_read_session' },
    });
    const omoPatch = onUpdate.mock.calls[1]?.[1];
    expect(onUpdate.mock.calls[1]?.[0]).toBe('omo');
    expect(omoPatch).toMatchObject({
      disabledTools: ['omo_list_agents', 'omo_read_session'],
      transport: 'stdio',
    });
    expect(omoPatch).not.toHaveProperty('command');
    expect(omoPatch).not.toHaveProperty('url');
  });

  it('keeps the app vitest shared-ui mock contract for protected user/plugin persistence', () => {
    const userOmo: MCPServerEntry = {
      id: 'omo',
      name: 'user omo',
      transport: 'stdio',
      command: 'fake-user-command',
      url: 'https://fake.invalid/user-omo',
      builtin: true,
      builtinKind: 'adapter',
      source: 'user',
      enabled: false,
      disabledTools: ['omo_read_session'],
    };
    const pluginOmo: MCPServerEntry = {
      id: 'omo-plugin',
      name: 'plugin omo',
      transport: 'stdio',
      command: 'fake-plugin-command',
      url: 'https://fake.invalid/plugin-omo',
      builtin: true,
      builtinKind: 'adapter',
      source: 'user',
      enabled: true,
      disabledTools: ['omo_list_agents'],
    };
    Object.defineProperty(pluginOmo, 'source', {
      value: 'plugin',
      enumerable: true,
      configurable: true,
    });

    const persisted = toPersistedMcpServers([userOmo, pluginOmo]);
    const persistedUserOmo = readPersistedServer(persisted, 0);
    const persistedPluginOmo = readPersistedServer(persisted, 1);

    expect(persistedUserOmo).toMatchObject({
      id: 'omo',
      source: 'user',
      enabled: false,
      disabledTools: ['omo_read_session'],
      transport: 'stdio',
    });
    expect(persistedUserOmo).not.toHaveProperty('command');
    expect(persistedUserOmo).not.toHaveProperty('url');
    expect(persistedPluginOmo).toMatchObject({
      id: 'omo-plugin',
      source: 'user',
      enabled: true,
      disabledTools: ['omo_list_agents'],
      transport: 'stdio',
    });
    expect(persistedPluginOmo).not.toHaveProperty('command');
    expect(persistedPluginOmo).not.toHaveProperty('url');
  });
});
