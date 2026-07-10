import React from 'react';
import { createChannelsClient, createResourcesClient } from '@openAwork/web-client';
import { StatusPill } from '@openAwork/shared-ui';
import type {
  ChannelDraft,
  ChannelPersonaOption,
  ChannelTypeDescriptor,
  ChannelProviderOption,
  ChannelSettingsEntry,
  ChannelTargetEntry,
} from '../../../components/common/display/ChannelSubscriptionSettings.js';
import { ChannelSubscriptionSettings } from '../../../components/common/display/ChannelSubscriptionSettings.js';
import { logger } from '../../../utils/log/logger.js';
import { ChannelConversationHistoryPanel } from './channel-conversation-history-panel.js';

interface ChannelsTabContentProps {
  channels: ChannelSettingsEntry[];
  setChannels: React.Dispatch<React.SetStateAction<ChannelSettingsEntry[]>>;
  descriptors: ChannelTypeDescriptor[];
  providers: ChannelProviderOption[];
  loadError: string | null;
  /** 网关地址 + 用户 token，用于通过 web-client 调用 channels 路由。 */
  gatewayUrl: string;
  token: string | null;
  connectedCount: number;
  disconnectedCount: number;
}

function toChannelPersonaSource(
  source: string | undefined,
  integration: string,
): ChannelPersonaOption['source'] {
  if (source === 'user') {
    return 'user';
  }
  if (source === 'builtin' || source === 'system' || integration === 'builtin') {
    return 'builtin';
  }
  return 'reference';
}

