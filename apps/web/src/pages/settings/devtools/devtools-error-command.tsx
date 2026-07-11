import React from 'react';
import type { WorkerEntry } from '@openAwork/shared-ui';
import type {
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from '../state/settings-types.js';
import { exportFile } from '../../../utils/export-file.js';
import {
  buildDiagnosticClipboardRecord,
  buildDiagnosticKey,
  buildLogClipboardRecord,
} from './devtools-workbench-primitives.js';

export interface ErrorCommandCenterProps {
  allDiagnostics: SettingsDiagnosticRecord[];
  filteredDiagnostics: SettingsDiagnosticRecord[];
  selectedDiagnostic: SettingsDiagnosticRecord | null;
  relatedLogs: SettingsDevLogRecord[];
  copiedFeedback: string | null;
  errorLogCount: number;
  workerErrorCount: number;
  onCopySelected: () => void;
  onCopyVisible: () => void;
  onCopyRelatedContext: () => void;
  onExportJson: () => void;
  onExportMarkdown: () => void;
  onExportErrorReport: () => void;
  onSelectDiagnostic: (key: string) => void;
  onScrollToLogs: () => void;
}

const BTN_BASE: React.CSSProperties = {
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  padding: '6px 10px',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontSize: 11,
  cursor: 'pointer',
};

const BTN_DISABLED: React.CSSProperties = {
  ...BTN_BASE,
  cursor: 'not-allowed',
  opacity: 0.45,
};

function btn(enabled: boolean, extra?: React.CSSProperties): React.CSSProperties {
  return enabled ? { ...BTN_BASE, ...extra } : { ...BTN_DISABLED, ...extra };
}

export function ErrorCommandCenter({
  allDiagnostics,
  filteredDiagnostics,
  selectedDiagnostic,
  relatedLogs,
  copiedFeedback,
  errorLogCount,
  workerErrorCount,
  onCopySelected,
  onCopyVisible,
  onCopyRelatedContext,
  onExportJson,
  onExportMarkdown,
  onExportErrorReport,
  onSelectDiagnostic,
  onScrollToLogs,
}: ErrorCommandCenterProps) {
  const hasErrors = filteredDiagnostics.length > 0;
  const hasSelected = selectedDiagnostic !== null;
  const hasRelated = relatedLogs.length > 0;
  const hasExportableContext = hasErrors || hasSelected || hasRelated;

  return (
    <div
      style={{
        borderRadius: 10,
        border: '2px solid color-mix(in srgb, var(--danger) 40%, var(--border-default))',
        background: 'color-mix(in srgb, var(--danger) 5%, var(--bg-overlay))',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      data-testid="error-command-center"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)' }}>错误指挥台</div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 11,
              color: 'var(--fg-muted)',
              marginTop: 4,
            }}
          >
            <span>全部错误：{allDiagnostics.length}</span>
            <span>当前可见：{filteredDiagnostics.length}</span>
            <span
              style={{
                color: errorLogCount > 0 ? 'var(--danger)' : 'var(--fg-muted)',
                fontWeight: errorLogCount > 0 ? 700 : 400,
              }}
            >
              错误日志：{errorLogCount}
            </span>
            <span
              style={{
                color: workerErrorCount > 0 ? 'var(--danger)' : 'var(--fg-muted)',
                fontWeight: workerErrorCount > 0 ? 700 : 400,
              }}
            >
              Worker 异常：{workerErrorCount}
            </span>
            {selectedDiagnostic?.requestId ? (
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
                当前请求：{selectedDiagnostic.requestId}
              </span>
            ) : null}
            <span
              style={{ color: 'var(--accent)', fontWeight: 700 }}
              aria-live="polite"
              aria-atomic="true"
            >
              {copiedFeedback ?? ''}
            </span>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            borderRadius: 999,
            background: hasErrors
              ? 'color-mix(in srgb, var(--danger) 14%, transparent)'
              : 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
            fontSize: 11,
            fontWeight: 700,
            color: hasErrors ? 'var(--danger)' : 'var(--fg-muted)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: hasErrors ? 'var(--danger)' : 'var(--fg-muted)',
              display: 'inline-block',
            }}
          />
          {hasErrors ? `${filteredDiagnostics.length} 条错误` : '无错误'}
        </div>
      </div>

      {hasErrors ? (
        <div
          style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, flexShrink: 0 }}
        >
          {filteredDiagnostics.map((diagnostic) => {
            const key = buildDiagnosticKey(diagnostic);
            const isActive =
              selectedDiagnostic !== null && buildDiagnosticKey(selectedDiagnostic) === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDiagnostic(key)}
                title={diagnostic.message}
                style={{
                  flexShrink: 0,
                  borderRadius: 8,
                  border: `1px solid ${isActive ? 'color-mix(in srgb, var(--danger) 60%, var(--border-default))' : 'color-mix(in srgb, var(--danger) 25%, var(--border-default))'}`,
                  background: isActive
                    ? 'color-mix(in srgb, var(--danger) 14%, var(--bg-overlay))'
                    : 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
                  color: isActive ? 'var(--danger)' : 'var(--fg-default)',
                  padding: '4px 8px',
                  fontSize: 10,
                  fontWeight: isActive ? 700 : 400,
                  cursor: 'pointer',
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                  textAlign: 'left',
                }}
              >
                {diagnostic.requestId ?? diagnostic.toolName ?? diagnostic.filePath}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={onCopySelected}
          disabled={!hasSelected}
          style={btn(hasSelected)}
        >
          复制当前错误
        </button>
        <button
          type="button"
          onClick={onCopyVisible}
          disabled={!hasErrors}
          style={btn(hasErrors, {
            border: '1px solid color-mix(in srgb, var(--danger) 26%, var(--border-default))',
            background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay))',
          })}
        >
          复制可见错误 {hasErrors ? `(${filteredDiagnostics.length})` : ''}
        </button>
        <button
          type="button"
          onClick={onCopyRelatedContext}
          disabled={!hasSelected}
          style={btn(hasSelected, {
            background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
          })}
        >
          复制关联上下文
        </button>
        <button
          type="button"
          onClick={onScrollToLogs}
          disabled={!hasRelated}
          style={btn(hasRelated)}
          aria-label="跳转到关联日志"
        >
          查看关联日志 {hasRelated ? `(${relatedLogs.length})` : ''}
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onExportErrorReport}
            disabled={!hasExportableContext}
            style={btn(hasExportableContext, {
              border: '2px solid var(--danger)',
              background: 'var(--danger)',
              color: 'var(--fg-on-accent)',
              fontWeight: 700,
              fontSize: 11,
              padding: '7px 14px',
            })}
            aria-label="一键导出错误报告"
            title="导出自包含 HTML 错误报告，包含版本号、环境信息、全部诊断与日志"
          >
            一键导出错误报告
          </button>
          <button
            type="button"
            onClick={onExportJson}
            disabled={!hasExportableContext}
            style={btn(hasExportableContext)}
            aria-label="导出错误 JSON"
          >
            导出错误 JSON
          </button>
          <button
            type="button"
            onClick={onExportMarkdown}
            disabled={!hasExportableContext}
            style={btn(hasExportableContext)}
            aria-label="导出错误 MD"
          >
            导出错误 MD
          </button>
        </div>
      </div>

      {hasSelected ? (
        <div
          style={{
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--danger) 28%, var(--border-default))',
            background: 'color-mix(in srgb, var(--bg-overlay) 94%, var(--bg-base))',
            padding: '7px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-strong)' }}>
            {selectedDiagnostic.message}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 11,
              color: 'var(--fg-muted)',
            }}
          >
            <span>工具：{selectedDiagnostic.toolName ?? selectedDiagnostic.filePath}</span>
            {selectedDiagnostic.requestId ? (
              <span>请求：{selectedDiagnostic.requestId}</span>
            ) : null}
            {selectedDiagnostic.sessionId ? (
              <span>会话：{selectedDiagnostic.sessionId}</span>
            ) : null}
            {typeof selectedDiagnostic.durationMs === 'number' ? (
              <span>耗时：{selectedDiagnostic.durationMs}ms</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function buildErrorExportPayload(
  filteredDiagnostics: SettingsDiagnosticRecord[],
  selectedDiagnostic: SettingsDiagnosticRecord | null,
  relatedLogs: SettingsDevLogRecord[],
): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    selectedError: selectedDiagnostic ? buildDiagnosticClipboardRecord(selectedDiagnostic) : null,
    visibleErrors: filteredDiagnostics.map((d) => buildDiagnosticClipboardRecord(d)),
    relatedLogs: relatedLogs.map((l) => buildLogClipboardRecord(l)),
  };
  return JSON.stringify(payload, null, 2);
}

