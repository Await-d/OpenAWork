import type { CSSProperties } from 'react';
import type { ChannelQuickLinkEntry } from './ChannelQuickLinks.js';

export type ChannelEditorType =
  'telegram' | 'discord' | 'slack' | 'feishu' | 'dingtalk' | 'weixin' | 'wecom' | 'whatsapp' | 'qq';

export type ChannelEditorStatus = 'connected' | 'disconnected' | 'error' | 'pending';
export type ChannelDescriptorCategory = 'china' | 'international' | 'custom';
export type ChannelDescriptorFieldType = 'text' | 'secret';

export interface ChannelSubscriptionEntry {
  chatId: string;
  name: string;
  enabled: boolean;
}

export interface ChannelTargetEntry {
  id: string;
  name: string;
  memberCount?: number;
}

export interface ChannelFeaturesEntry {
  autoReply: boolean;
  streamingReply: boolean;
  autoStart: boolean;
}

export interface ChannelPermissionsEntry {
  allowReadHome: boolean;
  readablePathPrefixes: string[];
  allowWriteOutside: boolean;
  allowShell: boolean;
  allowSubAgents: boolean;
}

export interface ChannelDiagnosticsEntry {
  status: string;
  running: boolean;
  transport?: string;
  currentIntent?: string;
  currentIntentDescription?: string;
  identified?: boolean;
  lastReadyAt?: number;
  lastHeartbeatAckAt?: number;
  lastDispatchAt?: number;
  lastDispatchType?: string;
  lastInboundAt?: number;
  lastInboundAccepted?: boolean;
  lastInboundType?: string;
  lastInboundError?: string;
  lastMessageAt?: number;
  lastMessageChatId?: string;
  lastIgnoredDispatchAt?: number;
  lastIgnoredDispatchType?: string;
  lastSocketCloseAt?: number;
  lastSocketCloseCode?: number;
  lastSocketCloseReason?: string;
  lastErrorAt?: number;
  lastError?: string;
  note?: string;
}

export interface ChannelProviderOption {
  id: string;
  name: string;
  defaultModels: Array<{ id: string; label: string; enabled: boolean }>;
}

export interface ChannelPersonaOption {
  resourceId: string;
  title: string;
  description: string;
  source: 'reference' | 'user' | 'builtin';
}

export interface ChannelPersonaSelection {
  resourceId: string;
  title: string;
}

export interface ChannelDescriptorField {
  key: string;
  label: string;
  type: ChannelDescriptorFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
}

export interface ChannelDescriptorTool {
  key: string;
  label: string;
  description: string;
  defaultEnabled?: boolean;
}

export type ChannelDescriptorLink = ChannelQuickLinkEntry;

export interface ChannelTypeDescriptor {
  type: ChannelEditorType;
  displayName: string;
  description: string;
  icon: string;
  category: ChannelDescriptorCategory;
  configSchema: ChannelDescriptorField[];
  quickLinks?: ChannelDescriptorLink[];
  tools: ChannelDescriptorTool[];
}

export interface ChannelSettingsEntry {
  id: string;
  type: ChannelEditorType;
  name: string;
  enabled: boolean;
  status: ChannelEditorStatus;
  config: Record<string, string>;
  subscriptions: ChannelSubscriptionEntry[];
  features: ChannelFeaturesEntry;
  channelLlmToolsEnabled?: boolean;
  providerId?: string | null;
  model?: string | null;
  tools?: Record<string, boolean>;
  permissions?: ChannelPermissionsEntry;
  diagnostics?: ChannelDiagnosticsEntry;
  persona?: ChannelPersonaSelection | null;
  errorMessage?: string;
  availableTargets?: ChannelTargetEntry[];
  loadingTargets?: boolean;
}

export interface ChannelDraft {
  type: ChannelEditorType;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  subscriptions: ChannelSubscriptionEntry[];
  features: ChannelFeaturesEntry;
  channelLlmToolsEnabled: boolean;
  providerId: string | null;
  model: string | null;
  tools: Record<string, boolean>;
  permissions: ChannelPermissionsEntry;
  persona: ChannelPersonaSelection | null;
}

export interface WeixinLoginStartInput {
  accountId?: string;
  baseUrl?: string;
  routeTag?: string;
  force?: boolean;
}

export interface WeixinLoginStartResult {
  sessionKey: string;
  qrCodeUrl?: string;
  message: string;
}

export interface WeixinLoginWaitInput {
  sessionKey: string;
  baseUrl?: string;
  routeTag?: string;
  timeoutMs?: number;
}

export interface WeixinLoginWaitResult {
  connected: boolean;
  message: string;
  token?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
}

export interface ChannelSubscriptionSettingsProps {
  channels: ChannelSettingsEntry[];
  descriptors: ChannelTypeDescriptor[];
  providers?: ChannelProviderOption[];
  personas?: readonly ChannelPersonaOption[];
  onSave: (channelId: string | null, draft: ChannelDraft) => Promise<ChannelSettingsEntry>;
  onDelete?: (channelId: string) => Promise<void>;
  onConnect?: (channelId: string) => Promise<void>;
  onDisconnect?: (channelId: string) => Promise<void>;
  onRefreshTargets?: (channelId: string) => Promise<void>;
  onRefreshDiagnostics?: (channelId: string) => Promise<void>;
  onStartWeixinLogin?: (input: WeixinLoginStartInput) => Promise<WeixinLoginStartResult>;
  onWaitWeixinLogin?: (input: WeixinLoginWaitInput) => Promise<WeixinLoginWaitResult>;
  style?: CSSProperties;
}
