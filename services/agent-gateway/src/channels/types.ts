import type { Buffer } from 'node:buffer';

export type ChannelPlatform =
  'telegram' | 'discord' | 'slack' | 'feishu' | 'dingtalk' | 'weixin' | 'wecom' | 'whatsapp' | 'qq';

export const SUPPORTED_CHANNEL_PLATFORMS = [
  'telegram',
  'discord',
  'slack',
  'feishu',
  'dingtalk',
  'weixin',
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

export type FeishuFileType = 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream';
export type FeishuMemberIdType = 'open_id' | 'user_id' | 'union_id';
export type FeishuUrgentType = 'app' | 'sms';

export interface FeishuChatMembersResult {
  readonly items: readonly unknown[];
  readonly pageToken?: string;
  readonly hasMore?: boolean;
}

export interface FeishuBitableRecordsInput {
  readonly appToken: string;
  readonly tableId: string;
  readonly records: readonly Record<string, unknown>[];
  readonly signal?: AbortSignal;
}

export interface ChannelStreamingHandle {
  update(content: string): Promise<void>;
  finish(finalContent: string): Promise<void>;
}

export interface ChannelDiagnostics {
  readonly status: ChannelStatus;
  readonly running: boolean;
  readonly transport?: string;
  readonly currentIntent?: string;
  readonly currentIntentDescription?: string;
  readonly identified?: boolean;
  readonly lastReadyAt?: number;
  readonly lastHeartbeatAckAt?: number;
  readonly lastDispatchAt?: number;
  readonly lastDispatchType?: string;
  readonly lastInboundAt?: number;
  readonly lastInboundAccepted?: boolean;
  readonly lastInboundType?: string;
  readonly lastInboundError?: string;
  readonly lastMessageAt?: number;
  readonly lastMessageChatId?: string;
  readonly lastIgnoredDispatchAt?: number;
  readonly lastIgnoredDispatchType?: string;
  readonly lastSocketCloseAt?: number;
  readonly lastSocketCloseCode?: number;
  readonly lastSocketCloseReason?: string;
  readonly lastErrorAt?: number;
  readonly lastError?: string;
  readonly note?: string;
}

export interface MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getDiagnostics?(): ChannelDiagnostics;
  sendMessage(chatId: string, content: string): Promise<{ messageId: string }>;
  replyMessage(messageId: string, content: string): Promise<{ messageId: string }>;
  sendImage?(
    chatId: string,
    input: {
      readonly buffer: Buffer;
      readonly fileName?: string;
      readonly signal?: AbortSignal;
      readonly sourceUrl?: string;
      readonly text?: string;
    },
  ): Promise<{ messageId: string }>;
  replyImage?(
    messageId: string,
    input: {
      readonly buffer: Buffer;
      readonly fileName?: string;
      readonly signal?: AbortSignal;
      readonly sourceUrl?: string;
      readonly text?: string;
    },
  ): Promise<{ messageId: string }>;
  sendFile?(
    chatId: string,
    input: {
      readonly buffer: Buffer;
      readonly fileName: string;
      readonly fileType?: FeishuFileType;
      readonly signal?: AbortSignal;
      readonly text?: string;
    },
  ): Promise<{ messageId: string }>;
  listChatMembers?(
    chatId: string,
    input?: {
      readonly pageSize?: number;
      readonly pageToken?: string;
      readonly memberIdType?: FeishuMemberIdType;
      readonly signal?: AbortSignal;
    },
  ): Promise<FeishuChatMembersResult>;
  sendMention?(
    chatId: string,
    input: {
      readonly userIds: readonly string[];
      readonly atAll?: boolean;
      readonly text: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ messageId: string }>;
  sendUrgent?(
    messageId: string,
    input: {
      readonly userIds: readonly string[];
      readonly urgentTypes: readonly FeishuUrgentType[];
      readonly userIdType?: FeishuMemberIdType;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ ok: true }>;
  listBitableApps?(input?: {
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  listBitableTables?(input: {
    readonly appToken: string;
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  listBitableFields?(input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  getBitableRecords?(input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly filter?: string;
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  createBitableRecords?(input: FeishuBitableRecordsInput): Promise<unknown>;
  updateBitableRecords?(input: FeishuBitableRecordsInput): Promise<unknown>;
  deleteBitableRecords?(input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly recordIds: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
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

export interface ChannelPersonaSelection {
  resourceId: string;
  title: string;
}

export interface ChannelInstance {
  id: string;
  type: ChannelPlatform;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  channelLlmToolsEnabled?: boolean;
  tools?: Record<string, boolean>;
  providerId?: string | null;
  model?: string | null;
  features?: ChannelFeatures;
  permissions?: ChannelPermissions;
  persona?: ChannelPersonaSelection | null;
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
