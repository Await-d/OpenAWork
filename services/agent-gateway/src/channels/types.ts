export type ChannelPlatform =
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'feishu'
  | 'dingtalk'
  | 'wecom'
  | 'whatsapp'
  | 'qq';

export const SUPPORTED_CHANNEL_PLATFORMS = [
  'telegram',
  'discord',
  'slack',
  'feishu',
  'dingtalk',
  'wecom',
  'whatsapp',
  'qq',
] as const satisfies readonly ChannelPlatform[];

export interface ChannelMessage {
  id: string;
  senderId: string;
  senderName: string;
  chatId: string;
  chatName?: string;
  content: string;
  timestamp: number;
  raw?: unknown;
}

export interface ChannelGroup {
  id: string;
  name: string;
  memberCount?: number;
}

export interface ChannelStreamingHandle {
  update(content: string): Promise<void>;
  finish(finalContent: string): Promise<void>;
}

export interface MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  sendMessage(chatId: string, content: string): Promise<{ messageId: string }>;
  replyMessage(messageId: string, content: string): Promise<{ messageId: string }>;
  getGroupMessages(chatId: string, count?: number): Promise<ChannelMessage[]>;
  listGroups(): Promise<ChannelGroup[]>;
  supportsStreaming?: boolean;
  sendStreamingMessage?(
    chatId: string,
    initialContent: string,
    replyToMessageId?: string,
  ): Promise<ChannelStreamingHandle>;
}

export type ChannelServiceFactory = (
  config: ChannelInstance,
  notify: (event: ChannelEvent) => void,
) => MessagingChannelService;

export type ChannelWsMessageParser = (raw: unknown) => ChannelMessage | null;

export interface ChannelPermissions {
  allowReadHome: boolean;
  readablePathPrefixes: string[];
  allowWriteOutside: boolean;
  allowShell: boolean;
  allowSubAgents: boolean;
}

export interface ChannelFeatures {
  autoReply: boolean;
  streamingReply: boolean;
  autoStart: boolean;
}

export interface ChannelSubscription {
  chatId: string;
  name: string;
  enabled: boolean;
}

export interface ChannelInstance {
  id: string;
  type: ChannelPlatform;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  tools?: Record<string, boolean>;
  providerId?: string | null;
  model?: string | null;
  features?: ChannelFeatures;
  permissions?: ChannelPermissions;
  subscriptions?: ChannelSubscription[];
  ownerUserId?: string;
  createdAt: number;
  updatedAt: number;
}

export type ChannelStatus = 'running' | 'stopped' | 'error';

export type ChannelEvent =
  | { type: 'message'; pluginId: string; message: ChannelMessage }
  | { type: 'error'; pluginId: string; error: string }
  | { type: 'status'; pluginId: string; status: ChannelStatus };
