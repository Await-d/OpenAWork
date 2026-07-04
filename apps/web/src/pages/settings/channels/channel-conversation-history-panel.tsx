import React from 'react';
import { createChannelsClient } from '@openAwork/web-client';
import type { ChannelConversationSummary } from '@openAwork/web-client';
import { useNavigate } from 'react-router';
import type { ChannelSettingsEntry } from '../../../components/common/display/ChannelSubscriptionSettings.js';
import { logger } from '../../../utils/log/logger.js';
import './channel-conversation-history-panel.css';

interface ChannelConversationHistoryPanelProps {
  channels: ChannelSettingsEntry[];
  gatewayUrl: string;
  token: string | null;
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getConversationTitle(conversation: ChannelConversationSummary): string {
  return conversation.chatName ?? conversation.chatId;
}

export function ChannelConversationHistoryPanel({
  channels,
  gatewayUrl,
  token,
}: ChannelConversationHistoryPanelProps) {
  const navigate = useNavigate();
  const [selectedChannelId, setSelectedChannelId] = React.useState<string>(
    () => channels[0]?.id ?? '',
  );
  const [conversations, setConversations] = React.useState<ChannelConversationSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (channels.length === 0) {
      setSelectedChannelId('');
      return;
    }

    const hasSelectedChannel = channels.some((channel) => channel.id === selectedChannelId);
    if (!hasSelectedChannel) {
      setSelectedChannelId(channels[0]?.id ?? '');
    }
  }, [channels, selectedChannelId]);

  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null;

  const loadConversations = React.useCallback(async () => {
    if (!token || !selectedChannel) {
      setConversations([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const client = createChannelsClient<ChannelSettingsEntry>(gatewayUrl);
      const nextConversations = await client.listConversations(token, selectedChannel.id, {
        limit: 50,
      });
      setConversations(nextConversations);
    } catch (loadError) {
      logger.error('failed to load channel conversations', loadError);
      setConversations([]);
      setError(loadError instanceof Error ? loadError.message : '无法读取渠道对话历史');
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl, selectedChannel, token]);

  React.useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const statusContent = (() => {
    if (!token) {
      return <div className="channel-history-panel__status">登录后可查看渠道自动回复会话。</div>;
    }
    if (channels.length === 0) {
      return <div className="channel-history-panel__status">暂无已配置的消息渠道。</div>;
    }
    if (error) {
      return (
        <div className="channel-history-panel__status channel-history-panel__status--error">
          {error}
        </div>
      );
    }
    if (loading) {
      return <div className="channel-history-panel__status">正在读取渠道对话历史...</div>;
    }
    if (conversations.length === 0) {
      return <div className="channel-history-panel__status">当前渠道还没有自动回复会话。</div>;
    }
    return null;
  })();

  return (
    <section className="channel-history-panel" aria-labelledby="channel-history-title">
      <div className="channel-history-panel__header">
        <div className="channel-history-panel__title-block">
          <div className="channel-history-panel__eyebrow">conversation history</div>
          <h3 className="channel-history-panel__title" id="channel-history-title">
            渠道对话历史
          </h3>
          <p className="channel-history-panel__description">
            查看自动回复为每个群组生成的会话摘要，并跳转到完整聊天记录。
          </p>
        </div>

        <div className="channel-history-panel__controls">
          <select
            aria-label="选择消息渠道"
            className="channel-history-panel__select"
            disabled={channels.length === 0}
            onChange={(event) => setSelectedChannelId(event.target.value)}
            value={selectedChannelId}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
          <button
            className="channel-history-panel__button"
            disabled={!token || !selectedChannel || loading}
            onClick={() => void loadConversations()}
            type="button"
          >
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </div>

      {statusContent}

      {conversations.length > 0 ? (
        <div className="channel-history-panel__list">
          {conversations.map((conversation) => (
            <button
              className="channel-history-panel__conversation"
              key={conversation.id}
              onClick={() => navigate(`/chat/${conversation.id}`)}
              type="button"
            >
              <span className="channel-history-panel__conversation-main">
                <span className="channel-history-panel__conversation-title">
                  {getConversationTitle(conversation)}
                </span>
                <span className="channel-history-panel__conversation-preview">
                  {conversation.lastMessagePreview ?? '暂无消息内容'}
                </span>
                <span className="channel-history-panel__conversation-meta">
                  <span>Chat ID: {conversation.chatId}</span>
                  <span>{conversation.messageCount} 条消息</span>
                </span>
              </span>
              <span className="channel-history-panel__conversation-side">
                <span className="channel-history-panel__badge">{conversation.stateStatus}</span>
                <span>{formatConversationTime(conversation.updatedAt)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
