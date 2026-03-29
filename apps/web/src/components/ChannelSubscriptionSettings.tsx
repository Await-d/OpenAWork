import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CHANNEL_SUBSCRIPTION_SETTINGS_STYLES } from './channel-subscription-settings.styles.js';

export type ChannelEditorType =
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'feishu'
  | 'dingtalk'
  | 'wecom'
  | 'whatsapp'
  | 'qq';

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

export interface ChannelProviderOption {
  id: string;
  name: string;
  defaultModels: Array<{ id: string; label: string; enabled: boolean }>;
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

export interface ChannelTypeDescriptor {
  type: ChannelEditorType;
  displayName: string;
  description: string;
  icon: string;
  category: ChannelDescriptorCategory;
  configSchema: ChannelDescriptorField[];
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
  providerId?: string | null;
  model?: string | null;
  tools?: Record<string, boolean>;
  permissions?: ChannelPermissionsEntry;
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
  providerId: string | null;
  model: string | null;
  tools: Record<string, boolean>;
  permissions: ChannelPermissionsEntry;
}

export interface ChannelSubscriptionSettingsProps {
  channels: ChannelSettingsEntry[];
  descriptors: ChannelTypeDescriptor[];
  providers?: ChannelProviderOption[];
  onSave: (channelId: string | null, draft: ChannelDraft) => Promise<ChannelSettingsEntry>;
  onDelete?: (channelId: string) => Promise<void>;
  onConnect?: (channelId: string) => Promise<void>;
  onDisconnect?: (channelId: string) => Promise<void>;
  onRefreshTargets?: (channelId: string) => Promise<void>;
  style?: CSSProperties;
}

type PendingAction = 'save' | 'connect' | 'disconnect' | 'delete' | 'refresh' | null;

const CATEGORY_ORDER: ChannelDescriptorCategory[] = ['china', 'international', 'custom'];

const CATEGORY_LABEL: Record<ChannelDescriptorCategory, string> = {
  china: '国内渠道',
  international: '国际渠道',
  custom: '自定义',
};

const CHANNEL_ICON: Record<string, string> = {
  telegram: '✈',
  discord: '◈',
  slack: '#',
  feishu: '飞',
  dingtalk: '钉',
  wecom: '企',
  whatsapp: '◎',
  qq: 'Q',
};

const FEATURE_OPTIONS: Array<{
  key: keyof ChannelFeaturesEntry;
  label: string;
  description: string;
}> = [
  {
    key: 'autoReply',
    label: '自动回复',
    description: '收到新消息后自动创建会话并生成回复。',
  },
  {
    key: 'streamingReply',
    label: '流式回复',
    description: '渠道支持时优先使用逐步更新的流式输出。',
  },
  {
    key: 'autoStart',
    label: '自动启动',
    description: 'Gateway 重启后自动拉起当前通道实例。',
  },
];

const PERMISSION_OPTIONS: Array<{
  key: Exclude<keyof ChannelPermissionsEntry, 'readablePathPrefixes'>;
  label: string;
  description: string;
}> = [
  {
    key: 'allowReadHome',
    label: '允许读取 Home',
    description: '允许代理读取用户目录内的文件。',
  },
  {
    key: 'allowWriteOutside',
    label: '允许工作区外写入',
    description: '允许代理修改工作区之外的文件。',
  },
  {
    key: 'allowShell',
    label: '允许 Shell',
    description: '允许代理运行终端命令与脚本。',
  },
  {
    key: 'allowSubAgents',
    label: '允许子代理',
    description: '允许代理继续派生子任务协作执行。',
  },
];

const EMPTY_DRAFT: ChannelDraft = {
  type: 'telegram',
  name: '',
  enabled: true,
  config: {},
  subscriptions: [],
  features: {
    autoReply: true,
    streamingReply: true,
    autoStart: true,
  },
  providerId: null,
  model: null,
  tools: {},
  permissions: {
    allowReadHome: false,
    readablePathPrefixes: [],
    allowWriteOutside: false,
    allowShell: false,
    allowSubAgents: true,
  },
};

function cloneDraft(draft: ChannelDraft): ChannelDraft {
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
  };
}

