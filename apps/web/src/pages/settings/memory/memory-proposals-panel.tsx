import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import type {
  DecideProposalInput,
  MemoryProposal,
  MemoryProposalPayload,
  MemoryProposalRelation,
  MemoryRevisionRecord,
} from '@openAwork/web-client';
import { BP, BS, IS, SS, ST } from '../shared/settings-section-styles.js';
import {
  PROPOSAL_ACTION_LABELS,
  PROPOSAL_ORIGIN_LABELS,
  RELATION_KIND_LABELS,
  SCOPE_TYPE_LABELS,
  describeExpiry,
  describeProposalPayload,
  formatRelativeTime,
  getExpiryRisk,
  summarizeProposals,
} from './memory-proposal-presentation.js';
import { MemoryRevisionsPanel } from './memory-revisions-panel.js';
import type { MemoryActionFeedback } from './memory-types.js';

/** 面板所需的最小依赖契约，便于测试注入桩实现。 */
export interface MemoryProposalsPanelProps {
  proposals: MemoryProposal[];
  pendingCount: number;
  listStatus: 'idle' | 'loading' | 'loaded' | 'error';
  listError: string | null;
  feedback: MemoryActionFeedback;
  onClearFeedback: () => void;
  onRefresh: () => Promise<void>;
  decide: (
    proposalId: string,
    decision: DecideProposalInput,
  ) => Promise<{ ok: boolean; error?: string }>;
  listRevisions: (memoryId: string) => Promise<MemoryRevisionRecord[]>;
  rollback: (revisionId: string) => Promise<{ ok: boolean; error?: string }>;
}

const BADGE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 9999,
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

const CARD: CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-overlay) 94%, var(--bg-base))',
  padding: '12px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const BTN_GHOST: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--fg-default)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const BTN_DANGER: CSSProperties = {
  background: 'transparent',
  border: '1px solid color-mix(in srgb, var(--danger) 40%, var(--border-default))',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--danger)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const VALUE_BOX: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-strong)',
  margin: 0,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  padding: '8px 10px',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--bg-overlay) 75%, var(--bg-base))',
  border: '1px solid var(--border-subtle)',
};

const LINK_BTN: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--accent)',
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 600,
};

const LONG_VALUE_THRESHOLD = 160;

function ProposalValue({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > LONG_VALUE_THRESHOLD;
  const shown = isLong && !expanded ? `${value.slice(0, LONG_VALUE_THRESHOLD)}…` : value;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <pre style={VALUE_BOX}>{shown}</pre>
      {isLong && (
        <button
          type="button"
          style={LINK_BTN}
          onClick={() => setExpanded((prev) => !prev)}
          aria-label={expanded ? '收起完整内容' : '展开完整内容'}
        >
          {expanded ? '收起' : '展开完整内容'}
        </button>
      )}
    </div>
  );
}

function ScopeLine({ proposal }: { proposal: MemoryProposal }) {
  const scope = proposal.scope;
  const label = SCOPE_TYPE_LABELS[scope?.type ?? 'user'];
  const id = scope?.id ?? '';
  return (
    <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
      影响范围：{label}
      {id ? ` · ${id}` : ''}
    </span>
  );
}

function ExpiryLine({ proposal }: { proposal: MemoryProposal }) {
  const risk = getExpiryRisk(proposal.expiresAt);
  const color = risk === 'expired' || risk === 'soon' ? 'var(--danger)' : 'var(--fg-muted)';
  return (
    <span style={{ fontSize: 10, color }}>
      有效期：{formatRelativeTime(proposal.expiresAt)} · {describeExpiry(risk)}
    </span>
  );
}