export function ChannelsTabContent({
  channels,
  setChannels,
  descriptors,
  providers,
  loadError,
  gatewayUrl,
  token,
  connectedCount,
  disconnectedCount,
}: ChannelsTabContentProps) {
  const channelsClient = React.useMemo(
    () =>
      createChannelsClient<ChannelSettingsEntry, ChannelTypeDescriptor, ChannelTargetEntry>(
        gatewayUrl,
      ),
    [gatewayUrl],
  );
  const resourcesClient = React.useMemo(() => createResourcesClient(gatewayUrl), [gatewayUrl]);
  const [personas, setPersonas] = React.useState<readonly ChannelPersonaOption[]>([]);
  const [personaError, setPersonaError] = React.useState<string | null>(null);
  const ensureToken = (): string => {
    if (!token) throw new Error('未登录');
    return token;
  };

  React.useEffect(() => {
    if (!token) {
      setPersonas([]);
      return;
    }

    const abortController = new AbortController();
    void resourcesClient
      .list(token)
      .then((resources) => {
        if (abortController.signal.aborted) {
          return;
        }
        setPersonas(
          resources.souls
            .filter(
              (soul) =>
                soul.visibility === 'feature' &&
                soul.feature === 'channels' &&
                soul.usageKind === 'channel-persona',
            )
            .map((soul) => ({
              resourceId: soul.id,
              title: soul.title,
              description: soul.description,
              source: toChannelPersonaSource(soul.source, soul.integration),
            })),
        );
        setPersonaError(null);
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }
        logger.error('failed to load channel personas', error);
        setPersonaError(error instanceof Error ? error.message : '通道人设资源加载失败');
      });

    return () => abortController.abort();
  }, [resourcesClient, token]);
  const applyChannelError = (channelId: string, errorMessage?: string) => {
    setChannels((prev) =>
      prev.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              errorMessage,
            }
          : channel,
      ),
    );
  };

  const saveChannel = async (
    channelId: string | null,
    draft: ChannelDraft,
  ): Promise<ChannelSettingsEntry> => {
    try {
      const savedChannel = channelId
        ? await channelsClient.update(ensureToken(), channelId, draft)
        : await channelsClient.create(ensureToken(), draft);
      setChannels((prev) => {
        const exists = prev.some((channel) => channel.id === savedChannel.id);
        if (exists) {
          return prev.map((channel) =>
            channel.id === savedChannel.id
              ? {
                  ...savedChannel,
                  availableTargets: channel.availableTargets,
                  loadingTargets: channel.loadingTargets,
                  diagnostics: savedChannel.diagnostics ?? channel.diagnostics,
                }
              : channel,
          );
        }

        return [...prev, savedChannel];
      });

      return savedChannel;
    } catch (error) {
      logger.error('failed to save channel', error);
      if (channelId) {
        applyChannelError(channelId, error instanceof Error ? error.message : '保存通道配置失败');
      }
      throw error;
    }
  };

  const refreshTargets = async (channelId: string): Promise<void> => {
    setChannels((prev) =>
      prev.map((channel) =>
        channel.id === channelId
          ? { ...channel, loadingTargets: true, errorMessage: undefined }
          : channel,
      ),
    );

    try {
      const groups = await channelsClient.listTargets(ensureToken(), channelId);
      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === channelId
            ? {
                ...channel,
                availableTargets: groups,
                loadingTargets: false,
                errorMessage: undefined,
              }
            : channel,
        ),
      );
    } catch (error) {
      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === channelId
            ? {
                ...channel,
                loadingTargets: false,
                errorMessage: error instanceof Error ? error.message : '无法拉取订阅目标',
              }
            : channel,
        ),
      );
      throw error;
    }
  };

  const connectChannel = async (id: string): Promise<void> => {
    try {
      const result = await channelsClient.start(ensureToken(), id);
      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === id
            ? {
                ...channel,
                status: (result.status as ChannelSettingsEntry['status']) ?? 'connected',
                errorMessage: undefined,
              }
            : channel,
        ),
      );
    } catch (error) {
      logger.error('failed to connect channel', error);
      applyChannelError(id, error instanceof Error ? error.message : '连接通道失败');
      throw error;
    }
  };

  const disconnectChannel = async (id: string): Promise<void> => {
    try {
      const result = await channelsClient.stop(ensureToken(), id);
      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === id
            ? {
                ...channel,
                status: (result.status as ChannelSettingsEntry['status']) ?? 'disconnected',
                errorMessage: undefined,
              }
            : channel,
        ),
      );
    } catch (error) {
      logger.error('failed to disconnect channel', error);
      applyChannelError(id, error instanceof Error ? error.message : '断开通道失败');
      throw error;
    }
  };

  const refreshDiagnostics = async (channelId: string): Promise<void> => {
    try {
      const diagnostics = await channelsClient.diagnostics(ensureToken(), channelId);
      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === channelId
            ? {
                ...channel,
                diagnostics,
                errorMessage: undefined,
              }
            : channel,
        ),
      );
    } catch (error) {
      logger.error('failed to load channel diagnostics', error);
      applyChannelError(channelId, error instanceof Error ? error.message : '无法读取通道诊断');
      throw error;
    }
  };

  const deleteChannel = async (id: string): Promise<void> => {
    try {
      await channelsClient.remove(ensureToken(), id);
      setChannels((prev) => prev.filter((channel) => channel.id !== id));
    } catch (error) {
      logger.error('failed to delete channel', error);
      applyChannelError(id, error instanceof Error ? error.message : '删除通道失败');
      throw error;
    }
  };

  const startWeixinLogin = async (input: {
    accountId?: string;
    baseUrl?: string;
    routeTag?: string;
    force?: boolean;
  }) => {
    return channelsClient.startWeixinLogin(ensureToken(), input);
  };

  const waitWeixinLogin = async (input: {
    sessionKey: string;
    baseUrl?: string;
    routeTag?: string;
    timeoutMs?: number;
  }) => {
    return channelsClient.waitWeixinLogin(ensureToken(), input);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              marginBottom: 4,
            }}
          >
            Channels
          </div>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--fg-strong)',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            消息频道
          </h2>
          <p
            style={{
              fontSize: 12,
              color: 'var(--fg-muted)',
              margin: '6px 0 0',
              lineHeight: 1.5,
            }}
          >
            配置 Telegram、Discord、飞书、钉钉等消息平台渠道，绑定模型与工具权限。
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {connectedCount > 0 && <StatusPill label={`${connectedCount} 已连接`} color="success" />}
          {disconnectedCount > 0 && (
            <StatusPill label={`${disconnectedCount} 未连接`} color="muted" />
          )}
        </div>
      </div>
      {(loadError ?? personaError) ? (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 10,
            border: '1px solid var(--complement-border)',
            background: 'var(--complement-subtle)',
            color: 'var(--complement)',
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.5,
          }}
        >
          {loadError ?? personaError}
        </div>
      ) : null}
      <ChannelSubscriptionSettings
        channels={channels}
        descriptors={descriptors}
        providers={providers}
        personas={personas}
        onSave={saveChannel}
        onConnect={connectChannel}
        onDisconnect={disconnectChannel}
        onDelete={deleteChannel}
        onRefreshTargets={refreshTargets}
        onRefreshDiagnostics={refreshDiagnostics}
        onStartWeixinLogin={startWeixinLogin}
        onWaitWeixinLogin={waitWeixinLogin}
      />
      <ChannelConversationHistoryPanel channels={channels} gatewayUrl={gatewayUrl} token={token} />
    </div>
  );
}
