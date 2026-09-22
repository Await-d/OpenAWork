import React from 'react';
import type { WorkerEntry } from '@openAwork/shared-ui';
import type {
  DevtoolsSourceKey,
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from '../state/settings-types.js';
import {
  buildDiagnosticClipboardPayload,
  buildDiagnosticClipboardRecord,
  buildDiagnosticKey,
  buildLogClipboardPayload,
  buildLogClipboardRecord,
  buildLogKey,
  buildWorkerClipboardRecord,
  buildWorkerKey,
  findRelatedLogs,
  matchesDiagnosticQuery,
  matchesLogQuery,
  matchesWorkerQuery,
  stringifyDetails,
} from './devtools-workbench-primitives.js';
import {
  DevtoolsSectionNav,
  type DevtoolsSectionId,
  type DevtoolsSectionNavItem,
} from './devtools-section-nav.js';
import { DevtoolsOverviewSection } from './devtools-overview-section.js';
import { DevtoolsDiagnosticsSection } from './devtools-diagnostics-section.js';
import { DevtoolsLogsSection } from './devtools-logs-section.js';
import { DevtoolsWorkerSection } from './devtools-worker-section.js';
import {
  buildErrorExportPayload,
  buildErrorExportMarkdown,
  buildErrorReportHtml,
  triggerDownload,
} from './devtools-error-command.js';
import { buildTroubleshootBundleMarkdown } from './devtools-troubleshoot-bundle.js';

declare const __APP_VERSION__: string;
declare const __APP_BUILD_VERSION__: string;
declare const __APP_BUILD_TIME__: string;
declare const __APP_GIT_HASH__: string;
declare const __APP_GIT_BRANCH__: string;

interface DevtoolsTabContentProps {
  gatewayUrl: string;
  devLogs: SettingsDevLogRecord[];
  diagnostics: SettingsDiagnosticRecord[];
  diagnosticsAvailableDates: string[];
  diagnosticsDateFilter: string | null;
  onSetDiagnosticsDateFilter: (date: string | null) => void;
  onClearDiagnostics: () => Promise<void>;
  sourceStates: Record<DevtoolsSourceKey, DevtoolsSourceState>;
  workers: WorkerEntry[];
  onExportLogs: () => void;
  onRefreshAllSources: () => void;
  onRefreshSource: (key: DevtoolsSourceKey) => void;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) {
      return false;
    }

    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    return false;
  }
}

/** 读取构建期注入的版本信息；未注入时（harness / 开发环境）降级为 dev / unknown。 */
function readBuildInfo() {
  let appVersion = 'dev';
  let buildVersion = 'dev';
  let buildTime = 'unknown';
  let gitHash = 'unknown';
  let gitBranch = 'unknown';

  try {
    appVersion = __APP_VERSION__;
  } catch (_e) {
    // 降级为 dev
  }
  try {
    buildVersion = __APP_BUILD_VERSION__;
  } catch (_e) {
    // 降级
  }
  try {
    buildTime = __APP_BUILD_TIME__;
  } catch (_e) {
    // 降级
  }
  try {
    gitHash = __APP_GIT_HASH__;
  } catch (_e) {
    // 降级
  }
  try {
    gitBranch = __APP_GIT_BRANCH__;
  } catch (_e) {
    // 降级
  }

  return { appVersion, buildVersion, buildTime, gitHash, gitBranch };
}

