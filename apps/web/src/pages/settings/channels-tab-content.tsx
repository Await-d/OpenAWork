import React from 'react';
import { StatusPill } from '@openAwork/shared-ui';
import type {
  ChannelDraft,
  ChannelTypeDescriptor,
  ChannelProviderOption,
  ChannelSettingsEntry,
  ChannelTargetEntry,
} from '../../components/ChannelSubscriptionSettings.js';
import { ChannelSubscriptionSettings } from '../../components/ChannelSubscriptionSettings.js';
import { logger } from '../../utils/logger.js';
import { SS, UV } from './settings-section-styles.js';

interface ChannelsTabContentProps {
  channels: ChannelSettingsEntry[];
  setChannels: React.Dispatch<React.SetStateAction<ChannelSettingsEntry[]>>;
  descriptors: ChannelTypeDescriptor[];
  providers: ChannelProviderOption[];
  loadError: string | null;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  connectedCount: number;
  disconnectedCount: number;
}

export function ChannelsTabContent({
  channels,
  setChannels,
  descriptors,
  providers,
  loadError,
  apiFetch,
  connectedCount,
  disconnectedCount,
}: ChannelsTabContentProps) {
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
    const request = channelId
      ? apiFetch(`/channels/${channelId}`, {
          method: 'PUT',
          body: JSON.stringify(draft),
        })
      : apiFetch('/channels', {
          method: 'POST',
          body: JSON.stringify(draft),
        });

    try {
      const response = await request;
      const payload = (await response.json()) as {
        channel?: ChannelSettingsEntry;
        error?: string;
      };
      if (!response.ok || !payload.channel) {
        throw new Error(payload.error ?? '保存通道配置失败');
      }

      const savedChannel = payload.channel;
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
      const response = await apiFetch(`/channels/${channelId}/groups`);
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? '无法拉取订阅目标');
      }

      const payload = (await response.json()) as { groups: ChannelTargetEntry[] };
      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === channelId
            ? {
                ...channel,
                availableTargets: payload.groups,
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
      const response = await apiFetch(`/channels/${id}/start`, { method: 'POST' });
      const payload = (await response.json()) as {
        status?: ChannelSettingsEntry['status'];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? '连接通道失败');
      }

      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === id
            ? {
                ...channel,
                status: payload.status ?? 'connected',
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
      const response = await apiFetch(`/channels/${id}/stop`, { method: 'POST' });
      const payload = (await response.json()) as {
        status?: ChannelSettingsEntry['status'];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? '断开通道失败');
      }

      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === id
            ? {
                ...channel,
                status: payload.status ?? 'disconnected',
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
      const response = await apiFetch(`/channels/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        let errorMessage = '删除通道失败';
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch (_error) {
          errorMessage = '删除通道失败';
        }
        throw new Error(errorMessage);
      }

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
        <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1 }}>消息频道</h2>
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
              color: 'var(--danger, #f87171)',
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
