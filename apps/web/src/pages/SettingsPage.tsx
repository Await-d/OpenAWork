import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { logger } from '../utils/logger.js';
import type {
  ChannelSettingsEntry,
  ChannelTypeDescriptor,
} from '../components/ChannelSubscriptionSettings.js';
import { validateImageGenerationSize } from '@openAwork/shared';
import {
  buildDevEventsFromLogs,
  createInitialDevtoolsSourceStates,
  extractPrimaryMessage,
} from './settings-derived.js';
import { normalizeSettingsModelPrices } from './settings/usage-data.js';
import {
  addProviderModel,
  removeProviderModel,
  toggleProviderModel,
  updateProviderModel,
} from './settings/provider-model-mutations.js';
import type {
  MCPServerEntry,
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
  MCPServerStatus,
  WorkerEntry,
  SSHConnectionEntry,
  FileTreeNode,
  ArtifactItem,
} from '@openAwork/shared-ui';
import { ConnectionTabContent } from './settings/connection-tab-content.js';
import { ChannelsTabContent } from './settings/channels-tab-content.js';
import { DevtoolsTabContent } from './settings/devtools-tab-content.js';
import {
  BUILTIN_PROVIDER_TYPE_SET,
  isTauri,
  normalizeActiveSelectionProviders,
  parseStructuredPayload,
  readErrorMessage,
  SETTINGS_LAYOUT_MAX_WIDTH,
  SETTINGS_TAB_CONTENT_GAP,
  SETTINGS_TAB_NAV_WIDTH,
  TAB_CATEGORIES,
  TABS,
  TAURI_ONLY_TAB_IDS,
  type TabId,
} from './settings/settings-page-helpers.js';
import { useSettingsEnvironment } from './settings/use-settings-environment.js';
import { useSettingsUpstreamRetry } from './settings/use-settings-upstream-retry.js';
import { useSettingsWebsearch } from './settings/use-settings-websearch.js';
import { WorkspaceTabContent } from './settings/workspace-tab-content.js';
import { SecurityTabContent } from './settings/security-tab-content.js';
import { UsageTabContent } from './settings/usage-tab-content.js';
import { MemoryTabContent } from './settings/memory-tab-content.js';
import { CompanionTabContent } from './settings/companion-tab-content.js';
import { PluginsTabContent } from './settings/plugins-tab-content.js';
import { DesktopTabContent } from './settings/desktop-tab-content.js';
import { useMemoryManagement } from './settings/use-memory-management.js';
import { useProviderDefaultProfile } from './settings/use-provider-default-profile.js';
import { useSettingsTabActions } from './settings/use-settings-tab-actions.js';
import type {
  DevtoolsSourceKey,
  DevtoolsSourceState,
  ProviderEditData,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
  ThinkingDefaultsRef,
} from './settings-types.js';

