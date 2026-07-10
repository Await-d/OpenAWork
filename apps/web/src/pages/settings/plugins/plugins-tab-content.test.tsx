// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { PluginsTabContent } from './plugins-tab-content.js';

vi.mock('@openAwork/shared-ui', () => ({
  MCPServerConfig: () => <div>MCP 配置表单</div>,
  MCPServerList: () => <div>MCP 状态列表</div>,
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
    mcpServers: [],
    setMcpServers: vi.fn(),
    mcpStatuses: [],
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
    expect(screen.getByText('MCP 配置表单')).toBeTruthy();
    expect(screen.getByText('MCP 状态列表')).toBeTruthy();
  });
});
