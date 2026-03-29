import React from 'react';
import { DeveloperModePanel, LogViewer, type DevEvent } from '@openAwork/shared-ui';
import type { DevtoolsSourceState, SettingsDevLogRecord } from '../settings-types.js';
import {
  buildLogKey,
  InlineFailureNotice,
  LogDetailsPanel,
} from './devtools-workbench-primitives.js';
import { SS, ST, UV } from './settings-section-styles.js';

export interface DevtoolsLogsSectionProps {
  sectionRef: React.RefObject<HTMLDivElement | null>;
  devLogs: SettingsDevLogRecord[];
  devEvents: DevEvent[];
  filteredLogs: SettingsDevLogRecord[];
  selectedLog: SettingsDevLogRecord | null;
  selectedLogKey: string | null;
  logQuery: string;
  showOnlyErrorLogs: boolean;
  copiedLogAction: string | null;
  sourceState: DevtoolsSourceState;
  setSelectedLogKey: (key: string) => void;
  setLogQuery: (value: string) => void;
  setShowOnlyErrorLogs: (value: boolean | ((prev: boolean) => boolean)) => void;
  copySelectedLog: () => void;
  copyVisibleLogs: () => void;
  copyLogField: (label: string, value: unknown) => void;
  onExportLogs: () => void;
}

