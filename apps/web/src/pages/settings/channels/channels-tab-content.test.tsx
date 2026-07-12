// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChannelCapabilityCatalogDraft,
  ChannelSettingsEntry,
  ChannelTargetEntry,
  ChannelTypeDescriptor,
} from '../../../components/common/display/ChannelSubscriptionSettings.js';
import { ChannelsTabContent } from './channels-tab-content.js';

const clientMocks = vi.hoisted(() => ({
  create: vi.fn(),
  listConversations: vi.fn(async () => []),
  listTargets: vi.fn(async (): Promise<ChannelTargetEntry[]> => []),
  remove: vi.fn(),
  start: vi.fn(async () => ({ status: 'connected' })),
  startWeixinLogin: vi.fn(async () => ({
    sessionKey: 'wx-session-1',
    qrCodeUrl: 'data:image/png;base64,QR',
    message: '请扫码。',
  })),
  stop: vi.fn(),
  update: vi.fn(),
  waitWeixinLogin: vi.fn(async () => ({
    connected: true,
    message: '已连接。',
    token: 'wx-token-1',
  })),
}));

const resourcesClientMocks = vi.hoisted(() => ({
  list: vi.fn(async () => ({
    skills: [],
    agents: [],
    agentTemplates: [],
    commands: [],
    souls: [
      {
        id: 'resource-soul-balanced-collaborator',
        name: 'balanced-collaborator',
        title: '稳健协作者',
        description: '稳健协作人设',
        integration: 'reference',
        visibility: 'feature',
        feature: 'channels',
        usageKind: 'channel-persona',
        path: '/resources/souls/reference/balanced-collaborator.md',
        content: '# 稳健协作者',
      },
    ],
    prompts: [],
    extensions: [],
    mcps: [],
  })),
}));

const capabilitiesClientMocks = vi.hoisted(() => ({
  list: vi.fn(async () => [
    {
      id: 'agent-1',
      kind: 'agent',
      label: 'Agent 1',
      description: 'desc',
      source: 'builtin',
    },
    {
      id: 'skill-1',
      kind: 'skill',
      label: 'Skill 1',
      description: 'desc',
      source: 'builtin',
    },
    {
      id: 'mcp-1',
      kind: 'mcp',
      label: 'MCP 1',
      description: 'desc',
      source: 'builtin',
      enabled: true,
    },
    {
      id: 'tool-1',
      kind: 'tool',
      label: 'Tool 1',
      description: 'desc',
      source: 'runtime',
      callable: true,
    },
    {
      id: 'command-1',
      kind: 'command',
      label: 'Command 1',
      description: 'desc',
      source: 'builtin',
    },
  ]),
  previewChannel: vi.fn(async () => ({
    agents: 1,
    skills: 1,
    mcps: 1,
    tools: 1,
    toolGroups: {
      web: 0,
      lsp: 0,
      files: 1,
      shell: 0,
      orchestration: 0,
      session: 0,
      mcp: 0,
      desktop: 0,
      repo: 0,
      channel: 0,
      other: 0,
    },
    commands: 1,
  })),
}));

vi.mock('@openAwork/web-client', () => ({
  createCapabilitiesClient: vi.fn(() => capabilitiesClientMocks),
  createChannelsClient: vi.fn(() => clientMocks),
  createResourcesClient: vi.fn(() => resourcesClientMocks),
}));

vi.mock('@openAwork/shared-ui', () => ({
  StatusPill: ({ label }: { readonly label: string }) => <span>{label}</span>,
}));

