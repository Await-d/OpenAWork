import type { CSSProperties } from 'react';
import type { ChannelQuickLinkEntry } from './ChannelQuickLinks.js';
import type { ChannelExtensionImpact } from './ChannelExtensionManagementSection.js';

export type ChannelEditorType =
  'telegram' | 'discord' | 'slack' | 'feishu' | 'dingtalk' | 'weixin' | 'wecom' | 'whatsapp' | 'qq';

export type ChannelEditorStatus = 'connected' | 'disconnected' | 'error' | 'pending';
export type ChannelDescriptorCategory = 'china' | 'international' | 'custom';
export type ChannelDescriptorFieldType = 'text' | 'secret';
export type ChannelReplyLanguage = 'zh-CN' | 'en-US';

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

export interface ChannelMemberAclPermissionPatchDraft {
  allowReadHome?: boolean;
  readablePathPrefixes?: string[];
  allowWriteOutside?: boolean;
  allowShell?: boolean;
  allowSubAgents?: boolean;
}

export interface ChannelMemberAclRuleDraft {
  platformUserId: string;
  senderName?: string;
  workspaceId?: string;
  userId?: string;
  toolAllowlist?: string[] | null;
  permissions?: ChannelMemberAclPermissionPatchDraft;
}

export type ChannelCapabilityToolGroupKey =
  | 'web'
  | 'lsp'
  | 'files'
  | 'shell'
  | 'orchestration'
  | 'session'
  | 'mcp'
  | 'desktop'
  | 'repo'
  | 'channel'
  | 'other';

export interface ChannelCapabilityContextToolPromptInjections {
  web: boolean;
  lsp: boolean;
  files: boolean;
  shell: boolean;
  orchestration: boolean;
  session: boolean;
  mcp: boolean;
  desktop: boolean;
  repo: boolean;
  channel: boolean;
  other: boolean;
}

export interface ChannelCapabilityContextPromptInjections {
  agents: boolean;
  skills: boolean;
  mcps: boolean;
  tools: boolean;
  toolGroups: ChannelCapabilityContextToolPromptInjections;
  commands: boolean;
}

export interface ChannelPromptInjections {
  capabilityContext: ChannelCapabilityContextPromptInjections;
}

export interface ChannelCapabilityCatalogToolGroupCounts {
  web: number;
  lsp: number;
  files: number;
  shell: number;
  orchestration: number;
  session: number;
  mcp: number;
  desktop: number;
  repo: number;
  channel: number;
  other: number;
}

export interface ChannelCapabilityCatalogCounts {
  agents: number;
  skills: number;
  mcps: number;
  tools: number;
  toolGroups: ChannelCapabilityCatalogToolGroupCounts;
  commands: number;
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
  replyLanguage?: ChannelReplyLanguage;
  subscriptions: ChannelSubscriptionEntry[];
  features: ChannelFeaturesEntry;
  channelLlmToolsEnabled?: boolean;
  /**
   * 渠道是否开启「会话级扩展管理」（技能 / MCP 的会话内安装）。
   *
   * 默认关闭：开启后本渠道的会话按 `explicit` 策略运行，**不再继承**会话所有者的
   * 用户级技能与 MCP。因此开启必须走确认（见 `ChannelExtensionManagementSection`），
   * 不能一勾就生效。
   */
  channelExtensionManagementEnabled?: boolean;
  providerId?: string | null;
  model?: string | null;
  tools?: Record<string, boolean>;
  permissions?: ChannelPermissionsEntry;
  diagnostics?: ChannelDiagnosticsEntry;
  persona?: ChannelPersonaSelection | null;
  promptInjections?: ChannelPromptInjections;
  errorMessage?: string;
  availableTargets?: ChannelTargetEntry[];
  loadingTargets?: boolean;
}

export interface ChannelDraft {
  type: ChannelEditorType;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  replyLanguage: ChannelReplyLanguage;
  subscriptions: ChannelSubscriptionEntry[];
  features: ChannelFeaturesEntry;
  channelLlmToolsEnabled: boolean;
  channelExtensionManagementEnabled: boolean;
  providerId: string | null;
  model: string | null;
  tools: Record<string, boolean>;
  permissions: ChannelPermissionsEntry;
  persona: ChannelPersonaSelection | null;
  promptInjections: ChannelPromptInjections;
}

export type ChannelCapabilityCatalogDraft = Pick<
  ChannelDraft,
  'type' | 'channelLlmToolsEnabled' | 'tools' | 'permissions'
>;

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
  capabilityCatalogCounts?: ChannelCapabilityCatalogCounts;
  onResolveCapabilityCatalogCounts?: (
    draft: ChannelCapabilityCatalogDraft,
  ) => Promise<ChannelCapabilityCatalogCounts>;
  /**
   * 读取「开启会话级扩展管理后不再继承」的用户级技能 / MCP 清单。
   *
   * 由调用方注入而不是组件自己取：清单来自设置页与技能两个客户端，组件只负责展示与
   * 「确认前不切换」的交互（见 `ChannelExtensionManagementSection`）。
   */
  onLoadChannelExtensionImpact?: () => Promise<ChannelExtensionImpact>;
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
