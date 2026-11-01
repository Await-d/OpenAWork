import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import type { MemoryRevisionRecord } from '@openAwork/web-client';
import { BP, BS, IS } from '../shared/settings-section-styles.js';
import {
  REVISION_OPERATION_LABELS,
  REVISION_ORIGIN_LABELS,
  formatRelativeTime,
  sortRevisionsDescending,
} from './memory-proposal-presentation.js';

const REVISION_ROW: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

const MUTED: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  fontVariantNumeric: 'tabular-nums',
};

export interface MemoryRevisionsPanelProps {
  memoryId: string;
  /** 只读：拉取该记忆的历史版本。 */
  listRevisions: (memoryId: string) => Promise<MemoryRevisionRecord[]>;
  rollback: (revisionId: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * 单条记忆的历史版本列表（可展开），提供「回滚到此版本」。
 * 回滚失败显示冲突提示（来自服务端 409 文案），不伪造成功。
 */
export function MemoryRevisionsPanel({
  memoryId,
  listRevisions,
  rollback,
}: MemoryRevisionsPanelProps) {
  const [revisions, setRevisions] = useState<MemoryRevisionRecord[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    void listRevisions(memoryId)
      .then((next) => {
        if (cancelled) {
          return;
        }
        setRevisions(sortRevisionsDescending(next));
        setStatus('loaded');
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : '加载历史版本失败');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [listRevisions, memoryId]);

  const handleRollback = (revisionId: string) => {
    setRollingBackId(revisionId);
    setRollbackError(null);
    void rollback(revisionId).then((result) => {
      setRollingBackId(null);
      if (!result.ok) {
        setRollbackError(result.error ?? '回滚失败');
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="记忆历史版本">
      {status === 'loading' && <div style={IS}>正在加载历史版本…</div>}
      {status === 'error' && error && (
        <div
          role="alert"
          style={{
            fontSize: 11,
            color: 'var(--danger)',
            border: '1px solid color-mix(in srgb, var(--danger) 42%, var(--border-default))',
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          历史版本加载失败：{error}
        </div>
      )}
      {status === 'loaded' && revisions.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>暂无历史版本</div>
      )}
      {rollbackError && (
        <div role="alert" style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>
          回滚失败：{rollbackError}
        </div>
      )}
      {status === 'loaded' &&
        revisions.map((revision) => (
          <div key={revision.id} style={REVISION_ROW}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
                版本 {revision.revision}
              </span>
              <span style={MUTED}>{REVISION_OPERATION_LABELS[revision.operation]}</span>
              <span style={MUTED}>来源：{REVISION_ORIGIN_LABELS[revision.origin]}</span>
              <span style={{ ...MUTED, marginLeft: 'auto' }}>
                {formatRelativeTime(revision.createdAt)}
              </span>
            </div>
            {revision.payload.value && (
              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: 'var(--fg-default)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 120,
                  overflowY: 'auto',
                }}
              >
                {revision.payload.value}
              </pre>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={{ ...BS, opacity: rollingBackId === revision.id ? 0.6 : 1 }}
                disabled={rollingBackId === revision.id}
                onClick={() => handleRollback(revision.id)}
                aria-label={`回滚到版本 ${String(revision.revision)}`}
              >
                {rollingBackId === revision.id ? '回滚中…' : '回滚到此版本'}
              </button>
            </div>
          </div>
        ))}
      {status === 'loaded' && revisions.length > 0 && (
        <button
          type="button"
          style={{ ...BP, alignSelf: 'flex-start' }}
          onClick={() => setStatus('idle')}
        >
          收起
        </button>
      )}
    </div>
  );
}
