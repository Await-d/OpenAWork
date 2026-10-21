import React, { useEffect, useRef, useState } from 'react';
import {
  createDesktopAutomationClient,
  createDesktopControlClient,
  createSettingsClient,
  createSshClient,
} from '@openAwork/web-client';
import type { DesktopControlStatus, SSHDialogEntry } from '@openAwork/web-client';
import type { SSHConnectionEntry, WorkerEntry } from '@openAwork/shared-ui';
import { logger } from '../../../utils/log/logger.js';
import {
  createInitialDevtoolsSourceStates,
  extractPrimaryMessage,
} from '../state/settings-derived.js';
import type {
  DevtoolsChannelAuditRecord,
  DevtoolsChannelRecord,
  DevtoolsSourceKey,
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from '../state/settings-types.js';
import { parseStructuredPayload } from './settings-page-helpers.js';

interface UseDevtoolsSourcesOptions {
  gatewayUrl: string;
  token: string | null;
}

/**
 * Settings 页 devtools 数据源（开发日志 / Worker / 诊断 / 桌面自动化 / 桌面控制 /
 * SSH 连接）的状态与加载器。仅负责数据装配，不承担渲染。
 */
/**
 * DevTools 数据源刷新的统一包装：try → catch 交给 `onError`（**无 finally**）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 try 内的值块（`??`、`.map(...)`、`?.`），本
 * hook 这处 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runDevtoolsRefreshOnce(ctx: {
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  }
}

export function useDevtoolsSources({ gatewayUrl, token }: UseDevtoolsSourcesOptions) {
  const [devLogs, setDevLogs] = useState<SettingsDevLogRecord[]>([]);
  const [workers, setWorkers] = useState<WorkerEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<SettingsDiagnosticRecord[]>([]);
  const [diagnosticsAvailableDates, setDiagnosticsAvailableDates] = useState<string[]>([]);
  // 命名刻意避开 `channels`：SettingsPage 里的 `channels` 是频道**配置**列表
  // （`ChannelInstance[]`，来自 useSettingsData），这里要的是排障用的**健康快照**，
  // 两者来源、生命周期、语义都不同。同名会让 `setChannels` 一度指向两个不相干
  // 的状态，是最难排查的一类 bug。
  const [channelHealthRecords, setChannelHealthRecords] = useState<DevtoolsChannelRecord[]>([]);
  const [channelAuditLogs, setChannelAuditLogs] = useState<DevtoolsChannelAuditRecord[]>([]);
  const [devtoolsSourceStates, setDevtoolsSourceStates] = useState(() =>
    createInitialDevtoolsSourceStates(),
  );
  const [desktopAutomationEnabled, setDesktopAutomationEnabled] = useState(false);
  const [desktopControlEnabled, setDesktopControlEnabled] = useState(false);
  const [desktopControlStatus, setDesktopControlStatus] = useState<DesktopControlStatus | null>(
    null,
  );
  const [sshConnections, setSshConnections] = useState<SSHConnectionEntry[]>([]);
  const [sshDialogs, setSshDialogs] = useState<SSHDialogEntry[]>([]);
  // 「最近 SSH 对话」是否已从网关拉取完成（成功或降级为空都算就绪）。恢复
  // effect 必须等这个标志为 true 再决策，否则 dialogs 还没到达就会被 fallback
  // 抢先锁死 restoredRef，导致永远恢复不到上次的对话。
  const [sshDialogsReady, setSshDialogsReady] = useState(false);
  const devLogsRef = useRef<SettingsDevLogRecord[]>(devLogs);
  const workersRef = useRef<WorkerEntry[]>(workers);
  const diagnosticsRef = useRef<SettingsDiagnosticRecord[]>(diagnostics);
  const channelsRef = useRef<DevtoolsChannelRecord[]>(channelHealthRecords);
  const desktopAutomationEnabledRef = useRef(desktopAutomationEnabled);
  const desktopControlEnabledRef = useRef(desktopControlEnabled);
  const sshConnectionsRef = useRef<SSHConnectionEntry[]>(sshConnections);

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
    channelsRef.current = channelHealthRecords;
  }, [channelHealthRecords]);

  useEffect(() => {
    desktopAutomationEnabledRef.current = desktopAutomationEnabled;
  }, [desktopAutomationEnabled]);

  useEffect(() => {
    desktopControlEnabledRef.current = desktopControlEnabled;
  }, [desktopControlEnabled]);

  useEffect(() => {
    sshConnectionsRef.current = sshConnections;
  }, [sshConnections]);

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

    // try/catch 下沉到模块级 `runDevtoolsRefreshOnce`（见其注释）。
    await runDevtoolsRefreshOnce({
      onError: (error) => {
        updateDevtoolsSourceState('devLogs', {
          status: 'error',
          detail: '开发日志加载失败',
          error: error instanceof Error ? error.message : '开发日志加载失败',
          count: devLogsRef.current.length,
          updatedAt: Date.now(),
        });
        logger.error('failed to load dev logs', error);
      },
      run: async () => {
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
      },
    });
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const clearDevLogs = React.useCallback(async () => {
    if (!token) return;

    // 同上：整段下沉到 `runDevtoolsRefreshOnce`（见其注释）。
    await runDevtoolsRefreshOnce({
      onError: (error) => {
        // 清除失败不抛出:调用方(按钮)只关心终态,失败以源状态错误提示呈现。
        updateDevtoolsSourceState('devLogs', {
          status: 'error',
          detail: '清空开发日志失败',
          error: error instanceof Error ? error.message : '清空开发日志失败',
          count: devLogsRef.current.length,
          updatedAt: Date.now(),
        });
        logger.error('failed to clear dev logs', error);
      },
      run: async () => {
        await createSettingsClient(gatewayUrl).clearDevLogs(token);
        setDevLogs([]);
        updateDevtoolsSourceState('devLogs', {
          status: 'empty',
          detail: '开发日志已清空',
          error: null,
          count: 0,
          updatedAt: Date.now(),
        });
      },
    });
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadWorkers = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('workers', {
      status: 'loading',
      detail: '正在刷新 Worker 状态',
      error: null,
    });

    // try/catch 下沉到模块级 `runDevtoolsRefreshOnce`（见其注释）。
    await runDevtoolsRefreshOnce({
      onError: (error) => {
        updateDevtoolsSourceState('workers', {
          status: 'error',
          detail: 'Worker 状态加载失败',
          error: error instanceof Error ? error.message : '加载 Worker 状态失败',
          count: workersRef.current.length,
          updatedAt: Date.now(),
        });
        logger.error('failed to load workers', error);
      },
      run: async () => {
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
      },
    });
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadDiagnostics = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('diagnostics', {
      status: 'loading',
      detail: '正在刷新诊断信息',
      error: null,
    });

    // try/catch 下沉到模块级 `runDevtoolsRefreshOnce`（见其注释）。
    await runDevtoolsRefreshOnce({
      onError: (error) => {
        updateDevtoolsSourceState('diagnostics', {
          status: 'error',
          detail: '诊断信息加载失败',
          error: error instanceof Error ? error.message : '加载诊断信息失败',
          count: diagnosticsRef.current.length,
          updatedAt: Date.now(),
        });
        logger.error('failed to load diagnostics', error);
      },
      run: async () => {
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
      },
    });
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadChannelTroubleshooting = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('channelTroubleshooting', {
      status: 'loading',
      detail: '正在刷新频道路障信息',
      error: null,
    });

    // try/catch 下沉到模块级 `runDevtoolsRefreshOnce`（见其注释）。
    await runDevtoolsRefreshOnce({
      onError: (error) => {
        updateDevtoolsSourceState('channelTroubleshooting', {
          status: 'error',
          detail: '频道路障信息加载失败',
          error: error instanceof Error ? error.message : '加载频道路障信息失败',
          count: channelsRef.current.length,
          updatedAt: Date.now(),
        });
        logger.error('failed to load channel troubleshooting', error);
      },
      run: async () => {
        const payload = await createSettingsClient(gatewayUrl).getChannelTroubleshooting(token);
        const nextChannels = (payload.channels ?? []).map((channel) => ({
          channelId: channel.channelId,
          channelType: channel.lastErrorChannelType ?? null,
          lastError: channel.lastError ?? null,
          lastErrorAt: channel.lastErrorAt ?? null,
          lastErrorSource: channel.lastErrorSource ?? null,
          lastInboundAccepted: channel.lastInboundAccepted ?? null,
          lastInboundAt: channel.lastInboundAt ?? null,
          lastInboundError: channel.lastInboundError ?? null,
          lastInboundType: channel.lastInboundType ?? null,
          lastMessageAt: channel.lastMessageAt ?? null,
          lastMessageChatId: channel.lastMessageChatId ?? null,
          status: channel.status ?? null,
        }));
        const nextAuditLogs = (payload.auditLogs ?? []).map((log) => ({
          id: log.id,
          channelId: log.channelId ?? null,
          code: log.code ?? null,
          createdAt: log.createdAt,
          message: log.message,
          sessionId: log.sessionId ?? null,
          source: log.source ?? null,
          toolName: log.toolName,
          stack: log.stack ?? null,
        }));

        setChannelHealthRecords(nextChannels);
        setChannelAuditLogs(nextAuditLogs);

        // 「有健康快照但都健康」与「一个频道都没配」是两回事：前者 status 是
        // healthy（信息有价值），后者才是 empty。合并计数取两者之和 —— 用户
        // 关心的是「有多少条待排查项」。
        const issueCount = nextChannels.filter((channel) => channel.lastError !== null).length;
        const totalCount = issueCount + nextAuditLogs.length;
        updateDevtoolsSourceState('channelTroubleshooting', {
          status: totalCount > 0 ? 'healthy' : 'empty',
          detail:
            totalCount > 0
              ? `${issueCount} 个频道带故障标记，${nextAuditLogs.length} 条错误留痕`
              : nextChannels.length > 0
                ? `${nextChannels.length} 个频道均无故障标记`
                : '尚未配置任何消息频道',
          error: null,
          count: totalCount,
          updatedAt: Date.now(),
        });
      },
    });
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  /**
   * 清空频道路障留痕。
   *
   * 与 `loadChannelTroubleshooting` 成对放在本 hook：清空后要把
   * `channel_health` / 审计行两处本地状态一起归零，若拆到 tab-actions hook
   * 就得把两个 setter 一路透传过去。
   */
  const clearChannelTroubleshooting = React.useCallback(async () => {
    if (!token) return;
    // 同上：整段下沉到 `runDevtoolsRefreshOnce`（见其注释）。
    await runDevtoolsRefreshOnce({
      onError: (error) => {
        // 清空失败保留现有数据并照实报错：静默失败会让用户以为记录已删，
        // 实际还在库里，下次排查看到旧数据时更困惑。
        updateDevtoolsSourceState('channelTroubleshooting', {
          status: 'error',
          detail: '清空频道路障留痕失败',
          error: error instanceof Error ? error.message : '清空频道路障留痕失败',
          count: channelsRef.current.length,
          updatedAt: Date.now(),
        });
        logger.error('failed to clear channel troubleshooting', error);
      },
      run: async () => {
        await createSettingsClient(gatewayUrl).clearChannelTroubleshooting(token);
        setChannelHealthRecords([]);
        setChannelAuditLogs([]);
        updateDevtoolsSourceState('channelTroubleshooting', {
          status: 'empty',
          detail: '频道路障留痕已清空',
          error: null,
          count: 0,
          updatedAt: Date.now(),
        });
      },
    });
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadDesktopAutomationStatus = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('desktopAutomation', {
      status: 'loading',
      detail: '正在刷新桌面自动化状态',
      error: null,
    });

    // try/catch 下沉到模块级 `runDevtoolsRefreshOnce`（见其注释）。
    await runDevtoolsRefreshOnce({
      onError: (error) => {
        updateDevtoolsSourceState('desktopAutomation', {
          status: 'error',
          detail: '桌面自动化状态加载失败',
          error: error instanceof Error ? error.message : '加载桌面自动化状态失败',
          count: desktopAutomationEnabledRef.current ? 1 : 0,
          updatedAt: Date.now(),
        });
        logger.error('failed to load desktop automation status', error);
      },
      run: async () => {
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
      },
    });
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadDesktopControlStatus = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('desktopControl', {
      status: 'loading',
      detail: '正在刷新系统桌面控制状态',
      error: null,
    });

    // try/catch 下沉到模块级 `runDevtoolsRefreshOnce`（见其注释）。
    await runDevtoolsRefreshOnce({
      onError: (error) => {
        updateDevtoolsSourceState('desktopControl', {
          status: 'error',
          detail: '系统桌面控制状态加载失败',
          error: error instanceof Error ? error.message : '加载系统桌面控制状态失败',
          count: desktopControlEnabledRef.current ? 1 : 0,
          updatedAt: Date.now(),
        });
        logger.error('failed to load desktop control status', error);
      },
      run: async () => {
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
      },
    });
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  const loadSshConnections = React.useCallback(async () => {
    if (!token) return;

    updateDevtoolsSourceState('sshConnections', {
      status: 'loading',
      detail: '正在刷新 SSH 连接',
      error: null,
    });

    // try/catch 下沉到模块级 `runDevtoolsRefreshOnce`（见其注释）。
    await runDevtoolsRefreshOnce({
      onError: (error) => {
        updateDevtoolsSourceState('sshConnections', {
          status: 'error',
          detail: 'SSH 连接加载失败',
          error: error instanceof Error ? error.message : '加载 SSH 连接失败',
          count: sshConnectionsRef.current.length,
          updatedAt: Date.now(),
        });
        logger.error('failed to load ssh connections', error);
      },
      run: async () => {
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
      },
    });
  }, [gatewayUrl, token, updateDevtoolsSourceState]);

  return {
    devLogs,
    workers,
    diagnostics,
    setDiagnostics,
    diagnosticsAvailableDates,
    setDiagnosticsAvailableDates,
    channelHealthRecords,
    setChannelHealthRecords,
    channelAuditLogs,
    setChannelAuditLogs,
    devtoolsSourceStates,
    setDevtoolsSourceStates,
    desktopAutomationEnabled,
    desktopControlEnabled,
    desktopControlStatus,
    sshConnections,
    setSshConnections,
    sshDialogs,
    setSshDialogs,
    sshDialogsReady,
    loadDevLogs,
    clearDevLogs,
    loadWorkers,
    loadDiagnostics,
    loadChannelTroubleshooting,
    clearChannelTroubleshooting,
    loadDesktopAutomationStatus,
    loadDesktopControlStatus,
    loadSshConnections,
  };
}
