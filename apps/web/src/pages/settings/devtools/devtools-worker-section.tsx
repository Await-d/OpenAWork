import React from 'react';
import { WorkerStatusIndicator, type WorkerEntry } from '@openAwork/shared-ui';
import type { DevtoolsSourceState } from '../state/settings-types.js';
import {
  InlineFailureNotice,
  buildWorkerKey,
  WorkerDetailsPanel,
} from './devtools-workbench-primitives.js';
import { SS, ST, UV, BADGE, BS, BG } from '../shared/settings-section-styles.js';

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
  const healthyCount = filteredWorkers.filter((w) => w.status !== 'error').length;

  const statusFilteredWorkers = React.useMemo(() => {
    if (workerStatusFilter === 'error') return filteredWorkers.filter((w) => w.status === 'error');
    if (workerStatusFilter === 'healthy')
      return filteredWorkers.filter((w) => w.status !== 'error');
    return filteredWorkers;
  }, [filteredWorkers, workerStatusFilter]);

  return (
    <section style={SS}>
      {/* 标题和统计 */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}
      >
        <h3 style={ST}>Worker 状态</h3>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          共 {workers.length} · 错误 {errorCount}
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
          gap: 4,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 搜索框 */}
          <input
            type="search"
            value={workerQuery}
            onChange={(event) => setWorkerQuery(event.target.value)}
            aria-label="搜索 Worker"
            name="worker-query"
            autoComplete="off"
            placeholder="搜索..."
            style={{
              minWidth: 100,
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 2,
              padding: '2px 6px',
              color: 'var(--fg-strong)',
              fontSize: 11,
              outline: 'none',
            }}
          />

          {/* 状态过滤 */}
          <div style={{ display: 'flex', gap: 1 }}>
            <button
              type="button"
              onClick={() => setWorkerStatusFilter('all')}
              style={{
                ...BG,
                color: workerStatusFilter === 'all' ? 'var(--accent)' : 'var(--fg-muted)',
              }}
            >
              全部 {filteredWorkers.length}
            </button>
            <button
              type="button"
              onClick={() => setWorkerStatusFilter('error')}
              style={{
                ...BG,
                color: workerStatusFilter === 'error' ? 'var(--danger)' : 'var(--fg-muted)',
              }}
            >
              错误 {errorCount}
            </button>
            <button
              type="button"
              onClick={() => setWorkerStatusFilter('healthy')}
              style={{
                ...BG,
                color: workerStatusFilter === 'healthy' ? 'var(--accent)' : 'var(--fg-muted)',
              }}
            >
              健康 {healthyCount}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--accent)' }} aria-live="polite">
            {copiedWorkerAction ?? ''}
          </span>
          <button
            type="button"
            onClick={onCopySelectedWorker}
            disabled={!selectedWorker}
            style={{
              ...BS,
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
            style={{
              ...BS,
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
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 3,
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
                style={{
                  borderRadius: 2,
                  border: `1px solid ${isError ? 'var(--danger)' : isActive ? 'var(--accent)' : 'var(--border-subtle)'}`,
                  background: isError
                    ? 'color-mix(in srgb, var(--danger) 5%, transparent)'
                    : isActive
                      ? 'color-mix(in srgb, var(--accent) 5%, transparent)'
                      : 'transparent',
                  color: 'var(--fg-strong)',
                  padding: '4px 6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: isError ? 500 : 400,
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
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {worker.endpoint ?? worker.id}
                </span>
                <span style={{ fontSize: 10, color: isError ? 'var(--danger)' : 'var(--accent)' }}>
                  {isError ? '⚠ ' : ''}
                  {worker.status}
                </span>
              </button>
            );
          })
        ) : (
          <div
            style={{
              borderRadius: 2,
              border: '1px dashed var(--border-subtle)',
              padding: '8px 6px',
              textAlign: 'center',
              gridColumn: '1 / -1',
              fontSize: 11,
              color: 'var(--fg-muted)',
            }}
          >
            {workers.length > 0 ? '筛选后没有匹配 Worker。' : '暂无 Worker 配置。'}
            {workers.length > 0 && workerQuery && (
              <button
                type="button"
                onClick={() => setWorkerQuery('')}
                style={{ ...BG, fontSize: 11, marginLeft: 4 }}
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