function createDefaultPermissions(): ChannelPermissionsEntry {
  return {
    allowReadHome: false,
    readablePathPrefixes: [],
    allowWriteOutside: false,
    allowShell: false,
    allowSubAgents: true,
  };
}

function createDefaultFeatures(): ChannelFeaturesEntry {
  return {
    autoReply: true,
    streamingReply: true,
    autoStart: true,
  };
}

function getChannelIcon(icon: string): string {
  return CHANNEL_ICON[icon] ?? CHANNEL_ICON['slack'] ?? '•';
}

function createToolsFromDescriptor(
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

function createDraftFromDescriptor(descriptor: ChannelTypeDescriptor): ChannelDraft {
  return {
    type: descriptor.type,
    name: descriptor.displayName,
    enabled: true,
    config: descriptor.configSchema.reduce<Record<string, string>>((acc, field) => {
      acc[field.key] = '';
      return acc;
    }, {}),
    subscriptions: [],
    features: createDefaultFeatures(),
    providerId: null,
    model: null,
    tools: createToolsFromDescriptor(descriptor),
    permissions: createDefaultPermissions(),
  };
}

function buildDraftFromEntry(
  entry: ChannelSettingsEntry,
  descriptor: ChannelTypeDescriptor | undefined,
): ChannelDraft {
  return cloneDraft({
    type: entry.type,
    name: entry.name,
    enabled: entry.enabled,
    config: {
      ...(descriptor ? createDraftFromDescriptor(descriptor).config : {}),
      ...entry.config,
    },
    subscriptions: entry.subscriptions,
    features: { ...createDefaultFeatures(), ...(entry.features ?? {}) },
    providerId: entry.providerId ?? null,
    model: entry.model ?? null,
    tools: entry.tools ?? createToolsFromDescriptor(descriptor),
    permissions: { ...createDefaultPermissions(), ...(entry.permissions ?? {}) },
  });
}

function normalizeDraft(draft: ChannelDraft): ChannelDraft {
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
    tools: Object.fromEntries(Object.entries(draft.tools).filter(([, enabled]) => enabled)),
    permissions: {
      ...draft.permissions,
      readablePathPrefixes: normalizedPrefixes,
    },
    subscriptions: normalizedSubscriptions,
  };
}

function getStatusTone(status: ChannelEditorStatus): { label: string; color: string } {
  switch (status) {
    case 'connected':
      return { label: '运行中', color: '#34d399' };
    case 'error':
      return { label: '异常', color: '#f87171' };
    case 'pending':
      return { label: '待创建', color: '#fbbf24' };
    default:
      return { label: '已停止', color: '#94a3b8' };
  }
}

