// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { PluginsTabContent } from './plugins-tab-content.js';

vi.mock('@openAwork/shared-ui', () => ({
  MCPServerConfig: ({
    servers,
    title,
    showAddForm = true,
  }: {
    servers: Array<{ id: string }>;
    title?: string;
    showAddForm?: boolean;
  }) => (
    <div>
      {title ?? 'MCP 配置表单'}:{servers.map((server) => server.id).join(',')}
      {showAddForm ? <span>显示新增</span> : <span>隐藏新增</span>}
    </div>
  ),
  MCPServerList: ({ servers }: { servers: Array<{ id: string }> }) => (
    <div>MCP 状态列表:{servers.map((server) => server.id).join(',')}</div>
  ),
}));

vi.mock('@openAwork/web-client', () => ({
  createSettingsClient: () => ({
    getPlugins: vi.fn(async () => ({})),
    getWebsearch: vi.fn(async () => ({ providers: [], rolloutMode: 'sequential' })),
  }),
  refreshAccessToken: vi.fn(async () => ({
    accessToken: 'refreshed-token',
    refreshToken: 'refresh-token',
    expiresIn: '15m',
  })),
}));

vi.mock('./skills-plugin-panel.js', () => ({
  SkillsPluginPanel: () => <div>管理已安装的 Agent 技能，控制每条技能是否对当前账号启用。</div>,
}));

vi.mock('../connection/websearch-section.js', () => ({
  WebsearchSection: () => <div>Web 搜索策略</div>,
}));

vi.mock('../connection/use-settings-websearch.js', () => ({
  useSettingsWebsearch: () => ({
    loadWebsearchPolicy: vi.fn(async () => undefined),
    saveWebsearchPolicy: vi.fn(async () => undefined),
    savedPolicy: { providers: [], rolloutMode: 'sequential' },
    saving: false,
    setPolicy: vi.fn(),
    policy: { providers: [], rolloutMode: 'sequential' },
  }),
}));

vi.mock('../connection/use-mcp-servers.js', () => ({
  useMcpServers: () => ({
    mcpServers: [
      {
        id: 'open_websearch',
        name: 'Open WebSearch',
        builtin: true,
        builtinKind: 'adapter',
        source: 'builtin',
        enabled: true,
      },
      {
        id: 'websearch',
        name: 'Exa Web Search',
        builtin: true,
        builtinKind: 'system',
        source: 'builtin',
        enabled: false,
      },
      {
        id: 'codegraph',
        name: 'codegraph',
        builtin: true,
        builtinKind: 'virtual',
        source: 'builtin',
        enabled: true,
      },
    ],
    setMcpServers: vi.fn(),
    mcpStatuses: [
      {
        id: 'open_websearch',
        name: 'Open WebSearch',
        status: 'connected',
        toolCount: 3,
        tools: [],
      },
      { id: 'websearch', name: 'Exa Web Search', status: 'disabled', toolCount: 0, tools: [] },
      { id: 'codegraph', name: 'codegraph', status: 'connected', toolCount: 4, tools: [] },
    ],
    onRetryMcp: vi.fn(),
  }),
}));

function renderPluginsTab(initialEntry: string): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PluginsTabContent providers={[]} />
    </MemoryRouter>,
  );
}

describe('PluginsTabContent', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 'test-token',
      gatewayUrl: 'https://gateway.test',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: null, gatewayUrl: 'http://localhost:3000' });
  });

  it('根据 plugin=skills 直达技能管理面', async () => {
    renderPluginsTab('/settings/plugins?plugin=skills');

    await waitFor(() => {
      expect(screen.getByText(/管理已安装的 Agent 技能/)).toBeTruthy();
    });
  });

  it('根据 plugin=mcp 直达 MCP 管理面', async () => {
    renderPluginsTab('/settings/plugins?plugin=mcp');

    await waitFor(() => {
      expect(screen.getAllByText('MCP 服务器').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('MCP 配置表单:codegraph')).toBeTruthy();
    expect(screen.getByText('MCP 状态列表:codegraph')).toBeTruthy();
    expect(screen.queryByText(/open_websearch/)).toBeNull();
  });

  it('根据 plugin=websearch 直达统一搜索管理面', async () => {
    renderPluginsTab('/settings/plugins?plugin=websearch');

    await waitFor(() => {
      expect(screen.getAllByText('Web 搜索').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('搜索 MCP 配置:open_websearch,websearch')).toBeTruthy();
    expect(screen.getByText('MCP 状态列表:open_websearch,websearch')).toBeTruthy();
    expect(screen.getByText('隐藏新增')).toBeTruthy();
    expect(screen.getByText('Web 搜索策略')).toBeTruthy();
  });
});