export function DevtoolsLogsSection({
  sectionRef,
  devLogs,
  devEvents,
  filteredLogs,
  selectedLog,
  selectedLogKey,
  logQuery,
  showOnlyErrorLogs,
  copiedLogAction,
  sourceState,
  setSelectedLogKey,
  setLogQuery,
  setShowOnlyErrorLogs,
  copySelectedLog,
  copyVisibleLogs,
  copyLogField,
  onExportLogs,
}: DevtoolsLogsSectionProps) {
  const visibleErrorCount = filteredLogs.filter((l) => l.level === 'error').length;
  const isFiltered = logQuery !== '' || showOnlyErrorLogs;

  return (
    <section ref={sectionRef} style={SS}>
      <h3 style={ST}>开发者模式与日志</h3>
      {sourceState.status === 'error' && sourceState.error ? (
        <InlineFailureNotice title="开发日志加载失败" message={sourceState.error} />
      ) : null}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--surface) 85%, var(--bg))',
          borderBottom: '2px solid var(--accent)',
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            日志工作台
          </span>
          <span
            style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}
          >
            全部 {devLogs.length}
          </span>
          <span
            style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}
          >
            可见 {filteredLogs.length}
          </span>
          <span
            style={{
              fontSize: 11,
              color:
                visibleErrorCount > 0
                  ? 'var(--danger)'
                  : showOnlyErrorLogs
                    ? 'var(--danger)'
                    : 'var(--text-3)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            错误 {visibleErrorCount}
          </span>
          {isFiltered ? (
            <span
              style={{
                borderRadius: 999,
                padding: '2px 8px',
                background: showOnlyErrorLogs
                  ? 'color-mix(in srgb, var(--danger) 12%, var(--surface))'
                  : 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
                border: `1px solid ${
                  showOnlyErrorLogs
                    ? 'color-mix(in srgb, var(--danger) 30%, var(--border))'
                    : 'color-mix(in srgb, var(--accent) 30%, var(--border))'
                }`,
                fontSize: 11,
                fontWeight: 700,
                color: showOnlyErrorLogs ? 'var(--danger)' : 'var(--accent)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              筛选中：{filteredLogs.length} 条可见
            </span>
          ) : null}
          {selectedLog?.requestId ? (
            <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'monospace' }}>
              当前请求：{selectedLog.requestId}
            </span>
          ) : null}
          <span
            style={{ fontSize: 11, color: 'var(--accent)' }}
            aria-live="polite"
            aria-atomic="true"
          >
            {copiedLogAction ?? ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <div
            style={{
              width: 1,
              height: 20,
              background: 'var(--border)',
              flexShrink: 0,
              marginRight: 2,
            }}
          />
          <button
            type="button"
            onClick={copySelectedLog}
            disabled={!selectedLog}
            style={{
              borderRadius: 8,
              border: '1px solid var(--accent)',
              padding: '6px 10px',
              background: selectedLog ? 'var(--accent)' : 'var(--surface)',
              color: selectedLog ? 'var(--accent-text)' : 'var(--text)',
              fontSize: 11,
              cursor: selectedLog ? 'pointer' : 'not-allowed',
              opacity: selectedLog ? 1 : 0.45,
              fontWeight: selectedLog ? 600 : 400,
            }}
          >
            复制当前日志
          </button>
          <button
            type="button"
            onClick={copyVisibleLogs}
            disabled={filteredLogs.length === 0}
            style={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              padding: '6px 10px',
              background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
              color: 'var(--text)',
              fontSize: 11,
              cursor: filteredLogs.length > 0 ? 'pointer' : 'not-allowed',
              opacity: filteredLogs.length > 0 ? 1 : 0.45,
            }}
          >
            复制可见日志
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div
          style={{
            flex: '0 1 420px',
            minWidth: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              borderRadius: 8,
              border: `1px solid ${logQuery ? 'var(--danger)' : 'var(--border)'}`,
              background: 'color-mix(in srgb, var(--surface) 85%, var(--bg))',
              padding: '8px 10px',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <input
              type="search"
              value={logQuery}
              onChange={(event) => setLogQuery(event.target.value)}
              aria-label="搜索开发日志"
              name="log-query"
              autoComplete="off"
              placeholder="搜索日志 message / requestId / payload…"
              style={{
                flex: 1,
                minWidth: 180,
                background: 'var(--surface)',
                border: `1px solid ${logQuery ? 'var(--danger)' : 'var(--border)'}`,
                borderRadius: 6,
                padding: '6px 10px',
                color: 'var(--text)',
                fontSize: 12,
              }}
            />
            <button
              type="button"
              onClick={() => setShowOnlyErrorLogs((prev) => !prev)}
              style={{
                borderRadius: 6,
                border: `1px solid ${showOnlyErrorLogs ? 'color-mix(in srgb, var(--danger) 40%, var(--border))' : 'var(--border)'}`,
                padding: '6px 10px',
                background: showOnlyErrorLogs
                  ? 'color-mix(in srgb, var(--danger) 10%, var(--surface))'
                  : 'var(--surface)',
                color: showOnlyErrorLogs ? 'var(--danger)' : 'var(--text)',
                fontSize: 11,
                fontWeight: showOnlyErrorLogs ? 700 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {showOnlyErrorLogs ? '恢复全部日志' : '只看错误日志'}
            </button>
            <span
              style={{
                borderRadius: 999,
                padding: '3px 8px',
                border: '1px solid var(--border)',
                background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
                fontSize: 11,
                color: showOnlyErrorLogs ? 'var(--danger)' : 'var(--text-3)',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {filteredLogs.length} 条
            </span>
          </div>

          <div
            style={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'color-mix(in srgb, var(--surface) 85%, var(--bg))',
            }}
          >
            <div
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--border)',
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              实时事件流
            </div>
            <div
              data-testid="devtools-event-stream"
              style={{ ...UV, minHeight: 280, maxHeight: 280, overflow: 'hidden' }}
            >
              <DeveloperModePanel events={devEvents} />
            </div>
          </div>

          <div
            style={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--border)',
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              日志列表
            </div>
            <div
              data-testid="devtools-log-list"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 300,
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log, index) => {
                  const key = buildLogKey(log);
                  const isActive = selectedLogKey === key || (!selectedLogKey && index === 0);
                  const isError = log.level === 'error';
                  const ts = log.createdAt
                    ? new Date(log.createdAt).toLocaleTimeString('zh-CN', { hour12: false })
                    : null;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedLogKey(key)}
                      style={{
                        borderRadius: 6,
                        border: `1px solid ${
                          isActive && isError
                            ? 'color-mix(in srgb, var(--danger) 50%, var(--border))'
                            : isActive
                              ? 'color-mix(in srgb, var(--accent) 40%, var(--border))'
                              : isError
                                ? 'color-mix(in srgb, var(--danger) 20%, var(--border))'
                                : 'var(--border)'
                        }`,
                        background:
                          isActive && isError
                            ? 'color-mix(in srgb, var(--danger) 10%, var(--surface))'
                            : isActive
                              ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))'
                              : isError
                                ? 'color-mix(in srgb, var(--danger) 5%, var(--surface))'
                                : 'var(--surface)',
                        color: 'var(--text)',
                        padding: '6px 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        cursor: 'pointer',
                        textAlign: 'left',
                        minWidth: 0,
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
                            fontWeight: isError ? 700 : 400,
                            color: isError ? 'var(--danger)' : 'var(--text)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            minWidth: 0,
                            flex: 1,
                            lineHeight: 1.4,
                          }}
                        >
                          {log.message}
                        </span>
                        <span
                          style={{
                            borderRadius: 4,
                            padding: '2px 6px',
                            background: isError
                              ? 'color-mix(in srgb, var(--danger) 18%, transparent)'
                              : 'color-mix(in srgb, var(--accent) 14%, transparent)',
                            color: isError ? 'var(--danger)' : 'var(--accent)',
                            fontSize: 10,
                            fontWeight: 700,
                            flexShrink: 0,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {log.level}
                        </span>
                      </div>
                      <div
                        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
                      >
                        {ts ? (
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--text-3)',
                              fontFamily: 'monospace',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {ts}
                          </span>
                        ) : null}
                        {(log.requestId ?? log.source) ? (
                          <span
                            style={{
                              borderRadius: 4,
                              padding: '1px 5px',
                              border: '1px solid var(--border)',
                              background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                              fontSize: 10,
                              color: 'var(--text-3)',
                              fontFamily: 'monospace',
                              maxWidth: 120,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {log.requestId ?? log.source}
                          </span>
                        ) : null}
                        {typeof log.durationMs === 'number' ? (
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--text-3)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {log.durationMs}ms
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div style={{ padding: '24px 12px', textAlign: 'center' }}>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
                    {devLogs.length > 0 ? '筛选后没有匹配日志。' : '暂无日志数据。'}
                  </p>
                  {devLogs.length > 0 && (logQuery || showOnlyErrorLogs) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLogQuery('');
                        setShowOnlyErrorLogs(false);
                      }}
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        color: 'var(--accent)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      清空筛选
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: '1 1 420px',
            minWidth: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text-3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  日志详情
                </span>
                {selectedLog ? (
                  <>
                    <span
                      style={{
                        borderRadius: 4,
                        padding: '2px 6px',
                        background:
                          selectedLog.level === 'error'
                            ? 'color-mix(in srgb, var(--danger) 15%, transparent)'
                            : 'color-mix(in srgb, var(--accent) 14%, transparent)',
                        color: selectedLog.level === 'error' ? 'var(--danger)' : 'var(--accent)',
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {selectedLog.level}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace' }}>
                      {selectedLog.source ?? 'settings'}
                    </span>
                    {selectedLog.requestId ? (
                      <span
                        style={{
                          borderRadius: 4,
                          padding: '2px 6px',
                          border: '1px solid var(--border)',
                          background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                          fontSize: 10,
                          color: 'var(--text-2)',
                          fontFamily: 'monospace',
                        }}
                      >
                        {selectedLog.requestId}
                      </span>
                    ) : null}
                    {typeof selectedLog.durationMs === 'number' ? (
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-3)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {selectedLog.durationMs}ms
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => copyLogField('日志输入 payload', selectedLog?.input)}
                  disabled={!selectedLog}
                  style={{
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    padding: '4px 8px',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontSize: 11,
                    cursor: selectedLog ? 'pointer' : 'not-allowed',
                    opacity: selectedLog ? 1 : 0.4,
                  }}
                >
                  复制日志输入
                </button>
                <button
                  type="button"
                  onClick={() => copyLogField('日志输出 payload', selectedLog?.output)}
                  disabled={!selectedLog}
                  style={{
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    padding: '4px 8px',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontSize: 11,
                    cursor: selectedLog ? 'pointer' : 'not-allowed',
                    opacity: selectedLog ? 1 : 0.4,
                  }}
                >
                  复制日志输出
                </button>
              </div>
            </div>
            {selectedLog ? (
              <div
                style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--text-3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      marginBottom: 4,
                    }}
                  >
                    输入 payload
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '8px 10px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'color-mix(in srgb, var(--bg) 60%, var(--surface))',
                      fontSize: 11,
                      fontFamily: 'monospace',
                      lineHeight: 1.5,
                      color: 'var(--text-2)',
                      overflowX: 'auto',
                      maxHeight: 320,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {selectedLog.input != null
                      ? JSON.stringify(selectedLog.input, null, 2)
                      : '(无输入 payload)'}
                  </pre>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--text-3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      marginBottom: 4,
                    }}
                  >
                    输出 payload
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '8px 10px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'color-mix(in srgb, var(--bg) 60%, var(--surface))',
                      fontSize: 11,
                      fontFamily: 'monospace',
                      lineHeight: 1.5,
                      color: 'var(--text-2)',
                      overflowX: 'auto',
                      maxHeight: 320,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {selectedLog.output != null
                      ? JSON.stringify(selectedLog.output, null, 2)
                      : '(无输出 payload)'}
                  </pre>
                </div>
              </div>
            ) : (
              <div style={{ padding: '32px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>暂无选中日志</p>
              </div>
            )}
          </div>
          <LogDetailsPanel log={selectedLog} />
          <div style={UV}>
            <LogViewer logs={devLogs} onExport={onExportLogs} />
          </div>
        </div>
      </div>
    </section>
  );
}
