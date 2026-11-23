import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import type { MemoryRevisionRecord } from '@openAwork/web-client';
import { BP, BS, IS } from '../shared/settings-section-styles.js';
import {
  REVISION_OPERATION_LABELS,
  REVISION_ORIGIN_LABELS,
  formatRelativeTime,
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
 * 展示变更前后快照；仅允许撤销最新变更，恢复该次变更前状态。
 * 回滚失败显示服务端原因，不伪造成功。
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
        setRevisions(next.toSorted((a, b) => b.revision - a.revision));
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
    void rollback(revisionId)
      .then(async (result) => {
        if (!result.ok) {
          setRollbackError(result.error ?? '回滚失败');
          return;
        }
        const next = await listRevisions(memoryId);
        setRevisions(next.toSorted((a, b) => b.revision - a.revision));
      })
      .catch((err: unknown) => {
        setRollbackError(err instanceof Error ? err.message : '回滚或刷新历史失败');
      })
      .finally(() => setRollingBackId(null));
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
            <details>
              <summary style={{ fontSize: 11 }}>查看变更前后快照</summary>
              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {`变更前：\n${revision.before === null ? '不存在（此操作创建了记忆）' : JSON.stringify(revision.before, null, 2)}\n变更后：\n${revision.after === null ? '不存在' : JSON.stringify(revision.after, null, 2)}`}
              </pre>
            </details>
            <div style={{ fontSize: 11, color: 'var(--fg-default)' }}>
              {revision.payload === null
                ? '回滚影响：撤销创建，停用并归档该记忆，不删除历史。'
                : `回滚影响：恢复变更前的「${revision.payload.key}」及其内容、优先级、作用域和启用状态，生成新版本。`}
            </div>
            {revision.id !== revisions[0]?.id && (
              <div style={MUTED}>仅可回滚最新变更；此记录之后已有修改。</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={{ ...BS, opacity: rollingBackId === revision.id ? 0.6 : 1 }}
                disabled={rollingBackId !== null || revision.id !== revisions[0]?.id}
                onClick={() => handleRollback(revision.id)}
                aria-label={`回滚版本 ${String(revision.revision)} 的变更`}
              >
                {rollingBackId === revision.id ? '回滚中…' : '回滚此次变更'}
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