function SettingsNavIcon({ id }: { id: string }) {
  const icons: Record<string, React.ReactNode> = {
    connection: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
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
  const {
    gatewayUrl,
    setGatewayUrl,
    setAuth,
    webAccessEnabled,
    webPort,
    webExposeLan,
    setWebAccess,
  } = useAuthStore();
  const token = useAuthStore((s) => s.accessToken);
  const { tab } = useParams<{ tab: string }>();
  const activeTab = (TABS.find((t) => t.id === tab)?.id ?? 'connection') as TabId;
  const {
    apiFetch,
    checkVersionUpdate,
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
    versionInfo,
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
  } = useSettingsUpstreamRetry({ apiFetch, token });
  const {
    loadWebsearchPolicy,
    saveWebsearchPolicy,
    savedPolicy: websearchSavedPolicy,
    saving: websearchSaving,
    setPolicy: setWebsearchPolicy,
    policy: websearchPolicy,
  } = useSettingsWebsearch({ apiFetch, token });
  const memoryManagement = useMemoryManagement({
    apiFetch,
    token,
    active: activeTab === 'memory',
  });

  const [mcpServers, setMcpServersState] = useState<MCPServerEntry[]>([]);
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
  const [mcpStatuses, setMcpStatuses] = useState<MCPServerStatus[]>([]);
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
    handleSaveGitHubTrigger,
  } = useSettingsTabActions({
    apiFetch,
    gatewayUrl,
    token,
    setDiagnostics,
    setDiagnosticsAvailableDates,
    setGithubTriggers,
  });
  const [devtoolsSourceStates, setDevtoolsSourceStates] = useState(() =>
    createInitialDevtoolsSourceStates(),
  );
  const [desktopAutomationEnabled, setDesktopAutomationEnabled] = useState(false);
  const [sshConnections, setSshConnections] = useState<SSHConnectionEntry[]>([]);
  const [sshCurrentPath, setSshCurrentPath] = useState('/');
  const [sshNodes, setSshNodes] = useState<FileTreeNode[]>([]);
  const [sshPreview, setSshPreview] = useState<(ArtifactItem & { content?: string }) | null>(null);
  const [activeSSHConnectionId, setActiveSSHConnectionId] = useState<string | null>(null);
  const devLogsRef = useRef<SettingsDevLogRecord[]>(devLogs);
  const workersRef = useRef<WorkerEntry[]>(workers);
  const diagnosticsRef = useRef<SettingsDiagnosticRecord[]>(diagnostics);
  const desktopAutomationEnabledRef = useRef(desktopAutomationEnabled);
  const sshConnectionsRef = useRef<SSHConnectionEntry[]>(sshConnections);
  const providerSaveSeqRef = useRef(0);
  const providerSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hasLoadedFilePatterns = useRef(false);

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

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
    sshConnectionsRef.current = sshConnections;
  }, [sshConnections]);

  useEffect(() => {
    if (!hasLoadedFilePatterns.current) return;
    if (!token) return;
    const timer = setTimeout(() => {
      void fetch(`${gatewayUrl}/settings/file-patterns`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patterns: filePatterns }),
      }).catch(() => undefined);
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
      const response = await fetch(`${gatewayUrl}/settings/dev-logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载开发日志失败'));
      }

      const payload = (await response.json()) as {
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
      const response = await fetch(`${gatewayUrl}/settings/workers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载 Worker 状态失败'));
      }

      const payload = (await response.json()) as { workers: WorkerEntry[] };
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
      const response = await fetch(`${gatewayUrl}/settings/diagnostics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载诊断信息失败'));
      }

      const payload = (await response.json()) as {
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
      const response = await fetch(`${gatewayUrl}/desktop-automation/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载桌面自动化状态失败'));
      }

      const payload = (await response.json()) as { enabled: boolean };
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

  const loadSshConnections = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('sshConnections', {
      status: 'loading',
      detail: '正在刷新 SSH 连接',
      error: null,
    });

    try {
      const response = await fetch(`${gatewayUrl}/ssh/connections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载 SSH 连接失败'));
      }

      const payload = (await response.json()) as { connections: SSHConnectionEntry[] };
      const nextConnections = payload.connections ?? [];
      setSshConnections(nextConnections);
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
    [loadDesktopAutomationStatus, loadDevLogs, loadDiagnostics, loadSshConnections, loadWorkers],
  );

  const refreshAllDevtoolsSources = React.useCallback(() => {
    void Promise.allSettled([
      loadDevLogs(),
      loadDiagnostics(),
      loadDesktopAutomationStatus(),
      loadSshConnections(),
      loadWorkers(),
    ]);
  }, [loadDesktopAutomationStatus, loadDevLogs, loadDiagnostics, loadSshConnections, loadWorkers]);

  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}` };
    setDevtoolsSourceStates(createInitialDevtoolsSourceStates());
    void fetch(`${gatewayUrl}/settings/providers`, { headers: h })
      .then(
        (r) =>
          r.json() as Promise<{
            providers: AIProviderRef[] | null;
            activeSelection?: ActiveSelectionRef | null;
            defaultThinking?: ThinkingDefaultsRef | null;
            imageGenerationDefaults?: ImageGenerationDefaultsRef | null;
          }>,
      )
      .then((d) => {
        if (d.providers) {
          providersRef.current = d.providers;
          setProviders(d.providers);
        }
        applyServerDefaults(
          {
            activeSelection: d.activeSelection,
            defaultThinking: d.defaultThinking,
            imageGenerationDefaults: d.imageGenerationDefaults,
          },
          { syncDraft: true, syncSaved: true },
        );
      });
    void fetch(`${gatewayUrl}/settings/mcp-servers`, { headers: h })
      .then((r) => r.json() as Promise<{ servers: MCPServerEntry[] }>)
      .then((d) => setMcpServersState(d.servers ?? []));
    void fetch(`${gatewayUrl}/usage/records`, { headers: h })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '加载用量记录失败'));
        }

        return response.json() as Promise<{ records: MonthlyRecord[]; budgetUsd: number }>;
      })
      .then((d) => {
        setUsageRecords(d.records ?? []);
        setUsageBudget(d.budgetUsd ?? 0);
        setUsageRecordsError(null);
      })
      .catch((error: unknown) => {
        setUsageRecords([]);
        setUsageBudget(0);
        setUsageRecordsError(error instanceof Error ? error.message : '加载用量记录失败');
        logger.error('failed to load usage records', error);
      });
    void fetch(`${gatewayUrl}/usage/breakdown`, { headers: h })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '加载费用明细失败'));
        }

        return response.json() as Promise<{
          monthlyCostUsd: number;
          breakdown: CostBreakdownItem[];
        }>;
      })
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
    void fetch(`${gatewayUrl}/settings/permission-rules`, { headers: h })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{
              rules: PermissionRuleEntry[];
              categories: PermissionCategoryMeta[];
            }>)
          : Promise.resolve({ rules: [], categories: [] }),
      )
      .then((d) => {
        setPermissionRules(d.rules ?? []);
        if (d.categories?.length) setPermissionCategories(d.categories);
      })
      .catch(() => setPermissionRules([]));
    void fetch(`${gatewayUrl}/settings/permissions`, { headers: h })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ decisions: PermissionDecisionRecord[] }>)
          : Promise.resolve({ decisions: [] }),
      )
      .then((d) =>
        setPermissions(
          (d.decisions ?? []).map((decision) => ({
            ...decision,
            scope:
              (decision as PermissionDecisionRecord & { sessionId?: string; requestId?: string })
                .sessionId ??
              (decision as PermissionDecisionRecord & { requestId?: string }).requestId ??
              'settings',
            timestamp: Date.now(),
            riskLevel: 'low',
          })),
        ),
      );
    void loadDevLogs();
    void fetch(`${gatewayUrl}/settings/mcp-status`, { headers: h })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{
              servers: Array<{
                id: string;
                name: string;
                type?: string;
                status?: string;
                builtin?: boolean;
              }>;
            }>)
          : Promise.resolve({ servers: [] }),
      )
      .then((d) =>
        setMcpStatuses(
          (d.servers ?? []).map((server) => ({
            id: server.id,
            name: server.name,
            // 后端可能返回 'disabled'（来自 PR-D-Plugin retry 路由的
            // mcp-status 增强），在前端列表里和 'disconnected' 同处理：
            // 列表只渲染 connected/connecting/disconnected/error 四
            // 种；disabled 等价于灰点，但 retry 按钮仍会出现，让用户
            // 知道点了之后会因 enabled=false 短路返回 disabled。
            status:
              server.status === 'connected' ||
              server.status === 'connecting' ||
              server.status === 'error'
                ? server.status
                : 'disconnected',
            toolCount: 0,
            authType: server.type,
            builtin: server.builtin === true,
          })),
        ),
      );
    void loadWorkers();
    void loadDiagnostics();
    void fetch(`${gatewayUrl}/settings/model-prices`, { headers: h })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '加载模型费用配置失败'));
        }

        return response.json() as Promise<{ models?: unknown }>;
      })
      .then((d) => {
        setPriceModels(normalizeSettingsModelPrices(d.models));
        setPriceModelsError(null);
      })
      .catch((error: unknown) => {
        setPriceModels([]);
        setPriceModelsError(error instanceof Error ? error.message : '加载模型费用配置失败');
        logger.error('failed to load settings model prices', error);
      });
    void loadDesktopAutomationStatus();
    void loadSshConnections();
    void fetch(`${gatewayUrl}/settings/file-patterns`, { headers: h })
      .then((r) => r.json() as Promise<{ patterns: string[] }>)
      .then((d) => {
        setFilePatterns(d.patterns ?? []);
        hasLoadedFilePatterns.current = true;
      })
      .catch(() => {
        hasLoadedFilePatterns.current = true;
      });
    void fetch(`${gatewayUrl}/github/triggers`, { headers: h })
      .then((r) => r.json() as Promise<{ triggers: Array<{ repo: string; events: string[] }> }>)
      .then((d) => setGithubTriggers(d.triggers ?? []))
      .catch(() => undefined);
    void loadUpstreamRetrySettings().catch(() => undefined);
    void loadWebsearchPolicy().catch(() => undefined);
    void checkVersionUpdate();
    void fetch(`${gatewayUrl}/channels`, { headers: h })
      .then(async (response) => {
        const payload = (await response.json()) as {
          channels?: ChannelSettingsEntry[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? '加载通道失败');
        }

        return payload;
      })
      .then((data) => {
        setChannelsLoadError(null);
        setChannels(data.channels ?? []);
      })
      .catch((error: unknown) => {
        setChannels([]);
        setChannelsLoadError(error instanceof Error ? error.message : '加载通道失败');
        logger.error('failed to load channels', error);
      });
    void fetch(`${gatewayUrl}/channels/descriptors`, { headers: h })
      .then(async (response) => {
        const payload = (await response.json()) as {
          descriptors?: ChannelTypeDescriptor[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? '加载通道模板失败');
        }

        return payload;
      })
      .then((data) => {
        setChannelDescriptorsLoadError(null);
        setChannelDescriptors(data.descriptors ?? []);
      })
      .catch((error: unknown) => {
        setChannelDescriptors([]);
        setChannelDescriptorsLoadError(error instanceof Error ? error.message : '加载通道模板失败');
        logger.error('failed to load channel descriptors', error);
      });
  }, [
    gatewayUrl,
    loadDesktopAutomationStatus,
    loadDevLogs,
    loadDiagnostics,
    loadUpstreamRetrySettings,
    loadWebsearchPolicy,
    loadSshConnections,
    loadWorkers,
    checkVersionUpdate,
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
        const response = await fetch(`${gatewayUrl}/settings/providers`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providers: next,
            activeSelection: nextSel,
            defaultThinking: nextThinking,
            imageGenerationDefaults: nextImageGenerationDefaults,
          }),
        });

        const data = (await response.json()) as {
          providers?: AIProviderRef[];
          activeSelection?: ActiveSelectionRef;
          defaultThinking?: ThinkingDefaultsRef;
          imageGenerationDefaults?: ImageGenerationDefaultsRef;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? '保存提供商配置失败');
        }

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

  const setMcpServers = React.useCallback(
    (updater: React.SetStateAction<MCPServerEntry[]>) => {
      setMcpServersState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (token) {
          void fetch(`${gatewayUrl}/settings/mcp-servers`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ servers: next }),
          });
        }
        return next;
      });
    },
    [token, gatewayUrl],
  );

  /**
   * 触发"重试连接 / 安装"。三段式：
   *   1) 立刻在状态里把 retryFeedback 设为 pending → 按钮转灰；
   *   2) POST /settings/mcp-servers/{id}/retry，后端实际跑 disconnect
   *      + 重连（stdio 用 npx -y 时顺带按需安装包）；
   *   3) 解析 200 响应里的 status：
   *      - `connected` → status 染绿、retryFeedback 为 ok，刷新
   *        toolCount；
   *      - `error` → retryFeedback 携带错误信息；
   *      - `disabled` → 把状态置为 disconnected（按当前列表设计，
   *        disabled 在加载阶段就被规整成 disconnected，这里保持
   *        一致）。
   *   网络错误 / 4xx 也染红，避免 UI 死挂在 pending。
   */
  const handleRetryMcp = React.useCallback(
    (serverId: string) => {
      if (!token) return;
      setMcpStatuses((prev) =>
        prev.map((server) =>
          server.id === serverId
            ? { ...server, retryFeedback: { kind: 'pending' as const } }
            : server,
        ),
      );

      void (async () => {
        try {
          const response = await fetch(
            `${gatewayUrl}/settings/mcp-servers/${encodeURIComponent(serverId)}/retry`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
          }
          const data = (await response.json()) as {
            status: 'connected' | 'error' | 'disabled';
            toolCount: number;
            durationMs: number;
            error?: string;
          };
          setMcpStatuses((prev) =>
            prev.map((server) => {
              if (server.id !== serverId) return server;
              if (data.status === 'connected') {
                return {
                  ...server,
                  status: 'connected' as const,
                  toolCount: data.toolCount,
                  retryFeedback: {
                    kind: 'ok' as const,
                    toolCount: data.toolCount,
                    durationMs: data.durationMs,
                  },
                };
              }
              if (data.status === 'error') {
                return {
                  ...server,
                  status: 'error' as const,
                  retryFeedback: {
                    kind: 'fail' as const,
                    error: data.error ?? '未知错误',
                  },
                };
              }
              // disabled — 按钮点了等于无操作；归位到 disconnected 灰点。
              return {
                ...server,
                status: 'disconnected' as const,
                retryFeedback: undefined,
              };
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setMcpStatuses((prev) =>
            prev.map((server) =>
              server.id === serverId
                ? {
                    ...server,
                    status: 'error' as const,
                    retryFeedback: { kind: 'fail' as const, error: message },
                  }
                : server,
            ),
          );
        }
      })();
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
    void apiFetch('/settings/permission-rules', {
      method: 'PUT',
      body: JSON.stringify({ rules }),
    })
      .then((response) => {
        if (!response.ok) {
          logger.error('failed to save permission rules');
        }
      })
      .catch((error: unknown) => {
        logger.error('failed to save permission rules', error);
      })
      .finally(() => setPermissionRulesSaving(false));
  }

  function handleAddProvider(data?: ProviderEditData) {
    if (!data) return;
    setProviders((prev) => {
      const existingTemplate =
        data.type === 'custom' ? undefined : prev.find((provider) => provider.type === data.type);
      const nextProvider: AIProviderRef = existingTemplate
        ? {
            ...existingTemplate,
            id: prev.some((provider) => provider.id === existingTemplate.id)
              ? `${existingTemplate.id}-${Date.now()}`
              : existingTemplate.id,
            name: data.name.trim() || existingTemplate.name,
            enabled: data.enabled,
            apiKey: data.apiKey.trim() || undefined,
            baseUrl: data.baseUrl.trim() || existingTemplate.baseUrl,
            upstreamProtocol: data.upstreamProtocol,
          }
        : {
            id:
              BUILTIN_PROVIDER_TYPE_SET.has(data.type) && data.type !== 'custom'
                ? data.type
                : `${BUILTIN_PROVIDER_TYPE_SET.has(data.type) ? data.type : 'custom'}-${Date.now()}`,
            type: BUILTIN_PROVIDER_TYPE_SET.has(data.type) ? data.type : 'custom',
            name: data.name.trim() || data.type,
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
      const response = await apiFetch(
        `/ssh/files?connectionId=${encodeURIComponent(connectionId)}&path=${encodeURIComponent(path)}`,
        { method: 'GET' },
      );
      const payload = (await response.json()) as {
        entries: Array<{ name: string; path: string; kind: 'file' | 'directory' }>;
      };
      const nodes: FileTreeNode[] = (payload.entries ?? []).map((entry) => ({
        path: entry.path,
        name: entry.name,
        type: entry.kind,
      }));
      setSshNodes(nodes);
      setSshCurrentPath(path);
      const firstFile = nodes.find((node) => node.type === 'file');
      if (firstFile) {
        const previewResponse = await apiFetch(
          `/ssh/file?connectionId=${encodeURIComponent(connectionId)}&path=${encodeURIComponent(firstFile.path)}`,
          { method: 'GET' },
        );
        const previewPayload = (await previewResponse.json()) as {
          preview: { path: string; content: string };
        };
        setSshPreview({
          id: previewPayload.preview.path,
          name: previewPayload.preview.path.split('/').pop() ?? previewPayload.preview.path,
          type: 'text',
          createdAt: Date.now(),
          sessionId: connectionId,
          content: previewPayload.preview.content,
        });
      } else {
        setSshPreview(null);
      }
    },
    [apiFetch],
  );

  useEffect(() => {
    if (activeSSHConnectionId) return;
    const firstConnected = sshConnections.find((connection) => connection.status === 'connected');
    if (!firstConnected) return;
    setActiveSSHConnectionId(firstConnected.id);
    void loadSshFiles(firstConnected.id, '/');
  }, [activeSSHConnectionId, loadSshFiles, sshConnections]);

  const addSshConnection = React.useCallback(
    (entry: Omit<SSHConnectionEntry, 'id' | 'status'>) => {
      void apiFetch('/ssh/connections', {
        method: 'POST',
        body: JSON.stringify(entry),
      })
        .then((response) => response.json() as Promise<{ connection: SSHConnectionEntry }>)
        .then((payload) => {
          setSshConnections((prev) => [...prev, payload.connection]);
          setActiveSSHConnectionId(payload.connection.id);
        });
    },
    [apiFetch],
  );

  const connectSsh = React.useCallback(
    (id: string) => {
      void apiFetch(`/ssh/connections/${id}/connect`, { method: 'POST' })
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
    [apiFetch, loadSshFiles],
  );

  const disconnectSsh = React.useCallback(
    (id: string) => {
      void apiFetch(`/ssh/connections/${id}/disconnect`, { method: 'POST' }).then(() => {
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
    [activeSSHConnectionId, apiFetch],
  );

  const browseSshPath = React.useCallback(
    (path: string) => {
      if (!activeSSHConnectionId) return;
      const node = sshNodes.find((item) => item.path === path);
      if (node?.type === 'directory') {
        void loadSshFiles(activeSSHConnectionId, path);
        return;
      }
      void apiFetch(
        `/ssh/file?connectionId=${encodeURIComponent(activeSSHConnectionId)}&path=${encodeURIComponent(path)}`,
        { method: 'GET' },
      )
        .then(
          (response) => response.json() as Promise<{ preview: { path: string; content: string } }>,
        )
        .then((payload) =>
          setSshPreview({
            id: payload.preview.path,
            name: payload.preview.path.split('/').pop() ?? payload.preview.path,
            type: 'text',
            createdAt: Date.now(),
            sessionId: activeSSHConnectionId,
            content: payload.preview.content,
          }),
        );
    },
    [activeSSHConnectionId, apiFetch, loadSshFiles, sshNodes],
  );

  const uploadSshFile = React.useCallback(
    (file: File) => {
      if (!activeSSHConnectionId) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (!(result instanceof ArrayBuffer)) return;
        const bytes = new Uint8Array(result);
        const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
        const contentBase64 = btoa(binary);
        void apiFetch('/ssh/upload', {
          method: 'POST',
          body: JSON.stringify({
            connectionId: activeSSHConnectionId,
            path: `${sshCurrentPath.replace(/\/$/, '')}/${file.name}`,
            contentBase64,
          }),
        }).then(() => {
          void loadSshFiles(activeSSHConnectionId, sshCurrentPath);
        });
      };
      reader.readAsArrayBuffer(file);
    },
    [activeSSHConnectionId, apiFetch, loadSshFiles, sshCurrentPath],
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
          style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', padding: '0 28px' }}
        >
          <div
            style={{
              display: 'grid',
              flex: 1,
              width: '100%',
              maxWidth: SETTINGS_LAYOUT_MAX_WIDTH,
              minHeight: 0,
              margin: '0 auto',
              overflow: 'hidden',
              // 3 列布局：nav | gap | content。外层 `margin: 0 auto` 负责在宽屏
              // 下整体居中；窄屏下 content 能拿到所有剩余宽度，不再被旧的
              // 第 4 列「装饰 gutter」吃掉 220px。
              gridTemplateColumns: `${SETTINGS_TAB_NAV_WIDTH}px ${SETTINGS_TAB_CONTENT_GAP}px minmax(0, 1fr)`,
            }}
          >
            <nav
              style={{
                gridColumn: '1',
                width: SETTINGS_TAB_NAV_WIDTH,
                flexShrink: 0,
                borderRight: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--nav-rail-bg)',
                minHeight: 0,
              }}
            >
              <div
                style={{
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
                    color: 'var(--text-3)',
                    marginTop: 3,
                  }}
                >
                  偏好与模型设置
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '8px 8px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  scrollbarWidth: 'none' as const,
                }}
              >
                {TAB_CATEGORIES.map((category, idx) => (
                  <div key={category.id} style={{ marginTop: idx > 0 ? 12 : 0 }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--text-3)',
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
                    ).map((tabItem) => (
                      <NavLink
                        key={tabItem.id}
                        to={`/settings/${tabItem.id}`}
                        style={({ isActive }) => ({
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: isActive ? 600 : 400,
                          background: isActive ? 'var(--accent-muted)' : 'transparent',
                          color: isActive ? 'var(--accent)' : 'var(--text-2)',
                          boxShadow: isActive ? 'inset 2px 0 0 var(--accent)' : 'none',
                          textDecoration: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'background 150ms ease, color 150ms ease',
                          overflow: 'hidden',
                        })}
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
                    ))}
                  </div>
                ))}
              </div>
            </nav>
            <div
              style={{
                gridColumn: '3',
                overflowY: 'auto',
                padding: '20px 0',
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
                    mcpServers={mcpServers}
                    setMcpServers={setMcpServers}
                    mcpStatuses={mcpStatuses}
                    onRetryMcp={handleRetryMcp}
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
                    websearchPolicy={websearchPolicy}
                    websearchSavedPolicy={websearchSavedPolicy}
                    websearchSaving={websearchSaving}
                    setWebsearchPolicy={setWebsearchPolicy}
                    saveWebsearchPolicy={() => {
                      void saveWebsearchPolicy();
                    }}
                  />
                )}
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
                    apiFetch={apiFetch}
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
                    sshConnections={sshConnections}
                    sshSourceState={devtoolsSourceStates.sshConnections}
                    sshNodes={sshNodes}
                    sshCurrentPath={sshCurrentPath}
                    sshPreview={sshPreview}
                    onAddSshConnection={addSshConnection}
                    onConnectSsh={connectSsh}
                    onDisconnectSsh={disconnectSsh}
                    onBrowseSshPath={browseSshPath}
                    onUploadSshFile={uploadSshFile}
                    githubTriggers={githubTriggers}
                    providerUpdatesDetail={devtoolsSourceStates.providerUpdates.detail}
                    versionInfo={versionInfo}
                    onCheckVersion={checkVersionUpdate}
                    onSaveGitHubTrigger={handleSaveGitHubTrigger}
                    onDesktopAutomationStart={handleDesktopAutomationStart}
                    onDesktopAutomationGoto={handleDesktopAutomationGoto}
                    onDesktopAutomationClick={handleDesktopAutomationClick}
                    onDesktopAutomationType={handleDesktopAutomationType}
                    onDesktopAutomationScreenshot={handleDesktopAutomationScreenshot}
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
                  />
                )}
              </div>
            </div>
            <div aria-hidden="true" style={{ gridColumn: '4' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
