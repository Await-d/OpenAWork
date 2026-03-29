import React from 'react';
import type { SettingsDiagnosticRecord, SettingsDevLogRecord } from '../settings-types.js';
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
  onSelectDiagnostic: (key: string) => void;
  onScrollToLogs: () => void;
}

const BTN_BASE: React.CSSProperties = {
  borderRadius: 8,
  border: '1px solid var(--border)',
  padding: '6px 10px',
  background: 'var(--surface)',
  color: 'var(--text)',
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
        border: '2px solid color-mix(in srgb, var(--danger) 40%, var(--border))',
        background: 'color-mix(in srgb, var(--danger) 5%, var(--surface))',
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
              color: 'var(--text-3)',
              marginTop: 4,
            }}
          >
            <span>全部错误：{allDiagnostics.length}</span>
            <span>当前可见：{filteredDiagnostics.length}</span>
            <span
              style={{
                color: errorLogCount > 0 ? 'var(--danger)' : 'var(--text-3)',
                fontWeight: errorLogCount > 0 ? 700 : 400,
              }}
            >
              错误日志：{errorLogCount}
            </span>
            <span
              style={{
                color: workerErrorCount > 0 ? 'var(--danger)' : 'var(--text-3)',
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
              : 'color-mix(in srgb, var(--text-3) 10%, transparent)',
            fontSize: 11,
            fontWeight: 700,
            color: hasErrors ? 'var(--danger)' : 'var(--text-3)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: hasErrors ? 'var(--danger)' : 'var(--text-3)',
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
                  border: `1px solid ${isActive ? 'color-mix(in srgb, var(--danger) 60%, var(--border))' : 'color-mix(in srgb, var(--danger) 25%, var(--border))'}`,
                  background: isActive
                    ? 'color-mix(in srgb, var(--danger) 14%, var(--surface))'
                    : 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
                  color: isActive ? 'var(--danger)' : 'var(--text-2)',
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
            border: '1px solid color-mix(in srgb, var(--danger) 26%, var(--border))',
            background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
          })}
        >
          复制可见错误 {hasErrors ? `(${filteredDiagnostics.length})` : ''}
        </button>
        <button
          type="button"
          onClick={onCopyRelatedContext}
          disabled={!hasSelected}
          style={btn(hasSelected, {
            background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
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
            border: '1px solid color-mix(in srgb, var(--danger) 28%, var(--border))',
            background: 'color-mix(in srgb, var(--surface) 94%, var(--bg))',
            padding: '7px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
            {selectedDiagnostic.message}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 11,
              color: 'var(--text-3)',
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

export function triggerDownload(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
