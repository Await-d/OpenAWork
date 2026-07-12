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
        id: 'omo',
        name: 'omo',
        transport: 'stdio',
        command: 'openawork-virtual-omo',
        url: 'https://fake.invalid/omo',
        builtin: true,
        builtinKind: 'adapter',
        source: 'builtin',
        enabled: true,
      },
    ];

    render(
      <MCPServerConfig servers={servers} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={onUpdate} />,
    );

    // When: the locked rows render and their editable management fields are changed.
    expect(screen.queryByDisplayValue('openawork-virtual-codegraph')).toBeNull();
    expect(screen.queryByDisplayValue('openawork-virtual-omo')).toBeNull();
    expect(screen.getAllByText('内置桥接')).toHaveLength(2);

    fireEvent.click(readElement(screen.getAllByLabelText('启用'), 0));
    fireEvent.change(readElement(screen.getAllByLabelText('禁用工具'), 1), {
      target: { value: 'omo_list_agents, omo_read_session' },
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

    const [omoId, omoPatch] = readUpdateCall(onUpdate.mock.calls, 1);
    expect(omoId).toBe('omo');
    expect(omoPatch).toMatchObject({
      disabledTools: ['omo_list_agents', 'omo_read_session'],
      transport: 'stdio',
    });
    expect(omoPatch).not.toHaveProperty('command');
    expect(omoPatch).not.toHaveProperty('url');
  });

  it('preserves explicit user/plugin trust when persisting protected adapter rows', () => {
    // Given: protected OMO rows came from user/plugin state but contain spoofed endpoint fields.
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

    // When: the settings persistence helper prepares rows for the backend.
    const persisted = toPersistedMcpServers([userOmo, pluginOmo]);
    const persistedUserOmo = readPersistedServer(persisted, 0);
    const persistedPluginOmo = readPersistedServer(persisted, 1);

    // Then: fake endpoints are stripped, but protected rows never gain system trust.
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
        id: 'omo',
        name: 'omo',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'adapter',
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
    expect(document.querySelector('[data-mcp-row="omo"]')).not.toBeNull();
    expect(document.querySelector('[data-mcp-row="fs"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    fireEvent.click(readElement(screen.getAllByRole('button', { name: '禁用' }), 0));
    fireEvent.click(readElement(screen.getAllByRole('button', { name: '禁用' }), 1));

    expect(onRemove.mock.calls).toEqual([['fs'], ['codegraph'], ['omo']]);
  });
});
