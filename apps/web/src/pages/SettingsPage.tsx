import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { logger } from '../utils/logger.js';
import type {
  ChannelSettingsEntry,
  ChannelTypeDescriptor,
} from '../components/ChannelSubscriptionSettings.js';
import {
  buildDevEventsFromLogs,
  createInitialDevtoolsSourceStates,
  extractPrimaryMessage,
} from './settings-derived.js';
import { normalizeSettingsModelPrices } from './settings/usage-data.js';
import type {
  MCPServerEntry,
  AIProviderRef,
  AIModelConfigRef,
  ActiveSelectionRef,
  AIModelConfigItem,
  MonthlyRecord,
  CostBreakdownItem,
  PermissionDecisionRecord,
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
  DEFAULT_THINKING_DEFAULTS,
  isTauri,
  normalizeActiveSelectionProviders,
  normalizeThinkingDefaults,
  parseStructuredPayload,
  readErrorMessage,
  SETTINGS_LAYOUT_SIDE_GUTTER,
  SETTINGS_LAYOUT_MAX_WIDTH,
  SETTINGS_TAB_CONTENT_GAP,
  SETTINGS_TAB_NAV_WIDTH,
  TABS,
  type TabId,
} from './settings/settings-page-helpers.js';
import { useSettingsEnvironment } from './settings/use-settings-environment.js';
import { useSettingsUpstreamRetry } from './settings/use-settings-upstream-retry.js';
import { WorkspaceTabContent } from './settings/workspace-tab-content.js';
import { SecurityTabContent } from './settings/security-tab-content.js';
import { UsageTabContent } from './settings/usage-tab-content.js';
import type {
  DevtoolsSourceKey,
  DevtoolsSourceState,
  ProviderEditData,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
  ThinkingDefaultsRef,
} from './settings-types.js';

