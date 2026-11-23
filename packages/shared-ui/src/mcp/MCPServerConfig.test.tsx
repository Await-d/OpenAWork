// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MCPServerConfig, toPersistedMcpServers, type MCPServerEntry } from '../index.js';

type UpdateCall = [id: string, entry: MCPServerEntry];

function readUpdateCall(calls: UpdateCall[], index: number): UpdateCall {
  const call = calls.at(index);
  if (!call) {
    throw new Error(`Expected MCPServerConfig onUpdate call at index ${index}`);
  }
  return call;
}

function readElement(elements: HTMLElement[], index: number): HTMLElement {
  const element = elements.at(index);
  if (!element) {
    throw new Error(`Expected MCPServerConfig element at index ${index}`);
  }
  return element;
}

function readPersistedServer(servers: MCPServerEntry[], index: number): MCPServerEntry {
  const server = servers.at(index);
  if (!server) {
    throw new Error(`Expected persisted MCP server at index ${index}`);
  }
  return server;
}

afterEach(() => {
  cleanup();
});

describe('MCPServerConfig shared-ui real public boundary', () => {
  it('ships tokenized focus-visible styles from the real component', () => {
    // Given: the real shared-ui MCPServerConfig barrel export is rendered in jsdom.
    render(<MCPServerConfig servers={[]} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()} />);

    // When: the scoped style tag is read from the rendered component root.
    const scopedStyle = document.querySelector('[data-openawork-mcp-server-config] style');

    // Then: the focus-visible ring uses E Nebula tokens, including danger complement styling.
    expect(scopedStyle?.textContent).toContain(':focus-visible');
    expect(scopedStyle?.textContent).toContain('outline: 2px solid var(--accent)');
    expect(scopedStyle?.textContent).toContain('box-shadow: 0 0 0 4px var(--accent-subtle)');
    expect(scopedStyle?.textContent).toContain('outline-color: var(--complement)');
    expect(scopedStyle?.textContent).toContain('box-shadow: 0 0 0 4px var(--complement-subtle)');
  });

  it('supports a custom title and can hide the add form for curated MCP views', () => {
    render(
      <MCPServerConfig
        servers={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
        title="搜索 MCP 配置"
        showAddForm={false}
      />,
    );

    expect(screen.getByText('搜索 MCP 配置')).toBeTruthy();
    expect(screen.queryByText('+ 添加服务器')).toBeNull();
  });

  it('locks virtual and adapter endpoints while saving editable management fields', () => {
    // Given: protected builtin MCP rows carry fake endpoint fields from an unsafe source.
    const onUpdate = vi.fn<(id: string, entry: MCPServerEntry) => void>();
    const servers: MCPServerEntry[] = [
      {
        id: 'codegraph',
        name: 'codegraph',
        transport: 'stdio',
        command: 'openawork-virtual-codegraph',
        url: 'https://fake.invalid/codegraph',
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
        command: 'openawork-virtual-lsp',
        url: 'https://fake.invalid/lsp',
        builtin: true,
        builtinKind: 'virtual',
        source: 'builtin',
        enabled: true,
      },
    ];

    render(
      <MCPServerConfig servers={servers} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={onUpdate} />,
    );

    // When: the locked rows render and their editable management fields are changed.
    expect(screen.queryByDisplayValue('openawork-virtual-codegraph')).toBeNull();
    expect(screen.queryByDisplayValue('openawork-virtual-lsp')).toBeNull();
    expect(screen.getAllByText('内置桥接')).toHaveLength(2);

    fireEvent.click(readElement(screen.getAllByLabelText('启用'), 0));
    fireEvent.change(readElement(screen.getAllByLabelText('禁用工具'), 1), {
      target: { value: 'lsp_rename, lsp_hover' },
    });

    // Then: enabled and disabledTools persist, but the patch never reintroduces command/url.
    const [codegraphId, codegraphPatch] = readUpdateCall(onUpdate.mock.calls, 0);
    expect(codegraphId).toBe('codegraph');
    expect(codegraphPatch).toMatchObject({
      enabled: false,
      disabledTools: ['codegraph_status'],
      transport: 'stdio',
    });
    expect(codegraphPatch).not.toHaveProperty('command');
    expect(codegraphPatch).not.toHaveProperty('url');

    const [lspId, lspPatch] = readUpdateCall(onUpdate.mock.calls, 1);
    expect(lspId).toBe('lsp');
    expect(lspPatch).toMatchObject({
      disabledTools: ['lsp_rename', 'lsp_hover'],
      transport: 'stdio',
    });
    expect(lspPatch).not.toHaveProperty('command');
    expect(lspPatch).not.toHaveProperty('url');
  });

  it('preserves explicit user/plugin trust when persisting protected virtual rows', () => {
    // Given: protected virtual rows came from user/plugin state but contain spoofed endpoint fields.
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

    // When: the settings persistence helper prepares rows for the backend.
    const persisted = toPersistedMcpServers([userLsp, pluginLsp]);
    const persistedUserLsp = readPersistedServer(persisted, 0);
    const persistedPluginLsp = readPersistedServer(persisted, 1);

    // Then: fake endpoints are stripped, but protected rows never gain system trust.
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

  it('Given multiple rows When removing each row Then dispatches the matching MCP server id', () => {
    const onRemove = vi.fn<(id: string) => void>();
    const servers: MCPServerEntry[] = [
      {
        id: 'codegraph',
        name: 'codegraph',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'virtual',
        source: 'builtin',
        enabled: true,
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
      {
        id: 'fs',
        name: 'filesystem',
        transport: 'stdio',
        command: 'mcp-server-fs',
        enabled: true,
      },
    ];

    render(<MCPServerConfig servers={servers} onAdd={vi.fn()} onRemove={onRemove} />);

    expect(document.querySelectorAll('[data-mcp-row]')).toHaveLength(3);
    expect(document.querySelector('[data-mcp-row="codegraph"]')).not.toBeNull();
    expect(document.querySelector('[data-mcp-row="lsp"]')).not.toBeNull();
    expect(document.querySelector('[data-mcp-row="fs"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    fireEvent.click(readElement(screen.getAllByRole('button', { name: '禁用' }), 0));
    fireEvent.click(readElement(screen.getAllByRole('button', { name: '禁用' }), 1));

    expect(onRemove.mock.calls).toEqual([['fs'], ['codegraph'], ['lsp']]);
  });
});
