import { validateMemberAclDocumentForSave } from './ChannelMemberAclEditor.js';
import {
  DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
  normalizeChannelCapabilityContextToolPromptInjections,
} from './channel-capability-tool-groups.js';
import { CHANNEL_ICON } from './channel-subscription-settings.constants.js';
import type {
  ChannelDraft,
  ChannelEditorStatus,
  ChannelEditorType,
  ChannelFeaturesEntry,
  ChannelPermissionsEntry,
  ChannelPromptInjections,
  ChannelSettingsEntry,
  ChannelTargetEntry,
  ChannelTypeDescriptor,
} from './channel-subscription-settings.types.js';

const TRUTHY_BOOLEAN_CONFIG_VALUES = new Set(['1', 'true', 'yes', 'on']);

/**
 * 订阅编辑器的草稿模型（默认值 / 反序列化 / 归一化 / 有效性判定）。
 *
 * 全部是纯函数，从 `ChannelSubscriptionSettings.tsx` 抽出，便于单测与减重。
 */

export function cloneDraft(draft: ChannelDraft): ChannelDraft {
  return {
    ...draft,
    config: { ...draft.config },
    subscriptions: draft.subscriptions.map((subscription) => ({ ...subscription })),
    features: { ...draft.features },
    tools: { ...draft.tools },
    permissions: {
      ...draft.permissions,
      readablePathPrefixes: [...draft.permissions.readablePathPrefixes],
    },
    persona: draft.persona ? { ...draft.persona } : null,
    promptInjections: {
      capabilityContext: {
        ...draft.promptInjections.capabilityContext,
        toolGroups: { ...draft.promptInjections.capabilityContext.toolGroups },
      },
    },
  };
}

export function createDefaultPermissions(): ChannelPermissionsEntry {
  return {
    allowReadHome: false,
    readablePathPrefixes: [],
    allowWriteOutside: false,
    allowShell: false,
    allowSubAgents: true,
  };
}

export function createDefaultFeatures(): ChannelFeaturesEntry {
  return {
    autoReply: true,
    streamingReply: true,
    autoStart: true,
  };
}

export function createDefaultPromptInjections(): ChannelPromptInjections {
  return {
    capabilityContext: {
      agents: true,
      skills: true,
      mcps: true,
      tools: true,
      toolGroups: { ...DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS },
      commands: true,
    },
  };
}

export function getChannelIcon(icon: string): string {
  return CHANNEL_ICON[icon as ChannelEditorType] ?? CHANNEL_ICON['slack'] ?? '•';
}

export function createToolsFromDescriptor(
  descriptor: ChannelTypeDescriptor | undefined,
): Record<string, boolean> {
  if (!descriptor) {
    return {};
  }

  return descriptor.tools.reduce<Record<string, boolean>>((acc, tool) => {
    if (tool.defaultEnabled !== false) {
      acc[tool.key] = true;
    }
    return acc;
  }, {});
}

export function isChannelRuntimeToolKey(key: string): boolean {
  return key.startsWith('Plugin') || key.startsWith('Feishu') || key.startsWith('Weixin');
}

export function createDraftFromDescriptor(descriptor: ChannelTypeDescriptor): ChannelDraft {
  return {
    type: descriptor.type,
    name: descriptor.displayName,
    enabled: true,
    config: descriptor.configSchema.reduce<Record<string, string>>((acc, field) => {
      acc[field.key] = '';
      return acc;
    }, {}),
    replyLanguage: 'zh-CN',
    subscriptions: [],
    features: createDefaultFeatures(),
    channelLlmToolsEnabled: false,
    providerId: null,
    model: null,
    tools: createToolsFromDescriptor(descriptor),
    permissions: createDefaultPermissions(),
    persona: null,
    promptInjections: createDefaultPromptInjections(),
  };
}

