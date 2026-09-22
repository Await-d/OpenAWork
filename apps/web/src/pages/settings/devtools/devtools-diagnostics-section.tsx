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
  rowInteractionProps,
  subtleButtonInteractionProps,
} from './devtools-workbench-primitives.js';
import { ErrorCommandCenter } from './devtools-error-command.js';
import {
  SS,
  ST,
  BADGE,
  BG,
  BS,
  TWO_COLUMN,
  LEFT_PANEL,
  RIGHT_PANEL,
  LIST_CONTAINER,
  SEARCH_INPUT,
} from '../shared/settings-section-styles.js';

interface DevtoolsDiagnosticsSectionProps {
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
  onCopyAll: () => void;
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

const GHOST_INTERACTION = subtleButtonInteractionProps();

const DATE_SELECT: React.CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border-default)',
  padding: '6px 10px',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontSize: 12,
  cursor: 'pointer',
};

export function DevtoolsDiagnosticsSection({
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
  onCopyAll,
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
    <section style={SS}>
      {/* 标题和操作栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <h3 style={{ ...ST, marginBottom: 0 }}>诊断信息</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {availableDates.length > 0 && (
            <select
              value={dateFilter ?? ''}
              onChange={(event) => onSetDateFilter(event.target.value || null)}
              style={DATE_SELECT}
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
            <span
              style={{
                ...BADGE,
                color: 'var(--fg-muted)',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
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
              {...GHOST_INTERACTION}
              style={{
                ...BS,
                fontSize: 12,
                color: isClearing ? 'var(--fg-muted)' : 'var(--danger)',
                cursor: isClearing ? 'not-allowed' : 'pointer',
              }}
            >
              {isClearing ? '清除中…' : '清除全部'}
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
        onCopyAll={onCopyAll}
        onCopyRelatedContext={onCopyRelatedContext}
        onExportJson={onExportJson}
        onExportMarkdown={onExportMarkdown}
        onExportErrorReport={onExportErrorReport}
        onScrollToLogs={onScrollToLogs}
      />

      {/* 内容区域 */}
      {sourceState.status === 'error' && sourceState.error ? (
        <InlineFailureNotice title="诊断信息加载失败" message={sourceState.error} />
      ) : filteredDiagnostics.length > 0 ? (
        <div style={TWO_COLUMN}>
          {/* 左侧：错误列表 */}
          <div style={LEFT_PANEL}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="search"
                value={diagnosticQuery}
                onChange={(event) => onSetDiagnosticQuery(event.target.value)}
                aria-label="搜索诊断错误"
                name="diagnostic-query"
                autoComplete="off"
                placeholder="搜索错误…"
                style={{
                  ...SEARCH_INPUT,
                  border: `1px solid ${diagnosticQuery ? 'var(--danger)' : 'var(--border-default)'}`,
                }}
              />
              {diagnosticQuery && (
                <button
                  type="button"
                  onClick={() => onSetDiagnosticQuery('')}
                  aria-label="清空搜索"
                  {...GHOST_INTERACTION}
                  style={{ ...BG, fontSize: 12, flexShrink: 0 }}
                >
                  清空
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--fg-muted)' }}>
              <span>{filteredDiagnostics.length} 条错误</span>
              {relatedLogs.length > 0 && <span>{relatedLogs.length} 条关联日志</span>}
            </div>

            <div style={{ ...LIST_CONTAINER, maxHeight: 480 }}>
              {filteredDiagnostics.map((diagnostic, index) => {
                const key = buildDiagnosticKey(diagnostic);
                const isActive =
                  selectedDiagnosticKey === key || (!selectedDiagnosticKey && index === 0);

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSelectDiagnostic(key)}
                    {...rowInteractionProps({ isActive, restBackground: 'transparent' })}
                    style={{
                      borderRadius: 8,
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      cursor: 'pointer',
                      textAlign: 'left',
                      minWidth: 0,
                      border: isActive
                        ? '1px solid var(--border-default)'
                        : '1px solid transparent',
                      background: isActive ? 'var(--bg-raised)' : 'transparent',
                      boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                      color: 'var(--fg-strong)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        alignItems: 'flex-start',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: isActive ? 500 : 400,
                          color: isActive ? 'var(--accent)' : 'var(--fg-strong)',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          minWidth: 0,
                          flex: 1,
                          lineHeight: 1.4,
                        }}
                      >
                        {diagnostic.message}
                      </span>
                      <span
                        style={{ ...BADGE, color: 'var(--danger)', flexShrink: 0, fontSize: 10 }}
                      >
                        {diagnostic.severity}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        fontSize: 11,
                        color: 'var(--fg-muted)',
                        fontFamily: 'var(--font-mono, monospace)',
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
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ color: 'var(--fg-muted)' }}>关联日志：</span>
                {relatedLogs.map((log, index) => (
                  <button
                    key={`${log.timestamp}-${log.requestId ?? index}`}
                    type="button"
                    onClick={onScrollToLogs}
                    {...GHOST_INTERACTION}
                    style={{
                      ...BG,
                      padding: '2px 8px',
                      fontSize: 11,
                      border: '1px solid var(--border-default)',
                      color: log.level === 'error' ? 'var(--danger)' : 'var(--fg-default)',
                    }}
                  >
                    {log.requestId ?? log.source ?? `日志 ${index + 1}`}
                  </button>
                ))}
              </div>
            )}

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onCopyDiagnosticField('输入', selectedDiagnostic?.input)}
                disabled={!selectedDiagnostic}
                {...GHOST_INTERACTION}
                style={{
                  ...BS,
                  fontSize: 12,
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
                {...GHOST_INTERACTION}
                style={{
                  ...BS,
                  fontSize: 12,
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
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          当前筛选条件无匹配结果。共有 {diagnostics.length} 条诊断记录。
          <button
            type="button"
            onClick={() => onSetDiagnosticQuery('')}
            style={{ ...BG, fontSize: 12, marginLeft: 4 }}
          >
            清空筛选
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>最近没有采集到新的异常。</p>
      )}
    </section>
  );
}