export default function SettingsPage() {
  const { gatewayUrl, setGatewayUrl, webAccessEnabled, webPort, setWebAccess } = useAuthStore();
  const token = useAuthStore((s) => s.accessToken);
  const { tab } = useParams<{ tab: string }>();
  const activeTab = (TABS.find((t) => t.id === tab)?.id ?? 'connection') as TabId;
  const {
    apiFetch,
    checkVersionUpdate,
    copied,
    copyAddress,
    portInput,
    saveGatewayUrl,
    saveWebPort,
    setPortInput,
    setUrlInput,
    toggleWebAccess,
    urlInput,
    urlSaved,
    versionInfo,
  } = useSettingsEnvironment({
    gatewayUrl,
    setGatewayUrl,
    token,
    webAccessEnabled,
    webPort,
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

  const [mcpServers, setMcpServersState] = useState<MCPServerEntry[]>([]);
  const [providers, setProviders] = useState<AIProviderRef[]>([]);
  const [activeSelection, setActiveSelectionState] = useState<ActiveSelectionRef>({
    chat: { providerId: '', modelId: '' },
    fast: { providerId: '', modelId: '' },
  });
  const [savedActiveSelection, setSavedActiveSelectionState] = useState<ActiveSelectionRef>({
    chat: { providerId: '', modelId: '' },
    fast: { providerId: '', modelId: '' },
  });
  const [defaultThinking, setDefaultThinkingState] = useState<ThinkingDefaultsRef>({
    chat: { ...DEFAULT_THINKING_DEFAULTS.chat },
    fast: { ...DEFAULT_THINKING_DEFAULTS.fast },
  });
  const [savedDefaultThinking, setSavedDefaultThinkingState] = useState<ThinkingDefaultsRef>({
    chat: { ...DEFAULT_THINKING_DEFAULTS.chat },
    fast: { ...DEFAULT_THINKING_DEFAULTS.fast },
  });
  const [savingDefaultModelSettings, setSavingDefaultModelSettings] = useState(false);
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
  const [devtoolsSourceStates, setDevtoolsSourceStates] = useState(() =>
    createInitialDevtoolsSourceStates(),
  );
  const [desktopAutomationEnabled, setDesktopAutomationEnabled] = useState(false);
  const [sshConnections, setSshConnections] = useState<SSHConnectionEntry[]>([]);
  const [sshCurrentPath, setSshCurrentPath] = useState('/');
  const [sshNodes, setSshNodes] = useState<FileTreeNode[]>([]);
  const [sshPreview, setSshPreview] = useState<(ArtifactItem & { content?: string }) | null>(null);
  const [activeSSHConnectionId, setActiveSSHConnectionId] = useState<string | null>(null);
  const providersRef = useRef<AIProviderRef[]>(providers);
  const devLogsRef = useRef<SettingsDevLogRecord[]>(devLogs);
  const workersRef = useRef<WorkerEntry[]>(workers);
  const diagnosticsRef = useRef<SettingsDiagnosticRecord[]>(diagnostics);
  const desktopAutomationEnabledRef = useRef(desktopAutomationEnabled);
  const sshConnectionsRef = useRef<SSHConnectionEntry[]>(sshConnections);
  const activeSelectionRef = useRef<ActiveSelectionRef>(activeSelection);
  const savedActiveSelectionRef = useRef<ActiveSelectionRef>(savedActiveSelection);
  const defaultThinkingRef = useRef<ThinkingDefaultsRef>(defaultThinking);
  const savedDefaultThinkingRef = useRef<ThinkingDefaultsRef>(savedDefaultThinking);
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

  useEffect(() => {
    activeSelectionRef.current = activeSelection;
  }, [activeSelection]);

  useEffect(() => {
    savedActiveSelectionRef.current = savedActiveSelection;
  }, [savedActiveSelection]);

  useEffect(() => {
    defaultThinkingRef.current = defaultThinking;
  }, [defaultThinking]);

  useEffect(() => {
    savedDefaultThinkingRef.current = savedDefaultThinking;
  }, [savedDefaultThinking]);

  const hasUnsavedDefaultModelChanges = React.useMemo(
    () =>
      JSON.stringify(activeSelection) !== JSON.stringify(savedActiveSelection) ||
      JSON.stringify(defaultThinking) !== JSON.stringify(savedDefaultThinking),
    [activeSelection, savedActiveSelection, defaultThinking, savedDefaultThinking],
  );

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
          }>,
      )
      .then((d) => {
        if (d.providers) setProviders(d.providers);
        if (d.activeSelection) {
          const normalizedSelection = normalizeActiveSelectionProviders(
            d.activeSelection,
            d.providers ?? providersRef.current,
          );
          activeSelectionRef.current = normalizedSelection;
          savedActiveSelectionRef.current = normalizedSelection;
          setActiveSelectionState(normalizedSelection);
          setSavedActiveSelectionState(normalizedSelection);
        }
        const normalizedThinking = normalizeThinkingDefaults(d.defaultThinking);
        defaultThinkingRef.current = normalizedThinking;
        savedDefaultThinkingRef.current = normalizedThinking;
        setDefaultThinkingState(normalizedThinking);
        setSavedDefaultThinkingState(normalizedThinking);
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
              servers: Array<{ id: string; name: string; type?: string; status?: string }>;
            }>)
          : Promise.resolve({ servers: [] }),
      )
      .then((d) =>
        setMcpStatuses(
          (d.servers ?? []).map((server) => ({
            id: server.id,
            name: server.name,
            status:
              server.status === 'connected' ||
              server.status === 'connecting' ||
              server.status === 'error'
                ? server.status
                : 'disconnected',
            toolCount: 0,
            authType: server.type,
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
      options?: {
        syncDraft?: boolean;
        syncSaved?: boolean;
      },
    ) => {
      if (!token) return;
      const syncDraft = options?.syncDraft ?? true;
      const syncSaved = options?.syncSaved ?? true;
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
          }),
        });

        const data = (await response.json()) as {
          providers?: AIProviderRef[];
          activeSelection?: ActiveSelectionRef;
          defaultThinking?: ThinkingDefaultsRef;
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
        if (data.activeSelection) {
          const normalizedSelection = normalizeActiveSelectionProviders(
            data.activeSelection,
            data.providers ?? providersRef.current,
          );
          if (syncDraft) {
            activeSelectionRef.current = normalizedSelection;
            setActiveSelectionState(normalizedSelection);
          }
          if (syncSaved) {
            savedActiveSelectionRef.current = normalizedSelection;
            setSavedActiveSelectionState(normalizedSelection);
          }
        }
        if (data.defaultThinking) {
          const normalizedThinking = normalizeThinkingDefaults(data.defaultThinking);
          if (syncDraft) {
            defaultThinkingRef.current = normalizedThinking;
            setDefaultThinkingState(normalizedThinking);
          }
          if (syncSaved) {
            savedDefaultThinkingRef.current = normalizedThinking;
            setSavedDefaultThinkingState(normalizedThinking);
          }
        }
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

  const setActiveSelection = React.useCallback(
    (updater: React.SetStateAction<ActiveSelectionRef>) => {
      setActiveSelectionState((prev) => {
        const nextRaw = typeof updater === 'function' ? updater(prev) : updater;
        const next = normalizeActiveSelectionProviders(nextRaw, providersRef.current);
        activeSelectionRef.current = next;
        return next;
      });
    },
    [],
  );

  const setDefaultThinking = React.useCallback(
    (updater: React.SetStateAction<ThinkingDefaultsRef>) => {
      setDefaultThinkingState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        defaultThinkingRef.current = next;
        return next;
      });
    },
    [],
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
    savedActiveSelectionRef.current = normalizedSavedSelection;
    setActiveSelectionState(normalizedDraftSelection);
    setSavedActiveSelectionState(normalizedSavedSelection);

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
      activeSelectionRef.current = normalizedDraftSelection;
      setActiveSelectionState(normalizedDraftSelection);
      await saveProviders(
        providersRef.current,
        normalizedDraftSelection,
        defaultThinkingRef.current,
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
            defaultModels: [],
          };
      const next = [...prev, nextProvider];
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(next, savedSelection, savedDefaultThinkingRef.current, {
        syncDraft: false,
        syncSaved: true,
      }).catch((error: unknown) => {
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
            }
          : provider,
      );
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(next, savedSelection, savedDefaultThinkingRef.current, {
        syncDraft: false,
        syncSaved: true,
      }).catch((error: unknown) => {
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
      void saveProviders(next, savedSelection, savedDefaultThinkingRef.current, {
        syncDraft: false,
        syncSaved: true,
      }).catch((error: unknown) => {
        logger.error('failed to save toggled provider', error);
      });
      return next;
    });
  }
  function handleToggleModel(providerId: string, modelId: string) {
    setProviders((prev) => {
      const next = prev.map((p) =>
        p.id === providerId
          ? {
              ...p,
              defaultModels: p.defaultModels.map((m: AIModelConfigRef) =>
                m.id === modelId ? { ...m, enabled: !m.enabled } : m,
              ),
            }
          : p,
      );
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(next, savedSelection, savedDefaultThinkingRef.current, {
        syncDraft: false,
        syncSaved: true,
      }).catch((error: unknown) => {
        logger.error('failed to save toggled model', error);
      });
      return next;
    });
  }
  function handleAddModel(providerId: string, model: AIModelConfigItem) {
    setProviders((prev) => {
      const next = prev.map((p) =>
        p.id === providerId ? { ...p, defaultModels: [...p.defaultModels, model] } : p,
      );
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(next, savedSelection, savedDefaultThinkingRef.current, {
        syncDraft: false,
        syncSaved: true,
      }).catch((error: unknown) => {
        logger.error('failed to save added model', error);
      });
      return next;
    });
  }
  function handleRemoveModel(providerId: string, modelId: string) {
    setProviders((prev) => {
      const next = prev.map((p) =>
        p.id === providerId
          ? {
              ...p,
              defaultModels: p.defaultModels.filter((m: AIModelConfigRef) => m.id !== modelId),
            }
          : p,
      );
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(next, savedSelection, savedDefaultThinkingRef.current, {
        syncDraft: false,
        syncSaved: true,
      }).catch((error: unknown) => {
        logger.error('failed to save removed model', error);
      });
      return next;
    });
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
              gridTemplateColumns: `${SETTINGS_TAB_NAV_WIDTH}px ${SETTINGS_TAB_CONTENT_GAP}px minmax(0, 1fr) ${SETTINGS_LAYOUT_SIDE_GUTTER}px`,
            }}
          >
            <nav
              style={{
                gridColumn: '1',
                width: SETTINGS_TAB_NAV_WIDTH,
                flexShrink: 0,
                borderRight: '1px solid var(--border-subtle)',
                padding: '16px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                overflowY: 'auto',
                background: 'var(--nav-rail-bg)',
              }}
            >
              {TABS.map((tabItem) => (
                <NavLink
                  key={tabItem.id}
                  to={`/settings/${tabItem.id}`}
                  style={({ isActive }) => ({
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    textAlign: 'center' as const,
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 400,
                    background: isActive ? 'var(--accent-muted)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--text-2)',
                    boxShadow: isActive ? 'inset 2px 0 0 var(--accent)' : 'none',
                    textDecoration: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 150ms ease, color 150ms ease',
                  })}
                >
                  {tabItem.label}
                </NavLink>
              ))}
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
                    hasUnsavedDefaultChanges={hasUnsavedDefaultModelChanges}
                    isSavingDefaultChanges={savingDefaultModelSettings}
                    setActiveSelection={setActiveSelection}
                    setDefaultThinking={setDefaultThinking}
                    saveDefaultModelSettings={() => {
                      void saveDefaultModelSettings();
                    }}
                    handleAddModel={handleAddModel}
                    handleRemoveModel={handleRemoveModel}
                    handleToggleModel={handleToggleModel}
                    handleToggleProvider={handleToggleProvider}
                    handleEditProvider={handleEditProvider}
                    handleAddProvider={handleAddProvider}
                    mcpServers={mcpServers}
                    setMcpServers={setMcpServers}
                    mcpStatuses={mcpStatuses}
                    urlInput={urlInput}
                    setUrlInput={setUrlInput}
                    saveGatewayUrl={saveGatewayUrl}
                    urlSaved={urlSaved}
                    webAccessEnabled={webAccessEnabled}
                    webPort={webPort}
                    portInput={portInput}
                    setPortInput={setPortInput}
                    saveWebPort={saveWebPort}
                    toggleWebAccess={() => void toggleWebAccess()}
                    copied={copied}
                    copyAddress={copyAddress}
                    isTauri={isTauri}
                    savingUpstreamRetrySettings={savingUpstreamRetrySettings}
                    setUpstreamRetryMaxRetries={setUpstreamRetryMaxRetries}
                    upstreamRetryMaxRetries={upstreamRetryMaxRetries}
                    saveUpstreamRetrySettings={() => {
                      void saveUpstreamRetrySettings();
                    }}
                    savedUpstreamRetryMaxRetries={savedUpstreamRetryMaxRetries}
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
                    onSaveGitHubTrigger={async (config) => {
                      const response = await apiFetch('/github/triggers', {
                        method: 'POST',
                        body: JSON.stringify(config),
                      });
                      if (!response.ok) {
                        const err = (await response.json()) as { message?: string };
                        throw new Error(err.message ?? '注册失败');
                      }
                      setGithubTriggers((prev) => [
                        ...prev,
                        { repo: config.repoFullNameOwnerSlashRepo, events: config.events },
                      ]);
                    }}
                    onDesktopAutomationStart={async (url) => {
                      await apiFetch('/desktop-automation/start', {
                        method: 'POST',
                        body: JSON.stringify({ url }),
                      });
                    }}
                    onDesktopAutomationGoto={async (url) => {
                      await apiFetch('/desktop-automation/goto', {
                        method: 'POST',
                        body: JSON.stringify({ url }),
                      });
                    }}
                    onDesktopAutomationClick={async (selector) => {
                      await apiFetch('/desktop-automation/click', {
                        method: 'POST',
                        body: JSON.stringify({ selector }),
                      });
                    }}
                    onDesktopAutomationType={async (selector, text) => {
                      await apiFetch('/desktop-automation/type', {
                        method: 'POST',
                        body: JSON.stringify({ selector, text }),
                      });
                    }}
                    onDesktopAutomationScreenshot={async () => {
                      const response = await apiFetch('/desktop-automation/screenshot', {
                        method: 'POST',
                      });
                      const payload = (await response.json()) as { screenshotBase64: string };
                      return payload.screenshotBase64;
                    }}
                  />
                )}
                {activeTab === 'devtools' && (
                  <DevtoolsTabContent
                    devLogs={devLogs}
                    devEvents={devEvents}
                    diagnostics={diagnostics}
                    diagnosticsAvailableDates={diagnosticsAvailableDates}
                    diagnosticsDateFilter={diagnosticsDateFilter}
                    onSetDiagnosticsDateFilter={setDiagnosticsDateFilter}
                    onClearDiagnostics={async () => {
                      try {
                        const resp = await fetch(`${gatewayUrl}/settings/diagnostics`, {
                          method: 'DELETE',
                          headers: { Authorization: `Bearer ${token ?? ''}` },
                        });
                        if (resp.ok) {
                          setDiagnostics([]);
                          setDiagnosticsAvailableDates([]);
                        }
                      } catch (_err) {
                        void 0;
                      }
                    }}
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