vi.mock('../../../components/common/display/ChannelSubscriptionSettings.js', () => ({
  ChannelSubscriptionSettings: ({
    channels,
    capabilityCatalogCounts,
    onResolveCapabilityCatalogCounts,
    personas,
    onConnect,
  }: {
    readonly channels: readonly ChannelSettingsEntry[];
    readonly capabilityCatalogCounts?: {
      readonly agents: number;
      readonly skills: number;
      readonly mcps: number;
      readonly tools: number;
      readonly toolGroups: {
        readonly web: number;
        readonly lsp: number;
        readonly files: number;
        readonly shell: number;
        readonly orchestration: number;
        readonly session: number;
        readonly mcp: number;
        readonly desktop: number;
        readonly repo: number;
        readonly channel: number;
        readonly other: number;
      };
      readonly commands: number;
    };
    readonly onResolveCapabilityCatalogCounts?: (draft: ChannelCapabilityCatalogDraft) => Promise<{
      readonly agents: number;
      readonly skills: number;
      readonly mcps: number;
      readonly tools: number;
      readonly toolGroups: {
        readonly web: number;
        readonly lsp: number;
        readonly files: number;
        readonly shell: number;
        readonly orchestration: number;
        readonly session: number;
        readonly mcp: number;
        readonly desktop: number;
        readonly repo: number;
        readonly channel: number;
        readonly other: number;
      };
      readonly commands: number;
    }>;
    readonly personas?: readonly { readonly title: string }[];
    readonly onConnect?: (channelId: string) => Promise<void>;
  }) => (
    <div>
      <button type="button" onClick={() => void onConnect?.(channels[0]?.id ?? '')}>
        连接
      </button>
      <button
        type="button"
        onClick={() =>
          void onResolveCapabilityCatalogCounts?.({
            type: 'telegram',
            channelLlmToolsEnabled: true,
            tools: { read: true },
            permissions: {
              allowReadHome: false,
              readablePathPrefixes: [],
              allowWriteOutside: false,
              allowShell: false,
              allowSubAgents: false,
            },
          })
        }
      >
        预览能力
      </button>
      <span>{personas?.[0]?.title ?? '无人设'}</span>
      <span>{capabilityCatalogCounts?.agents ?? 0} agents</span>
    </div>
  ),
}));

vi.mock('./channel-conversation-history-panel.js', () => ({
  ChannelConversationHistoryPanel: () => <section aria-label="渠道对话历史" />,
}));

function makeTelegramChannel(): ChannelSettingsEntry {
  return {
    id: 'telegram-1',
    type: 'telegram',
    name: '工程群 Telegram',
    enabled: true,
    status: 'disconnected',
    config: { token: 'redacted' },
    subscriptions: [],
    features: { autoReply: true, streamingReply: false, autoStart: false },
    providerId: null,
    model: null,
  };
}

const TELEGRAM_DESCRIPTOR: ChannelTypeDescriptor = {
  type: 'telegram',
  displayName: 'Telegram',
  description: 'Telegram Bot',
  icon: 'telegram',
  category: 'international',
  configSchema: [{ key: 'token', label: 'Bot Token', type: 'secret', required: true }],
  tools: [{ key: 'PluginSendMessage', label: '发送渠道消息', description: '发送消息' }],
};

function renderChannelsTab(channel: ChannelSettingsEntry = makeTelegramChannel()) {
  const setChannels = vi.fn();
  render(
    <ChannelsTabContent
      channels={[channel]}
      setChannels={setChannels}
      descriptors={[TELEGRAM_DESCRIPTOR]}
      providers={[]}
      loadError={null}
      gatewayUrl="http://gateway.local"
      token="token-1"
      connectedCount={0}
      disconnectedCount={1}
    />,
  );
  return { setChannels };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChannelsTabContent', () => {
  it('Given a disconnected channel When connect is clicked Then it starts the channel through web-client and updates status', async () => {
    const { setChannels } = renderChannelsTab();

    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await waitFor(() => {
      expect(clientMocks.start).toHaveBeenCalledWith('token-1', 'telegram-1');
    });
    expect(setChannels).toHaveBeenCalled();
    const updater = setChannels.mock.calls.at(-1)?.[0];
    if (typeof updater !== 'function') {
      throw new Error('Expected setChannels updater');
    }

    const next = updater([makeTelegramChannel()]);
    expect(next[0]).toMatchObject({ id: 'telegram-1', status: 'connected' });
  });

  it('Given channel persona resources When rendering Then it loads souls and passes channel-persona options to settings', async () => {
    renderChannelsTab();

    await waitFor(() => {
      expect(resourcesClientMocks.list).toHaveBeenCalledWith('token-1');
    });
    expect(await screen.findByText('稳健协作者')).toBeTruthy();
  });

  it('Given capabilities catalog When rendering Then it passes category counts to channel settings', async () => {
    renderChannelsTab();

    await waitFor(() => {
      expect(capabilitiesClientMocks.list).toHaveBeenCalledWith('token-1');
    });
    expect(await screen.findByText('1 agents')).toBeTruthy();
  });

  it('Given channel draft preview is requested When settings asks for counts Then it proxies to capabilities preview client', async () => {
    renderChannelsTab();

    fireEvent.click(screen.getByRole('button', { name: '预览能力' }));

    await waitFor(() => {
      expect(capabilitiesClientMocks.previewChannel).toHaveBeenCalledWith('token-1', {
        type: 'telegram',
        channelLlmToolsEnabled: true,
        tools: { read: true },
        permissions: {
          allowReadHome: false,
          readablePathPrefixes: [],
          allowWriteOutside: false,
          allowShell: false,
          allowSubAgents: false,
        },
      });
    });
  });
});
