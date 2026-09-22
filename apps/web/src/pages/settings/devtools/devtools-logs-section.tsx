import type { CSSProperties } from 'react';
import type { DevtoolsSourceState, SettingsDevLogRecord } from '../state/settings-types.js';
import {
  buildLogKey,
  InlineFailureNotice,
  LogDetailsPanel,
  rowInteractionProps,
  subtleButtonInteractionProps,
} from './devtools-workbench-primitives.js';
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

export interface DevtoolsLogsSectionProps {
  devLogs: SettingsDevLogRecord[];
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
  /** 复制**全部** error 级别日志（不受当前搜索 / 视图切换影响）。 */
  copyErrorLogs: () => void;
  copyLogField: (label: string, value: unknown) => void;
  onExportLogs: () => void;
}

const GHOST_INTERACTION = subtleButtonInteractionProps();

const SEGMENTED_GROUP: CSSProperties = {
  display: 'inline-flex',
  gap: 2,
  padding: 2,
  borderRadius: 8,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-subtle)',
};

/** 分段控件内的按钮：选中态用抬升背景 + 语义色文字，明显区别于普通 ghost 按钮。 */
function segmentStyle(selected: boolean, isError: boolean): CSSProperties {
  return {
    appearance: 'none',
    font: 'inherit',
    fontSize: 12,
    fontWeight: selected ? 600 : 500,
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid transparent',
    background: selected ? 'var(--bg-raised)' : 'transparent',
    color: selected ? (isError ? 'var(--danger)' : 'var(--accent)') : 'var(--fg-muted)',
    boxShadow: selected ? 'var(--shadow-sm)' : 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 120ms ease, color 120ms ease',
  };
}

const LOG_ROW_BASE = {
  borderRadius: 8,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  cursor: 'pointer',
  textAlign: 'left',
  minWidth: 0,
  transition: 'background 120ms ease, border-color 120ms ease',
} as const;

export function DevtoolsLogsSection({
  devLogs,
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
  copyErrorLogs,
  copyLogField,
  onExportLogs,
}: DevtoolsLogsSectionProps) {
  const visibleErrorCount = filteredLogs.filter((log) => log.level === 'error').length;
  const totalErrorCount = devLogs.filter((log) => log.level === 'error').length;

  return (
    <section style={SS}>
      <h3 style={ST}>开发者模式与日志</h3>
      {sourceState.status === 'error' && sourceState.error && (
        <InlineFailureNotice title="开发日志加载失败" message={sourceState.error} />
      )}

      {/* 操作栏 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            value={logQuery}
            onChange={(event) => setLogQuery(event.target.value)}
            aria-label="搜索开发日志"
            name="log-query"
            autoComplete="off"
            placeholder="搜索日志…"
            style={{
              ...SEARCH_INPUT,
              flex: '0 1 220px',
              border: `1px solid ${logQuery ? 'var(--accent)' : 'var(--border-default)'}`,
            }}
          />
          <div role="group" aria-label="日志级别过滤" style={SEGMENTED_GROUP}>
            <button
              type="button"
              onClick={() => setShowOnlyErrorLogs(false)}
              aria-pressed={!showOnlyErrorLogs}
              {...rowInteractionProps({
                isActive: !showOnlyErrorLogs,
                restBackground: 'transparent',
              })}
              style={segmentStyle(!showOnlyErrorLogs, false)}
            >
              全部 {devLogs.length}
            </button>
            <button
              type="button"
              onClick={() => setShowOnlyErrorLogs(true)}
              aria-pressed={showOnlyErrorLogs}
              {...rowInteractionProps({
                isActive: showOnlyErrorLogs,
                restBackground: 'transparent',
              })}
              style={segmentStyle(showOnlyErrorLogs, true)}
            >
              仅错误 {totalErrorCount}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--accent)' }} aria-live="polite">
            {copiedLogAction ?? ''}
          </span>
          <button
            type="button"
            onClick={copyErrorLogs}
            disabled={totalErrorCount === 0}
            {...GHOST_INTERACTION}
            style={{
              ...BS,
              fontSize: 12,
              color: totalErrorCount > 0 ? 'var(--danger)' : undefined,
              opacity: totalErrorCount > 0 ? 1 : 0.4,
              cursor: totalErrorCount > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            复制错误日志{totalErrorCount > 0 ? ` (${totalErrorCount})` : ''}
          </button>
          <button
            type="button"
            onClick={onExportLogs}
            {...GHOST_INTERACTION}
            style={{ ...BS, fontSize: 12 }}
          >
            导出日志
          </button>
          <button
            type="button"
            onClick={copySelectedLog}
            disabled={!selectedLog}
            {...GHOST_INTERACTION}
            style={{
              ...BS,
              fontSize: 12,
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
            {...GHOST_INTERACTION}
            style={{
              ...BS,
              fontSize: 12,
              opacity: filteredLogs.length > 0 ? 1 : 0.4,
              cursor: filteredLogs.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            复制可见
          </button>
        </div>
      </div>

      {logQuery.trim().length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          搜索命中 {filteredLogs.length} 条
          {visibleErrorCount > 0 && ` · 其中错误 ${visibleErrorCount} 条`}
        </div>
      )}

      {/* 两栏布局 */}
      <div style={TWO_COLUMN}>
        {/* 左侧：日志列表 */}
        <div style={LEFT_PANEL}>
          <div style={{ ...LIST_CONTAINER, maxHeight: 480 }}>
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
                    {...rowInteractionProps({ isActive, restBackground: 'transparent' })}
                    style={{
                      ...LOG_ROW_BASE,
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
                          lineHeight: 1.4,
                        }}
                      >
                        {log.message}
                      </span>
                      <span
                        style={{
                          ...BADGE,
                          color: isError ? 'var(--danger)' : 'var(--accent)',
                          flexShrink: 0,
                          fontSize: 10,
                        }}
                      >
                        {log.level}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        fontSize: 11,
                        color: 'var(--fg-muted)',
                      }}
                    >
                      {ts && (
                        <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{ts}</span>
                      )}
                      {(log.requestId ?? log.source) && (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono, monospace)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: 90,
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
                  padding: '20px 12px',
                  textAlign: 'center',
                  fontSize: 12,
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
                    {...GHOST_INTERACTION}
                    style={{ ...BG, fontSize: 12, marginLeft: 4 }}
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
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              minHeight: 28,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>日志详情</span>
            {selectedLog && (
              <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                <button
                  type="button"
                  onClick={() => copyLogField('输入', selectedLog.input)}
                  {...GHOST_INTERACTION}
                  style={{ ...BG, fontSize: 11, border: '1px solid var(--border-default)' }}
                >
                  复制输入
                </button>
                <button
                  type="button"
                  onClick={() => copyLogField('输出', selectedLog.output)}
                  {...GHOST_INTERACTION}
                  style={{ ...BG, fontSize: 11, border: '1px solid var(--border-default)' }}
                >
                  复制输出
                </button>
              </div>
            )}
          </div>
          <LogDetailsPanel log={selectedLog} />
        </div>
      </div>
    </section>
  );
}
