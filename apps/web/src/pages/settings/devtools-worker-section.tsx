import React from 'react';
import { WorkerStatusIndicator, type WorkerEntry } from '@openAwork/shared-ui';
import type { DevtoolsSourceState } from '../settings-types.js';
import {
  InlineFailureNotice,
  buildWorkerKey,
  WorkerDetailsPanel,
} from './devtools-workbench-primitives.js';
import { SS, ST, UV } from './settings-section-styles.js';

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
      <h3 style={ST}>Worker 状态</h3>
      {sourceState.status === 'error' && sourceState.error ? (
        <InlineFailureNotice title="Worker 状态加载失败" message={sourceState.error} />
      ) : null}
      <div style={UV}>
        <WorkerStatusIndicator workers={workers} />
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--surface) 90%, var(--bg))',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Worker 工作台</div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 11,
              color: 'var(--text-3)',
            }}
          >
            <span>全部 Worker：{workers.length}</span>
            <span>当前可见：{filteredWorkers.length}</span>
            <span>错误 Worker：{errorCount}</span>
            {selectedWorker ? <span>当前 Worker：{selectedWorker.name}</span> : null}
            <span style={{ color: 'var(--accent)' }} aria-live="polite" aria-atomic="true">
              {copiedWorkerAction ?? ''}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="search"
            value={workerQuery}
            onChange={(event) => setWorkerQuery(event.target.value)}
            aria-label="搜索 Worker"
            name="worker-query"
            autoComplete="off"
            placeholder="搜索 Worker 名称 / id / endpoint…"
            style={{
              minWidth: 220,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px 10px',
              color: 'var(--text)',
              fontSize: 11,
            }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setWorkerStatusFilter('all')}
          style={{
            borderRadius: 8,
            border: '1px solid var(--border)',
            padding: '5px 10px',
            background:
              workerStatusFilter === 'all'
                ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))'
                : 'var(--surface)',
            color: 'var(--text)',
            fontSize: 11,
            fontWeight: workerStatusFilter === 'all' ? 700 : 400,
            cursor: 'pointer',
          }}
        >
          全部 {filteredWorkers.length}
        </button>
        <button
          type="button"
          onClick={() => setWorkerStatusFilter('error')}
          style={{
            borderRadius: 8,
            border:
              workerStatusFilter === 'error'
                ? '1px solid color-mix(in srgb, var(--danger) 40%, var(--border))'
                : '1px solid var(--border)',
            padding: '5px 10px',
            background:
              workerStatusFilter === 'error'
                ? 'color-mix(in srgb, var(--danger) 12%, var(--surface))'
                : 'var(--surface)',
            color: workerStatusFilter === 'error' ? 'var(--danger)' : 'var(--text)',
            fontSize: 11,
            fontWeight: workerStatusFilter === 'error' ? 700 : 400,
            cursor: 'pointer',
          }}
        >
          错误 {errorCount}
        </button>
        <button
          type="button"
          onClick={() => setWorkerStatusFilter('healthy')}
          style={{
            borderRadius: 8,
            border:
              workerStatusFilter === 'healthy'
                ? '1px solid color-mix(in srgb, var(--accent) 40%, var(--border))'
                : '1px solid var(--border)',
            padding: '5px 10px',
            background:
              workerStatusFilter === 'healthy'
                ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))'
                : 'var(--surface)',
            color: workerStatusFilter === 'healthy' ? 'var(--accent)' : 'var(--text)',
            fontSize: 11,
            fontWeight: workerStatusFilter === 'healthy' ? 700 : 400,
            cursor: 'pointer',
          }}
        >
          健康 {healthyCount}
        </button>
        <button
          type="button"
          onClick={onCopySelectedWorker}
          disabled={!selectedWorker}
          style={{
            borderRadius: 8,
            border: selectedWorker ? '1px solid var(--accent)' : '1px solid var(--border)',
            padding: '5px 10px',
            background: selectedWorker ? 'var(--accent)' : 'var(--surface)',
            color: selectedWorker ? 'var(--accent-text)' : 'var(--text)',
            fontSize: 11,
            fontWeight: selectedWorker ? 700 : 400,
            cursor: selectedWorker ? 'pointer' : 'not-allowed',
            opacity: selectedWorker ? 1 : 0.45,
          }}
        >
          复制当前 Worker
        </button>
        <button
          type="button"
          onClick={onCopyVisibleWorkers}
          disabled={filteredWorkers.length === 0}
          style={{
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--accent) 28%, var(--border))',
            padding: '5px 10px',
            background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
            color: 'var(--text)',
            fontSize: 11,
            cursor: filteredWorkers.length > 0 ? 'pointer' : 'not-allowed',
            opacity: filteredWorkers.length > 0 ? 1 : 0.45,
          }}
        >
          复制可见 Worker
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10,
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
                  borderRadius: 8,
                  border: isError
                    ? '2px solid var(--danger)'
                    : `1px solid ${
                        isActive
                          ? 'color-mix(in srgb, var(--accent) 40%, var(--border))'
                          : 'var(--border)'
                      }`,
                  background: isError
                    ? 'color-mix(in srgb, var(--danger) 7%, var(--surface))'
                    : isActive
                      ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))'
                      : 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
                  color: 'var(--text)',
                  padding: '7px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: isError ? 'var(--danger)' : 'var(--text)',
                  }}
                >
                  {worker.name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>
                  {worker.endpoint ?? worker.id}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: isError ? 'var(--danger)' : 'var(--accent)',
                  }}
                >
                  {isError ? '⚠ ' : ''}
                  {worker.status}
                </span>
              </button>
            );
          })
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-3)', gridColumn: '1 / -1' }}>
            筛选后没有匹配 Worker。
          </p>
        )}
      </div>
      <WorkerDetailsPanel worker={selectedWorker} />
    </section>
  );
}
