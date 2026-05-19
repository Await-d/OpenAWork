import React from 'react';
import { createChannelsClient } from '@openAwork/web-client';
import { StatusPill } from '@openAwork/shared-ui';
import type {
  ChannelDraft,
  ChannelTypeDescriptor,
  ChannelProviderOption,
  ChannelSettingsEntry,
  ChannelTargetEntry,
} from '../../../components/common/display/ChannelSubscriptionSettings.js';
import { ChannelSubscriptionSettings } from '../../../components/common/display/ChannelSubscriptionSettings.js';
import { logger } from '../../../utils/log/logger.js';
import { SS, UV } from '../shared/settings-section-styles.js';

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
  const channelsClient = createChannelsClient<
    ChannelSettingsEntry,
    ChannelTypeDescriptor,
    ChannelTargetEntry
  >(gatewayUrl);
  const ensureToken = (): string => {
    if (!token) throw new Error('未登录');
    return token;
  };
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

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)', flex: 1 }}>消息频道</h2>
        {connectedCount > 0 && <StatusPill label={`${connectedCount} 已连接`} color="success" />}
        {disconnectedCount > 0 && (
          <StatusPill label={`${disconnectedCount} 未连接`} color="muted" />
        )}
      </div>
      <section style={SS}>
        {loadError ? (
          <div
            style={{
              ...UV,
              marginBottom: 12,
              color: 'var(--danger)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {loadError}
          </div>
        ) : null}
        <div style={UV}>
          <ChannelSubscriptionSettings
            channels={channels}
            descriptors={descriptors}
            providers={providers}
            onSave={saveChannel}
            onConnect={connectChannel}
            onDisconnect={disconnectChannel}
            onDelete={deleteChannel}
            onRefreshTargets={refreshTargets}
          />
        </div>
      </section>
    </>
  );
}