function channelMatchesQuery(
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

function descriptorMatchesQuery(descriptor: ChannelTypeDescriptor, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  return [descriptor.displayName, descriptor.type, descriptor.description].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

function isDraftValid(draft: ChannelDraft, descriptor: ChannelTypeDescriptor | undefined): boolean {
  const normalized = normalizeDraft(draft);
  if (!normalized.name.trim()) {
    return false;
  }

  return (descriptor?.configSchema ?? []).every(
    (field) => !field.required || Boolean(normalized.config[field.key]?.trim()),
  );
}

export function ChannelSubscriptionSettings({
  channels,
  descriptors,
  providers = [],
  onSave,
  onDelete,
  onConnect,
  onDisconnect,
  onRefreshTargets,
  style,
}: ChannelSubscriptionSettingsProps) {
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [creatingType, setCreatingType] = useState<ChannelEditorType | null>(null);
  const [draft, setDraft] = useState<ChannelDraft>(cloneDraft(EMPTY_DRAFT));
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [newReadPath, setNewReadPath] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  const descriptorMap = useMemo(
    () => new Map(descriptors.map((descriptor) => [descriptor.type, descriptor] as const)),
    [descriptors],
  );

  const selectedChannel = creatingType
    ? undefined
    : (channels.find((channel) => channel.id === selectedKey) ?? channels[0]);

  const activeDescriptor = creatingType
    ? descriptorMap.get(creatingType)
    : selectedChannel
      ? descriptorMap.get(selectedChannel.type)
      : undefined;

  const filteredDescriptors = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: descriptors.filter(
        (descriptor) =>
          descriptor.category === category && descriptorMatchesQuery(descriptor, query),
      ),
    })).filter((group) => group.items.length > 0);
  }, [descriptors, query]);

  const filteredChannels = useMemo(() => {
    return channels.filter((channel) =>
      channelMatchesQuery(channel, descriptorMap.get(channel.type), query),
    );
  }, [channels, descriptorMap, query]);

  useEffect(() => {
    if (creatingType) {
      return;
    }

    if (!selectedKey && channels[0]) {
      setSelectedKey(channels[0].id);
      return;
    }

    if (selectedKey && !channels.some((channel) => channel.id === selectedKey)) {
      setSelectedKey(channels[0]?.id ?? '');
    }
  }, [channels, creatingType, selectedKey]);

  useEffect(() => {
    if (creatingType) {
      const descriptor = descriptorMap.get(creatingType);
      setDraft(descriptor ? createDraftFromDescriptor(descriptor) : cloneDraft(EMPTY_DRAFT));
      setVisibleSecrets({});
      setNewReadPath('');
      return;
    }

    if (selectedChannel) {
      setDraft(buildDraftFromEntry(selectedChannel, descriptorMap.get(selectedChannel.type)));
      setVisibleSecrets({});
      setNewReadPath('');
    }
  }, [creatingType, descriptorMap, selectedChannel]);

  useEffect(() => {
    const focusKey = `${creatingType ?? 'existing'}:${selectedChannel?.id ?? ''}`;
    const timer = globalThis.setTimeout(() => {
      firstInputRef.current?.focus();
      firstInputRef.current?.select?.();
    }, 0);

    return () => {
      globalThis.clearTimeout(timer);
      void focusKey;
    };
  }, [creatingType, selectedChannel?.id]);

  const baselineDraft = useMemo(() => {
    if (creatingType) {
      const descriptor = descriptorMap.get(creatingType);
      return descriptor ? createDraftFromDescriptor(descriptor) : cloneDraft(EMPTY_DRAFT);
    }

    if (selectedChannel) {
      return buildDraftFromEntry(selectedChannel, descriptorMap.get(selectedChannel.type));
    }

    return null;
  }, [creatingType, descriptorMap, selectedChannel]);

  const selectedProvider = providers.find((provider) => provider.id === draft.providerId) ?? null;
  const providerModels = selectedProvider?.defaultModels ?? [];
  const toolOptions = useMemo(() => {
    const descriptorTools = activeDescriptor?.tools ?? [];
    const extraKeys = Object.keys(draft.tools).filter(
      (key) => !descriptorTools.some((tool) => tool.key === key),
    );

    return [
      ...descriptorTools,
      ...extraKeys.map((key) => ({
        key,
        label: key,
        description: '已从历史配置中保留的工具权限。',
      })),
    ];
  }, [activeDescriptor, draft.tools]);

  const statusTone = selectedChannel
    ? getStatusTone(selectedChannel.status)
    : getStatusTone('pending');
  const isDirty = baselineDraft
    ? JSON.stringify(normalizeDraft(draft)) !== JSON.stringify(normalizeDraft(baselineDraft))
    : false;
  const isValid = isDraftValid(draft, activeDescriptor);
  const isBusy = pendingAction !== null;
  const canRefreshTargets = Boolean(selectedChannel && onRefreshTargets);
  const availableTargets = selectedChannel?.availableTargets ?? [];
  const currentError = actionError ?? selectedChannel?.errorMessage ?? null;

  function startCreating(type: ChannelEditorType): void {
    setCreatingType(type);
    setSelectedKey('');
    setActionError(null);
  }

  function selectExisting(channelId: string): void {
    setCreatingType(null);
    setSelectedKey(channelId);
    setActionError(null);
  }

  function toggleSecret(fieldKey: string): void {
    setVisibleSecrets((current) => ({ ...current, [fieldKey]: !current[fieldKey] }));
  }

  function updatePermission<K extends keyof ChannelPermissionsEntry>(
    key: K,
    value: ChannelPermissionsEntry[K],
  ): void {
    setDraft((current) => ({
      ...current,
      permissions: { ...current.permissions, [key]: value },
    }));
  }

  function toggleTool(toolKey: string): void {
    setDraft((current) => ({
      ...current,
      tools: {
        ...current.tools,
        [toolKey]: !current.tools[toolKey],
      },
    }));
  }

  function toggleSubscription(target: ChannelTargetEntry): void {
    setDraft((current) => {
      const exists = current.subscriptions.some(
        (subscription) => subscription.chatId === target.id,
      );
      if (exists) {
        return {
          ...current,
          subscriptions: current.subscriptions.filter(
            (subscription) => subscription.chatId !== target.id,
          ),
        };
      }

      return {
        ...current,
        subscriptions: [
          ...current.subscriptions,
          { chatId: target.id, name: target.name, enabled: true },
        ],
      };
    });
  }

  function addReadablePath(): void {
    const trimmed = newReadPath.trim();
    if (!trimmed) {
      return;
    }

    if (draft.permissions.readablePathPrefixes.includes(trimmed)) {
      setNewReadPath('');
      return;
    }

    updatePermission('readablePathPrefixes', [...draft.permissions.readablePathPrefixes, trimmed]);
    setNewReadPath('');
  }

  function handleReadPathKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      addReadablePath();
    }
  }

  async function handleSave(): Promise<void> {
    if (!activeDescriptor || !isValid) {
      return;
    }

    setPendingAction('save');
    setActionError(null);
    try {
      const normalizedDraft = normalizeDraft({
        ...draft,
        name: draft.name.trim() || activeDescriptor.displayName,
      });
      const savedChannel = await onSave(selectedChannel?.id ?? null, normalizedDraft);
      setCreatingType(null);
      setSelectedKey(savedChannel.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '保存通道配置失败');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleConnect(): Promise<void> {
    if (!selectedChannel || !onConnect) {
      return;
    }

    setPendingAction('connect');
    setActionError(null);
    try {
      await onConnect(selectedChannel.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '连接通道失败');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDisconnect(): Promise<void> {
    if (!selectedChannel || !onDisconnect) {
      return;
    }

    setPendingAction('disconnect');
    setActionError(null);
    try {
      await onDisconnect(selectedChannel.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '断开通道失败');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selectedChannel || !onDelete) {
      return;
    }

    setPendingAction('delete');
    setActionError(null);
    try {
      await onDelete(selectedChannel.id);
      setSelectedKey('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '删除通道失败');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRefreshTargets(): Promise<void> {
    if (!selectedChannel || !onRefreshTargets) {
      return;
    }

    setPendingAction('refresh');
    setActionError(null);
    try {
      await onRefreshTargets(selectedChannel.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '刷新订阅目标失败');
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="channel-studio" style={style}>
      <style>{CHANNEL_SUBSCRIPTION_SETTINGS_STYLES}</style>

      <aside className="channel-card channel-sidebar">
        <div className="channel-sidebar__hero">
          <div className="channel-sidebar__eyebrow">Channel Studio</div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 14,
              alignItems: 'flex-start',
            }}
          >
            <div>
              <h3 className="channel-sidebar__title">渠道模板库</h3>
              <p className="channel-sidebar__description">
                借鉴 OpenCowork
                的使用方式：先选择平台模板，再围绕配置、模型、工具与权限完成一站式接入。
              </p>
            </div>
            <span className="channel-chip">{channels.length} 个实例</span>
          </div>
        </div>

        <div className="channel-search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索平台、实例名称或描述"
          />
        </div>

        <div className="channel-sidebar__body">
          {filteredDescriptors.length === 0 ? (
            <div className="channel-empty">当前没有可用的渠道模板，或筛选条件下没有匹配结果。</div>
          ) : (
            filteredDescriptors.map((group) => (
              <section key={group.category} className="channel-group">
                <div className="channel-group__header">
                  <div className="channel-group__title">{CATEGORY_LABEL[group.category]}</div>
                  <span className="channel-mini-badge">{group.items.length} 个模板</span>
                </div>
                <div className="channel-group">
                  {group.items.map((descriptor) => {
                    const configuredCount = channels.filter(
                      (channel) => channel.type === descriptor.type,
                    ).length;
                    const isActive = creatingType === descriptor.type;
                    return (
                      <button
                        key={descriptor.type}
                        type="button"
                        className={`channel-descriptor${isActive ? ' is-active' : ''}`}
                        onClick={() => startCreating(descriptor.type)}
                      >
                        <div className="channel-descriptor__body">
                          <span className="channel-icon">{getChannelIcon(descriptor.icon)}</span>
                          <div>
                            <div className="channel-descriptor__name">{descriptor.displayName}</div>
                            <div className="channel-descriptor__desc">{descriptor.description}</div>
                          </div>
                          <span className="channel-count">{configuredCount} 个</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}

          <section className="channel-group">
            <div className="channel-group__header">
              <div className="channel-group__title">已配置实例</div>
              <span className="channel-mini-badge">{filteredChannels.length} 条</span>
            </div>

            {filteredChannels.length === 0 ? (
              <div className="channel-empty">
                {channels.length === 0
                  ? '还没有保存任何通道实例。先从上面的模板库选择一个平台开始创建。'
                  : '当前筛选条件下没有匹配实例。'}
              </div>
            ) : (
              filteredChannels.map((channel) => {
                const descriptor = descriptorMap.get(channel.type);
                const tone = getStatusTone(channel.status);
                const isActive = !creatingType && selectedChannel?.id === channel.id;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    className={`channel-instance${isActive ? ' is-active' : ''}`}
                    onClick={() => selectExisting(channel.id)}
                  >
                    <div className="channel-instance__body">
                      <span className="channel-icon">
                        {getChannelIcon(descriptor?.icon ?? channel.type)}
                      </span>
                      <div>
                        <div className="channel-instance__name">{channel.name}</div>
                        <div className="channel-instance__desc">
                          {(descriptor?.displayName ?? channel.type) +
                            (channel.enabled ? ' · 已启用' : ' · 已停用')}
                        </div>
                      </div>
                      <span
                        className="channel-status-badge"
                        style={{ '--tone-color': tone.color } as CSSProperties}
                      >
                        {tone.label}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </section>
        </div>
      </aside>

      <section className="channel-card">
        {!activeDescriptor && !selectedChannel ? (
          <div className="channel-panel__hero">
            <div>
              <div className="channel-panel__eyebrow">Ready to Configure</div>
              <h3 className="channel-panel__title">选择一个渠道模板开始配置</h3>
              <p className="channel-panel__description">
                左侧模板库会按照国内 /
                国际平台分组展示。保存实例后，你就可以在这里继续管理启停、模型覆盖、权限与订阅目标。
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="channel-panel__hero">
              <div className="channel-panel__identity">
                <span className="channel-icon">
                  {getChannelIcon(activeDescriptor?.icon ?? draft.type)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="channel-panel__eyebrow">
                    {creatingType ? 'Create Channel' : 'Channel Instance'}
                  </div>
                  <div className="channel-panel__title-row">
                    <h3 className="channel-panel__title">
                      {creatingType
                        ? `新增 ${activeDescriptor?.displayName ?? draft.type}`
                        : draft.name}
                    </h3>
                    <span
                      className="channel-status-badge"
                      style={{ '--tone-color': statusTone.color } as CSSProperties}
                    >
                      {statusTone.label}
                    </span>
                    <span className="channel-mini-badge">
                      {draft.enabled ? '实例已启用' : '实例已停用'}
                    </span>
                  </div>
                  <p className="channel-panel__description">
                    {activeDescriptor?.description ?? '配置连接参数、回复策略以及工具边界。'}
                  </p>
                  <div className="channel-panel__meta">
                    <span className="channel-mini-badge">
                      平台 · {activeDescriptor?.displayName ?? draft.type}
                    </span>
                    {draft.model ? (
                      <span className="channel-mini-badge">模型 · {draft.model}</span>
                    ) : (
                      <span className="channel-mini-badge">模型 · 使用全局默认</span>
                    )}
                    <span className="channel-mini-badge">修改后需保存</span>
                  </div>
                </div>
              </div>

              <div className="channel-toolbar">
                {selectedChannel && selectedChannel.status !== 'connected' && onConnect ? (
                  <button
                    type="button"
                    className="channel-button channel-button--primary"
                    disabled={isBusy}
                    onClick={() => {
                      void handleConnect();
                    }}
                  >
                    {pendingAction === 'connect' ? '连接中…' : '启动通道'}
                  </button>
                ) : null}
                {selectedChannel && selectedChannel.status === 'connected' && onDisconnect ? (
                  <button
                    type="button"
                    className="channel-button channel-button--ghost"
                    disabled={isBusy}
                    onClick={() => {
                      void handleDisconnect();
                    }}
                  >
                    {pendingAction === 'disconnect' ? '停止中…' : '停止通道'}
                  </button>
                ) : null}
                {selectedChannel && onDelete ? (
                  <button
                    type="button"
                    className="channel-button channel-button--danger"
                    disabled={isBusy}
                    onClick={() => {
                      void handleDelete();
                    }}
                  >
                    {pendingAction === 'delete' ? '删除中…' : '删除实例'}
                  </button>
                ) : null}
                <label className="channel-toggle">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  启用实例
                </label>
              </div>
            </div>

            <div className="channel-panel__body">
              {currentError ? <div className="channel-notice">{currentError}</div> : null}

              <section className="channel-section">
                <div className="channel-section__head">
                  <div>
                    <h4 className="channel-section__title">基础信息</h4>
                    <div className="channel-muted">管理实例名称、展示身份与平台模板来源。</div>
                  </div>
                </div>
                <div className="channel-section__body channel-grid-two">
                  <div className="channel-field">
                    <div className="channel-field__label">实例名称</div>
                    <input
                      ref={firstInputRef}
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder={activeDescriptor?.displayName ?? 'Channel'}
                    />
                  </div>
                  <div className="channel-field">
                    <div className="channel-field__label">渠道模板</div>
                    <input value={activeDescriptor?.displayName ?? draft.type} disabled />
                  </div>
                </div>
              </section>

              <section className="channel-section">
                <div className="channel-section__head">
                  <div>
                    <h4 className="channel-section__title">接入参数</h4>
                    <div className="channel-muted">
                      字段由 Gateway 的渠道描述符下发，和实际后端实现保持一致。
                    </div>
                  </div>
                </div>
                <div className="channel-section__body channel-grid-fields">
                  {(activeDescriptor?.configSchema ?? []).map((field) => (
                    <div key={field.key} className="channel-field">
                      <div className="channel-field__label">
                        {field.label}
                        {field.required ? <span style={{ color: '#f87171' }}>*</span> : null}
                      </div>
                      {field.description ? (
                        <div className="channel-field__hint">{field.description}</div>
                      ) : null}
                      <div className="channel-field__input-wrap">
                        <input
                          type={
                            field.type === 'secret' && !visibleSecrets[field.key]
                              ? 'password'
                              : 'text'
                          }
                          value={draft.config[field.key] ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              config: { ...current.config, [field.key]: event.target.value },
                            }))
                          }
                          placeholder={field.placeholder}
                        />
                        {field.type === 'secret' ? (
                          <button
                            type="button"
                            className="channel-field__secret-toggle"
                            onClick={() => toggleSecret(field.key)}
                          >
                            {visibleSecrets[field.key] ? '隐藏' : '显示'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="channel-section">
                <div className="channel-section__head">
                  <div>
                    <h4 className="channel-section__title">模型覆盖</h4>
                    <div className="channel-muted">
                      为当前渠道绑定专用 Provider / Model，不绑定时继续使用全局默认模型。
                    </div>
                  </div>
                </div>
                <div className="channel-section__body channel-grid-provider">
                  <div className="channel-field">
                    <div className="channel-field__label">Provider</div>
                    <select
                      value={draft.providerId ?? ''}
                      onChange={(event) => {
                        const providerId = event.target.value || null;
                        const provider = providers.find((item) => item.id === providerId) ?? null;
                        setDraft((current) => ({
                          ...current,
                          providerId,
                          model: provider?.defaultModels.find((model) => model.enabled)?.id ?? null,
                        }));
                      }}
                    >
                      <option value="">使用全局默认</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="channel-field">
                    <div className="channel-field__label">Model</div>
                    <select
                      value={draft.model ?? ''}
                      disabled={!selectedProvider}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          model: event.target.value || null,
                        }))
                      }
                    >
                      <option value="">使用 Provider 默认模型</option>
                      {providerModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="channel-section">
                <div className="channel-section__head">
                  <div>
                    <h4 className="channel-section__title">运行策略</h4>
                    <div className="channel-muted">
                      沿用 OpenCowork
                      的核心思路：通道本身决定是否自动回复、是否流式返回以及是否自启动。
                    </div>
                  </div>
                </div>
                <div className="channel-section__body channel-tool-grid">
                  {FEATURE_OPTIONS.map((option) => (
                    <label key={option.key} className="channel-check-card">
                      <input
                        type="checkbox"
                        checked={draft.features[option.key]}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            features: {
                              ...current.features,
                              [option.key]: event.target.checked,
                            },
                          }))
                        }
                      />
                      <div>
                        <div className="channel-check-card__title">{option.label}</div>
                        <div className="channel-check-card__desc">{option.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              <section className="channel-section">
                <div className="channel-section__head">
                  <div>
                    <h4 className="channel-section__title">Agent 工具白名单</h4>
                    <div className="channel-muted">
                      默认跟随模板建议开启。关闭后会在保存时从通道配置中移除该工具能力。
                    </div>
                  </div>
                </div>
                <div className="channel-section__body channel-tool-grid">
                  {toolOptions.map((tool) => (
                    <label key={tool.key} className="channel-check-card">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.tools[tool.key])}
                        onChange={() => toggleTool(tool.key)}
                      />
                      <div>
                        <div className="channel-check-card__title">{tool.label}</div>
                        <div className="channel-check-card__desc">{tool.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              <section className="channel-section">
                <div className="channel-section__head">
                  <div>
                    <h4 className="channel-section__title">安全边界</h4>
                    <div className="channel-muted">
                      把工具权限显式写进通道配置，便于后续在执行链路中做强约束。
                    </div>
                  </div>
                </div>
                <div className="channel-section__body" style={{ display: 'grid', gap: 14 }}>
                  <div className="channel-tool-grid">
                    {PERMISSION_OPTIONS.map((option) => (
                      <label key={option.key} className="channel-check-card">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.permissions[option.key])}
                          onChange={(event) => updatePermission(option.key, event.target.checked)}
                        />
                        <div>
                          <div className="channel-check-card__title">{option.label}</div>
                          <div className="channel-check-card__desc">{option.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="channel-field">
                    <div className="channel-field__label">可读取路径前缀</div>
                    <div className="channel-field__hint">
                      当未开启"允许读取 Home"时，可通过这里补充精确白名单路径。
                    </div>
                    <div className="channel-path-entry">
                      <input
                        value={newReadPath}
                        onChange={(event) => setNewReadPath(event.target.value)}
                        onKeyDown={handleReadPathKeyDown}
                        placeholder="/workspace 或 /home/user/project"
                      />
                      <button
                        type="button"
                        className="channel-button channel-button--ghost"
                        onClick={addReadablePath}
                      >
                        添加路径
                      </button>
                    </div>
                    <div className="channel-path-list">
                      {draft.permissions.readablePathPrefixes.length === 0 ? (
                        <span className="channel-mini-badge">暂未设置路径白名单</span>
                      ) : (
                        draft.permissions.readablePathPrefixes.map((prefix) => (
                          <span key={prefix} className="channel-path-pill">
                            {prefix}
                            <button
                              type="button"
                              onClick={() =>
                                updatePermission(
                                  'readablePathPrefixes',
                                  draft.permissions.readablePathPrefixes.filter(
                                    (item) => item !== prefix,
                                  ),
                                )
                              }
                            >
                              移除
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="channel-section">
                <div className="channel-section__head">
                  <div>
                    <h4 className="channel-section__title">订阅目标</h4>
                    <div className="channel-muted">
                      连接通道后可以拉取群组 / 会话列表，再将目标加入当前实例的订阅范围。
                    </div>
                  </div>
                  {selectedChannel ? (
                    <button
                      type="button"
                      className="channel-button channel-button--ghost"
                      disabled={!canRefreshTargets || isBusy}
                      onClick={() => {
                        void handleRefreshTargets();
                      }}
                    >
                      {pendingAction === 'refresh'
                        ? '刷新中…'
                        : selectedChannel.loadingTargets
                          ? '刷新中…'
                          : '刷新目标'}
                    </button>
                  ) : null}
                </div>
                <div className="channel-section__body">
                  {availableTargets.length === 0 ? (
                    <div className="channel-notice channel-notice--neutral">
                      {selectedChannel
                        ? selectedChannel.status === 'connected'
                          ? '当前尚未获取到可订阅目标，请点击右上角的“刷新目标”。'
                          : '请先保存并启动通道，然后再刷新订阅目标。'
                        : '创建实例并保存后，这里会展示可选的频道 / 群组目标。'}
                    </div>
                  ) : (
                    <div className="channel-targets">
                      {availableTargets.map((target) => {
                        const checked = draft.subscriptions.some(
                          (subscription) => subscription.chatId === target.id,
                        );
                        return (
                          <label
                            key={target.id}
                            className={`channel-target-row${checked ? ' is-selected' : ''}`}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                minWidth: 0,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSubscription(target)}
                              />
                              <div style={{ minWidth: 0 }}>
                                <div className="channel-target-name">{target.name}</div>
                                <div className="channel-target-id">{target.id}</div>
                              </div>
                            </div>
                            <div className="channel-target-actions">
                              {typeof target.memberCount === 'number' ? (
                                <span className="channel-mini-badge">{target.memberCount} 人</span>
                              ) : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="channel-panel__footer">
              <div className="channel-footer__meta">
                {creatingType
                  ? '当前正在创建新实例。先填写接入参数，再保存到网关。'
                  : isDirty
                    ? '检测到未保存变更。保存后才会同步到 Gateway。'
                    : '当前配置已与 Gateway 同步。'}
              </div>
              <div className="channel-footer__actions">
                {creatingType ? (
                  <button
                    type="button"
                    className="channel-button channel-button--ghost"
                    disabled={isBusy}
                    onClick={() => {
                      setCreatingType(null);
                      setActionError(null);
                    }}
                  >
                    取消创建
                  </button>
                ) : null}
                <button
                  type="button"
                  className="channel-button channel-button--primary"
                  disabled={isBusy || !isValid || (!creatingType && !isDirty)}
                  onClick={() => {
                    void handleSave();
                  }}
                >
                  {pendingAction === 'save' ? '保存中…' : creatingType ? '创建并保存' : '保存改动'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
