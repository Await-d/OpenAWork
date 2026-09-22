import React from 'react';
import { WorkerStatusIndicator, type WorkerEntry } from '@openAwork/shared-ui';
import type { DevtoolsSourceState } from '../state/settings-types.js';
import {
  InlineFailureNotice,
  buildWorkerKey,
  rowInteractionProps,
  subtleButtonInteractionProps,
  WorkerDetailsPanel,
} from './devtools-workbench-primitives.js';
import { SS, ST, UV, BADGE, BG, BS, SEARCH_INPUT } from '../shared/settings-section-styles.js';

type WorkerStatusFilter = 'all' | 'error' | 'healthy';

interface DevtoolsWorkerSectionProps {
  copiedWorkerAction: string | null;
  filteredWorkers: WorkerEntry[];
  onCopySelectedWorker: () => void;
  onCopyVisibleWorkers: () => void;
  onSelectWorker: (key: string) => void;
  selectedWorker: WorkerEntry | null;
  selectedWorkerKey: string | null;
  setWorkerQuery: (value: string) => void;
  sourceState: DevtoolsSourceState;
  workerQuery: string;
  workers: WorkerEntry[];
}

const FILTER_OPTIONS: Array<{ value: WorkerStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'error', label: '异常' },
  { value: 'healthy', label: '正常' },
];

const GHOST_INTERACTION = subtleButtonInteractionProps();

export function DevtoolsWorkerSection({
  copiedWorkerAction,
  filteredWorkers,
  onCopySelectedWorker,
  onCopyVisibleWorkers,
  onSelectWorker,
  selectedWorker,
  selectedWorkerKey,
  setWorkerQuery,
  sourceState,
  workerQuery,
  workers,
}: DevtoolsWorkerSectionProps) {
  const [workerStatusFilter, setWorkerStatusFilter] = React.useState<WorkerStatusFilter>('all');

  const errorCount = filteredWorkers.filter((w) => w.status === 'error').length;
  const healthyCount = filteredWorkers.length - errorCount;

  const statusFilteredWorkers = React.useMemo(() => {
    if (workerStatusFilter === 'error') return filteredWorkers.filter((w) => w.status === 'error');
    if (workerStatusFilter === 'healthy')
      return filteredWorkers.filter((w) => w.status !== 'error');
    return filteredWorkers;
  }, [filteredWorkers, workerStatusFilter]);

  const filterCounts: Record<WorkerStatusFilter, number> = {
    all: filteredWorkers.length,
    error: errorCount,
    healthy: healthyCount,
  };

  return (
    <section style={SS}>
      {/* 标题和统计 */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
      >
        <h3 style={{ ...ST, marginBottom: 0 }}>Worker 状态</h3>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          共 {workers.length} 个 · 异常 {errorCount} 个
        </span>
      </div>

      {sourceState.status === 'error' && sourceState.error && (
        <InlineFailureNotice title="Worker 状态加载失败" message={sourceState.error} />
      )}

      {/* Worker 状态指示器 */}
      <div style={UV}>
        <WorkerStatusIndicator workers={workers} />
      </div>

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
            value={workerQuery}
            onChange={(event) => setWorkerQuery(event.target.value)}
            aria-label="搜索 Worker"
            name="worker-query"
            autoComplete="off"
            placeholder="搜索 Worker…"
            style={{
              ...SEARCH_INPUT,
              flex: '0 1 200px',
              border: `1px solid ${workerQuery ? 'var(--accent)' : 'var(--border-default)'}`,
            }}
          />

          <div style={{ display: 'flex', gap: 6 }}>
            {FILTER_OPTIONS.map((option) => {
              const selected = workerStatusFilter === option.value;
              const isErrorOption = option.value === 'error';
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setWorkerStatusFilter(option.value)}
                  aria-pressed={selected}
                  {...GHOST_INTERACTION}
                  style={{
                    ...BG,
                    fontSize: 12,
                    border: `1px solid ${selected ? 'var(--border-emphasis)' : 'transparent'}`,
                    background: selected ? 'var(--bg-hover)' : 'transparent',
                    color: selected
                      ? isErrorOption && filterCounts.error > 0
                        ? 'var(--danger)'
                        : 'var(--accent)'
                      : 'var(--fg-muted)',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {option.label} {filterCounts[option.value]}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--accent)' }} aria-live="polite">
            {copiedWorkerAction ?? ''}
          </span>
          <button
            type="button"
            onClick={onCopySelectedWorker}
            disabled={!selectedWorker}
            {...GHOST_INTERACTION}
            style={{
              ...BS,
              fontSize: 12,
              opacity: selectedWorker ? 1 : 0.4,
              cursor: selectedWorker ? 'pointer' : 'not-allowed',
            }}
          >
            复制当前
          </button>
          <button
            type="button"
            onClick={onCopyVisibleWorkers}
            disabled={filteredWorkers.length === 0}
            {...GHOST_INTERACTION}
            style={{
              ...BS,
              fontSize: 12,
              opacity: filteredWorkers.length > 0 ? 1 : 0.4,
              cursor: filteredWorkers.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            复制可见
          </button>
        </div>
      </div>

      {/* Worker 列表 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 8,
        }}
      >
        {statusFilteredWorkers.length > 0 ? (
          statusFilteredWorkers.map((worker) => {
            const key = buildWorkerKey(worker);
            const isError = worker.status === 'error';
            const isActive =
              selectedWorkerKey === key ||
              (!selectedWorkerKey && statusFilteredWorkers[0]?.id === worker.id);

            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectWorker(key)}
                {...rowInteractionProps({
                  isActive,
                  restBackground: 'var(--bg-overlay)',
                })}
                style={{
                  borderRadius: 8,
                  border: isError
                    ? '1px solid var(--danger-border)'
                    : isActive
                      ? '1px solid var(--border-default)'
                      : '1px solid var(--border-subtle)',
                  background: isActive ? 'var(--bg-raised)' : 'var(--bg-overlay)',
                  boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                  color: 'var(--fg-strong)',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                  textAlign: 'left',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: isError ? 'var(--danger)' : 'var(--fg-strong)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {worker.name}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                    fontFamily: 'var(--font-mono, monospace)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {worker.endpoint ?? worker.id}
                </span>
                <span
                  style={{
                    ...BADGE,
                    alignSelf: 'flex-start',
                    color: isError ? 'var(--danger)' : 'var(--accent)',
                    background: isError ? 'var(--danger-muted)' : 'var(--accent-subtle)',
                  }}
                >
                  {worker.status}
                </span>
              </button>
            );
          })
        ) : (
          <div
            style={{
              borderRadius: 8,
              border: '1px dashed var(--border-default)',
              padding: '20px 12px',
              textAlign: 'center',
              gridColumn: '1 / -1',
              fontSize: 12,
              color: 'var(--fg-muted)',
            }}
          >
            {workers.length > 0 ? '筛选后没有匹配 Worker。' : '暂无 Worker 配置。'}
            {workers.length > 0 && workerQuery && (
              <button
                type="button"
                onClick={() => setWorkerQuery('')}
                {...GHOST_INTERACTION}
                style={{ ...BG, fontSize: 12, marginLeft: 4 }}
              >
                清空搜索
              </button>
            )}
          </div>
        )}
      </div>

      {/* Worker 详情 */}
      <WorkerDetailsPanel worker={selectedWorker} />
    </section>
  );
}
