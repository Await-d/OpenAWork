// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { PluginsTabContent } from './plugins-tab-content.js';
import type { PluginSettings } from './plugins-tab-content.js';

const settingsClientMocks = vi.hoisted(() => ({
  getPlugins: vi.fn(async (): Promise<unknown> => ({})),
  putPlugins: vi.fn(async (_token: string, _payload: unknown) => undefined),
}));

vi.mock('@openAwork/shared-ui', () => ({
  McpServerManager: ({
    servers,
    statuses = [],
    title,
    showAddForm = true,
  }: {
    servers: Array<{ id: string }>;
    statuses?: Array<{ id: string }>;
    title?: string;
    showAddForm?: boolean;
  }) => (
    <div>
      {title ?? 'MCP 配置表单'}:{servers.map((server) => server.id).join(',')}
      {statuses.length > 0 ? <span> 状态:{statuses.map((s) => s.id).join(',')}</span> : null}
      {showAddForm ? <span>显示新增</span> : <span>隐藏新增</span>}
    </div>
  ),
}));

vi.mock('@openAwork/web-client', () => ({
  createSettingsClient: () => ({
    getPlugins: settingsClientMocks.getPlugins,
    putPlugins: settingsClientMocks.putPlugins,
    getWebsearch: vi.fn(async () => ({ providers: [], rolloutMode: 'sequential' })),
  }),
  createPluginsClient: () => ({
    list: vi.fn(async () => []),
    install: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
    reload: vi.fn(async () => ({ reloaded: true })),
    disable: vi.fn(async () => undefined),
    enable: vi.fn(async () => ({ enabled: true })),
    listMarketSources: vi.fn(async () => []),
    addMarketSource: vi.fn(async () => null),
    removeMarketSource: vi.fn(async () => undefined),
    searchMarket: vi.fn(async () => ({ entries: [], failedSources: [] })),
    getMarketEntry: vi.fn(async () => null),
    installFromGithub: vi.fn(async () => null),
  }),
  refreshAccessToken: vi.fn(async () => ({
    accessToken: 'refreshed-token',
    refreshToken: 'refresh-token',
    expiresIn: '15m',
  })),
}));

vi.mock('./skills-plugin-panel.js', () => ({
  SkillsPluginPanel: () => <div>技能管理面板</div>,
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
      expect(screen.getByText('技能管理面板')).toBeTruthy();
    });
  });

  it('根据 plugin=mcp 直达 MCP 管理面', async () => {
    renderPluginsTab('/settings/plugins?plugin=mcp');

    await waitFor(() => {
      expect(screen.getAllByText('MCP 服务器').length).toBeGreaterThan(0);
    });
    // 配置与运行状态合并进同一个管理列表，且排除搜索 MCP。
    expect(screen.getByText(/MCP 配置表单:codegraph/)).toBeTruthy();
    expect(screen.getByText(/状态:codegraph/)).toBeTruthy();
    expect(screen.queryByText(/open_websearch/)).toBeNull();
  });

  it('根据 plugin=websearch 直达统一搜索管理面', async () => {
    renderPluginsTab('/settings/plugins?plugin=websearch');

    await waitFor(() => {
      expect(screen.getAllByText('Web 搜索').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/搜索 MCP:open_websearch,websearch/)).toBeTruthy();
    expect(screen.getByText(/状态:open_websearch,websearch/)).toBeTruthy();
    expect(screen.getByText('隐藏新增')).toBeTruthy();
    expect(screen.getByText('Web 搜索策略')).toBeTruthy();
  });

  it('根据 plugin=market 直达插件市场', async () => {
    renderPluginsTab('/settings/plugins?plugin=market');

    await waitFor(() => {
      expect(screen.getByText(/从 GitHub 源浏览并一键安装插件/)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('市场里还没有可安装的插件')).toBeTruthy();
    });
  });

  it('根据 plugin=third-party 直达已安装插件管理面', async () => {
    renderPluginsTab('/settings/plugins?plugin=third-party');

    await waitFor(() => {
      expect(screen.getByText(/管理网关级插件平台/)).toBeTruthy();
    });
    expect(screen.getByText('安装新插件')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('还没有安装第三方插件')).toBeTruthy();
    });
  });

  it('根据 plugin=desktop-automation 直达浏览器自动化管理面', async () => {
    renderPluginsTab('/settings/plugins?plugin=desktop-automation');

    await waitFor(() => {
      expect(screen.getByText(/为 Agent 提供网页导航、点击、填写与截图 Tool/)).toBeTruthy();
    });
    expect(screen.getByText('desktop_automation')).toBeTruthy();
    expect(screen.getByRole('switch', { name: '启用插件' })).toBeTruthy();
  });

  it('切换 desktop-automation 开关会保存 desktopAutomation.enabled 且不影响 desktopControl', async () => {
    settingsClientMocks.getPlugins.mockResolvedValueOnce({
      desktopAutomation: { enabled: false },
      desktopControl: { enabled: true },
    });

    renderPluginsTab('/settings/plugins?plugin=desktop-automation');

    const toggle = await screen.findByRole('switch', { name: '启用插件' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(settingsClientMocks.putPlugins).toHaveBeenCalled();
    });
    const payload = settingsClientMocks.putPlugins.mock.calls.at(-1)?.[1] as PluginSettings;
    expect(payload.desktopAutomation?.enabled).toBe(true);
    // 两个桌面插件是独立开关：启用 desktop_automation 不得改动 desktop_control。
    expect(payload.desktopControl?.enabled).toBe(true);
  });
});