function RelationRow({ relation }: { relation: MemoryProposalRelation }) {
  return (
    <div
      style={{
        borderRadius: 8,
        border:
          '1px solid color-mix(in srgb, var(--warning, var(--accent)) 30%, var(--border-default))',
        background: 'color-mix(in srgb, var(--accent) 5%, var(--bg-overlay))',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span
          style={{
            ...BADGE,
            color: 'var(--accent)',
            background: 'var(--accent-muted)',
          }}
        >
          与既有记忆{RELATION_KIND_LABELS[relation.kind]}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-strong)' }}>
          {relation.key}
        </span>
      </div>
      <pre style={{ ...VALUE_BOX, fontSize: 11 }}>{relation.value}</pre>
    </div>
  );
}

function ProposalCard({
  proposal,
  selected,
  onToggleSelected,
  decide,
  listRevisions,
  rollback,
}: {
  proposal: MemoryProposal;
  selected: boolean;
  onToggleSelected: (id: string, next: boolean) => void;
  decide: MemoryProposalsPanelProps['decide'];
  listRevisions: MemoryProposalsPanelProps['listRevisions'];
  rollback: MemoryProposalsPanelProps['rollback'];
}) {
  const [editing, setEditing] = useState(false);
  const [editKey, setEditKey] = useState(proposal.payload.key ?? proposal.payload.name ?? '');
  const [editValue, setEditValue] = useState(proposal.payload.value ?? proposal.payload.body ?? '');
  const [showRevisions, setShowRevisions] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const payload = describeProposalPayload(proposal.payload);
  const relations = proposal.relations ?? [];
  const hasConflict = relations.some((relation) => relation.kind === 'conflict');

  const runDecide = (decision: DecideProposalInput) => {
    setLocalError(null);
    void decide(proposal.id, decision).then((result) => {
      if (!result.ok) {
        setLocalError(result.error ?? '操作失败');
      }
    });
  };

  const submitEdited = () => {
    const editedPayload: MemoryProposalPayload = {
      ...proposal.payload,
      ...(proposal.action === 'rule'
        ? { name: editKey.trim(), body: editValue.trim() }
        : { key: editKey.trim(), value: editValue.trim() }),
    };
    runDecide({ decision: 'approve', payload: editedPayload });
  };

  return (
    <div style={CARD} role="article" aria-label={`待确认提议 ${proposal.id}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggleSelected(proposal.id, event.target.checked)}
          aria-label={`选择提议 ${payload.key}`}
        />
        <span style={{ ...BADGE, color: 'var(--accent)', background: 'var(--accent-muted)' }}>
          {PROPOSAL_ACTION_LABELS[proposal.action]}
        </span>
        <ScopeLine proposal={proposal} />
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginLeft: 'auto' }}>
          来源：{PROPOSAL_ORIGIN_LABELS[proposal.origin]} · 置信度{' '}
          {String(Math.round(proposal.confidence * 100))}%
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>当前记录</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
          {payload.key}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>问题或理由</span>
        <span style={{ fontSize: 12, color: 'var(--fg-default)' }}>{proposal.reason}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>修改结果</span>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="text"
              value={editKey}
              onChange={(event) => setEditKey(event.target.value)}
              style={IS}
              aria-label="编辑提议键"
            />
            <textarea
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              rows={4}
              style={{ ...IS, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              aria-label="编辑提议内容"
            />
          </div>
        ) : (
          <ProposalValue value={payload.value} />
        )}
      </div>

      <ExpiryLine proposal={proposal} />

      {relations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {relations.map((relation) => (
            <RelationRow key={`${relation.kind}-${relation.memoryId}`} relation={relation} />
          ))}
          {hasConflict && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={BP}
                onClick={() => runDecide({ decision: 'approve' })}
                aria-label="用新内容替代"
              >
                用新内容替代
              </button>
              <button
                type="button"
                style={BTN_GHOST}
                onClick={() =>
                  runDecide({
                    decision: 'approve',
                    note: `与既有记忆并存，适用条件：${payload.key}`,
                  })
                }
                aria-label="两者并存"
              >
                两者并存（会新增一条，不覆盖原记录）
              </button>
              <button
                type="button"
                style={BTN_GHOST}
                onClick={() => runDecide({ decision: 'reject', keepOriginal: true })}
                aria-label="暂不处理"
              >
                暂不处理
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={BP}
          onClick={() => runDecide({ decision: 'approve' })}
          aria-label="接受"
        >
          接受
        </button>
        <button
          type="button"
          style={BTN_GHOST}
          onClick={() => setEditing((prev) => !prev)}
          aria-label="修改后接受"
        >
          {editing ? '取消修改' : '修改后接受'}
        </button>
        {editing && (
          <button type="button" style={BP} onClick={submitEdited} aria-label="提交修改后的内容">
            提交修改后的内容
          </button>
        )}
        <button
          type="button"
          style={BTN_GHOST}
          onClick={() => runDecide({ decision: 'reject', keepOriginal: true })}
          aria-label="保留原状"
        >
          保留原状
        </button>
        <button
          type="button"
          style={BTN_DANGER}
          onClick={() => runDecide({ decision: 'reject' })}
          aria-label="拒绝"
        >
          拒绝
        </button>
        {proposal.targetMemoryId && (
          <button
            type="button"
            style={{ ...LINK_BTN, marginLeft: 'auto' }}
            onClick={() => setShowRevisions((prev) => !prev)}
            aria-label="查看历史版本"
          >
            {showRevisions ? '收起历史版本' : '查看历史版本'}
          </button>
        )}
      </div>

      {localError && (
        <div role="alert" style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>
          {localError}
        </div>
      )}

      {showRevisions && proposal.targetMemoryId && (
        <MemoryRevisionsPanel
          memoryId={proposal.targetMemoryId}
          listRevisions={listRevisions}
          rollback={rollback}
        />
      )}
    </div>
  );
}

export function MemoryProposalsPanel({
  proposals,
  pendingCount,
  listStatus,
  listError,
  feedback,
  onClearFeedback,
  onRefresh,
  decide,
  listRevisions,
  rollback,
}: MemoryProposalsPanelProps) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const toggleSelected = (id: string, next: boolean) => {
    setSelectedIds((previous) => {
      const copy = new Set(previous);
      if (next) {
        copy.add(id);
      } else {
        copy.delete(id);
      }
      return copy;
    });
  };

  const summary = useMemo(() => summarizeProposals(proposals), [proposals]);
  const selectedProposals = useMemo(
    () => proposals.filter((proposal) => selectedIds.has(proposal.id)),
    [proposals, selectedIds],
  );
  const batchEnabled = selectedProposals.length > 0;

  const runBatch = (decision: DecideProposalInput) => {
    for (const proposal of selectedProposals) {
      void decide(proposal.id, decision);
    }
    setSelectedIds(new Set());
  };

  const feedbackScheme =
    feedback.status === 'success'
      ? { bg: 'color-mix(in srgb, var(--success) 10%, var(--bg-overlay))', color: 'var(--success)' }
      : { bg: 'color-mix(in srgb, var(--danger) 10%, var(--bg-overlay))', color: 'var(--danger)' };

  return (
    <>
      <section style={SS}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ ...ST, margin: 0 }}>待确认记忆</h3>
          <span
            style={{
              ...BADGE,
              color: 'var(--accent)',
              background: 'var(--accent-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}
            aria-label={`待确认 ${String(pendingCount)} 条`}
          >
            {pendingCount}
          </span>
          <button
            type="button"
            style={{ ...BTN_GHOST, marginLeft: 'auto' }}
            onClick={() => void onRefresh()}
            aria-label="刷新待确认"
          >
            刷新
          </button>
        </div>

        {feedback.status !== 'idle' && feedback.message && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              borderRadius: 8,
              padding: '8px 12px',
              background:
                feedback.status === 'pending'
                  ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-overlay))'
                  : feedbackScheme.bg,
              color: feedback.status === 'pending' ? 'var(--accent)' : feedbackScheme.color,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={onClearFeedback}
              aria-label="关闭提示"
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
            >
              ×
            </button>
          </div>
        )}

        {listStatus === 'loading' && (
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>正在加载待确认提议…</div>
        )}
        {listStatus === 'error' && (
          <div role="alert" style={{ fontSize: 11, color: 'var(--danger)' }}>
            待确认提议加载失败：{listError ?? '未知错误'}
          </div>
        )}
        {listStatus === 'loaded' && proposals.length === 0 && (
          <div
            style={{
              borderRadius: 12,
              border: '1px dashed var(--border-emphasis)',
              padding: '28px 20px',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--fg-muted)',
            }}
          >
            暂无待确认
          </div>
        )}

        {proposals.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              style={{ ...BS, opacity: batchEnabled ? 1 : 0.5 }}
              disabled={!batchEnabled}
              onClick={() => runBatch({ decision: 'approve' })}
              aria-label="批量接受已勾选项"
            >
              接受已勾选（{selectedProposals.length}）
            </button>
            <button
              type="button"
              style={{ ...BTN_DANGER, opacity: batchEnabled ? 1 : 0.5 }}
              disabled={!batchEnabled}
              onClick={() => runBatch({ decision: 'reject' })}
              aria-label="批量拒绝已勾选项"
            >
              拒绝已勾选（{selectedProposals.length}）
            </button>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>需逐个勾选后才可批量操作</span>
          </div>
        )}

        {proposals.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                selected={selectedIds.has(proposal.id)}
                onToggleSelected={toggleSelected}
                decide={decide}
                listRevisions={listRevisions}
                rollback={rollback}
              />
            ))}
          </div>
        )}
      </section>

      <section style={SS}>
        <h3 style={ST}>整理报告</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
            待确认 {summary.pending} 条
          </span>
          <span style={{ fontSize: 12, color: 'var(--fg-default)' }}>
            其中重复 {summary.duplicates}
          </span>
          <span style={{ fontSize: 12, color: 'var(--fg-default)' }}>冲突 {summary.conflicts}</span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--fg-muted)', margin: 0, lineHeight: 1.6 }}>
          系统只提出建议，未修改任何正式记忆。只有在你逐条确认后，才会写入正式记忆。
        </p>
      </section>
    </>
  );
}
