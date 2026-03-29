import React from 'react';
import { RootCausePanel, type DevEvent, type WorkerEntry } from '@openAwork/shared-ui';
import type {
  DevtoolsSourceKey,
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from '../settings-types.js';
import {
  buildDiagnosticClipboardPayload,
  buildDiagnosticClipboardRecord,
  buildDiagnosticKey,
  buildLogClipboardPayload,
  buildLogClipboardRecord,
  buildLogKey,
  buildWorkerClipboardRecord,
  buildWorkerKey,
  type DevtoolsSectionId,
  findRelatedLogs,
  InlineFailureNotice,
  matchesDiagnosticQuery,
  matchesLogQuery,
  matchesWorkerQuery,
  SourceOverviewCard,
  stringifyDetails,
} from './devtools-workbench-primitives.js';
import { DevtoolsToolbarSection } from './devtools-toolbar-section.js';
import { DevtoolsWorkerSection } from './devtools-worker-section.js';
import { SS, ST, UV } from './settings-section-styles.js';
import { DevtoolsDiagnosticsSection } from './devtools-diagnostics-section.js';
import {
  buildErrorExportPayload,
  buildErrorExportMarkdown,
  triggerDownload,
} from './devtools-error-command.js';
import { DevtoolsLogsSection } from './devtools-logs-section.js';

interface DevtoolsTabContentProps {
  devLogs: SettingsDevLogRecord[];
  devEvents: DevEvent[];
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

export function DevtoolsTabContent({
  devLogs,
  devEvents,
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
  const overviewSectionRef = React.useRef<HTMLDivElement | null>(null);
  const diagnosticsSectionRef = React.useRef<HTMLDivElement | null>(null);
  const logsSectionRef = React.useRef<HTMLDivElement | null>(null);
  const sshSectionRef = React.useRef<HTMLDivElement | null>(null);
  const workersSectionRef = React.useRef<HTMLDivElement | null>(null);
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
  const sourceList = Object.values(sourceStates);
  const anyRefreshableSourceLoading = [
    sourceStates.devLogs.status,
    sourceStates.diagnostics.status,
    sourceStates.desktopAutomation.status,
    sourceStates.sshConnections.status,
    sourceStates.workers.status,
  ].some((status) => status === 'loading');
  const errorSources = sourceList.filter((source) => source.status === 'error' && source.error);
  const healthyCount = sourceList.filter((source) => source.status === 'healthy').length;
  const loadingCount = sourceList.filter((source) => source.status === 'loading').length;
  const unavailableCount = sourceList.filter((source) => source.status === 'unavailable').length;
  const emptyCount = sourceList.filter((source) => source.status === 'empty').length;
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
        onRefreshAllSources();
      }
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [anyRefreshableSourceLoading, autoRefreshEnabled, onRefreshAllSources]);

  const scrollToSection = React.useCallback((sectionId: DevtoolsSectionId) => {
    const refMap: Record<DevtoolsSectionId, React.RefObject<HTMLDivElement | null>> = {
      overview: overviewSectionRef,
      diagnostics: diagnosticsSectionRef,
      logs: logsSectionRef,
      ssh: sshSectionRef,
      workers: workersSectionRef,
    };
    refMap[sectionId].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

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

  return (
    <>
      <DevtoolsToolbarSection
        anyRefreshableSourceLoading={anyRefreshableSourceLoading}
        autoRefreshEnabled={autoRefreshEnabled}
        counts={{
          diagnostics: filteredDiagnostics.length,
          errorSources: errorSources.length,
          logs: filteredLogs.length,
          sshConnections: 0,
          workers: workers.length,
        }}
        workerErrors={workerErrors}
        onExportDebugBundle={exportDebugBundle}
        onExportMarkdownBundle={exportDebugBundleAsMarkdown}
        onRefreshAllSources={onRefreshAllSources}
        onScrollToSection={scrollToSection}
        onToggleAutoRefresh={() => setAutoRefreshEnabled((prev) => !prev)}
      />

      <section ref={overviewSectionRef} style={SS}>
        <h3 style={ST}>数据源概览</h3>
        <div style={{ fontSize: 11, color: 'var(--text-3)', maxWidth: 760 }}>
          哪个数据源失败，再往下钻日志、诊断和远程连接细节。
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: '正常', value: healthyCount, color: 'var(--accent)' },
            { label: '载入中', value: loadingCount, color: 'var(--text-2)' },
            { label: '空数据', value: emptyCount, color: 'var(--text-2)' },
            { label: '未接入', value: unavailableCount, color: 'var(--warning, #f59e0b)' },
            { label: '失败', value: errorSources.length, color: 'var(--danger)' },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                borderRadius: 999,
                padding: '3px 8px',
                background: 'color-mix(in srgb, var(--surface) 82%, var(--bg))',
                border: '1px solid var(--border)',
                fontSize: 11,
                color: item.color,
                fontWeight: 600,
              }}
            >
              {item.label} {item.value}
            </div>
          ))}
          <div
            style={{
              borderRadius: 999,
              padding: '3px 8px',
              background: 'color-mix(in srgb, var(--surface) 82%, var(--bg))',
              border: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-2)',
              fontWeight: 600,
            }}
          >
            错误日志 {logErrors}
          </div>
          <div
            style={{
              borderRadius: 999,
              padding: '3px 8px',
              background: 'color-mix(in srgb, var(--surface) 82%, var(--bg))',
              border: '1px solid var(--border)',
              fontSize: 11,
              color: workerErrors > 0 ? 'var(--danger)' : 'var(--text-2)',
              fontWeight: 600,
            }}
          >
            Worker 异常 {workerErrors}
          </div>
        </div>
        {errorSources.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {errorSources.map((source) => (
              <RootCausePanel
                key={source.label}
                nodeLabel={source.label}
                attempts={1}
                error={`${source.detail}：${source.error}`}
                style={{ maxWidth: '100%' }}
              />
            ))}
          </div>
        ) : null}
        <div
          style={{
            ...UV,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 8,
          }}
        >
          {(Object.entries(sourceStates) as Array<[DevtoolsSourceKey, DevtoolsSourceState]>).map(
            ([key, source]) => (
              <SourceOverviewCard
                key={source.label}
                source={source}
                onRefresh={
                  key === 'githubTriggers' || key === 'providerUpdates'
                    ? undefined
                    : () => onRefreshSource(key)
                }
              />
            ),
          )}
        </div>
      </section>

      <DevtoolsDiagnosticsSection
        sectionRef={diagnosticsSectionRef}
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
        onScrollToLogs={() => {
          const hasVisibleRelatedLogs = relatedLogs.some((relatedLog) =>
            filteredLogs.some((visibleLog) => buildLogKey(visibleLog) === buildLogKey(relatedLog)),
          );

          if (relatedLogs.length > 0) {
            const firstRelatedLog = relatedLogs[0];
            if (firstRelatedLog) {
              setSelectedLogKey(buildLogKey(firstRelatedLog));
            }
          }
          if (!hasVisibleRelatedLogs) {
            setLogQuery('');
            setShowOnlyErrorLogs(false);
          }
          scrollToSection('logs');
        }}
        onCopyDiagnosticField={(label, value) => {
          void copyDiagnosticField(label, value);
        }}
        availableDates={diagnosticsAvailableDates}
        dateFilter={diagnosticsDateFilter}
        onSetDateFilter={onSetDiagnosticsDateFilter}
        onClearDiagnostics={onClearDiagnostics}
      />

      <DevtoolsLogsSection
        sectionRef={logsSectionRef}
        devLogs={devLogs}
        devEvents={devEvents}
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
        copyLogField={(label, value) => {
          void copyLogField(label, value);
        }}
        onExportLogs={onExportLogs}
      />

      <section ref={workersSectionRef} style={SS}>
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
      </section>
    </>
  );
}
