import React from 'react';
import type {
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from '../state/settings-types.js';
import {
  buildDiagnosticKey,
  DiagnosticDetailsPanel,
  InlineFailureNotice,
} from './devtools-workbench-primitives.js';
import { ErrorCommandCenter } from './devtools-error-command.js';
import {
  SS,
  ST,
  BADGE,
  BS,
  BG,
  TWO_COLUMN,
  LEFT_PANEL,
  RIGHT_PANEL,
  LIST_CONTAINER,
} from '../shared/settings-section-styles.js';

interface DevtoolsDiagnosticsSectionProps {
  sectionRef: React.RefObject<HTMLDivElement | null>;
  sourceState: DevtoolsSourceState;
  diagnostics: SettingsDiagnosticRecord[];
  filteredDiagnostics: SettingsDiagnosticRecord[];
  selectedDiagnostic: SettingsDiagnosticRecord | null;
  selectedDiagnosticKey: string | null;
  relatedLogs: SettingsDevLogRecord[];
  copiedDiagnosticAction: string | null;
  diagnosticQuery: string;
  logErrors: number;
  workerErrors: number;
  availableDates: string[];
  dateFilter: string | null;
  onSetDateFilter: (date: string | null) => void;
  onClearDiagnostics: () => Promise<void>;
  onSetDiagnosticQuery: (value: string) => void;
  onSelectDiagnostic: (key: string) => void;
  onCopySelected: () => void;
  onCopyVisible: () => void;
  onCopyRelatedContext: () => void;
  onExportJson: () => void;
  onExportMarkdown: () => void;
  onExportErrorReport: () => void;
  onScrollToLogs: () => void;
  onCopyDiagnosticField: (label: string, value: unknown) => void;
}

function formatDiagnosticLocation(diagnostic: SettingsDiagnosticRecord): string {
  return diagnostic.requestId ?? diagnostic.toolName ?? diagnostic.filePath;
}

export function DevtoolsDiagnosticsSection({
  sectionRef,
  sourceState,
  diagnostics,
  filteredDiagnostics,
  selectedDiagnostic,
  selectedDiagnosticKey,
  relatedLogs,
  copiedDiagnosticAction,
  diagnosticQuery,
  logErrors,
  workerErrors,
  availableDates,
  dateFilter,
  onSetDateFilter,
  onClearDiagnostics,
  onSetDiagnosticQuery,
  onSelectDiagnostic,
  onCopySelected,
  onCopyVisible,
  onCopyRelatedContext,
  onExportJson,
  onExportMarkdown,
  onExportErrorReport,
  onScrollToLogs,
  onCopyDiagnosticField,
}: DevtoolsDiagnosticsSectionProps) {
  const appVersion = filteredDiagnostics[0]?.appVersion ?? null;
  const [isClearing, setIsClearing] = React.useState(false);

  return (
    <section ref={sectionRef} style={SS}>
      {/* 标题和操作栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
        }}
      >
        <h3 style={ST}>诊断信息</h3>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {availableDates.length > 0 && (
            <select
              value={dateFilter ?? ''}
              onChange={(event) => onSetDateFilter(event.target.value || null)}
              style={{
                borderRadius: 3,
                border: '1px solid var(--border-default)',
                padding: '3px 6px',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-strong)',
                fontSize: 11,
                cursor: 'pointer',
              }}
              aria-label="按日期过滤诊断"
            >
              <option value="">全部日期</option>
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          )}
          {appVersion && (
            <span style={{ ...BADGE, color: 'var(--fg-muted)', fontFamily: 'monospace' }}>
              v{appVersion}
            </span>
          )}
          {diagnostics.length > 0 && (
            <button
              type="button"
              disabled={isClearing}
              onClick={() => {
                setIsClearing(true);
                void onClearDiagnostics().finally(() => setIsClearing(false));
              }}
              style={{ ...BG, color: isClearing ? 'var(--fg-muted)' : 'var(--danger)' }}
            >
              {isClearing ? '清除中…' : '清除'}
            </button>
          )}
        </div>
      </div>

      {/* 错误命令中心 */}
      <ErrorCommandCenter
        allDiagnostics={diagnostics}
        filteredDiagnostics={filteredDiagnostics}
        selectedDiagnostic={selectedDiagnostic}
        relatedLogs={relatedLogs}
        copiedFeedback={copiedDiagnosticAction}
        errorLogCount={logErrors}
        workerErrorCount={workerErrors}
        onCopySelected={onCopySelected}
        onCopyVisible={onCopyVisible}
        onCopyRelatedContext={onCopyRelatedContext}
        onExportJson={onExportJson}
        onExportMarkdown={onExportMarkdown}
        onExportErrorReport={onExportErrorReport}
        onSelectDiagnostic={onSelectDiagnostic}
        onScrollToLogs={onScrollToLogs}
      />

      {/* 内容区域 */}
      {sourceState.status === 'error' && sourceState.error ? (
        <InlineFailureNotice title="诊断信息加载失败" message={sourceState.error} />
      ) : filteredDiagnostics.length > 0 ? (
        <div style={TWO_COLUMN}>
          {/* 左侧：错误列表 */}
          <div style={LEFT_PANEL}>
            {/* 搜索框 */}
            <div style={{ position: 'relative' }}>
              <input
                type="search"
                value={diagnosticQuery}
                onChange={(event) => onSetDiagnosticQuery(event.target.value)}
                aria-label="搜索诊断错误"
                name="diagnostic-query"
                autoComplete="off"
                placeholder="搜索错误..."
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: `1px solid ${diagnosticQuery ? 'var(--danger)' : 'var(--border-subtle)'}`,
                  borderRadius: 2,
                  padding: '3px 6px',
                  color: 'var(--fg-strong)',
                  fontSize: 11,
                  outline: 'none',
                }}
              />
              {diagnosticQuery && (
                <button
                  type="button"
                  onClick={() => onSetDiagnosticQuery('')}
                  aria-label="清空搜索"
                  style={{
                    position: 'absolute',
                    right: 3,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--fg-muted)',
                    fontSize: 10,
                    padding: '1px 2px',
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* 统计信息 */}
            <div style={{ display: 'flex', gap: 6, fontSize: 10, color: 'var(--fg-muted)' }}>
              <span>{filteredDiagnostics.length} 条错误</span>
              {relatedLogs.length > 0 && <span>{relatedLogs.length} 关联日志</span>}
            </div>

            {/* 错误列表 */}
            <div style={LIST_CONTAINER}>
              {filteredDiagnostics.map((diagnostic, index) => {
                const key = buildDiagnosticKey(diagnostic);
                const isActive =
                  selectedDiagnosticKey === key || (!selectedDiagnosticKey && index === 0);

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSelectDiagnostic(key)}
                    style={{
                      borderRadius: 6,
                      border: isActive
                        ? '1px solid var(--border-default)'
                        : '1px solid transparent',
                      background: isActive ? 'var(--bg-raised)' : 'transparent',
                      boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                      color: 'var(--fg-strong)',
                      padding: '4px 6px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                      cursor: 'pointer',
                      textAlign: 'left',
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 4,
                        alignItems: 'flex-start',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: isActive ? 500 : 400,
                          color: isActive ? 'var(--accent)' : 'var(--fg-strong)',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          minWidth: 0,
                          flex: 1,
                          lineHeight: 1.3,
                        }}
                      >
                        {diagnostic.message}
                      </span>
                      <span
                        style={{ ...BADGE, color: 'var(--danger)', flexShrink: 0, fontSize: 9 }}
                      >
                        {diagnostic.severity}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        fontSize: 10,
                        color: 'var(--fg-muted)',
                        fontFamily: 'monospace',
                      }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatDiagnosticLocation(diagnostic)}
                      </span>
                      {typeof diagnostic.durationMs === 'number' && (
                        <span style={{ flexShrink: 0 }}>{diagnostic.durationMs}ms</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 右侧：详情面板 */}
          <div style={RIGHT_PANEL}>
            {/* 关联日志 */}
            {relatedLogs.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 10 }}>
                <span style={{ color: 'var(--fg-muted)' }}>关联:</span>
                {relatedLogs.map((log, index) => (
                  <button
                    key={`${log.timestamp}-${log.requestId ?? index}`}
                    type="button"
                    onClick={onScrollToLogs}
                    style={{
                      ...BG,
                      padding: '1px 4px',
                      fontSize: 10,
                      color: log.level === 'error' ? 'var(--danger)' : 'var(--fg-default)',
                    }}
                  >
                    {log.requestId ?? log.source ?? `日志 ${index + 1}`}
                  </button>
                ))}
              </div>
            )}

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onCopyDiagnosticField('输入', selectedDiagnostic?.input)}
                disabled={!selectedDiagnostic}
                style={{
                  ...BS,
                  opacity: selectedDiagnostic ? 1 : 0.4,
                  cursor: selectedDiagnostic ? 'pointer' : 'not-allowed',
                }}
              >
                复制输入
              </button>
              <button
                type="button"
                onClick={() => onCopyDiagnosticField('输出', selectedDiagnostic?.output)}
                disabled={!selectedDiagnostic}
                style={{
                  ...BS,
                  opacity: selectedDiagnostic ? 1 : 0.4,
                  cursor: selectedDiagnostic ? 'pointer' : 'not-allowed',
                }}
              >
                复制输出
              </button>
            </div>

            {/* 详情面板 */}
            <DiagnosticDetailsPanel diagnostic={selectedDiagnostic} />
          </div>
        </div>
      ) : diagnostics.length > 0 ? (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          当前筛选条件无匹配结果。共有 {diagnostics.length} 条诊断记录。
          <button
            type="button"
            onClick={() => onSetDiagnosticQuery('')}
            style={{ ...BG, fontSize: 11, marginLeft: 4 }}
          >
            清空筛选
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 11, color: 'var(--fg-muted)' }}>最近没有采集到新的异常。</p>
      )}
    </section>
  );
}
