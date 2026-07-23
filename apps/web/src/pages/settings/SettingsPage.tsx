import React, { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { useAuthStore } from '../../stores/auth/auth.js';
import { logger } from '../../utils/log/logger.js';
import type {
  ChannelSettingsEntry,
  ChannelTypeDescriptor,
} from '../../components/common/display/ChannelSubscriptionSettings.js';
import { validateImageGenerationSize } from '@openAwork/shared';
import {
  createChannelsClient,
  createDesktopAutomationClient,
  createDesktopControlClient,
  createGitHubClient,
  createSettingsClient,
  createSshClient,
  createUsageClient,
} from '@openAwork/web-client';
import type { DesktopControlStatus, SSHDialogEntry } from '@openAwork/web-client';
import {
  buildDevEventsFromLogs,
  createInitialDevtoolsSourceStates,
  extractPrimaryMessage,
} from './state/settings-derived.js';
import { normalizeSettingsModelPrices } from './usage/usage-data.js';
import {
  addProviderModel,
  removeProviderModel,
  toggleProviderModel,
  updateProviderModel,
} from './connection/provider-model-mutations.js';
import type {
  AIProviderRef,
  AIModelConfigRef,
  ActiveSelectionRef,
  AIModelConfigItem,
  ImageGenerationDefaultsRef,
  MonthlyRecord,
  CostBreakdownItem,
  PermissionDecisionRecord,
  PermissionRuleEntry,
  PermissionCategoryMeta,
  ModelPriceEntry,
  AttributionConfig,
  WorkerEntry,
  SSHConnectionEntry,
  FileTreeNode,
  ArtifactItem,
  ProviderCatalogUiEntry,
} from '@openAwork/shared-ui';
import { hydrateProviderCatalogUi } from '@openAwork/shared-ui';
import { ConnectionTabContent } from './connection/connection-tab-content.js';
import { DisplayTabContent } from './display/display-tab-content.js';
import { ChannelsTabContent } from './channels/channels-tab-content.js';
import { DevtoolsTabContent } from './devtools/devtools-tab-content.js';
import AboutPage from '../misc/AboutPage.js';
import {
  BUILTIN_PROVIDER_TYPE_SET,
  isTauri,
  normalizeActiveSelectionProviders,
  parseStructuredPayload,
  resolveSshDialogRestore,
  SETTINGS_LAYOUT_MAX_WIDTH,
  SETTINGS_TAB_CONTENT_GAP,
  SETTINGS_TAB_NAV_WIDTH,
  TAB_CATEGORIES,
  TABS,
  TAURI_ONLY_TAB_IDS,
  isEmbeddedRouteTab,
  type TabId,
} from './shared/settings-page-helpers.js';
import { useSettingsEnvironment } from './shared/use-settings-environment.js';
import { useSettingsUpstreamRetry } from './connection/use-settings-upstream-retry.js';
import { WorkspaceTabContent } from './workspace/workspace-tab-content.js';
import { SecurityTabContent } from './security/security-tab-content.js';
import { UsageTabContent } from './usage/usage-tab-content.js';
import { MemoryTabContent } from './memory/memory-tab-content.js';
import { CompanionTabContent } from './companion/companion-tab-content.js';
import { PluginsTabContent } from './plugins/plugins-tab-content.js';
import { DesktopTabContent } from './desktop/desktop-tab-content.js';
import { useMemoryManagement } from './memory/use-memory-management.js';
import { useProviderDefaultProfile } from './connection/use-provider-default-profile.js';
import { useSettingsTabActions } from './shared/use-settings-tab-actions.js';
import { PRELOADABLE_ROUTE_MODULES } from '../../routes/preloadable-route-modules.js';
import PageTransitionLoader from '../../components/common/feedback/PageTransitionLoader.js';
import { usePrefersReducedMotion } from '../../hooks/ui/usePrefersReducedMotion.js';
import type {
  DevtoolsSourceKey,
  DevtoolsSourceState,
  ProviderEditData,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
  ThinkingDefaultsRef,
} from './state/settings-types.js';

const SETTINGS_COMPACT_VIEWPORT_QUERY = '(max-width: 820px)';

function SettingsNavIcon({ id }: { id: string }) {
  const icons: Record<string, React.ReactNode> = {
    connection: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    ),
    display: (
      <>
        <rect x="2" y="4" width="20" height="13" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </>
    ),
    desktop: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </>
    ),
    channels: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    companion: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    memory: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </>
    ),
    templates: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="9" x2="9" y2="21" />
      </>
    ),
    agents: (
      <>
        <rect x="3" y="4" width="7" height="7" rx="2" />
        <rect x="14" y="4" width="7" height="7" rx="2" />
        <rect x="3" y="13" width="7" height="7" rx="2" />
        <rect x="14" y="13" width="7" height="7" rx="2" />
      </>
    ),
    skills: (
      <>
        <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.47 1.229 0 1.698l-1.568 1.568a1.1 1.1 0 0 0-.289.878l.31 2.208a1.1 1.1 0 0 1-1.271 1.271l-2.208-.31a1.1 1.1 0 0 0-.878.289l-1.568 1.568a1.2 1.2 0 0 1-1.698 0l-1.568-1.568a1.1 1.1 0 0 0-.878-.289l-2.208.31a1.1 1.1 0 0 1-1.271-1.271l.31-2.208a1.1 1.1 0 0 0-.289-.878L4.753 13.1a1.2 1.2 0 0 1 0-1.698l1.568-1.568a1.1 1.1 0 0 0 .289-.878l-.31-2.208a1.1 1.1 0 0 1 1.271-1.271l2.208.31a1.1 1.1 0 0 0 .878-.289l1.568-1.568a1.2 1.2 0 0 1 1.698 0l1.568 1.568a1.1 1.1 0 0 0 .878.289l2.208-.31a1.1 1.1 0 0 1 1.271 1.271z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    workflows: (
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M8 6h8" />
        <path d="M7 7.5 10.8 15" />
        <path d="M17 7.5 13.2 15" />
      </>
    ),
    schedules: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    ),
    artifacts: (
      <>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <line x1="9" y1="10" x2="9" y2="10" />
        <line x1="12" y1="10" x2="12" y2="10" />
        <line x1="15" y1="10" x2="15" y2="10" />
      </>
    ),
    images: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.5" cy="10" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </>
    ),
    sessions: (
      <>
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </>
    ),
    usage: (
      <>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </>
    ),
    security: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    workspace: (
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    ),
    resources: (
      <>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="M3.3 7 12 12l8.7-5" />
        <path d="M12 22V12" />
      </>
    ),
    devtools: (
      <>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </>
    ),
    plugins: (
      <>
        <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
        <line x1="16" y1="8" x2="2" y2="22" />
        <line x1="17.5" y1="15" x2="9" y2="15" />
      </>
    ),
    about: (
      <>
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  };

  const content = icons[id];
  if (!content) return null;

  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {content}
    </svg>
  );
}

