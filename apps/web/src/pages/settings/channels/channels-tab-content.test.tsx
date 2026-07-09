// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
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
        title: 'Balanced Collaborator',
        description: '稳健协作人设',
        integration: 'reference',
        visibility: 'feature',
        feature: 'channels',
        usageKind: 'channel-persona',
        path: '/resources/souls/reference/balanced-collaborator.md',
        content: '# Balanced Collaborator',
      },
    ],
    prompts: [],
    extensions: [],
    mcps: [],
  })),
}));

vi.mock('@openAwork/web-client', () => ({
  createChannelsClient: vi.fn(() => clientMocks),
  createResourcesClient: vi.fn(() => resourcesClientMocks),
}));

vi.mock('@openAwork/shared-ui', () => ({
  StatusPill: ({ label }: { readonly label: string }) => <span>{label}</span>,
}));

vi.mock('../../../components/common/display/ChannelSubscriptionSettings.js', () => ({
  ChannelSubscriptionSettings: ({
    channels,
    personas,
    onConnect,
  }: {
    readonly channels: readonly ChannelSettingsEntry[];
    readonly personas?: readonly { readonly title: string }[];
    readonly onConnect?: (channelId: string) => Promise<void>;
  }) => (
    <div>
      <button type="button" onClick={() => void onConnect?.(channels[0]?.id ?? '')}>
        连接
      </button>
      <span>{personas?.[0]?.title ?? '无人设'}</span>
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
    expect(await screen.findByText('Balanced Collaborator')).toBeTruthy();
  });
});
