import React from 'react';
import { DeveloperModePanel, LogViewer, type DevEvent } from '@openAwork/shared-ui';
import type { DevtoolsSourceState, SettingsDevLogRecord } from '../state/settings-types.js';
import {
  buildLogKey,
  InlineFailureNotice,
  LogDetailsPanel,
} from './devtools-workbench-primitives.js';
import {
  SS,
  ST,
  UV,
  BADGE,
  BS,
  BG,
  TWO_COLUMN,
  LEFT_PANEL,
  RIGHT_PANEL,
  LIST_CONTAINER,
  CODE_BLOCK,
} from '../shared/settings-section-styles.js';

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

  return (
    <section ref={sectionRef} style={SS}>
      <h3 style={ST}>开发者模式与日志</h3>
      {sourceState.status === 'error' && sourceState.error && (
        <InlineFailureNotice title="开发日志加载失败" message={sourceState.error} />
      )}

      {/* 操作栏 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 搜索框 */}
          <input
            type="search"
            value={logQuery}
            onChange={(event) => setLogQuery(event.target.value)}
            aria-label="搜索开发日志"
            name="log-query"
            autoComplete="off"
            placeholder="搜索日志..."
            style={{
              minWidth: 120,
              background: 'transparent',
              border: `1px solid ${logQuery ? 'var(--accent)' : 'var(--border-subtle)'}`,
              borderRadius: 2,
              padding: '2px 6px',
              color: 'var(--fg-strong)',
              fontSize: 11,
              outline: 'none',
            }}
          />

          {/* 错误过滤 */}
          <button
            type="button"
            onClick={() => setShowOnlyErrorLogs((prev) => !prev)}
            style={{ ...BG, color: showOnlyErrorLogs ? 'var(--danger)' : 'var(--fg-muted)' }}
          >
            {showOnlyErrorLogs ? '仅错误' : '全部'}
          </button>

          {/* 统计 */}
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
            {filteredLogs.length} 条{visibleErrorCount > 0 && ` (${visibleErrorCount} 错误)`}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--accent)' }} aria-live="polite">
            {copiedLogAction ?? ''}
          </span>
          <button
            type="button"
            onClick={copySelectedLog}
            disabled={!selectedLog}
            style={{
              ...BS,
              opacity: selectedLog ? 1 : 0.4,
              cursor: selectedLog ? 'pointer' : 'not-allowed',
            }}
          >
            复制当前
          </button>
          <button
            type="button"
            onClick={copyVisibleLogs}
            disabled={filteredLogs.length === 0}
            style={{
              ...BS,
              opacity: filteredLogs.length > 0 ? 1 : 0.4,
              cursor: filteredLogs.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            复制可见
          </button>
        </div>
      </div>

      {/* 两栏布局 */}
      <div style={TWO_COLUMN}>
        {/* 左侧：日志列表 */}
        <div style={LEFT_PANEL}>
          <div style={LIST_CONTAINER}>
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
                      borderRadius: 2,
                      border: 'none',
                      borderBottom: `1px solid ${isActive ? (isError ? 'var(--danger)' : 'var(--accent)') : 'var(--border-subtle)'}`,
                      background: isActive
                        ? isError
                          ? 'color-mix(in srgb, var(--danger) 5%, transparent)'
                          : 'color-mix(in srgb, var(--accent) 5%, transparent)'
                        : 'transparent',
                      color: 'var(--fg-strong)',
                      padding: '3px 6px',
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
                          fontWeight: isError ? 500 : 400,
                          color: isError
                            ? 'var(--danger)'
                            : isActive
                              ? 'var(--accent)'
                              : 'var(--fg-strong)',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          minWidth: 0,
                          flex: 1,
                          lineHeight: 1.3,
                        }}
                      >
                        {log.message}
                      </span>
                      <span
                        style={{
                          ...BADGE,
                          color: isError ? 'var(--danger)' : 'var(--accent)',
                          flexShrink: 0,
                          fontSize: 9,
                        }}
                      >
                        {log.level}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 3,
                        alignItems: 'center',
                        fontSize: 10,
                        color: 'var(--fg-muted)',
                      }}
                    >
                      {ts && <span style={{ fontFamily: 'monospace' }}>{ts}</span>}
                      {(log.requestId ?? log.source) && (
                        <span
                          style={{
                            fontFamily: 'monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: 60,
                          }}
                        >
                          {log.requestId ?? log.source}
                        </span>
                      )}
                      {typeof log.durationMs === 'number' && <span>{log.durationMs}ms</span>}
                    </div>
                  </button>
                );
              })
            ) : (
              <div
                style={{
                  padding: '8px 6px',
                  textAlign: 'center',
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                }}
              >
                {devLogs.length > 0 ? '筛选后没有匹配日志。' : '暂无日志数据。'}
                {devLogs.length > 0 && (logQuery || showOnlyErrorLogs) && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogQuery('');
                      setShowOnlyErrorLogs(false);
                    }}
                    style={{ ...BG, fontSize: 11, marginLeft: 4 }}
                  >
                    清空筛选
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：详情 */}
        <div style={RIGHT_PANEL}>
          {/* 日志详情 */}
          <div
            style={{
              borderRadius: 2,
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '3px 6px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>详情</span>
                {selectedLog && (
                  <>
                    <span
                      style={{
                        ...BADGE,
                        color: selectedLog.level === 'error' ? 'var(--danger)' : 'var(--accent)',
                      }}
                    >
                      {selectedLog.level}
                    </span>
                    {selectedLog.requestId && (
                      <span
                        style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'monospace' }}
                      >
                        {selectedLog.requestId}
                      </span>
                    )}
                  </>
                )}
              </div>
              {selectedLog && (
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    onClick={() => copyLogField('输入', selectedLog?.input)}
                    style={{ ...BG, padding: '1px 4px', fontSize: 10 }}
                  >
                    复制输入
                  </button>
                  <button
                    type="button"
                    onClick={() => copyLogField('输出', selectedLog?.output)}
                    style={{ ...BG, padding: '1px 4px', fontSize: 10 }}
                  >
                    复制输出
                  </button>
                </div>
              )}
            </div>

            {selectedLog ? (
              <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 1 }}>
                    输入
                  </div>
                  <pre style={CODE_BLOCK}>
                    {selectedLog.input != null
                      ? JSON.stringify(selectedLog.input, null, 2)
                      : '(无输入)'}
                  </pre>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 1 }}>
                    输出
                  </div>
                  <pre style={CODE_BLOCK}>
                    {selectedLog.output != null
                      ? JSON.stringify(selectedLog.output, null, 2)
                      : '(无输出)'}
                  </pre>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: '8px 6px',
                  textAlign: 'center',
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                }}
              >
                暂无选中日志
              </div>
            )}
          </div>

          {/* LogDetailsPanel */}
          <LogDetailsPanel log={selectedLog} />
        </div>
      </div>
    </section>
  );
}