export default function SettingsPage() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const {
    gatewayUrl,
    setGatewayUrl,
    setAuth,
    webAccessEnabled,
    webPort,
    webExposeLan,
    setWebAccess,
    customBaseUrl,
    setCustomBaseUrl,
  } = useAuthStore();
  const token = useAuthStore((s) => s.accessToken);
  const { tab } = useParams<{ tab: string }>();
  const activeTab = (TABS.find((t) => t.id === tab)?.id ?? 'connection') as TabId;
  const [customBaseUrlSaved, setCustomBaseUrlSaved] = useState(false);
  const {
    desktopGatewayBusy,
    desktopGatewayError,
    desktopGatewayMode,
    remoteAdminEmail,
    remoteAdminPassword,
    saveGatewayUrl,
    setRemoteAdminEmail,
    setRemoteAdminPassword,
    setUrlInput,
    urlInput,
    urlSaved,
  } = useSettingsEnvironment({
    gatewayUrl,
    setGatewayUrl,
    setAuth,
    token,
    webAccessEnabled,
    webPort,
    webExposeLan,
    setWebAccess,
  });
  const {
    loadUpstreamRetrySettings,
    saveUpstreamRetrySettings,
    savedUpstreamRetryMaxRetries,
    savingUpstreamRetrySettings,
    setUpstreamRetryMaxRetries,
    upstreamRetryMaxRetries,
  } = useSettingsUpstreamRetry({ gatewayUrl, token });

  const saveCustomBaseUrl = React.useCallback(() => {
    setCustomBaseUrlSaved(true);
    setTimeout(() => setCustomBaseUrlSaved(false), 2000);
  }, []);

  const memoryManagement = useMemoryManagement({
    gatewayUrl,
    token,
    active: activeTab === 'memory',
  });

  const [providers, setProviders] = useState<AIProviderRef[]>([]);
  const providersRef = useRef<AIProviderRef[]>(providers);
  const normalizeProviderSelection = React.useCallback(
    (selection: ActiveSelectionRef) =>
      normalizeActiveSelectionProviders(selection, providersRef.current),
    [],
  );
  const {
    activeSelection,
    activeSelectionRef,
    applyServerDefaults,
    defaultThinking,
    defaultThinkingRef,
    hasUnsavedDefaultModelChanges,
    imageGenerationDefaults,
    imageGenerationDefaultsRef,
    savedActiveSelectionRef,
    savedDefaultThinkingRef,
    savedImageGenerationDefaultsRef,
    savingDefaultModelSettings,
    setActiveSelection,
    setSavedActiveSelection,
    setDefaultThinking,
    setImageGenerationDefaults,
    setSavingDefaultModelSettings,
  } = useProviderDefaultProfile({
    normalizeSelection: normalizeProviderSelection,
  });
  const [filePatterns, setFilePatterns] = useState<string[]>([]);
  const [githubTriggers, setGithubTriggers] = useState<Array<{ repo: string; events: string[] }>>(
    [],
  );
  const [attribution, setAttribution] = useState<AttributionConfig>({
    coAuthoredBy: false,
    assistedBy: false,
    authorName: '',
  });
  const [usageRecords, setUsageRecords] = useState<MonthlyRecord[]>([]);
  const [usageBudget, setUsageBudget] = useState(10);
  const [monthlyCostUsd, setMonthlyCostUsd] = useState(0);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdownItem[]>([]);
  const [usageRecordsError, setUsageRecordsError] = useState<string | null>(null);
  const [costBreakdownError, setCostBreakdownError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionDecisionRecord[]>([]);
  const [permissionRules, setPermissionRules] = useState<PermissionRuleEntry[]>([]);
  const [permissionCategories, setPermissionCategories] = useState<PermissionCategoryMeta[]>([]);
  const [permissionRulesSaving, setPermissionRulesSaving] = useState(false);
  const [devLogs, setDevLogs] = useState<SettingsDevLogRecord[]>([]);
  const [workers, setWorkers] = useState<WorkerEntry[]>([]);
  const [priceModels, setPriceModels] = useState<ModelPriceEntry[]>([]);
  const [priceModelsError, setPriceModelsError] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelSettingsEntry[]>([]);
  const [channelDescriptors, setChannelDescriptors] = useState<ChannelTypeDescriptor[]>([]);
  const [channelDescriptorsLoadError, setChannelDescriptorsLoadError] = useState<string | null>(
    null,
  );
  const [channelsLoadError, setChannelsLoadError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<SettingsDiagnosticRecord[]>([]);
  const [diagnosticsAvailableDates, setDiagnosticsAvailableDates] = useState<string[]>([]);
  const [diagnosticsDateFilter, setDiagnosticsDateFilter] = React.useState<string | null>(null);
  const {
    handleClearDiagnostics,
    handleDesktopAutomationClick,
    handleDesktopAutomationGoto,
    handleDesktopAutomationScreenshot,
    handleDesktopAutomationStart,
    handleDesktopAutomationType,
    handleDesktopControlClick,
    handleDesktopControlHotkey,
    handleDesktopControlKey,
    handleDesktopControlScreenshot,
    handleDesktopControlScroll,
    handleDesktopControlType,
    handleDesktopControlWait,
    handleSaveGitHubTrigger,
  } = useSettingsTabActions({
    gatewayUrl,
    token,
    setDiagnostics,
    setDiagnosticsAvailableDates,
    setGithubTriggers,
  });
  const [devtoolsSourceStates, setDevtoolsSourceStates] = useState(() =>
    createInitialDevtoolsSourceStates(),
  );
  const [isCompactSettingsLayout, setIsCompactSettingsLayout] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(SETTINGS_COMPACT_VIEWPORT_QUERY).matches;
    }
    return window.innerWidth <= 820;
  });
  const [desktopAutomationEnabled, setDesktopAutomationEnabled] = useState(false);
  const [desktopControlEnabled, setDesktopControlEnabled] = useState(false);
  const [desktopControlStatus, setDesktopControlStatus] = useState<DesktopControlStatus | null>(
    null,
  );
  const [sshConnections, setSshConnections] = useState<SSHConnectionEntry[]>([]);
  const [sshCurrentPath, setSshCurrentPath] = useState('/');
  const [sshNodes, setSshNodes] = useState<FileTreeNode[]>([]);
  const [sshPreview, setSshPreview] = useState<(ArtifactItem & { content?: string }) | null>(null);
  const [activeSSHConnectionId, setActiveSSHConnectionId] = useState<string | null>(null);
  const [sshDialogs, setSshDialogs] = useState<SSHDialogEntry[]>([]);
  // 「最近 SSH 对话」是否已从网关拉取完成（成功或降级为空都算就绪）。恢复
  // effect 必须等这个标志为 true 再决策，否则 dialogs 还没到达就会被 fallback
  // 抢先锁死 restoredRef，导致永远恢复不到上次的对话。
  const [sshDialogsReady, setSshDialogsReady] = useState(false);
  const devLogsRef = useRef<SettingsDevLogRecord[]>(devLogs);
  const workersRef = useRef<WorkerEntry[]>(workers);
  const diagnosticsRef = useRef<SettingsDiagnosticRecord[]>(diagnostics);
  const desktopAutomationEnabledRef = useRef(desktopAutomationEnabled);
  const desktopControlEnabledRef = useRef(desktopControlEnabled);
  const sshConnectionsRef = useRef<SSHConnectionEntry[]>(sshConnections);
  const providerSaveSeqRef = useRef(0);
  const providerSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hasLoadedFilePatterns = useRef(false);

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (typeof window.matchMedia !== 'function') {
      const updateCompactLayout = () => setIsCompactSettingsLayout(window.innerWidth <= 820);
      updateCompactLayout();
      window.addEventListener('resize', updateCompactLayout);
      return () => window.removeEventListener('resize', updateCompactLayout);
    }

    const media = window.matchMedia(SETTINGS_COMPACT_VIEWPORT_QUERY);
    const updateCompactLayout = () => setIsCompactSettingsLayout(media.matches);
    updateCompactLayout();
    media.addEventListener('change', updateCompactLayout);
    return () => media.removeEventListener('change', updateCompactLayout);
  }, []);

  useEffect(() => {
    devLogsRef.current = devLogs;
  }, [devLogs]);

  useEffect(() => {
    workersRef.current = workers;
  }, [workers]);

  useEffect(() => {
    diagnosticsRef.current = diagnostics;
  }, [diagnostics]);

  useEffect(() => {
    desktopAutomationEnabledRef.current = desktopAutomationEnabled;
  }, [desktopAutomationEnabled]);

  useEffect(() => {
    desktopControlEnabledRef.current = desktopControlEnabled;
  }, [desktopControlEnabled]);

  useEffect(() => {
    sshConnectionsRef.current = sshConnections;
  }, [sshConnections]);

  useEffect(() => {
    if (!hasLoadedFilePatterns.current) return;
    if (!token) return;
    const timer = setTimeout(() => {
      void createSettingsClient(gatewayUrl)
        .putFilePatterns(token, filePatterns)
        .catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [filePatterns, gatewayUrl, token]);

  const updateDevtoolsSourceState = React.useCallback(
    (key: DevtoolsSourceKey, patch: Partial<DevtoolsSourceState>) => {
      setDevtoolsSourceStates((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          ...patch,
        },
      }));
    },
    [],
  );

  const loadDevLogs = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('devLogs', {
      status: 'loading',
      detail: '正在刷新开发日志',
      error: null,
    });

    try {
      const payload = (await createSettingsClient(gatewayUrl).getDevLogs(token)) as {
        logs: Array<{
          id?: string;
          sessionId?: string | null;
          requestId?: string;
          level: SettingsDevLogRecord['level'];
          message: string;
          createdAt: string;
          toolName?: string;
          durationMs?: number | null;
          input?: unknown;
          output?: unknown;
          isError?: boolean;
        }>;
      };

      const logs = (payload.logs ?? []).map(
        (log) =>
          ({
            id: log.id,
            level: log.level,
            message: extractPrimaryMessage(log.output) ?? log.message,
            source: log.toolName,
            timestamp: Date.parse(log.createdAt) || Date.now(),
            requestId: log.requestId,
            sessionId: log.sessionId,
            durationMs: log.durationMs,
            input: parseStructuredPayload(log.input),
            output: parseStructuredPayload(log.output),
            isError: log.isError,
            createdAt: log.createdAt,
          }) satisfies SettingsDevLogRecord,
      );

      const errorCount = logs.filter((log) => log.level === 'error').length;
      setDevLogs(logs);
      updateDevtoolsSourceState('devLogs', {
        status: logs.length > 0 ? 'healthy' : 'empty',
        detail:
          logs.length === 0
            ? '最近没有工具执行日志'
            : errorCount > 0
              ? `${errorCount} 条错误，${logs.length} 条日志`
              : `${logs.length} 条日志已同步`,
        error: null,
        count: logs.length,
        updatedAt: Date.now(),
      });
    } catch (error: unknown) {
      updateDevtoolsSourceState('devLogs', {
        status: 'error',
        detail: '开发日志加载失败',
        error: error instanceof Error ? error.message : '开发日志加载失败',
        count: devLogsRef.current.length,
        updatedAt: Date.now(),
      });
      logger.error('failed to load dev logs', error);
    }
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadWorkers = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('workers', {
      status: 'loading',
      detail: '正在刷新 Worker 状态',
      error: null,
    });

    try {
      const payload = (await createSettingsClient(gatewayUrl).getWorkers(token)) as {
        workers: WorkerEntry[];
      };
      const nextWorkers = payload.workers ?? [];
      const errorCount = nextWorkers.filter((worker) => worker.status === 'error').length;
      setWorkers(nextWorkers);
      updateDevtoolsSourceState('workers', {
        status: nextWorkers.length > 0 ? 'healthy' : 'empty',
        detail:
          nextWorkers.length === 0
            ? '暂无 Worker 配置'
            : errorCount > 0
              ? `${errorCount} 个 Worker 异常`
              : `${nextWorkers.length} 个 Worker 已上报`,
        error: null,
        count: nextWorkers.length,
        updatedAt: Date.now(),
      });
    } catch (error: unknown) {
      updateDevtoolsSourceState('workers', {
        status: 'error',
        detail: 'Worker 状态加载失败',
        error: error instanceof Error ? error.message : '加载 Worker 状态失败',
        count: workersRef.current.length,
        updatedAt: Date.now(),
      });
      logger.error('failed to load workers', error);
    }
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadDiagnostics = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('diagnostics', {
      status: 'loading',
      detail: '正在刷新诊断信息',
      error: null,
    });

    try {
      const payload = (await createSettingsClient(gatewayUrl).getDiagnostics(token)) as {
        diagnostics: Array<SettingsDiagnosticRecord>;
        availableDates?: string[];
        appVersion?: string;
      };
      const nextDiagnostics = (payload.diagnostics ?? []).map((diagnostic) => ({
        ...diagnostic,
        appVersion: diagnostic.appVersion ?? payload.appVersion,
        input: parseStructuredPayload(diagnostic.input),
        output: parseStructuredPayload(diagnostic.output),
      }));
      setDiagnostics(nextDiagnostics);
      setDiagnosticsAvailableDates(payload.availableDates ?? []);
      updateDevtoolsSourceState('diagnostics', {
        status: nextDiagnostics.length > 0 ? 'healthy' : 'empty',
        detail:
          nextDiagnostics.length > 0
            ? `${nextDiagnostics.length} 条最近异常可供排查`
            : '最近没有新的工具异常',
        error: null,
        count: nextDiagnostics.length,
        updatedAt: Date.now(),
      });
    } catch (error: unknown) {
      updateDevtoolsSourceState('diagnostics', {
        status: 'error',
        detail: '诊断信息加载失败',
        error: error instanceof Error ? error.message : '加载诊断信息失败',
        count: diagnosticsRef.current.length,
        updatedAt: Date.now(),
      });
      logger.error('failed to load diagnostics', error);
    }
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadDesktopAutomationStatus = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('desktopAutomation', {
      status: 'loading',
      detail: '正在刷新桌面自动化状态',
      error: null,
    });

    try {
      const payload = await createDesktopAutomationClient(gatewayUrl).getStatus(token);
      const enabled = payload.enabled === true;
      setDesktopAutomationEnabled(enabled);
      updateDevtoolsSourceState('desktopAutomation', {
        status: enabled ? 'healthy' : 'unavailable',
        detail: enabled ? '桌面 sidecar 已启用自动化能力' : '当前环境未启用桌面自动化',
        error: null,
        count: enabled ? 1 : 0,
        updatedAt: Date.now(),
      });
    } catch (error: unknown) {
      updateDevtoolsSourceState('desktopAutomation', {
        status: 'error',
        detail: '桌面自动化状态加载失败',
        error: error instanceof Error ? error.message : '加载桌面自动化状态失败',
        count: desktopAutomationEnabledRef.current ? 1 : 0,
        updatedAt: Date.now(),
      });
      logger.error('failed to load desktop automation status', error);
    }
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadDesktopControlStatus = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('desktopControl', {
      status: 'loading',
      detail: '正在刷新系统桌面控制状态',
      error: null,
    });

    try {
      const payload = await createDesktopControlClient(gatewayUrl).getStatus(token);
      const enabled = payload.enabled === true;
      setDesktopControlEnabled(enabled);
      setDesktopControlStatus(payload);
      updateDevtoolsSourceState('desktopControl', {
        status: enabled ? 'healthy' : 'unavailable',
        detail: enabled
          ? '系统桌面控制桥接已启用'
          : (payload.reason ?? '当前环境未启用系统桌面控制'),
        error: null,
        count: enabled ? 1 : 0,
        updatedAt: Date.now(),
      });
    } catch (error: unknown) {
      updateDevtoolsSourceState('desktopControl', {
        status: 'error',
        detail: '系统桌面控制状态加载失败',
        error: error instanceof Error ? error.message : '加载系统桌面控制状态失败',
        count: desktopControlEnabledRef.current ? 1 : 0,
        updatedAt: Date.now(),
      });
      logger.error('failed to load desktop control status', error);
    }
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadSshConnections = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('sshConnections', {
      status: 'loading',
      detail: '正在刷新 SSH 连接',
      error: null,
    });

    try {
      const sshClient = createSshClient(gatewayUrl);
      const nextConnections = (await sshClient.list(token)) as unknown as SSHConnectionEntry[];
      setSshConnections(nextConnections);
      // 同步拉取「最近 SSH 对话」用于恢复面板;旧网关未注册该端点时静默降级为空列表。
      void sshClient
        .listDialogs(token)
        .then((dialogs) => setSshDialogs(dialogs))
        .catch((error: unknown) => {
          // 旧网关无该端点时降级为空列表，但仍要置位就绪标志，否则恢复
          // effect 会一直等待、永远走不到 fallback。
          logger.warn('failed to load ssh dialogs', error);
        })
        .finally(() => setSshDialogsReady(true));
      updateDevtoolsSourceState('sshConnections', {
        status: nextConnections.length > 0 ? 'healthy' : 'empty',
        detail:
          nextConnections.length > 0 ? `${nextConnections.length} 个 SSH 连接` : '暂无 SSH 连接',
        error: null,
        count: nextConnections.length,
        updatedAt: Date.now(),
      });
    } catch (error: unknown) {
      updateDevtoolsSourceState('sshConnections', {
        status: 'error',
        detail: 'SSH 连接加载失败',
        error: error instanceof Error ? error.message : '加载 SSH 连接失败',
        count: sshConnectionsRef.current.length,
        updatedAt: Date.now(),
      });
      logger.error('failed to load ssh connections', error);
    }
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const refreshDevtoolsSource = React.useCallback(
    (key: DevtoolsSourceKey) => {
      switch (key) {
        case 'devLogs':
          void loadDevLogs();
          break;
        case 'diagnostics':
          void loadDiagnostics();
          break;
        case 'desktopAutomation':
          void loadDesktopAutomationStatus();
          break;
        case 'desktopControl':
          void loadDesktopControlStatus();
          break;
        case 'sshConnections':
          void loadSshConnections();
          break;
        case 'workers':
          void loadWorkers();
          break;
        default:
          break;
      }
    },
    [
      loadDesktopAutomationStatus,
      loadDesktopControlStatus,
      loadDevLogs,
      loadDiagnostics,
      loadSshConnections,
      loadWorkers,
    ],
  );

  const refreshAllDevtoolsSources = React.useCallback(() => {
    void Promise.allSettled([
      loadDevLogs(),
      loadDiagnostics(),
      loadDesktopAutomationStatus(),
      loadDesktopControlStatus(),
      loadSshConnections(),
      loadWorkers(),
    ]);
  }, [
    loadDesktopAutomationStatus,
    loadDesktopControlStatus,
    loadDevLogs,
    loadDiagnostics,
    loadSshConnections,
    loadWorkers,
  ]);

  useEffect(() => {
    if (!token) return;
    setDevtoolsSourceStates(createInitialDevtoolsSourceStates());
    const settingsClient = createSettingsClient(gatewayUrl);
    const usageClient = createUsageClient(gatewayUrl);
    const channelsClient = createChannelsClient<ChannelSettingsEntry, ChannelTypeDescriptor>(
      gatewayUrl,
    );
    const githubClient = createGitHubClient(gatewayUrl);

    // 用网关 catalog(单一事实来源)刷新前端 UI 注册表，使新增平台的 logo/名称/
    // 上游变体无需改前端即可显示。失败时静默回退到内置静态兜底。
    void settingsClient
      .getProviderCatalog(token)
      .then((data) => {
        const entries = (data as { catalog?: ProviderCatalogUiEntry[] }).catalog;
        if (entries) {
          hydrateProviderCatalogUi(entries);
        }
      })
      .catch(() => undefined);

    void settingsClient
      .getProviders(token)
      .then((data) => {
        const typed = data as {
          providers: AIProviderRef[] | null;
          activeSelection?: ActiveSelectionRef | null;
          defaultThinking?: ThinkingDefaultsRef | null;
          imageGenerationDefaults?: ImageGenerationDefaultsRef | null;
        };
        if (typed.providers) {
          providersRef.current = typed.providers;
          setProviders(typed.providers);
        }
        applyServerDefaults(
          {
            activeSelection: typed.activeSelection,
            defaultThinking: typed.defaultThinking,
            imageGenerationDefaults: typed.imageGenerationDefaults,
          },
          { syncDraft: true, syncSaved: true },
        );
      })
      .catch(() => undefined);
    void usageClient
      .getRecords(token)
      .then((d) => {
        setUsageRecords((d.records as MonthlyRecord[]) ?? []);
        setUsageBudget(d.budgetUsd ?? 0);
        setUsageRecordsError(null);
      })
      .catch((error: unknown) => {
        setUsageRecords([]);
        setUsageBudget(0);
        setUsageRecordsError(error instanceof Error ? error.message : '加载用量记录失败');
        logger.error('failed to load usage records', error);
      });
    void usageClient
      .getBreakdown(token)
      .then((d) => {
        setMonthlyCostUsd(d.monthlyCostUsd ?? 0);
        setCostBreakdown(d.breakdown ?? []);
        setCostBreakdownError(null);
      })
      .catch((error: unknown) => {
        setMonthlyCostUsd(0);
        setCostBreakdown([]);
        setCostBreakdownError(error instanceof Error ? error.message : '加载费用明细失败');
        logger.error('failed to load usage breakdown', error);
      });
    void settingsClient
      .getPermissionRules(token)
      .then((d) => {
        const typed = d as {
          rules: PermissionRuleEntry[];
          categories: PermissionCategoryMeta[];
        };
        setPermissionRules(typed.rules ?? []);
        if (typed.categories?.length) setPermissionCategories(typed.categories);
      })
      .catch(() => setPermissionRules([]));
    void settingsClient
      .getPermissionDecisions(token)
      .then((d) => {
        const typed = d as { decisions: PermissionDecisionRecord[] };
        setPermissions(
          (typed.decisions ?? []).map((decision) => ({
            ...decision,
            scope:
              (decision as PermissionDecisionRecord & { sessionId?: string; requestId?: string })
                .sessionId ??
              (decision as PermissionDecisionRecord & { requestId?: string }).requestId ??
              'settings',
            timestamp: Date.now(),
            riskLevel: 'low',
          })),
        );
      })
      .catch(() => undefined);
    void loadDevLogs();
    void loadWorkers();
    void loadDiagnostics();
    void settingsClient
      .getModelPrices(token)
      .then((d) => {
        const typed = d as { models?: unknown };
        setPriceModels(normalizeSettingsModelPrices(typed.models));
        setPriceModelsError(null);
      })
      .catch((error: unknown) => {
        setPriceModels([]);
        setPriceModelsError(error instanceof Error ? error.message : '加载模型费用配置失败');
        logger.error('failed to load settings model prices', error);
      });
    void loadDesktopAutomationStatus();
    void loadDesktopControlStatus();
    void loadSshConnections();
    void settingsClient
      .getFilePatterns(token)
      .then((d) => {
        const typed = d as { patterns: string[] };
        setFilePatterns(typed.patterns ?? []);
        hasLoadedFilePatterns.current = true;
      })
      .catch(() => {
        hasLoadedFilePatterns.current = true;
      });
    void githubClient
      .listTriggers(token)
      .then((triggers) => setGithubTriggers(triggers))
      .catch(() => undefined);
    void loadUpstreamRetrySettings().catch(() => undefined);
    void channelsClient
      .list(token)
      .then((data) => {
        setChannelsLoadError(null);
        setChannels(data ?? []);
      })
      .catch((error: unknown) => {
        setChannels([]);
        setChannelsLoadError(error instanceof Error ? error.message : '加载通道失败');
        logger.error('failed to load channels', error);
      });
    void channelsClient
      .listDescriptors(token)
      .then((data) => {
        setChannelDescriptorsLoadError(null);
        setChannelDescriptors(data ?? []);
      })
      .catch((error: unknown) => {
        setChannelDescriptors([]);
        setChannelDescriptorsLoadError(error instanceof Error ? error.message : '加载通道模板失败');
        logger.error('failed to load channel descriptors', error);
      });
  }, [
    gatewayUrl,
    loadDesktopAutomationStatus,
    loadDesktopControlStatus,
    loadDevLogs,
    loadDiagnostics,
    loadUpstreamRetrySettings,
    loadSshConnections,
    loadWorkers,
    token,
  ]);

  const saveProviders = React.useCallback(
    async (
      next: AIProviderRef[] = providersRef.current,
      nextSel: ActiveSelectionRef = activeSelectionRef.current,
      nextThinking: ThinkingDefaultsRef = defaultThinkingRef.current,
      nextImageGenerationDefaults: ImageGenerationDefaultsRef = imageGenerationDefaultsRef.current,
      options?: {
        syncDraft?: boolean;
        syncSaved?: boolean;
      },
    ) => {
      if (!token) return;
      const syncDraft = options?.syncDraft ?? true;
      const syncSaved = options?.syncSaved ?? true;
      const sizeValidation = validateImageGenerationSize(nextImageGenerationDefaults.size);
      if (!sizeValidation.valid) {
        throw new Error(sizeValidation.message ?? '图片尺寸无效');
      }
      const requestSeq = providerSaveSeqRef.current + 1;
      providerSaveSeqRef.current = requestSeq;

      const runSave = async () => {
        const data = (await createSettingsClient(gatewayUrl).putProviders(token, {
          providers: next,
          activeSelection: nextSel,
          defaultThinking: nextThinking,
          imageGenerationDefaults: nextImageGenerationDefaults,
        })) as {
          providers?: AIProviderRef[];
          activeSelection?: ActiveSelectionRef;
          defaultThinking?: ThinkingDefaultsRef;
          imageGenerationDefaults?: ImageGenerationDefaultsRef;
          error?: string;
        };

        if (requestSeq !== providerSaveSeqRef.current) {
          return;
        }

        if (data.providers) {
          providersRef.current = data.providers;
          setProviders(data.providers);
        }
        applyServerDefaults(
          {
            activeSelection: data.activeSelection,
            defaultThinking: data.defaultThinking,
            imageGenerationDefaults: data.imageGenerationDefaults,
          },
          { syncDraft, syncSaved },
        );
      };

      const queuedSave = providerSaveQueueRef.current.catch(() => undefined).then(runSave);
      providerSaveQueueRef.current = queuedSave.then(
        () => undefined,
        () => undefined,
      );
      await queuedSave;
    },
    [token, gatewayUrl],
  );

  const syncSelectionForProviders = React.useCallback((nextProviders: AIProviderRef[]) => {
    const normalizedDraftSelection = normalizeActiveSelectionProviders(
      activeSelectionRef.current,
      nextProviders,
    );
    const normalizedSavedSelection = normalizeActiveSelectionProviders(
      savedActiveSelectionRef.current,
      nextProviders,
    );

    activeSelectionRef.current = normalizedDraftSelection;
    setActiveSelection(normalizedDraftSelection);
    setSavedActiveSelection(normalizedSavedSelection);

    return {
      draftSelection: normalizedDraftSelection,
      savedSelection: normalizedSavedSelection,
    };
  }, []);

  const saveDefaultModelSettings = React.useCallback(async () => {
    if (!token || savingDefaultModelSettings) {
      return;
    }

    setSavingDefaultModelSettings(true);
    try {
      const normalizedDraftSelection = normalizeActiveSelectionProviders(
        activeSelectionRef.current,
        providersRef.current,
      );
      setActiveSelection(normalizedDraftSelection);
      await saveProviders(
        providersRef.current,
        normalizedDraftSelection,
        defaultThinkingRef.current,
        imageGenerationDefaultsRef.current,
        {
          syncDraft: true,
          syncSaved: true,
        },
      );
    } catch (error: unknown) {
      logger.error('failed to save default model settings', error);
    } finally {
      setSavingDefaultModelSettings(false);
    }
  }, [token, savingDefaultModelSettings, saveProviders]);

  function handlePermissionRulesChange(rules: PermissionRuleEntry[]) {
    setPermissionRules(rules);
    setPermissionRulesSaving(true);
    if (!token) {
      setPermissionRulesSaving(false);
      return;
    }
    void createSettingsClient(gatewayUrl)
      .putPermissionRules(token, { rules })
      .catch((error: unknown) => {
        logger.error('failed to save permission rules', error);
      })
      .finally(() => setPermissionRulesSaving(false));
  }

  function handleAddProvider(data?: ProviderEditData) {
    if (!data) return;
    setProviders((prev) => {
      const takenIds = new Set(prev.map((provider) => provider.id));
      // 稳定且不重排的 id：会话以 providerId 作为外键，删除中间实例不能让其它
      // 实例的 id 漂移，因此用 UUID 后缀而非基于当前列表的序号。
      const makeStableId = (base: string): string => {
        if (!takenIds.has(base)) return base;
        const uuid =
          typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID().slice(0, 8)
            : Math.random().toString(36).slice(2, 10);
        let candidate = `${base}-${uuid}`;
        while (takenIds.has(candidate)) {
          candidate = `${base}-${Math.random().toString(36).slice(2, 10)}`;
        }
        return candidate;
      };

      const isBuiltin = BUILTIN_PROVIDER_TYPE_SET.has(data.type) && data.type !== 'custom';
      const existingTemplate = isBuiltin
        ? prev.find((provider) => provider.type === data.type)
        : undefined;
      const baseId = isBuiltin ? data.type : 'custom';

      const nextProvider: AIProviderRef = existingTemplate
        ? {
            ...existingTemplate,
            id: makeStableId(existingTemplate.id),
            name: data.name.trim() || existingTemplate.name,
            enabled: data.enabled,
            apiKey: data.apiKey.trim() || undefined,
            baseUrl: data.baseUrl.trim() || existingTemplate.baseUrl,
            upstreamProtocol: data.upstreamProtocol,
          }
        : {
            id: makeStableId(baseId),
            type: isBuiltin ? data.type : 'custom',
            name: data.name.trim() || (isBuiltin ? data.type : '自定义渠道'),
            enabled: data.enabled,
            apiKey: data.apiKey.trim() || undefined,
            baseUrl: data.baseUrl.trim() || undefined,
            upstreamProtocol: data.upstreamProtocol,
            defaultModels: [],
          };
      const next = [...prev, nextProvider];
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(
        next,
        savedSelection,
        savedDefaultThinkingRef.current,
        savedImageGenerationDefaultsRef.current,
        {
          syncDraft: false,
          syncSaved: true,
        },
      ).catch((error: unknown) => {
        logger.error('failed to save added provider', error);
      });
      return next;
    });
  }
  function handleEditProvider(id: string, data?: ProviderEditData) {
    if (!data) return;
    setProviders((prev) => {
      const next = prev.map((provider) =>
        provider.id === id
          ? {
              ...provider,
              name: data.name.trim(),
              type: data.type,
              enabled: data.enabled,
              apiKey: data.apiKey.trim() || undefined,
              baseUrl: data.baseUrl.trim() || undefined,
              upstreamProtocol: data.upstreamProtocol,
            }
          : provider,
      );
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(
        next,
        savedSelection,
        savedDefaultThinkingRef.current,
        savedImageGenerationDefaultsRef.current,
        {
          syncDraft: false,
          syncSaved: true,
        },
      ).catch((error: unknown) => {
        logger.error('failed to save edited provider', error);
      });
      return next;
    });
  }

  // 连通性自检：用「当前内存里的 provider 配置」(含尚未保存的编辑)对指定模型
  // 发起一次最小化上游调用，返回结构化结果给 ModelManager 的检测按钮显示。
  const handleTestModel = React.useCallback(
    async (
      providerId: string,
      modelId: string,
    ): Promise<{
      ok: boolean;
      status: 'ok' | 'auth_error' | 'rate_limited' | 'timeout' | 'not_found' | 'error';
      message: string;
      latencyMs?: number;
    }> => {
      if (!token) {
        return { ok: false, status: 'error', message: '未登录，无法发起检测。' };
      }
      const provider = providersRef.current.find((item) => item.id === providerId);
      if (!provider) {
        return { ok: false, status: 'error', message: '未找到该 provider，请先保存配置。' };
      }
      try {
        const result = (await createSettingsClient(gatewayUrl).testProvider(token, {
          modelId,
          // 传内联 provider，测「尚未保存」的表单值；带上 createdAt/updatedAt 占位
          // 以满足网关 schema(后端会重新规整)。
          provider: {
            ...provider,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        })) as {
          ok?: boolean;
          status?: 'ok' | 'auth_error' | 'rate_limited' | 'timeout' | 'not_found' | 'error';
          message?: string;
          latencyMs?: number;
        };
        return {
          ok: result.ok === true,
          status: result.status ?? (result.ok ? 'ok' : 'error'),
          message: result.message ?? (result.ok ? '连接正常' : '检测失败'),
          ...(typeof result.latencyMs === 'number' ? { latencyMs: result.latencyMs } : {}),
        };
      } catch (error: unknown) {
        return {
          ok: false,
          status: 'error',
          message: error instanceof Error ? error.message : '检测请求失败',
        };
      }
    },
    [token, gatewayUrl],
  );

  // 手动同步内置模型目录：触发网关从 models.dev 重新拉取，成功后重新加载 provider
  // 列表，使新模型 / 更新后的上下文与价格即时反映到表格里。
  const handleSyncCatalog = React.useCallback(async (): Promise<{
    ok: boolean;
    providerCount?: number;
    modelCount?: number;
    message?: string;
  }> => {
    if (!token) {
      return { ok: false, message: '未登录，无法同步模型目录。' };
    }
    const settingsClient = createSettingsClient(gatewayUrl);
    try {
      const result = await settingsClient.syncModelsCatalog(token);
      if (!result.ok) {
        return { ok: false, message: result.message ?? '同步失败' };
      }
      // 同步成功后拉取最新 provider 列表（网关已对 catalog 缓存做了失效）。
      // 仅刷新模型清单，不动用户尚未保存的默认选择草稿。
      try {
        const data = (await settingsClient.getProviders(token)) as {
          providers: AIProviderRef[] | null;
        };
        if (data.providers) {
          providersRef.current = data.providers;
          setProviders(data.providers);
        }
      } catch (reloadError) {
        logger.error('failed to reload providers after catalog sync', reloadError);
      }
      return {
        ok: true,
        ...(typeof result.providerCount === 'number'
          ? { providerCount: result.providerCount }
          : {}),
        ...(typeof result.modelCount === 'number' ? { modelCount: result.modelCount } : {}),
      };
    } catch (error: unknown) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '同步请求失败',
      };
    }
  }, [token, gatewayUrl]);

  const handleDiscoverProviders = React.useCallback(async (): Promise<{
    providers: Array<{
      id: string;
      name: string;
      api?: string;
      modelCount: number;
      sampleModels?: Array<{ id: string; name: string }>;
    }>;
  }> => {
    if (!token) {
      throw new Error('未登录，无法发现平台。');
    }
    const data = (await createSettingsClient(gatewayUrl).discoverProviders(token)) as {
      providers?: Array<{
        id: string;
        name: string;
        api?: string;
        modelCount: number;
        sampleModels?: Array<{ id: string; name: string }>;
      }>;
    };
    return { providers: data.providers ?? [] };
  }, [token, gatewayUrl]);

  const handleImportDiscoveredProvider = React.useCallback(
    async (modelsDevProviderId: string): Promise<void> => {
      if (!token) {
        throw new Error('未登录，无法导入平台。');
      }
      const data = (await createSettingsClient(gatewayUrl).importProviderFromModelsDev(token, {
        modelsDevProviderId,
      })) as {
        providers?: AIProviderRef[];
        activeSelection?: ActiveSelectionRef;
      };
      if (data.providers) {
        providersRef.current = data.providers;
        setProviders(data.providers);
        const { draftSelection, savedSelection } = syncSelectionForProviders(data.providers);
        if (data.activeSelection) {
          activeSelectionRef.current = data.activeSelection;
          setActiveSelection(data.activeSelection);
          setSavedActiveSelection(data.activeSelection);
        } else {
          activeSelectionRef.current = draftSelection;
          setActiveSelection(draftSelection);
          setSavedActiveSelection(savedSelection);
        }
      }
    },
    [token, gatewayUrl, syncSelectionForProviders],
  );

  function handleToggleProvider(id: string) {
    setProviders((prev) => {
      const next = prev.map((provider) =>
        provider.id === id ? { ...provider, enabled: !provider.enabled } : provider,
      );
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(
        next,
        savedSelection,
        savedDefaultThinkingRef.current,
        savedImageGenerationDefaultsRef.current,
        {
          syncDraft: false,
          syncSaved: true,
        },
      ).catch((error: unknown) => {
        logger.error('failed to save toggled provider', error);
      });
      return next;
    });
  }
  function persistModelMutation(
    mutate: (providers: AIProviderRef[]) => AIProviderRef[],
    errorMessage: string,
  ) {
    setProviders((prev) => {
      const next = mutate(prev);
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(
        next,
        savedSelection,
        savedDefaultThinkingRef.current,
        savedImageGenerationDefaultsRef.current,
        {
          syncDraft: false,
          syncSaved: true,
        },
      ).catch((error: unknown) => {
        logger.error(errorMessage, error);
      });
      return next;
    });
  }
  function handleToggleModel(providerId: string, modelId: string) {
    persistModelMutation(
      (prev) => toggleProviderModel(prev, providerId, modelId),
      'failed to save toggled model',
    );
  }
  function handleAddModel(providerId: string, model: AIModelConfigItem) {
    persistModelMutation(
      (prev) => addProviderModel(prev, providerId, model),
      'failed to save added model',
    );
  }
  function handleUpdateModel(
    providerId: string,
    modelId: string,
    updates: Partial<AIModelConfigRef>,
  ) {
    persistModelMutation(
      (prev) => updateProviderModel(prev, providerId, modelId, updates),
      'failed to save updated model settings',
    );
  }
  function handleRemoveModel(providerId: string, modelId: string) {
    persistModelMutation(
      (prev) => removeProviderModel(prev, providerId, modelId),
      'failed to save removed model',
    );
  }

  const exportDevLogs = React.useCallback(() => {
    const content = JSON.stringify(devLogs, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'settings-dev-logs.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [devLogs]);

  const devEvents = buildDevEventsFromLogs(devLogs);

  const loadSshFiles = React.useCallback(
    async (connectionId: string, path: string) => {
      if (!token) return;
      // listFiles 在连接尚未握手成功时会抛 `SSH client not connected`，
      // 例如重启后 auto-reconnect 还没跑完就点开对话。这里兜底成清空面板 +
      // 记录日志，避免 unhandled rejection，让 UI 停在「已选中、未加载」态。
      try {
        const sshClient = createSshClient(gatewayUrl);
        const entries = await sshClient.listFiles(token, connectionId, path);
        const nodes: FileTreeNode[] = entries.map((entry) => ({
          path: entry.path,
          name: entry.name,
          type: entry.kind,
        }));
        setSshNodes(nodes);
        setSshCurrentPath(path);
        const firstFile = nodes.find((node) => node.type === 'file');
        if (firstFile) {
          const previewPayload = await sshClient.readFile(token, connectionId, firstFile.path);
          setSshPreview({
            id: previewPayload.path,
            name: previewPayload.path.split('/').pop() ?? previewPayload.path,
            type: 'text',
            createdAt: Date.now(),
            sessionId: connectionId,
            content: previewPayload.content,
          });
        } else {
          setSshPreview(null);
        }
      } catch (error: unknown) {
        setSshNodes([]);
        setSshPreview(null);
        setSshCurrentPath(path);
        logger.warn('failed to load ssh files', error);
      }
    },
    [gatewayUrl, token],
  );

  // 重启后恢复「上一次打开的 SSH 对话」：
  // 1. 优先选最近活跃的对话（sshDialogs 已按 pinned/lastOpenedAt 排好），让用户
  //    感觉面板从未关过；连接已删除的历史对话会被纯函数跳过；
  // 2. 没有可用对话时退化为「第一个 connected 的连接」；
  // 3. 都没有就保持空白，避免误把某个意料之外的连接拉到前台。
  // 注意：boot 时的 auto-reconnect 是 fire-and-forget，对话往往在握手完成前就
  // 回灌，所以只对「已 connected」的连接拉文件；未就绪的连接仅高亮选中，等用户
  // 手动点连接或 auto-reconnect 完成后再浏览。决策逻辑抽成纯函数便于单测，并
  // 等 `sshDialogsReady` 置位后再跑，避免对话尚未到达就被 fallback 抢先锁定。
  const sshDialogRestoredRef = useRef(false);
  useEffect(() => {
    if (sshDialogRestoredRef.current) return;
    if (activeSSHConnectionId) return;
    if (!token) return;
    if (!sshDialogsReady) return;
    if (sshConnections.length === 0) return;

    sshDialogRestoredRef.current = true;
    const decision = resolveSshDialogRestore(sshDialogs, sshConnections);
    if (!decision) return;
    setActiveSSHConnectionId(decision.connectionId);
    if (decision.shouldLoadFiles) {
      void loadSshFiles(decision.connectionId, decision.cwd);
    }
  }, [activeSSHConnectionId, loadSshFiles, sshConnections, sshDialogs, sshDialogsReady, token]);

  const addSshConnection = React.useCallback(
    (entry: Omit<SSHConnectionEntry, 'id' | 'status'>) => {
      if (!token) return;
      void createSshClient(gatewayUrl)
        .create(token, entry as never)
        .then((connection) => {
          const next = connection as unknown as SSHConnectionEntry;
          setSshConnections((prev) => [...prev, next]);
          setActiveSSHConnectionId(next.id);
        });
    },
    [gatewayUrl, token],
  );

  const connectSsh = React.useCallback(
    (id: string) => {
      if (!token) return;
      void createSshClient(gatewayUrl)
        .connect(token, id)
        .then(() => {
          setSshConnections((prev) =>
            prev.map((connection) =>
              connection.id === id ? { ...connection, status: 'connected' } : connection,
            ),
          );
          setActiveSSHConnectionId(id);
          return loadSshFiles(id, '/');
        })
        .catch((error: unknown) => logger.error('failed to connect ssh', error));
    },
    [gatewayUrl, loadSshFiles, token],
  );

  const disconnectSsh = React.useCallback(
    (id: string) => {
      if (!token) return;
      void createSshClient(gatewayUrl)
        .disconnect(token, id)
        .then(() => {
          setSshConnections((prev) =>
            prev.map((connection) =>
              connection.id === id ? { ...connection, status: 'disconnected' } : connection,
            ),
          );
          if (activeSSHConnectionId === id) {
            setActiveSSHConnectionId(null);
            setSshNodes([]);
            setSshPreview(null);
            setSshCurrentPath('/');
          }
        });
    },
    [activeSSHConnectionId, gatewayUrl, token],
  );

  const browseSshPath = React.useCallback(
    (path: string) => {
      if (!activeSSHConnectionId || !token) return;
      const node = sshNodes.find((item) => item.path === path);
      if (node?.type === 'directory') {
        void loadSshFiles(activeSSHConnectionId, path);
        return;
      }
      void createSshClient(gatewayUrl)
        .readFile(token, activeSSHConnectionId, path)
        .then((preview) =>
          setSshPreview({
            id: preview.path,
            name: preview.path.split('/').pop() ?? preview.path,
            type: 'text',
            createdAt: Date.now(),
            sessionId: activeSSHConnectionId,
            content: preview.content,
          }),
        );
    },
    [activeSSHConnectionId, gatewayUrl, loadSshFiles, sshNodes, token],
  );

  const uploadSshFile = React.useCallback(
    (file: File) => {
      if (!activeSSHConnectionId || !token) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (!(result instanceof ArrayBuffer)) return;
        const bytes = new Uint8Array(result);
        const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
        const contentBase64 = btoa(binary);
        void createSshClient(gatewayUrl)
          .upload(token, {
            connectionId: activeSSHConnectionId,
            path: `${sshCurrentPath.replace(/\/$/, '')}/${file.name}`,
            contentBase64,
          })
          .then(() => {
            void loadSshFiles(activeSSHConnectionId, sshCurrentPath);
          });
      };
      reader.readAsArrayBuffer(file);
    },
    [activeSSHConnectionId, gatewayUrl, loadSshFiles, sshCurrentPath, token],
  );

  const connectedCount = channels.filter((c) => c.status === 'connected').length;
  const disconnectedCount = channels.filter((c) => c.status === 'disconnected').length;
  const channelsPanelLoadError = channelsLoadError ?? channelDescriptorsLoadError;

  return (
    <div className="page-root">
      <div
        className="page-content"
        style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            padding: isCompactSettingsLayout ? '0 12px' : '0 28px',
          }}
        >
          <div
            style={{
              display: 'grid',
              flex: 1,
              width: '100%',
              maxWidth: isCompactSettingsLayout ? '100%' : SETTINGS_LAYOUT_MAX_WIDTH,
              minHeight: 0,
              margin: '0 auto',
              overflow: 'hidden',
              // 3 列布局：nav | gap | content。外层 `margin: 0 auto` 负责在宽屏
              // 下整体居中；窄屏下 content 能拿到所有剩余宽度，不再被旧的
              // 第 4 列「装饰 gutter」吃掉 220px。
              gridTemplateColumns: isCompactSettingsLayout
                ? 'minmax(0, 1fr)'
                : `${SETTINGS_TAB_NAV_WIDTH}px ${SETTINGS_TAB_CONTENT_GAP}px minmax(0, 1fr)`,
              gridTemplateRows: isCompactSettingsLayout ? 'auto minmax(0, 1fr)' : undefined,
            }}
          >
            <nav
              style={{
                gridColumn: '1',
                gridRow: isCompactSettingsLayout ? '1' : undefined,
                width: isCompactSettingsLayout ? '100%' : SETTINGS_TAB_NAV_WIDTH,
                flexShrink: 0,
                borderRight: isCompactSettingsLayout ? 'none' : '1px solid var(--border-subtle)',
                borderBottom: isCompactSettingsLayout ? '1px solid var(--border-subtle)' : 'none',
                display: 'flex',
                flexDirection: isCompactSettingsLayout ? 'row' : 'column',
                background: 'var(--bg-raised)',
                minHeight: 0,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: isCompactSettingsLayout ? 'none' : 'block',
                  padding: '20px 12px 12px',
                  borderBottom: '1px solid var(--border-subtle)',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--text-1)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  设置
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                    marginTop: 3,
                  }}
                >
                  偏好与模型设置
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  overflowX: isCompactSettingsLayout ? 'auto' : 'hidden',
                  overflowY: isCompactSettingsLayout ? 'hidden' : 'auto',
                  padding: isCompactSettingsLayout ? '8px 0' : '8px 8px 16px',
                  display: 'flex',
                  flexDirection: isCompactSettingsLayout ? 'row' : 'column',
                  gap: isCompactSettingsLayout ? 8 : 1,
                  scrollbarWidth: 'none' as const,
                  minWidth: 0,
                }}
              >
                {TAB_CATEGORIES.map((category, idx) => (
                  <div
                    key={category.id}
                    style={{
                      display: isCompactSettingsLayout ? 'contents' : 'block',
                      marginTop: !isCompactSettingsLayout && idx > 0 ? 12 : 0,
                    }}
                  >
                    <div
                      style={{
                        display: isCompactSettingsLayout ? 'none' : 'block',
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--fg-muted)',
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        padding: '4px 10px 3px',
                        userSelect: 'none',
                      }}
                    >
                      {category.label}
                    </div>
                    {/* 仅在 Tauri 桌面端运行时才渲染 desktop tab；Web/移动端隐藏。 */}
                    {TABS.filter(
                      (t) =>
                        (category.tabIds as readonly string[]).includes(t.id) &&
                        (!TAURI_ONLY_TAB_IDS.has(t.id) || isTauri),
                    ).map((tabItem) => {
                      const linkTo = `/settings/${tabItem.id}`;
                      return (
                        <NavLink
                          key={tabItem.id}
                          to={linkTo}
                          style={() => {
                            // NavLink 的内置 isActive 仅在 URL 精确匹配 `/settings/<id>` 时才为 true。
                            // 当用户进入 `/settings`（无 tab 参数）时，SettingsPage 会把 activeTab
                            // 回退到 'connection' 并渲染对应内容，但此时所有 NavLink 都没高亮。
                            // 改为统一基于 activeTab 计算激活态，让侧栏选中始终与右侧内容一致。
                            const isActive = activeTab === tabItem.id;
                            return {
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              flex: isCompactSettingsLayout ? '0 0 auto' : undefined,
                              width: isCompactSettingsLayout ? 'auto' : '100%',
                              padding: isCompactSettingsLayout ? '8px 12px' : '8px 10px',
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: isActive ? 600 : 400,
                              background: isActive ? 'var(--accent-muted)' : 'transparent',
                              color: isActive ? 'var(--accent)' : 'var(--fg-default)',
                              boxShadow: isActive ? 'inset 2px 0 0 var(--accent)' : 'none',
                              textDecoration: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              transition: 'background 150ms ease, color 150ms ease',
                              overflow: 'hidden',
                            };
                          }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 18,
                            }}
                          >
                            <SettingsNavIcon id={tabItem.id} />
                          </span>
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {tabItem.label}
                          </span>
                        </NavLink>
                      );
                    })}
                  </div>
                ))}
              </div>
            </nav>
            <div
              style={{
                gridColumn: isCompactSettingsLayout ? '1' : '3',
                gridRow: isCompactSettingsLayout ? '2' : undefined,
                overflowY: 'auto',
                padding: isCompactSettingsLayout ? '12px 0' : '20px 0',
                minWidth: 0,
              }}
            >
              <div style={{ width: '100%' }}>
                {activeTab === 'connection' && (
                  <ConnectionTabContent
                    providers={providers}
                    activeSelection={activeSelection}
                    defaultThinking={defaultThinking}
                    imageGenerationDefaults={imageGenerationDefaults}
                    hasUnsavedDefaultChanges={hasUnsavedDefaultModelChanges}
                    isSavingDefaultChanges={savingDefaultModelSettings}
                    setActiveSelection={setActiveSelection}
                    setDefaultThinking={setDefaultThinking}
                    setImageGenerationDefaults={setImageGenerationDefaults}
                    saveDefaultModelSettings={() => {
                      void saveDefaultModelSettings();
                    }}
                    handleAddModel={handleAddModel}
                    handleRemoveModel={handleRemoveModel}
                    handleUpdateModel={handleUpdateModel}
                    handleToggleModel={handleToggleModel}
                    handleToggleProvider={handleToggleProvider}
                    handleEditProvider={handleEditProvider}
                    handleAddProvider={handleAddProvider}
                    onTestModel={handleTestModel}
                    onSyncCatalog={handleSyncCatalog}
                    onDiscoverProviders={handleDiscoverProviders}
                    onImportDiscoveredProvider={handleImportDiscoveredProvider}
                    urlInput={urlInput}
                    setUrlInput={setUrlInput}
                    saveGatewayUrl={saveGatewayUrl}
                    urlSaved={urlSaved}
                    desktopGatewayBusy={desktopGatewayBusy}
                    desktopGatewayError={desktopGatewayError}
                    desktopGatewayMode={desktopGatewayMode}
                    remoteAdminEmail={remoteAdminEmail}
                    remoteAdminPassword={remoteAdminPassword}
                    setRemoteAdminEmail={setRemoteAdminEmail}
                    setRemoteAdminPassword={setRemoteAdminPassword}
                    isTauri={isTauri}
                    savingUpstreamRetrySettings={savingUpstreamRetrySettings}
                    setUpstreamRetryMaxRetries={setUpstreamRetryMaxRetries}
                    upstreamRetryMaxRetries={upstreamRetryMaxRetries}
                    saveUpstreamRetrySettings={() => {
                      void saveUpstreamRetrySettings();
                    }}
                    savedUpstreamRetryMaxRetries={savedUpstreamRetryMaxRetries}
                    customBaseUrl={customBaseUrl}
                    setCustomBaseUrl={setCustomBaseUrl}
                    customBaseUrlSaved={customBaseUrlSaved}
                    saveCustomBaseUrl={saveCustomBaseUrl}
                  />
                )}
                {activeTab === 'display' && <DisplayTabContent />}
                {activeTab === 'channels' && (
                  <ChannelsTabContent
                    channels={channels}
                    setChannels={setChannels}
                    descriptors={channelDescriptors}
                    providers={providers.map((provider) => ({
                      id: provider.id,
                      name: provider.name,
                      defaultModels: provider.defaultModels,
                    }))}
                    loadError={channelsPanelLoadError}
                    gatewayUrl={gatewayUrl}
                    token={token}
                    connectedCount={connectedCount}
                    disconnectedCount={disconnectedCount}
                  />
                )}
                {activeTab === 'memory' && <MemoryTabContent memoryState={memoryManagement} />}
                {activeTab === 'companion' && <CompanionTabContent />}
                {activeTab === 'usage' && (
                  <UsageTabContent
                    usageRecords={usageRecords}
                    usageBudget={usageBudget}
                    monthlyCostUsd={monthlyCostUsd}
                    costBreakdown={costBreakdown}
                    priceModels={priceModels}
                    devLogs={devLogs}
                    usageRecordsError={usageRecordsError}
                    costBreakdownError={costBreakdownError}
                    priceModelsError={priceModelsError}
                  />
                )}
                {activeTab === 'security' && (
                  <SecurityTabContent
                    permissions={permissions}
                    permissionCategories={permissionCategories}
                    permissionRules={permissionRules}
                    onPermissionRulesChange={handlePermissionRulesChange}
                    permissionRulesSaving={permissionRulesSaving}
                    attribution={attribution}
                    setAttribution={setAttribution}
                    diagnostics={diagnostics}
                    diagnosticsSource={devtoolsSourceStates.diagnostics}
                  />
                )}
                {activeTab === 'workspace' && (
                  <WorkspaceTabContent
                    filePatterns={filePatterns}
                    setFilePatterns={setFilePatterns}
                    desktopAutomationEnabled={desktopAutomationEnabled}
                    desktopAutomationSourceState={devtoolsSourceStates.desktopAutomation}
                    desktopControlEnabled={desktopControlEnabled}
                    desktopControlStatus={desktopControlStatus}
                    desktopControlSourceState={devtoolsSourceStates.desktopControl}
                    sshConnections={sshConnections}
                    sshSourceState={devtoolsSourceStates.sshConnections}
                    sshNodes={sshNodes}
                    sshCurrentPath={sshCurrentPath}
                    sshPreview={sshPreview}
                    sshDialogs={sshDialogs}
                    activeSshConnectionId={activeSSHConnectionId}
                    onSelectSshDialog={(connectionId, cwd) => {
                      setActiveSSHConnectionId(connectionId);
                      // 仅对已连接的连接拉文件；未就绪的对话只高亮，避免
                      // loadSshFiles 内部因 `SSH client not connected` 兜底清空。
                      const target = sshConnections.find((c) => c.id === connectionId);
                      if (target?.status === 'connected') {
                        void loadSshFiles(connectionId, cwd || '/');
                      }
                    }}
                    onAddSshConnection={addSshConnection}
                    onConnectSsh={connectSsh}
                    onDisconnectSsh={disconnectSsh}
                    onBrowseSshPath={browseSshPath}
                    onUploadSshFile={uploadSshFile}
                    githubTriggers={githubTriggers}
                    providerUpdatesDetail={devtoolsSourceStates.providerUpdates.detail}
                    onSaveGitHubTrigger={handleSaveGitHubTrigger}
                    onDesktopAutomationStart={handleDesktopAutomationStart}
                    onDesktopAutomationGoto={handleDesktopAutomationGoto}
                    onDesktopAutomationClick={handleDesktopAutomationClick}
                    onDesktopAutomationType={handleDesktopAutomationType}
                    onDesktopAutomationScreenshot={handleDesktopAutomationScreenshot}
                    onDesktopControlScreenshot={handleDesktopControlScreenshot}
                    onDesktopControlClick={handleDesktopControlClick}
                    onDesktopControlType={handleDesktopControlType}
                    onDesktopControlKey={handleDesktopControlKey}
                    onDesktopControlHotkey={handleDesktopControlHotkey}
                    onDesktopControlScroll={handleDesktopControlScroll}
                    onDesktopControlWait={handleDesktopControlWait}
                  />
                )}
                {activeTab === 'plugins' && (
                  <PluginsTabContent
                    providers={providers}
                    activeImageProviderId={activeSelection.image?.providerId}
                    activeImageModelId={activeSelection.image?.modelId}
                  />
                )}
                {activeTab === 'desktop' && isTauri && <DesktopTabContent />}
                {activeTab === 'devtools' && (
                  <DevtoolsTabContent
                    devLogs={devLogs}
                    devEvents={devEvents}
                    diagnostics={diagnostics}
                    diagnosticsAvailableDates={diagnosticsAvailableDates}
                    diagnosticsDateFilter={diagnosticsDateFilter}
                    onSetDiagnosticsDateFilter={setDiagnosticsDateFilter}
                    onClearDiagnostics={handleClearDiagnostics}
                    sourceStates={devtoolsSourceStates}
                    workers={workers}
                    onExportLogs={exportDevLogs}
                    onRefreshAllSources={refreshAllDevtoolsSources}
                    onRefreshSource={refreshDevtoolsSource}
                    sshConnections={sshConnections}
                    onAddSshConnection={addSshConnection}
                    onConnectSsh={connectSsh}
                    onDisconnectSsh={disconnectSsh}
                  />
                )}
                {activeTab === 'about' && <AboutPage />}
                {isEmbeddedRouteTab(activeTab) && (
                  <div
                    style={{
                      height: 'calc(100vh - 80px)',
                      margin: isCompactSettingsLayout ? '-12px 0' : '-20px 0',
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 0,
                    }}
                  >
                    <Suspense
                      fallback={
                        <PageTransitionLoader
                          variant="overlay"
                          caption="加载中"
                          title="正在加载页面"
                          description="正在加载页面资源，请稍候。"
                          prefersReducedMotion={prefersReducedMotion}
                        />
                      }
                    >
                      {activeTab === 'templates' && (
                        <PRELOADABLE_ROUTE_MODULES.templates.component />
                      )}
                      {activeTab === 'agents' && <PRELOADABLE_ROUTE_MODULES.agents.component />}
                      {activeTab === 'skills' && <PRELOADABLE_ROUTE_MODULES.skills.component />}
                      {activeTab === 'workflows' && (
                        <PRELOADABLE_ROUTE_MODULES.workflows.component />
                      )}
                      {activeTab === 'schedules' && (
                        <PRELOADABLE_ROUTE_MODULES.schedules.component />
                      )}
                      {activeTab === 'resources' && (
                        <PRELOADABLE_ROUTE_MODULES.resources.component />
                      )}
                      {activeTab === 'artifacts' && (
                        <PRELOADABLE_ROUTE_MODULES.artifacts.component />
                      )}
                      {activeTab === 'images' && <PRELOADABLE_ROUTE_MODULES.images.component />}
                      {activeTab === 'sessions' && <PRELOADABLE_ROUTE_MODULES.sessions.component />}
                    </Suspense>
                  </div>
                )}
              </div>
            </div>
            {!isCompactSettingsLayout ? (
              <div aria-hidden="true" style={{ gridColumn: '4' }} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
