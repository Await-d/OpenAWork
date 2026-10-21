import React from 'react';
import type { CapabilityDescriptor } from '@openAwork/shared';
import {
  createCapabilitiesClient,
  createChannelsClient,
  createResourcesClient,
} from '@openAwork/web-client';
import { StatusPill } from '@openAwork/shared-ui';
import { buildChannelCapabilityToolGroupCounts } from '../../../components/common/display/channel-capability-tool-groups.js';
import type {
  ChannelCapabilityCatalogDraft,
  ChannelCapabilityCatalogCounts,
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

function buildCapabilityCatalogCounts(
  capabilities: readonly CapabilityDescriptor[],
): ChannelCapabilityCatalogCounts {
  return {
    agents: capabilities.filter((capability) => capability.kind === 'agent').length,
    skills: capabilities.filter((capability) => capability.kind === 'skill').length,
    mcps: capabilities.filter(
      (capability) => capability.kind === 'mcp' && capability.enabled !== false,
    ).length,
    tools: capabilities.filter(
      (capability) => capability.kind === 'tool' && capability.callable === true,
    ).length,
    toolGroups: buildChannelCapabilityToolGroupCounts(capabilities),
    commands: capabilities.filter(
      (capability) => capability.kind === 'command' && capability.enabled !== false,
    ).length,
  };
}

const CHANNEL_CAPABILITY_CATALOG_RETRY_BASE_MS = 2_000;
const CHANNEL_CAPABILITY_CATALOG_RETRY_MAX_MS = 15_000;

function computeCapabilityCatalogRetryDelay(attempt: number): number {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(
    CHANNEL_CAPABILITY_CATALOG_RETRY_BASE_MS * 2 ** safeAttempt,
    CHANNEL_CAPABILITY_CATALOG_RETRY_MAX_MS,
  );
}

/**
 * 拉取能力目录计数（含失败重试调度）；失败一律落到 `onFailed`。
 *
 * 必须留在模块级：`try/catch` 内的值块（条件 / 逻辑）会让 React Compiler 报
 * "Support value blocks ... within a try/catch statement" 并放弃优化调用方组件
 * （实测 `ChannelsTabContent` 因此脱靶；同类改法见 `ChatPageSections.tsx` 的
 * `tryCreateCompactionCard`）。模块级普通函数不在编译器检查范围内，语义逐字不变——
 * 同一段解析、同样的重试与兜底，「try 覆盖到哪」也完全照搬（结果处理仍在 try 内）。
 */
async function loadCapabilityCatalogCountsOnce(ctx: {
  capabilitiesClient: ReturnType<typeof createCapabilitiesClient>;
  token: string;
  isCancelled: () => boolean;
  attemptRef: React.MutableRefObject<number>;
  clearRetry: () => void;
  scheduleNext: (delayMs: number) => void;
  onCounts: (counts: ChannelCapabilityCatalogCounts) => void;
  onFailed: () => void;
}): Promise<void> {
  try {
    const result = await ctx.capabilitiesClient.listResult(ctx.token);
    if (ctx.isCancelled()) {
      return;
    }
    if (result.ok) {
      ctx.clearRetry();
      ctx.attemptRef.current = 0;
      ctx.onCounts(buildCapabilityCatalogCounts(result.capabilities));
      return;
    }

    const catalogError = new Error(result.errorMessage ?? '加载能力列表失败');
    if (result.retryable) {
      const attempt = ctx.attemptRef.current + 1;
      const delayMs = computeCapabilityCatalogRetryDelay(ctx.attemptRef.current);
      ctx.attemptRef.current = attempt;
      logger.warn('failed to load channel capability catalog counts, will retry', {
        attempt,
        delayMs,
        error: catalogError,
      });
      ctx.clearRetry();
      ctx.scheduleNext(delayMs);
      return;
    }

    ctx.clearRetry();
    ctx.attemptRef.current = 0;
    logger.error('failed to load channel capability catalog counts', catalogError);
    ctx.onFailed();
  } catch (catalogCatchError: unknown) {
    if (ctx.isCancelled()) {
      return;
    }
    ctx.clearRetry();
    ctx.attemptRef.current = 0;
    logger.error('failed to load channel capability catalog counts', catalogCatchError);
    ctx.onFailed();
  }
}

/**
 * 保存（新建 / 更新）一个通道并合并进列表。
 *
 * 同样留在模块级（理由见 `loadCapabilityCatalogCountsOnce`）：这段 try/catch 里既有
 * 「三元 await」，catch 里又有三元，都会被判为 try/catch 内的值块。语义逐字不变——
 * 调用方把「选哪个请求」提前算好传进来，网络异常仍由本函数的 catch 兜住。
 */
async function saveChannelOnce(ctx: {
  request: () => Promise<ChannelSettingsEntry>;
  channelId: string | null;
  applyChannelError: (channelId: string, errorMessage?: string) => void;
  setChannels: (updater: (prev: ChannelSettingsEntry[]) => ChannelSettingsEntry[]) => void;
}): Promise<ChannelSettingsEntry> {
  try {
    const savedChannel = await ctx.request();
    ctx.setChannels((prev) => {
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
  } catch (saveChannelError) {
    logger.error('failed to save channel', saveChannelError);
    if (ctx.channelId) {
      ctx.applyChannelError(
        ctx.channelId,
        saveChannelError instanceof Error ? saveChannelError.message : '保存通道配置失败',
      );
    }
    throw saveChannelError;
  }
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
  const capabilitiesClient = React.useMemo(
    () => createCapabilitiesClient(gatewayUrl),
    [gatewayUrl],
  );
  const resourcesClient = React.useMemo(() => createResourcesClient(gatewayUrl), [gatewayUrl]);
  const [personas, setPersonas] = React.useState<readonly ChannelPersonaOption[]>([]);
  const [capabilityCatalogCounts, setCapabilityCatalogCounts] =
    React.useState<ChannelCapabilityCatalogCounts | null>(null);
  const [personaError, setPersonaError] = React.useState<string | null>(null);
  const capabilityCatalogRetryAttemptRef = React.useRef(0);
  const capabilityCatalogRetryTimerRef = React.useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  // 用 useCallback 稳定身份：它被多个 useCallback 引用，编译器要求 memo 体内用到的
  // 自定义函数必须列入依赖（"Existing memoization could not be preserved"）。写成
  // 普通箭头函数的话身份每次渲染都变，加进依赖就会把下游 memo 全部击穿。
  const ensureToken = React.useCallback((): string => {
    if (!token) throw new Error('未登录');
    return token;
  }, [token]);
  const clearCapabilityCatalogRetry = React.useCallback(() => {
    if (capabilityCatalogRetryTimerRef.current === null) {
      return;
    }
    globalThis.clearTimeout(capabilityCatalogRetryTimerRef.current);
    capabilityCatalogRetryTimerRef.current = null;
  }, []);

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
      // 参数名刻意不与下方各 `catch (error)` 同名（同 channels-tab-content 的
      // `catalogError` 注释）：同一标识符在一处是回调内的局部量、另一处是 catch 参数
      // 时，编译器会合并成同一个 SSA 变量并放弃优化整个组件。
      .catch((personasError: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }
        logger.error('failed to load channel personas', personasError);
        setPersonaError(
          personasError instanceof Error ? personasError.message : '通道人设资源加载失败',
        );
      });

    return () => abortController.abort();
  }, [resourcesClient, token]);

  React.useEffect(() => {
    if (!token) {
      clearCapabilityCatalogRetry();
      capabilityCatalogRetryAttemptRef.current = 0;
      setCapabilityCatalogCounts(null);
      return;
    }

    let cancelled = false;

    capabilityCatalogRetryAttemptRef.current = 0;
    clearCapabilityCatalogRetry();
    const loadCapabilityCatalogCounts = async (): Promise<void> => {
      // 含 try/catch 的拉取逻辑在模块级 `loadCapabilityCatalogCountsOnce`（见其注释）。
      await loadCapabilityCatalogCountsOnce({
        capabilitiesClient,
        token,
        isCancelled: () => cancelled,
        attemptRef: capabilityCatalogRetryAttemptRef,
        clearRetry: clearCapabilityCatalogRetry,
        scheduleNext: (delayMs) => {
          capabilityCatalogRetryTimerRef.current = globalThis.setTimeout(() => {
            capabilityCatalogRetryTimerRef.current = null;
            if (!cancelled) {
              void loadCapabilityCatalogCounts();
            }
          }, delayMs);
        },
        onCounts: setCapabilityCatalogCounts,
        onFailed: () => setCapabilityCatalogCounts(null),
      });
    };

    void loadCapabilityCatalogCounts();

    return () => {
      cancelled = true;
      clearCapabilityCatalogRetry();
    };
  }, [capabilitiesClient, clearCapabilityCatalogRetry, token]);

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

  const resolveCapabilityCatalogCounts = React.useCallback(
    async (draft: ChannelCapabilityCatalogDraft): Promise<ChannelCapabilityCatalogCounts> => {
      return capabilitiesClient.previewChannel(ensureToken(), {
        type: draft.type,
        channelLlmToolsEnabled: draft.channelLlmToolsEnabled,
        tools: draft.tools,
        permissions: draft.permissions,
      });
    },
    [capabilitiesClient, ensureToken],
  );

  const saveChannel = async (
    channelId: string | null,
    draft: ChannelDraft,
  ): Promise<ChannelSettingsEntry> => {
    // 「选哪个请求」的三元放进 try 外（它不抛异常），网络异常仍由模块级函数的
    // catch 兜住——见 `saveChannelOnce` 注释。
    const request = channelId
      ? () => channelsClient.update(ensureToken(), channelId, draft)
      : () => channelsClient.create(ensureToken(), draft);
    return saveChannelOnce({ request, channelId, applyChannelError, setChannels });
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
    } catch (targetsError) {
      // 错误文案在回调**外**算好：catch 参数若在 `setChannels` 的嵌套回调里被捕获，
      // 它就是 context 变量，而下面的 `throw` 又按 local 引用它——编译器要求同一变量
      // 的引用方式必须一致，否则报 "consistently local or context references" 并放弃
      // 优化整个组件。这里让回调只捕获一个字符串常量。
      const errorMessage =
        targetsError instanceof Error ? targetsError.message : '无法拉取订阅目标';
      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === channelId ? { ...channel, loadingTargets: false, errorMessage } : channel,
        ),
      );
      throw targetsError;
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
    } catch (connectError) {
      logger.error('failed to connect channel', connectError);
      applyChannelError(id, connectError instanceof Error ? connectError.message : '连接通道失败');
      throw connectError;
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
    } catch (disconnectError) {
      logger.error('failed to disconnect channel', disconnectError);
      applyChannelError(
        id,
        disconnectError instanceof Error ? disconnectError.message : '断开通道失败',
      );
      throw disconnectError;
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
    } catch (diagnosticsError) {
      logger.error('failed to load channel diagnostics', diagnosticsError);
      applyChannelError(
        channelId,
        diagnosticsError instanceof Error ? diagnosticsError.message : '无法读取通道诊断',
      );
      throw diagnosticsError;
    }
  };

  const deleteChannel = async (id: string): Promise<void> => {
    try {
      await channelsClient.remove(ensureToken(), id);
      setChannels((prev) => prev.filter((channel) => channel.id !== id));
    } catch (deleteError) {
      logger.error('failed to delete channel', deleteError);
      applyChannelError(id, deleteError instanceof Error ? deleteError.message : '删除通道失败');
      throw deleteError;
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
        capabilityCatalogCounts={capabilityCatalogCounts ?? undefined}
        onResolveCapabilityCatalogCounts={token ? resolveCapabilityCatalogCounts : undefined}
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
