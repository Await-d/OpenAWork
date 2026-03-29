import React from 'react';
import type {
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from '../settings-types.js';
import {
  buildDiagnosticKey,
  DiagnosticDetailsPanel,
  InlineFailureNotice,
} from './devtools-workbench-primitives.js';
import { ErrorCommandCenter } from './devtools-error-command.js';
import { SS, ST } from './settings-section-styles.js';

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
  onScrollToLogs: () => void;
  onCopyDiagnosticField: (label: string, value: unknown) => void;
}

interface DiagnosticFileSummary {
  filePath: string;
  count: number;
  toolName: string;
  lastMessage: string;
}

const PANEL_SURFACE_STYLE: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
};

const META_BADGE_STYLE: React.CSSProperties = {
  borderRadius: 999,
  padding: '5px 10px',
  border: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
  fontSize: 11,
  color: 'var(--text-2)',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

function buildFileSummaries(diagnostics: SettingsDiagnosticRecord[]): DiagnosticFileSummary[] {
  const grouped = new Map<string, DiagnosticFileSummary>();

  for (const diagnostic of diagnostics) {
    const existing = grouped.get(diagnostic.filePath);
    if (existing) {
      existing.count += 1;
      existing.lastMessage = diagnostic.message;
      continue;
    }

    grouped.set(diagnostic.filePath, {
      filePath: diagnostic.filePath,
      count: 1,
      toolName: diagnostic.toolName ?? diagnostic.filePath,
      lastMessage: diagnostic.message,
    });
  }

  return Array.from(grouped.values());
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
  onScrollToLogs,
  onCopyDiagnosticField,
}: DevtoolsDiagnosticsSectionProps) {
  const fileSummaries = React.useMemo(
    () => buildFileSummaries(filteredDiagnostics),
    [filteredDiagnostics],
  );

  const selectedFilePath = selectedDiagnostic?.filePath ?? null;

  const appVersion = filteredDiagnostics[0]?.appVersion ?? null;
  const [isClearing, setIsClearing] = React.useState(false);

  return (
    <section ref={sectionRef} style={SS}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <h3 style={ST}>诊断信息</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {availableDates.length > 0 ? (
            <select
              value={dateFilter ?? ''}
              onChange={(event) => onSetDateFilter(event.target.value || null)}
              style={{
                borderRadius: 8,
                border: dateFilter ? '1px solid var(--danger)' : '1px solid var(--border)',
                padding: '6px 10px',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 12,
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
          ) : null}
          {appVersion ? (
            <span
              style={{
                borderRadius: 999,
                padding: '5px 10px',
                border: '1px solid var(--border)',
                background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
                fontSize: 11,
                color: 'var(--text-3)',
                fontFamily: 'monospace',
              }}
            >
              v{appVersion}
            </span>
          ) : null}
          {diagnostics.length > 0 ? (
            <button
              type="button"
              disabled={isClearing}
              onClick={() => {
                setIsClearing(true);
                void onClearDiagnostics().finally(() => setIsClearing(false));
              }}
              style={{
                borderRadius: 8,
                border: '1px solid color-mix(in srgb, var(--danger) 40%, var(--border))',
                padding: '6px 12px',
                background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
                color: 'var(--danger)',
                fontSize: 12,
                fontWeight: 700,
                cursor: isClearing ? 'not-allowed' : 'pointer',
                opacity: isClearing ? 0.6 : 1,
              }}
            >
              {isClearing ? '清除中…' : '清除全部错误'}
            </button>
          ) : null}
        </div>
      </div>
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
        onSelectDiagnostic={onSelectDiagnostic}
        onScrollToLogs={onScrollToLogs}
      />
      {sourceState.status === 'error' && sourceState.error ? (
        <InlineFailureNotice title="诊断信息加载失败" message={sourceState.error} />
      ) : filteredDiagnostics.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div
            style={{
              flex: '0 1 340px',
              minWidth: 280,
              maxWidth: 360,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={PANEL_SURFACE_STYLE}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {diagnosticQuery ? '搜索条件（筛选中）' : '错误浏览器'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                    先缩小范围，再从左侧列表锁定具体错误，右侧详情会保持稳定宽度，不会被不同长度的卡片撑乱。
                  </div>
                </div>
                {diagnosticQuery ? (
                  <button
                    type="button"
                    onClick={() => onSetDiagnosticQuery('')}
                    style={{
                      alignSelf: 'flex-start',
                      borderRadius: 999,
                      border: '1px solid var(--border)',
                      padding: '6px 10px',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    清空筛选
                  </button>
                ) : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                <input
                  type="search"
                  value={diagnosticQuery}
                  onChange={(event) => onSetDiagnosticQuery(event.target.value)}
                  aria-label="搜索诊断错误"
                  name="diagnostic-query"
                  autoComplete="off"
                  placeholder="搜索 message / requestId / tool…"
                  style={{
                    flex: 1,
                    background: 'var(--surface)',
                    border: diagnosticQuery ? '1px solid var(--danger)' : '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '7px 32px 7px 10px',
                    color: 'var(--text)',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
                {diagnosticQuery ? (
                  <button
                    type="button"
                    onClick={() => onSetDiagnosticQuery('')}
                    aria-label="清空搜索"
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-3)',
                      fontSize: 14,
                      lineHeight: 1,
                      padding: '2px 4px',
                      borderRadius: 3,
                    }}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={META_BADGE_STYLE}>文件 {fileSummaries.length}</span>
                <span
                  style={{
                    ...META_BADGE_STYLE,
                    color: filteredDiagnostics.length > 0 ? 'var(--danger)' : 'var(--text-2)',
                    borderColor:
                      filteredDiagnostics.length > 0
                        ? 'color-mix(in srgb, var(--danger) 30%, var(--border))'
                        : 'var(--border)',
                    background:
                      filteredDiagnostics.length > 0
                        ? 'color-mix(in srgb, var(--danger) 8%, var(--surface))'
                        : 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
                  }}
                >
                  可见错误 {filteredDiagnostics.length}
                </span>
                <span style={META_BADGE_STYLE}>关联日志 {relatedLogs.length}</span>
              </div>
            </div>

            <div style={PANEL_SURFACE_STYLE}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                  按文件聚合
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-3)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fileSummaries.length} 个文件
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 220,
                  overflowY: 'auto',
                }}
              >
                {fileSummaries.map((summary) => {
                  const firstIndex = filteredDiagnostics.findIndex(
                    (diagnostic) => diagnostic.filePath === summary.filePath,
                  );
                  const firstDiagnostic = firstIndex >= 0 ? filteredDiagnostics[firstIndex] : null;
                  const isActive = selectedFilePath === summary.filePath;

                  return (
                    <button
                      key={summary.filePath}
                      type="button"
                      onClick={() => {
                        if (!firstDiagnostic) {
                          return;
                        }
                        onSelectDiagnostic(buildDiagnosticKey(firstDiagnostic));
                      }}
                      style={{
                        borderRadius: 6,
                        border: `1px solid ${isActive ? 'color-mix(in srgb, var(--danger) 50%, var(--border))' : 'color-mix(in srgb, var(--danger) 20%, var(--border))'}`,
                        background: isActive
                          ? 'color-mix(in srgb, var(--danger) 12%, var(--surface))'
                          : 'var(--surface)',
                        color: 'var(--text)',
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        cursor: firstDiagnostic ? 'pointer' : 'default',
                        textAlign: 'left',
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: isActive ? 'var(--danger)' : 'var(--text)',
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                          }}
                        >
                          {summary.filePath}
                        </span>
                        <span
                          style={{
                            borderRadius: 4,
                            padding: '2px 6px',
                            background: isActive
                              ? 'color-mix(in srgb, var(--danger) 20%, transparent)'
                              : 'color-mix(in srgb, var(--danger) 12%, transparent)',
                            color: 'var(--danger)',
                            fontSize: 10,
                            fontWeight: 700,
                            flexShrink: 0,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {summary.count}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-3)',
                          fontFamily: 'monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {summary.toolName}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={PANEL_SURFACE_STYLE}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>错误列表</div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-3)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {filteredDiagnostics.length} 条
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 420,
                  overflowY: 'auto',
                }}
              >
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
                        borderRadius: 14,
                        border: `1px solid ${isActive ? 'color-mix(in srgb, var(--danger) 42%, var(--border))' : 'var(--border)'}`,
                        background: isActive
                          ? 'linear-gradient(135deg, color-mix(in srgb, var(--danger) 11%, var(--surface)), color-mix(in srgb, var(--surface) 96%, var(--bg)))'
                          : 'color-mix(in srgb, var(--surface) 96%, var(--bg))',
                        color: 'var(--text)',
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        cursor: 'pointer',
                        textAlign: 'left',
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 10,
                          alignItems: 'flex-start',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: isActive ? 'var(--danger)' : 'var(--text)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          {diagnostic.message}
                        </span>
                        <span
                          style={{
                            borderRadius: 999,
                            padding: '4px 8px',
                            background: 'color-mix(in srgb, var(--danger) 14%, transparent)',
                            color: 'var(--danger)',
                            fontSize: 10,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {diagnostic.severity}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                          fontSize: 11,
                          color: 'var(--text-3)',
                        }}
                      >
                        <span>{formatDiagnosticLocation(diagnostic)}</span>
                        {typeof diagnostic.durationMs === 'number' ? (
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {diagnostic.durationMs}ms
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            style={{
              flex: '1 1 460px',
              minWidth: 320,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={PANEL_SURFACE_STYLE}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    错误详情
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                    详情区固定在右侧，输入、输出和关联日志都围绕当前错误展开，避免在不同大小的卡片之间来回跳转。
                  </div>
                </div>
                {selectedDiagnostic ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={META_BADGE_STYLE}>
                      {selectedDiagnostic.toolName ?? selectedDiagnostic.filePath}
                    </span>
                    {selectedDiagnostic.requestId ? (
                      <span style={META_BADGE_STYLE}>{selectedDiagnostic.requestId}</span>
                    ) : null}
                    {typeof selectedDiagnostic.durationMs === 'number' ? (
                      <span style={META_BADGE_STYLE}>{selectedDiagnostic.durationMs}ms</span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {relatedLogs.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)' }}>
                    关联日志
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {relatedLogs.map((log, index) => (
                      <button
                        key={`${log.timestamp}-${log.requestId ?? index}`}
                        type="button"
                        onClick={onScrollToLogs}
                        style={{
                          borderRadius: 999,
                          border: '1px solid var(--border)',
                          padding: '6px 10px',
                          background: 'color-mix(in srgb, var(--surface) 90%, var(--bg))',
                          color: log.level === 'error' ? 'var(--danger)' : 'var(--text)',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        {log.requestId ?? log.source ?? `日志 ${index + 1}`}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    borderRadius: 12,
                    border: '1px dashed var(--border)',
                    padding: '12px 14px',
                    fontSize: 12,
                    color: 'var(--text-3)',
                    background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
                  }}
                >
                  这条错误暂时没有匹配到关联日志，可以直接复制输入和输出 payload 继续排查。
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => onCopyDiagnosticField('输入 payload', selectedDiagnostic?.input)}
                  disabled={!selectedDiagnostic}
                  style={{
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    padding: '8px 12px',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontSize: 12,
                    cursor: selectedDiagnostic ? 'pointer' : 'not-allowed',
                    opacity: selectedDiagnostic ? 1 : 0.45,
                  }}
                >
                  复制输入 payload
                </button>
                <button
                  type="button"
                  onClick={() => onCopyDiagnosticField('输出 payload', selectedDiagnostic?.output)}
                  disabled={!selectedDiagnostic}
                  style={{
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    padding: '8px 12px',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontSize: 12,
                    cursor: selectedDiagnostic ? 'pointer' : 'not-allowed',
                    opacity: selectedDiagnostic ? 1 : 0.45,
                  }}
                >
                  复制输出 payload
                </button>
              </div>
            </div>

            <DiagnosticDetailsPanel diagnostic={selectedDiagnostic} />
          </div>
        </div>
      ) : diagnostics.length > 0 ? (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid color-mix(in srgb, var(--warning, #f59e0b) 30%, var(--border))',
            background: 'color-mix(in srgb, var(--warning, #f59e0b) 8%, var(--surface))',
            padding: '16px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              当前筛选条件无匹配结果
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              共有 {diagnostics.length} 条诊断记录，但当前搜索词未命中任何条目。
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSetDiagnosticQuery('')}
            style={{
              borderRadius: 10,
              border: '1px solid color-mix(in srgb, var(--warning, #f59e0b) 40%, var(--border))',
              padding: '8px 14px',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            清空筛选
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-3)' }}>最近没有采集到新的异常。</p>
      )}
    </section>
  );
}