export function buildErrorExportMarkdown(
  filteredDiagnostics: SettingsDiagnosticRecord[],
  selectedDiagnostic: SettingsDiagnosticRecord | null,
  relatedLogs: SettingsDevLogRecord[],
): string {
  const lines: string[] = [
    '# Error Export',
    '',
    `- exportedAt: ${new Date().toISOString()}`,
    `- visibleErrors: ${filteredDiagnostics.length}`,
    `- relatedLogs: ${relatedLogs.length}`,
    '',
    '## Selected Error',
    '```json',
    JSON.stringify(
      selectedDiagnostic ? buildDiagnosticClipboardRecord(selectedDiagnostic) : null,
      null,
      2,
    ),
    '```',
    '',
    '## Visible Errors',
    '```json',
    JSON.stringify(
      filteredDiagnostics.map((d) => buildDiagnosticClipboardRecord(d)),
      null,
      2,
    ),
    '```',
    '',
    '## Related Logs',
    '```json',
    JSON.stringify(
      relatedLogs.map((l) => buildLogClipboardRecord(l)),
      null,
      2,
    ),
    '```',
  ];
  return lines.join('\n');
}

export async function triggerDownload(
  content: string,
  mimeType: string,
  filename: string,
): Promise<void> {
  await exportFile({ content, filename, mimeType });
}