export function buildDraftFromEntry(
  entry: ChannelSettingsEntry,
  descriptor: ChannelTypeDescriptor | undefined,
): ChannelDraft {
  const tools = entry.tools ? { ...entry.tools } : createToolsFromDescriptor(descriptor);
  for (const tool of descriptor?.tools ?? []) {
    if (tool.key in tools || tool.defaultEnabled === false || !isChannelRuntimeToolKey(tool.key)) {
      continue;
    }
    tools[tool.key] = true;
  }

  return cloneDraft({
    type: entry.type,
    name: entry.name,
    enabled: entry.enabled,
    config: {
      ...(descriptor ? createDraftFromDescriptor(descriptor).config : {}),
      ...entry.config,
    },
    replyLanguage: entry.replyLanguage ?? 'zh-CN',
    subscriptions: entry.subscriptions,
    features: { ...createDefaultFeatures(), ...(entry.features ?? {}) },
    channelLlmToolsEnabled: entry.channelLlmToolsEnabled ?? false,
    providerId: entry.providerId ?? null,
    model: entry.model ?? null,
    tools,
    permissions: { ...createDefaultPermissions(), ...(entry.permissions ?? {}) },
    persona: entry.persona ?? null,
    promptInjections: {
      capabilityContext: {
        ...createDefaultPromptInjections().capabilityContext,
        ...(entry.promptInjections?.capabilityContext ?? {}),
        toolGroups: normalizeChannelCapabilityContextToolPromptInjections(
          entry.promptInjections?.capabilityContext?.toolGroups,
        ),
      },
    },
  });
}

export function normalizeDraft(draft: ChannelDraft): ChannelDraft {
  const normalizedConfig = Object.entries(draft.config).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      const trimmedValue = value.trim();
      if (trimmedValue.length > 0) {
        acc[key] = trimmedValue;
      }
      return acc;
    },
    {},
  );

  const normalizedPrefixes = Array.from(
    new Set(
      draft.permissions.readablePathPrefixes
        .map((prefix) => prefix.trim())
        .filter((prefix) => prefix.length > 0),
    ),
  );

  const normalizedSubscriptions = draft.subscriptions
    .filter((subscription) => subscription.enabled)
    .map((subscription) => ({
      chatId: subscription.chatId,
      name: subscription.name.trim() || subscription.chatId,
      enabled: true,
    }));

  return {
    ...draft,
    name: draft.name.trim(),
    config: normalizedConfig,
    replyLanguage: draft.replyLanguage,
    tools: { ...draft.tools },
    permissions: {
      ...draft.permissions,
      readablePathPrefixes: normalizedPrefixes,
    },
    persona: draft.persona,
    promptInjections: {
      capabilityContext: {
        ...draft.promptInjections.capabilityContext,
        toolGroups: { ...draft.promptInjections.capabilityContext.toolGroups },
      },
    },
    subscriptions: normalizedSubscriptions,
  };
}

export function getStatusTone(status: ChannelEditorStatus): { label: string; color: string } {
  switch (status) {
    case 'connected':
      return { label: '运行中', color: 'var(--success)' };
    case 'error':
      return { label: '异常', color: 'var(--danger)' };
    case 'pending':
      return { label: '待创建', color: 'var(--warning)' };
    default:
      return { label: '已停止', color: 'var(--fg-muted)' };
  }
}

export function channelMatchesQuery(
  channel: ChannelSettingsEntry,
  descriptor: ChannelTypeDescriptor | undefined,
  query: string,
): boolean {
  if (!query) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  return [channel.name, channel.type, descriptor?.displayName, descriptor?.description]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(normalized));
}

export function descriptorMatchesQuery(descriptor: ChannelTypeDescriptor, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  return [descriptor.displayName, descriptor.type, descriptor.description].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

export function isDraftValid(
  draft: ChannelDraft,
  descriptor: ChannelTypeDescriptor | undefined,
): boolean {
  const normalized = normalizeDraft(draft);
  if (!normalized.name.trim()) {
    return false;
  }

  return (descriptor?.configSchema ?? []).every((field) => {
    const value = normalized.config[field.key];
    if (field.required && !value?.trim()) {
      return false;
    }
    if (field.key === 'memberAclJson') {
      return validateMemberAclDocumentForSave(value ?? '');
    }
    if (field.key === 'requireMentionInGroup' && value) {
      return TRUTHY_BOOLEAN_CONFIG_VALUES.has(value.trim().toLowerCase());
    }
    return true;
  });
}

export function buildAutoStartFailureMessage(channel: ChannelSettingsEntry): string {
  return `已保存配置，但自动启动失败：${
    channel.errorMessage?.trim() || '请检查平台凭证、事件订阅与网关权限。'
  }`;
}