export function DevtoolsTabContent({
  gatewayUrl,
  devLogs,
  diagnostics,
  diagnosticsAvailableDates,
  diagnosticsDateFilter,
  onSetDiagnosticsDateFilter,
  onClearDiagnostics,
  sourceStates,
  workers,
  onExportLogs,
  onRefreshAllSources,
  onRefreshSource,
}: DevtoolsTabContentProps) {
  const [activeSection, setActiveSection] = React.useState<DevtoolsSectionId>('overview');
  const [diagnosticQuery, setDiagnosticQuery] = React.useState('');
  const [selectedDiagnosticKey, setSelectedDiagnosticKey] = React.useState<string | null>(null);
  const [copiedDiagnosticAction, setCopiedDiagnosticAction] = React.useState<string | null>(null);
  const copiedDiagnosticTimeoutRef = React.useRef<number | null>(null);
  const [logQuery, setLogQuery] = React.useState('');
  const [showOnlyErrorLogs, setShowOnlyErrorLogs] = React.useState(false);
  const [selectedLogKey, setSelectedLogKey] = React.useState<string | null>(null);
  const [copiedLogAction, setCopiedLogAction] = React.useState<string | null>(null);
  const copiedLogTimeoutRef = React.useRef<number | null>(null);
  const [workerQuery, setWorkerQuery] = React.useState('');
  const [selectedWorkerKey, setSelectedWorkerKey] = React.useState<string | null>(null);
  const [copiedWorkerAction, setCopiedWorkerAction] = React.useState<string | null>(null);
  const copiedWorkerTimeoutRef = React.useRef<number | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(false);
  const [lastGlobalRefreshAt, setLastGlobalRefreshAt] = React.useState<number | null>(null);
  const sourceList = Object.values(sourceStates);
  const anyRefreshableSourceLoading = [
    sourceStates.devLogs.status,
    sourceStates.diagnostics.status,
    sourceStates.desktopAutomation.status,
    sourceStates.sshConnections.status,
    sourceStates.workers.status,
  ].some((status) => status === 'loading');
  const errorSources = sourceList.filter((source) => source.status === 'error' && source.error);
  const logErrors = devLogs.filter((log) => log.level === 'error').length;
  const workerErrors = workers.filter((worker) => worker.status === 'error').length;
  const filteredDiagnostics = React.useMemo(
    () => diagnostics.filter((diagnostic) => matchesDiagnosticQuery(diagnostic, diagnosticQuery)),
    [diagnostics, diagnosticQuery],
  );
  const filteredLogs = React.useMemo(
    () =>
      devLogs.filter(
        (log) => matchesLogQuery(log, logQuery) && (!showOnlyErrorLogs || log.level === 'error'),
      ),
    [devLogs, logQuery, showOnlyErrorLogs],
  );
  const filteredWorkers = React.useMemo(
    () => workers.filter((worker) => matchesWorkerQuery(worker, workerQuery)),
    [workerQuery, workers],
  );
  const selectedDiagnostic = React.useMemo(() => {
    const entries = filteredDiagnostics.map((diagnostic) => ({
      key: buildDiagnosticKey(diagnostic),
      diagnostic,
    }));
    const firstEntry = entries[0];

    if (!firstEntry) {
      return null;
    }

    return (
      entries.find((entry) => entry.key === selectedDiagnosticKey)?.diagnostic ??
      firstEntry.diagnostic
    );
  }, [filteredDiagnostics, selectedDiagnosticKey]);
  const relatedLogs = React.useMemo(
    () => findRelatedLogs(selectedDiagnostic, devLogs),
    [selectedDiagnostic, devLogs],
  );
  const selectedLog = React.useMemo(() => {
    const entries = filteredLogs.map((log) => ({
      key: buildLogKey(log),
      log,
    }));
    const firstEntry = entries[0];

    if (!firstEntry) {
      return null;
    }

    return entries.find((entry) => entry.key === selectedLogKey)?.log ?? firstEntry.log;
  }, [filteredLogs, selectedLogKey]);
  const selectedWorker = React.useMemo(() => {
    const entries = filteredWorkers.map((worker) => ({
      key: buildWorkerKey(worker),
      worker,
    }));
    const firstEntry = entries[0];

    if (!firstEntry) {
      return null;
    }

    return entries.find((entry) => entry.key === selectedWorkerKey)?.worker ?? firstEntry.worker;
  }, [filteredWorkers, selectedWorkerKey]);

  React.useEffect(() => {
    const firstDiagnostic = filteredDiagnostics[0];
    if (!firstDiagnostic) {
      if (selectedDiagnosticKey !== null) {
        setSelectedDiagnosticKey(null);
      }
      return;
    }

    const hasSelectedDiagnostic = filteredDiagnostics.some(
      (diagnostic) => buildDiagnosticKey(diagnostic) === selectedDiagnosticKey,
    );

    if (!selectedDiagnosticKey || !hasSelectedDiagnostic) {
      setSelectedDiagnosticKey(buildDiagnosticKey(firstDiagnostic));
    }
  }, [filteredDiagnostics, selectedDiagnosticKey]);

  React.useEffect(() => {
    const firstLog = filteredLogs[0];
    if (!firstLog) {
      if (selectedLogKey !== null) {
        setSelectedLogKey(null);
      }
      return;
    }

    const hasSelectedLog = filteredLogs.some((log) => buildLogKey(log) === selectedLogKey);
    if (!selectedLogKey || !hasSelectedLog) {
      setSelectedLogKey(buildLogKey(firstLog));
    }
  }, [filteredLogs, selectedLogKey]);

  React.useEffect(() => {
    const firstWorker = filteredWorkers[0];
    if (!firstWorker) {
      if (selectedWorkerKey !== null) {
        setSelectedWorkerKey(null);
      }
      return;
    }

    const hasSelectedWorker = filteredWorkers.some(
      (worker) => buildWorkerKey(worker) === selectedWorkerKey,
    );
    if (!selectedWorkerKey || !hasSelectedWorker) {
      setSelectedWorkerKey(buildWorkerKey(firstWorker));
    }
  }, [filteredWorkers, selectedWorkerKey]);

  React.useEffect(() => {
    const firstVisibleRelatedLog = relatedLogs.find((relatedLog) =>
      filteredLogs.some((visibleLog) => buildLogKey(visibleLog) === buildLogKey(relatedLog)),
    );

    if (!firstVisibleRelatedLog) {
      return;
    }

    const nextKey = buildLogKey(firstVisibleRelatedLog);
    if (selectedLogKey !== nextKey) {
      setSelectedLogKey(nextKey);
    }
  }, [filteredLogs, relatedLogs, selectedLogKey]);

  const updateCopiedDiagnosticAction = React.useCallback((label: string) => {
    if (copiedDiagnosticTimeoutRef.current !== null) {
      window.clearTimeout(copiedDiagnosticTimeoutRef.current);
    }

    setCopiedDiagnosticAction(label);
    copiedDiagnosticTimeoutRef.current = window.setTimeout(() => {
      setCopiedDiagnosticAction((current) => (current === label ? null : current));
    }, 1800);
  }, []);

  React.useEffect(
    () => () => {
      if (copiedDiagnosticTimeoutRef.current !== null) {
        window.clearTimeout(copiedDiagnosticTimeoutRef.current);
      }
    },
    [],
  );

  const updateCopiedLogAction = React.useCallback((label: string) => {
    if (copiedLogTimeoutRef.current !== null) {
      window.clearTimeout(copiedLogTimeoutRef.current);
    }

    setCopiedLogAction(label);
    copiedLogTimeoutRef.current = window.setTimeout(() => {
      setCopiedLogAction((current) => (current === label ? null : current));
    }, 1800);
  }, []);

  React.useEffect(
    () => () => {
      if (copiedLogTimeoutRef.current !== null) {
        window.clearTimeout(copiedLogTimeoutRef.current);
      }
    },
    [],
  );

  const updateCopiedWorkerAction = React.useCallback((label: string) => {
    if (copiedWorkerTimeoutRef.current !== null) {
      window.clearTimeout(copiedWorkerTimeoutRef.current);
    }

    setCopiedWorkerAction(label);
    copiedWorkerTimeoutRef.current = window.setTimeout(() => {
      setCopiedWorkerAction((current) => (current === label ? null : current));
    }, 1800);
  }, []);

  React.useEffect(
    () => () => {
      if (copiedWorkerTimeoutRef.current !== null) {
        window.clearTimeout(copiedWorkerTimeoutRef.current);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!anyRefreshableSourceLoading) {
        setLastGlobalRefreshAt(Date.now());
        onRefreshAllSources();
      }
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [anyRefreshableSourceLoading, autoRefreshEnabled, onRefreshAllSources]);

  const copySelectedDiagnostic = React.useCallback(async () => {
    if (!selectedDiagnostic) {
      return;
    }

    const ok = await copyToClipboard(buildDiagnosticClipboardPayload(selectedDiagnostic));
    if (ok) {
      updateCopiedDiagnosticAction('当前错误已复制');
    } else {
      updateCopiedDiagnosticAction('复制失败：浏览器拒绝了剪贴板写入');
    }
  }, [selectedDiagnostic, updateCopiedDiagnosticAction]);

  const copyVisibleDiagnostics = React.useCallback(async () => {
    if (filteredDiagnostics.length === 0) {
      return;
    }

    const ok = await copyToClipboard(
      JSON.stringify(
        filteredDiagnostics.map((diagnostic) => buildDiagnosticClipboardRecord(diagnostic)),
        null,
        2,
      ),
    );
    if (ok) {
      updateCopiedDiagnosticAction('可见错误已复制');
    } else {
      updateCopiedDiagnosticAction('复制失败：浏览器拒绝了剪贴板写入');
    }
  }, [filteredDiagnostics, updateCopiedDiagnosticAction]);

  const copyAllDiagnostics = React.useCallback(async () => {
    if (diagnostics.length === 0) {
      return;
    }

    const ok = await copyToClipboard(
      JSON.stringify(
        diagnostics.map((diagnostic) => buildDiagnosticClipboardRecord(diagnostic)),
        null,
        2,
      ),
    );
    if (ok) {
      updateCopiedDiagnosticAction('全部错误已复制');
    } else {
      updateCopiedDiagnosticAction('复制失败：浏览器拒绝了剪贴板写入');
    }
  }, [diagnostics, updateCopiedDiagnosticAction]);

  const copyDiagnosticField = React.useCallback(
    async (label: string, value: unknown) => {
      const ok = await copyToClipboard(stringifyDetails(value));
      if (ok) {
        updateCopiedDiagnosticAction(`${label}已复制`);
      } else {
        updateCopiedDiagnosticAction('复制失败：浏览器拒绝了剪贴板写入');
      }
    },
    [updateCopiedDiagnosticAction],
  );

  const copyRelatedContext = React.useCallback(async () => {
    if (!selectedDiagnostic) {
      return;
    }

    const payload = {
      diagnostic: buildDiagnosticClipboardRecord(selectedDiagnostic),
      relatedLogs: relatedLogs.map((log) => buildLogClipboardRecord(log)),
    };
    const ok = await copyToClipboard(JSON.stringify(payload, null, 2));
    if (ok) {
      updateCopiedDiagnosticAction('关联上下文已复制');
    } else {
      updateCopiedDiagnosticAction('复制失败：浏览器拒绝了剪贴板写入');
    }
  }, [relatedLogs, selectedDiagnostic, updateCopiedDiagnosticAction]);

  const copySelectedLog = React.useCallback(async () => {
    if (!selectedLog) {
      return;
    }

    const ok = await copyToClipboard(buildLogClipboardPayload(selectedLog));
    if (ok) {
      updateCopiedLogAction('当前日志已复制');
    } else {
      updateCopiedLogAction('复制失败：浏览器拒绝了剪贴板写入');
    }
  }, [selectedLog, updateCopiedLogAction]);

  const copyVisibleLogs = React.useCallback(async () => {
    if (filteredLogs.length === 0) {
      return;
    }

    const ok = await copyToClipboard(
      JSON.stringify(
        filteredLogs.map((log) => buildLogClipboardRecord(log)),
        null,
        2,
      ),
    );
    if (ok) {
      updateCopiedLogAction('可见日志已复制');
    } else {
      updateCopiedLogAction('复制失败：浏览器拒绝了剪贴板写入');
    }
  }, [filteredLogs, updateCopiedLogAction]);

  const copyErrorLogs = React.useCallback(async () => {
    const errorLogs = devLogs.filter((log) => log.level === 'error');
    if (errorLogs.length === 0) {
      return;
    }

    const ok = await copyToClipboard(
      JSON.stringify(
        errorLogs.map((log) => buildLogClipboardRecord(log)),
        null,
        2,
      ),
    );
    if (ok) {
      updateCopiedLogAction(`全部错误日志已复制（${errorLogs.length} 条）`);
    } else {
      updateCopiedLogAction('复制失败：浏览器拒绝了剪贴板写入');
    }
  }, [devLogs, updateCopiedLogAction]);

  const copyLogField = React.useCallback(
    async (label: string, value: unknown) => {
      const ok = await copyToClipboard(stringifyDetails(value));
      if (ok) {
        updateCopiedLogAction(`${label}已复制`);
      } else {
        updateCopiedLogAction('复制失败：浏览器拒绝了剪贴板写入');
      }
    },
    [updateCopiedLogAction],
  );

  const copySelectedWorker = React.useCallback(async () => {
    if (!selectedWorker) {
      return;
    }

    const ok = await copyToClipboard(
      JSON.stringify(buildWorkerClipboardRecord(selectedWorker), null, 2),
    );
    if (ok) {
      updateCopiedWorkerAction('当前 Worker 已复制');
    } else {
      updateCopiedWorkerAction('复制失败：浏览器拒绝了剪贴板写入');
    }
  }, [selectedWorker, updateCopiedWorkerAction]);

  const copyVisibleWorkers = React.useCallback(async () => {
    if (filteredWorkers.length === 0) {
      return;
    }

    const ok = await copyToClipboard(
      JSON.stringify(
        filteredWorkers.map((worker) => buildWorkerClipboardRecord(worker)),
        null,
        2,
      ),
    );
    if (ok) {
      updateCopiedWorkerAction('可见 Worker 已复制');
    } else {
      updateCopiedWorkerAction('复制失败：浏览器拒绝了剪贴板写入');
    }
  }, [filteredWorkers, updateCopiedWorkerAction]);

  /**
   * 一次性复制完整排障上下文（Markdown）：环境信息 + 数据源状态 + 全部诊断 +
   * 全部错误日志 + Worker 异常，便于直接粘贴给 AI 或同事排查。
   */
  const copyTroubleshootBundle = React.useCallback(async (): Promise<boolean> => {
    const markdown = buildTroubleshootBundleMarkdown({
      generatedAt: new Date().toISOString(),
      ...readBuildInfo(),
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : 'unknown',
      gatewayUrl,
      sourceStates,
      diagnostics,
      errorLogs: devLogs.filter((log) => log.level === 'error'),
      workers,
    });

    return copyToClipboard(markdown);
  }, [devLogs, diagnostics, gatewayUrl, sourceStates, workers]);

  /** 诊断区「查看日志」：切到日志分区，并尽量选中与当前诊断关联的那条日志。 */
  const goToRelatedLogs = React.useCallback(() => {
    const firstRelatedLog = relatedLogs[0];

    if (firstRelatedLog) {
      setSelectedLogKey(buildLogKey(firstRelatedLog));
      // 诊断跳转过来时清空日志搜索（原查询词属于诊断上下文），
      // 并在关联日志是错误级别时切到「仅错误」视图，集中查看错误日志。
      setLogQuery('');
      setShowOnlyErrorLogs(firstRelatedLog.level === 'error');
    }

    setActiveSection('logs');
  }, [relatedLogs]);

  const exportDebugBundleAsMarkdown = React.useCallback(() => {
    const lines = [
      '# Devtools Debug Bundle',
      '',
      `- generatedAt: ${new Date().toISOString()}`,
      `- diagnosticQuery: ${diagnosticQuery || '(empty)'}`,
      `- logQuery: ${logQuery || '(empty)'}`,
      `- workerQuery: ${workerQuery || '(empty)'}`,
      `- showOnlyErrorLogs: ${showOnlyErrorLogs}`,
      '',
      '## Source States',
      '```json',
      JSON.stringify(sourceStates, null, 2),
      '```',
      '',
      '## Selected Diagnostic',
      '```json',
      JSON.stringify(
        selectedDiagnostic ? buildDiagnosticClipboardRecord(selectedDiagnostic) : null,
        null,
        2,
      ),
      '```',
      '',
      '## Selected Log',
      '```json',
      JSON.stringify(selectedLog ? buildLogClipboardRecord(selectedLog) : null, null, 2),
      '```',
      '',
      '## Selected Worker',
      '```json',
      JSON.stringify(selectedWorker ? buildWorkerClipboardRecord(selectedWorker) : null, null, 2),
      '```',
      '',
      '## Visible Diagnostics',
      '```json',
      JSON.stringify(
        filteredDiagnostics.map((diagnostic) => buildDiagnosticClipboardRecord(diagnostic)),
        null,
        2,
      ),
      '```',
      '',
      '## Visible Logs',
      '```json',
      JSON.stringify(
        filteredLogs.map((log) => buildLogClipboardRecord(log)),
        null,
        2,
      ),
      '```',
      '',
      '## Visible Workers',
      '```json',
      JSON.stringify(
        filteredWorkers.map((worker) => buildWorkerClipboardRecord(worker)),
        null,
        2,
      ),
      '```',
      '',
      '## Related Logs',
      '```json',
      JSON.stringify(
        relatedLogs.map((log) => buildLogClipboardRecord(log)),
        null,
        2,
      ),
      '```',
    ].join('\n');

    triggerDownload(lines, 'text/markdown', `devtools-debug-bundle-${Date.now()}.md`);
  }, [
    diagnosticQuery,
    logQuery,
    filteredDiagnostics,
    filteredLogs,
    filteredWorkers,
    relatedLogs,
    selectedDiagnostic,
    selectedLog,
    selectedWorker,
    showOnlyErrorLogs,
    sourceStates,
    workerQuery,
  ]);

  const exportDebugBundle = React.useCallback(() => {
    const bundle = {
      generatedAt: new Date().toISOString(),
      filters: {
        diagnosticQuery,
        logQuery,
        workerQuery,
        showOnlyErrorLogs,
      },
      sourceStates,
      selectedDiagnostic: selectedDiagnostic
        ? buildDiagnosticClipboardRecord(selectedDiagnostic)
        : null,
      selectedLog: selectedLog ? buildLogClipboardRecord(selectedLog) : null,
      selectedWorker: selectedWorker ? buildWorkerClipboardRecord(selectedWorker) : null,
      visibleDiagnostics: filteredDiagnostics.map((diagnostic) =>
        buildDiagnosticClipboardRecord(diagnostic),
      ),
      visibleLogs: filteredLogs.map((log) => buildLogClipboardRecord(log)),
      visibleWorkers: filteredWorkers.map((worker) => buildWorkerClipboardRecord(worker)),
      relatedLogs: relatedLogs.map((log) => buildLogClipboardRecord(log)),
    };

    triggerDownload(
      JSON.stringify(bundle, null, 2),
      'application/json',
      `devtools-debug-bundle-${Date.now()}.json`,
    );
  }, [
    diagnosticQuery,
    filteredDiagnostics,
    filteredLogs,
    logQuery,
    relatedLogs,
    selectedDiagnostic,
    selectedLog,
    selectedWorker,
    showOnlyErrorLogs,
    sourceStates,
    workerQuery,
    filteredWorkers,
  ]);

  const exportErrorReport = React.useCallback(() => {
    if (
      filteredDiagnostics.length === 0 &&
      selectedDiagnostic === null &&
      relatedLogs.length === 0 &&
      devLogs.filter((log) => log.level === 'error').length === 0
    ) {
      return;
    }

    const { appVersion, buildVersion, buildTime, gitHash, gitBranch } = readBuildInfo();

    const html = buildErrorReportHtml({
      diagnostics,
      filteredDiagnostics,
      selectedDiagnostic,
      relatedLogs,
      allLogs: devLogs,
      workers,
      sourceStates,
      appVersion,
      buildVersion,
      buildTime,
      gitHash,
      gitBranch,
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : 'unknown',
      gatewayUrl,
    });

    triggerDownload(html, 'text/html', `openawork-error-report-${Date.now()}.html`);
  }, [
    devLogs,
    diagnostics,
    filteredDiagnostics,
    gatewayUrl,
    relatedLogs,
    selectedDiagnostic,
    sourceStates,
    workers,
  ]);

  const navItems: DevtoolsSectionNavItem[] = [
    {
      id: 'overview',
      label: '总览',
      count: errorSources.length,
      hasError: errorSources.length > 0,
    },
    {
      id: 'diagnostics',
      label: '诊断',
      count: diagnostics.length,
      hasError: diagnostics.length > 0,
    },
    {
      id: 'logs',
      label: '日志',
      count: devLogs.length,
      hasError: logErrors > 0,
    },
    {
      id: 'workers',
      label: 'Worker',
      count: workers.length,
      hasError: workerErrors > 0,
    },
  ];

  return (
    <>
      <DevtoolsSectionNav
        activeSection={activeSection}
        items={navItems}
        anyRefreshableSourceLoading={anyRefreshableSourceLoading}
        autoRefreshEnabled={autoRefreshEnabled}
        lastGlobalRefreshAt={lastGlobalRefreshAt}
        issueCount={diagnostics.length + logErrors + workerErrors}
        onSelectSection={setActiveSection}
        onRefreshAllSources={() => {
          setLastGlobalRefreshAt(Date.now());
          onRefreshAllSources();
        }}
        onToggleAutoRefresh={setAutoRefreshEnabled}
        onCopyTroubleshootBundle={copyTroubleshootBundle}
        onExportErrorReport={() => {
          void exportErrorReport();
        }}
        onExportDebugBundle={exportDebugBundle}
        onExportMarkdownBundle={exportDebugBundleAsMarkdown}
      />

      {activeSection === 'overview' && (
        <DevtoolsOverviewSection
          sourceStates={sourceStates}
          logErrors={logErrors}
          workerErrors={workerErrors}
          onRefreshSource={onRefreshSource}
        />
      )}

      {activeSection === 'diagnostics' && (
        <DevtoolsDiagnosticsSection
          sourceState={sourceStates.diagnostics}
          diagnostics={diagnostics}
          filteredDiagnostics={filteredDiagnostics}
          selectedDiagnostic={selectedDiagnostic}
          selectedDiagnosticKey={selectedDiagnosticKey}
          relatedLogs={relatedLogs}
          copiedDiagnosticAction={copiedDiagnosticAction}
          diagnosticQuery={diagnosticQuery}
          logErrors={logErrors}
          workerErrors={workerErrors}
          onSetDiagnosticQuery={setDiagnosticQuery}
          onSelectDiagnostic={setSelectedDiagnosticKey}
          onCopySelected={() => {
            void copySelectedDiagnostic();
          }}
          onCopyVisible={() => {
            void copyVisibleDiagnostics();
          }}
          onCopyAll={() => {
            void copyAllDiagnostics();
          }}
          onCopyRelatedContext={() => {
            void copyRelatedContext();
          }}
          onExportJson={() => {
            if (
              filteredDiagnostics.length === 0 &&
              selectedDiagnostic === null &&
              relatedLogs.length === 0
            ) {
              return;
            }

            triggerDownload(
              buildErrorExportPayload(filteredDiagnostics, selectedDiagnostic, relatedLogs),
              'application/json',
              `error-export-${Date.now()}.json`,
            );
          }}
          onExportMarkdown={() => {
            if (
              filteredDiagnostics.length === 0 &&
              selectedDiagnostic === null &&
              relatedLogs.length === 0
            ) {
              return;
            }

            triggerDownload(
              buildErrorExportMarkdown(filteredDiagnostics, selectedDiagnostic, relatedLogs),
              'text/markdown',
              `error-export-${Date.now()}.md`,
            );
          }}
          onExportErrorReport={() => {
            void exportErrorReport();
          }}
          onScrollToLogs={goToRelatedLogs}
          onCopyDiagnosticField={(label, value) => {
            void copyDiagnosticField(label, value);
          }}
          availableDates={diagnosticsAvailableDates}
          dateFilter={diagnosticsDateFilter}
          onSetDateFilter={onSetDiagnosticsDateFilter}
          onClearDiagnostics={onClearDiagnostics}
        />
      )}

      {activeSection === 'logs' && (
        <DevtoolsLogsSection
          devLogs={devLogs}
          filteredLogs={filteredLogs}
          selectedLog={selectedLog}
          selectedLogKey={selectedLogKey}
          logQuery={logQuery}
          showOnlyErrorLogs={showOnlyErrorLogs}
          copiedLogAction={copiedLogAction}
          sourceState={sourceStates.devLogs}
          setSelectedLogKey={setSelectedLogKey}
          setLogQuery={setLogQuery}
          setShowOnlyErrorLogs={setShowOnlyErrorLogs}
          copySelectedLog={() => {
            void copySelectedLog();
          }}
          copyVisibleLogs={() => {
            void copyVisibleLogs();
          }}
          copyErrorLogs={() => {
            void copyErrorLogs();
          }}
          copyLogField={(label, value) => {
            void copyLogField(label, value);
          }}
          onExportLogs={onExportLogs}
        />
      )}

      {activeSection === 'workers' && (
        <DevtoolsWorkerSection
          copiedWorkerAction={copiedWorkerAction}
          filteredWorkers={filteredWorkers}
          onCopySelectedWorker={() => {
            void copySelectedWorker();
          }}
          onCopyVisibleWorkers={() => {
            void copyVisibleWorkers();
          }}
          onSelectWorker={setSelectedWorkerKey}
          selectedWorker={selectedWorker}
          selectedWorkerKey={selectedWorkerKey}
          setWorkerQuery={setWorkerQuery}
          sourceState={sourceStates.workers}
          workerQuery={workerQuery}
          workers={workers}
        />
      )}
    </>
  );
}