export interface ErrorReportContext {
  diagnostics: SettingsDiagnosticRecord[];
  filteredDiagnostics: SettingsDiagnosticRecord[];
  selectedDiagnostic: SettingsDiagnosticRecord | null;
  relatedLogs: SettingsDevLogRecord[];
  allLogs: SettingsDevLogRecord[];
  workers: WorkerEntry[];
  sourceStates: Record<string, DevtoolsSourceState>;
  appVersion: string;
  buildVersion: string;
  buildTime: string;
  gitHash: string;
  gitBranch: string;
  platform: string;
  userAgent: string;
  gatewayUrl: string;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildErrorReportHtml(ctx: ErrorReportContext): string {
  const {
    diagnostics,
    filteredDiagnostics,
    selectedDiagnostic,
    relatedLogs,
    allLogs,
    workers,
    sourceStates,
    appVersion,
    buildVersion,
    buildTime,
    gitHash,
    gitBranch,
    platform,
    userAgent,
    gatewayUrl,
  } = ctx;

  const now = new Date().toISOString();
  const errorLogs = allLogs.filter((log) => log.level === 'error');
  const errorWorkers = workers.filter((worker) => worker.status === 'error');

  const errorListHtml = filteredDiagnostics
    .map((diagnostic, index) => {
      const record = buildDiagnosticClipboardRecord(diagnostic);
      const isActive =
        selectedDiagnostic !== null &&
        buildDiagnosticKey(selectedDiagnostic) === buildDiagnosticKey(diagnostic);
      return `
      <details class="error-item${isActive ? ' active' : ''}"${index === 0 ? ' open' : ''}>
        <summary>
          <span class="error-severity">${escapeHtml(diagnostic.severity)}</span>
          <span class="error-message">${escapeHtml(diagnostic.message)}</span>
          <span class="error-meta">${escapeHtml(diagnostic.toolName ?? diagnostic.filePath)}${diagnostic.requestId ? ' · ' + escapeHtml(diagnostic.requestId) : ''}${typeof diagnostic.durationMs === 'number' ? ' · ' + diagnostic.durationMs + 'ms' : ''}</span>
        </summary>
        <div class="error-detail">
          <div class="detail-row"><span class="detail-label">文件路径</span><code>${escapeHtml(diagnostic.filePath)}</code></div>
          ${diagnostic.toolName ? `<div class="detail-row"><span class="detail-label">工具名</span><code>${escapeHtml(diagnostic.toolName)}</code></div>` : ''}
          ${diagnostic.requestId ? `<div class="detail-row"><span class="detail-label">请求 ID</span><code>${escapeHtml(diagnostic.requestId)}</code></div>` : ''}
          ${diagnostic.sessionId ? `<div class="detail-row"><span class="detail-label">会话 ID</span><code>${escapeHtml(diagnostic.sessionId)}</code></div>` : ''}
          ${diagnostic.createdAt ? `<div class="detail-row"><span class="detail-label">创建时间</span><code>${escapeHtml(diagnostic.createdAt)}</code></div>` : ''}
          ${typeof diagnostic.durationMs === 'number' ? `<div class="detail-row"><span class="detail-label">耗时</span><code>${diagnostic.durationMs}ms</code></div>` : ''}
          ${diagnostic.appVersion ? `<div class="detail-row"><span class="detail-label">采集时版本</span><code>v${escapeHtml(diagnostic.appVersion)}</code></div>` : ''}
          <div class="payload-section">
            <div class="detail-label">输入 Payload</div>
            <pre>${escapeHtml(JSON.stringify(record.input ?? null, null, 2))}</pre>
          </div>
          <div class="payload-section">
            <div class="detail-label">输出 / 错误 Payload</div>
            <pre>${escapeHtml(JSON.stringify(record.output ?? null, null, 2))}</pre>
          </div>
        </div>
      </details>`;
    })
    .join('\n');

  const relatedLogsHtml = relatedLogs
    .map((log) => {
      const record = buildLogClipboardRecord(log);
      return `
      <details class="log-item${log.level === 'error' ? ' error' : ''}">
        <summary>
          <span class="log-level ${log.level}">${escapeHtml(log.level)}</span>
          <span class="log-message">${escapeHtml(log.message)}</span>
          <span class="log-meta">${escapeHtml(log.source ?? 'settings')}${log.requestId ? ' · ' + escapeHtml(log.requestId) : ''}${typeof log.durationMs === 'number' ? ' · ' + log.durationMs + 'ms' : ''}</span>
        </summary>
        <div class="log-detail">
          <div class="payload-section">
            <div class="detail-label">输入 Payload</div>
            <pre>${escapeHtml(JSON.stringify(record.input ?? null, null, 2))}</pre>
          </div>
          <div class="payload-section">
            <div class="detail-label">输出 Payload</div>
            <pre>${escapeHtml(JSON.stringify(record.output ?? null, null, 2))}</pre>
          </div>
        </div>
      </details>`;
    })
    .join('\n');

  const errorLogsHtml = errorLogs
    .slice(0, 50)
    .map((log) => {
      return `
      <details class="log-item error">
        <summary>
          <span class="log-level error">ERROR</span>
          <span class="log-message">${escapeHtml(log.message)}</span>
          <span class="log-meta">${escapeHtml(log.source ?? 'settings')}${log.requestId ? ' · ' + escapeHtml(log.requestId) : ''}</span>
        </summary>
        <div class="log-detail">
          <div class="payload-section">
            <div class="detail-label">输出 Payload</div>
            <pre>${escapeHtml(JSON.stringify(log.output ?? null, null, 2))}</pre>
          </div>
        </div>
      </details>`;
    })
    .join('\n');

  const workersHtml = workers
    .map((worker) => {
      const isError = worker.status === 'error';
      return `
      <div class="worker-card${isError ? ' error' : ''}">
        <div class="worker-header">
          <span class="worker-name">${escapeHtml(worker.name)}</span>
          <span class="worker-status ${isError ? 'error' : 'ok'}">${escapeHtml(worker.status)}</span>
        </div>
        <div class="worker-meta">
          <span>ID: <code>${escapeHtml(worker.id)}</code></span>
          <span>模式: <code>${escapeHtml(worker.mode ?? 'unknown')}</code></span>
          ${worker.endpoint ? `<span>端点: <code>${escapeHtml(worker.endpoint)}</code></span>` : ''}
        </div>
      </div>`;
    })
    .join('\n');

  const sourceStatesHtml = Object.entries(sourceStates)
    .map(([_key, source]) => {
      const statusClass =
        source.status === 'error'
          ? 'error'
          : source.status === 'healthy'
            ? 'ok'
            : source.status === 'unavailable'
              ? 'warn'
              : 'info';
      return `
      <div class="source-card ${statusClass}">
        <div class="source-header">
          <span class="source-label">${escapeHtml(source.label)}</span>
          <span class="source-status ${statusClass}">${escapeHtml(source.status)}</span>
        </div>
        <div class="source-detail">${escapeHtml(source.detail)}</div>
        <div class="source-endpoint"><code>${escapeHtml(source.endpoint)}</code></div>
        ${source.error ? `<div class="source-error">${escapeHtml(source.error)}</div>` : ''}
        ${source.count !== null ? `<div class="source-count">${source.count} 条</div>` : ''}
      </div>`;
    })
    .join('\n');

  const rawJsonData = escapeHtml(
    JSON.stringify(
      {
        exportedAt: now,
        environment: {
          appVersion,
          buildVersion,
          buildTime,
          gitHash,
          gitBranch,
          platform,
          userAgent,
          gatewayUrl,
        },
        summary: {
          totalDiagnostics: diagnostics.length,
          visibleDiagnostics: filteredDiagnostics.length,
          totalLogs: allLogs.length,
          errorLogs: errorLogs.length,
          totalWorkers: workers.length,
          errorWorkers: errorWorkers.length,
        },
        sourceStates,
        selectedError: selectedDiagnostic
          ? buildDiagnosticClipboardRecord(selectedDiagnostic)
          : null,
        visibleErrors: filteredDiagnostics.map((d) => buildDiagnosticClipboardRecord(d)),
        relatedLogs: relatedLogs.map((l) => buildLogClipboardRecord(l)),
        errorLogs: errorLogs.map((l) => buildLogClipboardRecord(l)),
        workers,
      },
      null,
      2,
    ),
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenAWork 错误报告 — ${now}</title>
<style>
:root {
  --bg: #0f1117;
  --surface: #181b24;
  --surface-2: #1e2230;
  --border: #2a2f3d;
  --text: #e0e4ee;
  --text-muted: #7b8a9e;
  --accent: #5cd4c0;
  --danger: #f06b7e;
  --warning: #f0b429;
  --code-bg: #12141c;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
h1 { font-size: 22px; margin-bottom: 4px; }
h2 { font-size: 16px; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.meta-bar {
  display: flex; gap: 12px; flex-wrap: wrap;
  font-size: 12px; color: var(--text-muted); margin-bottom: 20px;
}
.meta-bar span { font-family: monospace; }
.meta-bar .badge { padding: 2px 8px; border-radius: 999px; font-weight: 600; }
.meta-bar .badge.version { background: rgba(92,212,192,0.14); color: var(--accent); }
.meta-bar .badge.danger { background: rgba(240,107,126,0.14); color: var(--danger); }
.summary-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px; margin-bottom: 24px;
}
.summary-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 4px;
}
.summary-card .value { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
.summary-card .label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.summary-card.error .value { color: var(--danger); }
.summary-card.ok .value { color: var(--accent); }
details {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  margin-bottom: 8px; overflow: hidden;
}
details[open] { border-color: var(--text-muted); }
summary {
  cursor: pointer; padding: 10px 14px; display: flex; align-items: center; gap: 10px;
  font-size: 12px; list-style: none; user-select: none;
}
summary::-webkit-details-marker { display: none; }
summary:hover { background: var(--surface-2); }
.error-item.active { border-left: 3px solid var(--danger); }
.error-item summary .error-severity {
  font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
  background: rgba(240,107,126,0.18); color: var(--danger); text-transform: uppercase; flex-shrink: 0;
}
.error-item summary .error-message {
  flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.error-item summary .error-meta { font-size: 11px; color: var(--text-muted); font-family: monospace; flex-shrink: 0; }
.error-detail, .log-detail { padding: 12px 14px; border-top: 1px solid var(--border); }
.detail-row { display: flex; gap: 8px; padding: 4px 0; font-size: 12px; }
.detail-row .detail-label { color: var(--text-muted); min-width: 80px; flex-shrink: 0; }
.detail-row code { font-size: 11px; color: var(--accent); }
.payload-section { margin-top: 8px; }
.payload-section .detail-label {
  font-size: 10px; font-weight: 700; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px;
}
pre {
  background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px 12px; font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
  overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow-y: auto;
}
.log-item.error { border-left: 3px solid var(--danger); }
.log-item summary .log-level {
  font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
  text-transform: uppercase; flex-shrink: 0;
}
.log-level.error { background: rgba(240,107,126,0.18); color: var(--danger); }
.log-level.info, .log-level.debug { background: rgba(92,212,192,0.14); color: var(--accent); }
.log-level.warn { background: rgba(240,180,41,0.18); color: var(--warning); }
.log-item summary .log-message { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-item summary .log-meta { font-size: 11px; color: var(--text-muted); font-family: monospace; flex-shrink: 0; }
.worker-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 14px; margin-bottom: 8px;
}
.worker-card.error { border-left: 3px solid var(--danger); }
.worker-header { display: flex; justify-content: space-between; align-items: center; }
.worker-name { font-size: 13px; font-weight: 600; }
.worker-status { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; }
.worker-status.error { background: rgba(240,107,126,0.18); color: var(--danger); }
.worker-status.ok { background: rgba(92,212,192,0.14); color: var(--accent); }
.worker-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--text-muted); margin-top: 6px; }
.worker-meta code { font-size: 10px; }
.source-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 14px; margin-bottom: 8px;
}
.source-card.error { border-left: 3px solid var(--danger); }
.source-card.ok { border-left: 3px solid var(--accent); }
.source-card.warn { border-left: 3px solid var(--warning); }
.source-header { display: flex; justify-content: space-between; align-items: center; }
.source-label { font-size: 12px; font-weight: 600; }
.source-status { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; }
.source-status.error { background: rgba(240,107,126,0.18); color: var(--danger); }
.source-status.ok { background: rgba(92,212,192,0.14); color: var(--accent); }
.source-status.warn { background: rgba(240,180,41,0.18); color: var(--warning); }
.source-status.info { background: rgba(123,138,158,0.18); color: var(--text-muted); }
.source-detail { font-size: 11px; color: var(--text); margin-top: 4px; }
.source-endpoint { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
.source-endpoint code { font-family: monospace; }
.source-error { font-size: 10px; color: var(--danger); font-family: monospace; margin-top: 4px; word-break: break-word; }
.source-count { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
.raw-data-section { margin-top: 32px; border-top: 2px dashed var(--border); padding-top: 16px; }
.raw-data-section summary { font-size: 13px; font-weight: 600; color: var(--text-muted); }
.footer {
  margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border);
  font-size: 11px; color: var(--text-muted); text-align: center;
}
</style>
</head>
<body>
<h1>OpenAWork 错误诊断报告</h1>
<div class="meta-bar">
  <span class="badge version">v${escapeHtml(appVersion)}</span>
  <span>构建: ${escapeHtml(buildVersion)}</span>
  <span>Git: ${escapeHtml(gitHash)} @ ${escapeHtml(gitBranch)}</span>
  <span>构建时间: ${escapeHtml(buildTime)}</span>
  <span>平台: ${escapeHtml(platform)}</span>
  <span>导出时间: ${now}</span>
</div>

<div class="summary-grid">
  <div class="summary-card ${filteredDiagnostics.length > 0 ? 'error' : 'ok'}">
    <div class="value">${filteredDiagnostics.length}</div>
    <div class="label">可见错误</div>
  </div>
  <div class="summary-card">
    <div class="value">${diagnostics.length}</div>
    <div class="label">全部诊断</div>
  </div>
  <div class="summary-card ${errorLogs.length > 0 ? 'error' : ''}">
    <div class="value">${errorLogs.length}</div>
    <div class="label">错误日志</div>
  </div>
  <div class="summary-card">
    <div class="value">${allLogs.length}</div>
    <div class="label">全部日志</div>
  </div>
  <div class="summary-card ${errorWorkers.length > 0 ? 'error' : ''}">
    <div class="value">${errorWorkers.length}</div>
    <div class="label">Worker 异常</div>
  </div>
  <div class="summary-card">
    <div class="value">${workers.length}</div>
    <div class="label">全部 Worker</div>
  </div>
</div>

${
  filteredDiagnostics.length > 0
    ? `
<h2>错误详情（${filteredDiagnostics.length} 条）</h2>
${errorListHtml}
`
    : '<h2>错误详情</h2><p style="color:var(--text-muted);font-size:12px;">当前没有可见的诊断错误。</p>'
}

${
  relatedLogs.length > 0
    ? `
<h2>关联日志（${relatedLogs.length} 条）</h2>
${relatedLogsHtml}
`
    : ''
}

${
  errorLogs.length > 0
    ? `
<h2>错误日志（前 50 条，共 ${errorLogs.length} 条）</h2>
${errorLogsHtml}
`
    : ''
}

${
  workers.length > 0
    ? `
<h2>Worker 状态（${workers.length} 个，${errorWorkers.length} 个异常）</h2>
${workersHtml}
`
    : ''
}

<h2>数据源状态</h2>
${sourceStatesHtml || '<p style="color:var(--text-muted);font-size:12px;">无数据源状态信息。</p>'}

<details class="raw-data-section">
  <summary>📋 原始 JSON 数据（点击展开 / 可复制到 Issue）</summary>
  <pre id="raw-json">${rawJsonData}</pre>
</details>

<div class="footer">
  Generated by OpenAWork DevTools · ${now}<br>
  此报告自包含全部错误上下文，可安全离线查看或分享给开发者排查问题。
</div>

<script>
document.getElementById('raw-json')?.addEventListener('click', function() {
  var range = document.createRange();
  range.selectNodeContents(this);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
</script>
</body>
</html>`;
}
