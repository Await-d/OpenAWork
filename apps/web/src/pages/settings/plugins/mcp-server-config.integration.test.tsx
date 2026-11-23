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
        id: 'lsp',
        name: 'lsp',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'virtual',
        source: 'builtin',
        enabled: true,
      },
    ];

    render(
      <MCPServerConfig servers={servers} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={onUpdate} />,
    );

    expect(screen.queryByDisplayValue('openawork-virtual-codegraph')).toBeNull();
    expect(screen.queryByDisplayValue('openawork-virtual-lsp')).toBeNull();
    expect(screen.getAllByText('内置桥接')).toHaveLength(2);

    fireEvent.click(readElement(screen.getAllByLabelText('启用'), 0));
    const codegraphPatch = onUpdate.mock.calls[0]?.[1];
    expect(onUpdate.mock.calls[0]?.[0]).toBe('codegraph');
    expect(codegraphPatch).toMatchObject({ enabled: false, transport: 'stdio' });
    expect(codegraphPatch).not.toHaveProperty('command');
    expect(codegraphPatch).not.toHaveProperty('url');

    fireEvent.change(readElement(screen.getAllByLabelText('禁用工具'), 1), {
      target: { value: 'lsp_rename, lsp_hover' },
    });
    const lspPatch = onUpdate.mock.calls[1]?.[1];
    expect(onUpdate.mock.calls[1]?.[0]).toBe('lsp');
    expect(lspPatch).toMatchObject({
      disabledTools: ['lsp_rename', 'lsp_hover'],
      transport: 'stdio',
    });
    expect(lspPatch).not.toHaveProperty('command');
    expect(lspPatch).not.toHaveProperty('url');
  });

  it('keeps the app vitest shared-ui mock contract for protected user/plugin persistence', () => {
    const userLsp: MCPServerEntry = {
      id: 'lsp',
      name: 'user lsp',
      transport: 'stdio',
      command: 'fake-user-command',
      url: 'https://fake.invalid/user-lsp',
      builtin: true,
      builtinKind: 'virtual',
      source: 'user',
      enabled: false,
      disabledTools: ['lsp_hover'],
    };
    const pluginLsp: MCPServerEntry = {
      id: 'lsp-plugin',
      name: 'plugin lsp',
      transport: 'stdio',
      command: 'fake-plugin-command',
      url: 'https://fake.invalid/plugin-lsp',
      builtin: true,
      builtinKind: 'virtual',
      source: 'user',
      enabled: true,
      disabledTools: ['lsp_rename'],
    };
    Object.defineProperty(pluginLsp, 'source', {
      value: 'plugin',
      enumerable: true,
      configurable: true,
    });

    const persisted = toPersistedMcpServers([userLsp, pluginLsp]);
    const persistedUserLsp = readPersistedServer(persisted, 0);
    const persistedPluginLsp = readPersistedServer(persisted, 1);

    expect(persistedUserLsp).toMatchObject({
      id: 'lsp',
      source: 'user',
      enabled: false,
      disabledTools: ['lsp_hover'],
      transport: 'stdio',
    });
    expect(persistedUserLsp).not.toHaveProperty('command');
    expect(persistedUserLsp).not.toHaveProperty('url');
    expect(persistedPluginLsp).toMatchObject({
      id: 'lsp-plugin',
      source: 'user',
      enabled: true,
      disabledTools: ['lsp_rename'],
      transport: 'stdio',
    });
    expect(persistedPluginLsp).not.toHaveProperty('command');
    expect(persistedPluginLsp).not.toHaveProperty('url');
  });
});
