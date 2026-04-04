import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  createSessionsClient,
  HttpError,
  type SessionRestorePreviewResult,
  type SessionSnapshotComparisonResult,
  type SessionTurnDiffFileSummary,
  type SessionTurnDiffReadModel,
} from '@openAwork/web-client';
import { FileChangeReviewPanel } from '@openAwork/shared-ui';
import type { FileChange } from '@openAwork/shared-ui';
import { extractWorkingDirectory } from '../../utils/session-metadata.js';
import type { SessionRow } from './session-page-types.js';
import { statusBadgeBg, statusBadgeFg, statusLabel } from './session-page-utils.js';

const CARD_STYLE: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
};

const ACTION_BUTTON_STYLE: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 7,
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-2)',
  cursor: 'pointer',
};

const META_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  minHeight: 24,
  padding: '0 9px',
  borderRadius: 999,
  border: '1px solid var(--border-subtle)',
  background: 'color-mix(in oklch, var(--surface) 82%, var(--bg-2) 18%)',
  color: 'var(--text-2)',
  fontSize: 11,
  fontWeight: 600,
};

interface DetailPanelProps {
  selected: SessionRow;
  copiedId: boolean;
  onOpenChat: () => void;
  onPreloadChat: () => void;
  onExport: () => void;
  onCopyId: () => void;
  gatewayUrl: string;
  token: string;
  onRefreshSessions?: () => Promise<void> | void;
}

interface SnapshotAsyncState<T> {
  error: string | null;
  loading: boolean;
  result: T | null;
  snapshotRef: string | null;
}

interface ApplyState {
  message: string | null;
  snapshotRef: string | null;
  status: 'idle' | 'loading' | 'success' | 'error';
}

const INITIAL_COMPARISON_STATE: SnapshotAsyncState<SessionSnapshotComparisonResult> = {
  error: null,
  loading: false,
  result: null,
  snapshotRef: null,
};

const INITIAL_PREVIEW_STATE: SnapshotAsyncState<SessionRestorePreviewResult> = {
  error: null,
  loading: false,
  result: null,
  snapshotRef: null,
};

const INITIAL_APPLY_STATE: ApplyState = {
  message: null,
  snapshotRef: null,
  status: 'idle',
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRestorePreviewResult(value: unknown): value is SessionRestorePreviewResult {
  return (
    isObjectRecord(value) &&
    value['validateOnly'] === true &&
    (value['mode'] === 'snapshot' || value['mode'] === 'backup')
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof HttpError &&
    isObjectRecord(error.data) &&
    typeof error.data['error'] === 'string'
  ) {
    return error.data['error'];
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function formatScopeKind(scopeKind: string): string {
  if (scopeKind === 'request') return '请求';
  if (scopeKind === 'backup') return '备份';
  if (scopeKind === 'scope') return '范围';
  return '未知';
}

function formatSourceKind(sourceKind: string): string {
  if (sourceKind === 'structured_tool_diff') return '工具';
  if (sourceKind === 'workspace_reconcile') return '工作区';
  if (sourceKind === 'restore_replay') return '恢复';
  if (sourceKind === 'manual_revert') return '回退';
  if (sourceKind === 'session_snapshot') return '快照';
  return sourceKind;
}

function formatGuaranteeLevel(level?: string): string {
  if (level === 'strong') return '强保证';
  if (level === 'medium') return '中保证';
  if (level === 'weak') return '弱保证';
  return '未标注';
}

function formatFileStatus(status?: string): string {
  if (status === 'added') return '新增';
  if (status === 'deleted') return '删除';
  return '修改';
}

function compactSnapshotRef(snapshotRef: string): string {
  return snapshotRef.length > 18
    ? `${snapshotRef.slice(0, 10)}…${snapshotRef.slice(-5)}`
    : snapshotRef;
}

function formatSnapshotTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function renderTurnFiles(files: SessionTurnDiffFileSummary[]): string {
  return files
    .slice(0, 3)
    .map((file) => file.file)
    .join(' · ');
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <span style={META_PILL_STYLE}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </span>
  );
}

function InlineInfo({
  tone = 'neutral',
  text,
}: {
  tone?: 'neutral' | 'success' | 'error' | 'warning';
  text: string;
}) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'error'
        ? 'var(--danger)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--text-3)';

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid color-mix(in oklch, ${color} 28%, var(--border))`,
        background: `color-mix(in oklch, ${color} 8%, var(--surface))`,
        padding: '8px 10px',
        fontSize: 11,
        color: tone === 'neutral' ? 'var(--text-2)' : color,
        lineHeight: 1.6,
      }}
    >
      {text}
    </div>
  );
}

function ComparisonPanel({ comparison }: { comparison: SessionSnapshotComparisonResult }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SummaryPill label="对比起点" value={compactSnapshotRef(comparison.from.snapshotRef)} />
        <SummaryPill label="对比目标" value={compactSnapshotRef(comparison.to.snapshotRef)} />
        <SummaryPill
          label="变化文件"
          value={String(comparison.comparison.filter((item) => item.changed).length)}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {comparison.comparison.length === 0 ? (
          <InlineInfo text="与最新快照相比没有额外差异。" />
        ) : (
          comparison.comparison.slice(0, 8).map((entry) => (
            <div
              key={entry.file}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 10,
                background: 'color-mix(in oklch, var(--surface) 86%, var(--bg-2) 14%)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: 'var(--text)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={entry.file}
                >
                  {entry.file}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  {`${formatFileStatus(entry.fromStatus)} → ${formatFileStatus(entry.toStatus)}`}
                </span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: entry.changed ? 'var(--accent)' : 'var(--text-3)',
                  fontWeight: 700,
                }}
              >
                {entry.changed ? '有变化' : '无变化'}
              </span>
            </div>
          ))
        )}
        {comparison.comparison.length > 8 && (
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
            另有 {comparison.comparison.length - 8} 个文件差异未展开。
          </div>
        )}
      </div>
    </div>
  );
}

function RestorePreviewPanel({ preview }: { preview: SessionRestorePreviewResult }) {
  const previewItems = preview.mode === 'snapshot' ? preview.preview : [preview.preview];
  const conflictCount = preview.workspaceReview.available
    ? preview.workspaceReview.conflicts.length
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SummaryPill
          label="预览模式"
          value={preview.mode === 'snapshot' ? '快照恢复' : '备份恢复'}
        />
        <SummaryPill label="文件数" value={String(previewItems.length)} />
        <SummaryPill label="工作区冲突" value={String(conflictCount)} />
      </div>
      {preview.workspaceReview.available ? (
        <InlineInfo
          tone={conflictCount > 0 ? 'warning' : 'neutral'}
          text={
            conflictCount > 0
              ? `检测到 ${conflictCount} 个工作区冲突；再次点击“应用恢复”将按当前预览强制执行。`
              : `工作区检查完成，当前脏文件数 ${preview.workspaceReview.dirtyCount}。`
          }
        />
      ) : preview.workspaceReview.reason ? (
        <InlineInfo tone="warning" text={`工作区检查不可用：${preview.workspaceReview.reason}`} />
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {previewItems.slice(0, 8).map((item) => (
          <div
            key={item.diff.file}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 10,
              background: 'color-mix(in oklch, var(--surface) 86%, var(--bg-2) 14%)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={item.diff.file}
              >
                {item.diff.file}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                {`${formatFileStatus(item.diff.status)} · +${item.diff.additions} / -${item.diff.deletions}`}
              </span>
            </div>
            {'validPath' in item || 'hashValidation' in item ? (
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                {'validPath' in item && item.validPath === false ? '路径无效' : '可恢复'}
              </span>
            ) : null}
          </div>
        ))}
        {previewItems.length > 8 && (
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
            另有 {previewItems.length - 8} 个文件未展开。
          </div>
        )}
      </div>
    </div>
  );
}

export function DetailPanel({
  selected,
  copiedId,
  onOpenChat,
  onPreloadChat,
  onExport,
  onCopyId,
  gatewayUrl,
  token,
  onRefreshSessions,
}: DetailPanelProps) {
  const sessionsClient = useMemo(() => createSessionsClient(gatewayUrl), [gatewayUrl]);
  const selectedWorkingDirectory = useMemo(
    () => extractWorkingDirectory(selected.metadata_json),
    [selected.metadata_json],
  );
  const [reviewChanges, setReviewChanges] = useState<FileChange[]>([]);
  const [reviewDiff, setReviewDiff] = useState<Record<string, string>>({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [readModel, setReadModel] = useState<SessionTurnDiffReadModel | null>(null);
  const [readModelLoading, setReadModelLoading] = useState(false);
  const [readModelError, setReadModelError] = useState<string | null>(null);
  const [activeSnapshotRef, setActiveSnapshotRef] = useState<string | null>(null);
  const [comparisonState, setComparisonState] = useState(INITIAL_COMPARISON_STATE);
  const [previewState, setPreviewState] = useState(INITIAL_PREVIEW_STATE);
  const [applyState, setApplyState] = useState(INITIAL_APPLY_STATE);

  const loadReadModel = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) {
        setReadModel(null);
        return;
      }

      setReadModelLoading(true);
      setReadModelError(null);
      try {
        const data = await sessionsClient.getFileChangesReadModel(token, selected.id, { signal });
        setReadModel(data);
        setActiveSnapshotRef((previous) => {
          if (previous && data.turns.some((turn) => turn.snapshotRef === previous)) {
            return previous;
          }
          return data.sessionSummary.latestSnapshotRef ?? data.turns[0]?.snapshotRef ?? null;
        });
      } catch (error) {
        if (!isAbortError(error)) {
          setReadModel(null);
          setReadModelError(getErrorMessage(error, '加载会话文件快照失败'));
        }
      } finally {
        setReadModelLoading(false);
      }
    },
    [selected.id, sessionsClient, token],
  );

  const loadWorkspaceReview = useCallback(
    async (signal?: AbortSignal) => {
      if (!token || !selectedWorkingDirectory) {
        setReviewChanges([]);
        setReviewDiff({});
        setReviewError(null);
        return;
      }

      setReviewLoading(true);
      setReviewError(null);
      try {
        const response = await fetch(
          `${gatewayUrl}/workspace/review/status?path=${encodeURIComponent(selectedWorkingDirectory)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal,
          },
        );
        if (!response.ok) {
          throw new Error(`status:${response.status}`);
        }
        const data = (await response.json()) as { changes: FileChange[] };
        setReviewChanges(data.changes ?? []);
        setReviewDiff({});
      } catch (error) {
        if (!isAbortError(error)) {
          setReviewChanges([]);
          setReviewError('加载工作区改动失败');
        }
      } finally {
        setReviewLoading(false);
      }
    },
    [gatewayUrl, selectedWorkingDirectory, token],
  );

  useEffect(() => {
    setComparisonState(INITIAL_COMPARISON_STATE);
    setPreviewState(INITIAL_PREVIEW_STATE);
    setApplyState(INITIAL_APPLY_STATE);
  }, [selected.id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadReadModel(controller.signal);
    return () => controller.abort();
  }, [loadReadModel]);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorkspaceReview(controller.signal);
    return () => controller.abort();
  }, [loadWorkspaceReview]);

  const turns = readModel?.turns ?? [];
  const latestSnapshotRef = readModel?.sessionSummary.latestSnapshotRef ?? null;
  const activeTurn = useMemo(
    () => turns.find((turn) => turn.snapshotRef === activeSnapshotRef) ?? turns[0] ?? null,
    [activeSnapshotRef, turns],
  );
  const activeComparison =
    comparisonState.snapshotRef === activeTurn?.snapshotRef ? comparisonState.result : null;
  const activePreview =
    previewState.snapshotRef === activeTurn?.snapshotRef ? previewState.result : null;
  const hasPreviewConflicts =
    activePreview?.workspaceReview.available === true &&
    activePreview.workspaceReview.conflicts.length > 0;

  const handleCompareToLatest = useCallback(async () => {
    if (
      !token ||
      !activeTurn ||
      !latestSnapshotRef ||
      activeTurn.snapshotRef === latestSnapshotRef
    ) {
      return;
    }

    setComparisonState({
      error: null,
      loading: true,
      result: null,
      snapshotRef: activeTurn.snapshotRef,
    });
    try {
      const result = await sessionsClient.compareSnapshots(token, selected.id, {
        from: activeTurn.snapshotRef,
        to: latestSnapshotRef,
        includeText: true,
      });
      setComparisonState({
        error: null,
        loading: false,
        result,
        snapshotRef: activeTurn.snapshotRef,
      });
    } catch (error) {
      setComparisonState({
        error: getErrorMessage(error, '对比快照失败'),
        loading: false,
        result: null,
        snapshotRef: activeTurn.snapshotRef,
      });
    }
  }, [activeTurn, latestSnapshotRef, selected.id, sessionsClient, token]);

  const handlePreviewRestore = useCallback(async () => {
    if (!token || !activeTurn) {
      return;
    }

    setPreviewState({
      error: null,
      loading: true,
      result: null,
      snapshotRef: activeTurn.snapshotRef,
    });
    try {
      const result = await sessionsClient.previewRestore(token, selected.id, {
        snapshotRef: activeTurn.snapshotRef,
        includeText: true,
      });
      setPreviewState({ error: null, loading: false, result, snapshotRef: activeTurn.snapshotRef });
    } catch (error) {
      setPreviewState({
        error: getErrorMessage(error, '恢复预览失败'),
        loading: false,
        result: null,
        snapshotRef: activeTurn.snapshotRef,
      });
    }
  }, [activeTurn, selected.id, sessionsClient, token]);

  const handleApplyRestore = useCallback(async () => {
    if (!token || !activeTurn) {
      return;
    }

    setApplyState({ message: null, snapshotRef: activeTurn.snapshotRef, status: 'loading' });
    try {
      const result = await sessionsClient.applyRestore(token, selected.id, {
        snapshotRef: activeTurn.snapshotRef,
        includeText: true,
        forceConflicts: hasPreviewConflicts,
      });
      setApplyState({
        message: `恢复已应用：生成 ${result.clientRequestId}，共处理 ${result.fileCount} 个文件。`,
        snapshotRef: activeTurn.snapshotRef,
        status: 'success',
      });
      await Promise.all([
        loadReadModel(),
        loadWorkspaceReview(),
        Promise.resolve(onRefreshSessions?.()),
      ]);
    } catch (error) {
      if (error instanceof HttpError && isRestorePreviewResult(error.data)) {
        setPreviewState({
          error: null,
          loading: false,
          result: error.data,
          snapshotRef: activeTurn.snapshotRef,
        });
        setApplyState({
          message: '检测到工作区冲突，已载入恢复预览；再次点击“应用恢复”将按当前预览强制执行。',
          snapshotRef: activeTurn.snapshotRef,
          status: 'error',
        });
        return;
      }

      setApplyState({
        message: getErrorMessage(error, '恢复执行失败'),
        snapshotRef: activeTurn.snapshotRef,
        status: 'error',
      });
    }
  }, [
    activeTurn,
    hasPreviewConflicts,
    loadReadModel,
    loadWorkspaceReview,
    onRefreshSessions,
    selected.id,
    sessionsClient,
    token,
  ]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-2)',
      }}
    >
      <div
        style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginBottom: 6,
              }}
            >
              {selected.title ?? (
                <span style={{ color: 'var(--text-3)', fontFamily: 'monospace', fontSize: 14 }}>
                  {selected.id.slice(0, 8)}…
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 9px',
                  borderRadius: 99,
                  background: statusBadgeBg(selected.state_status),
                  color: statusBadgeFg(selected.state_status),
                  fontWeight: 600,
                }}
              >
                {statusLabel(selected.state_status)}
              </span>
              <SummaryPill
                label="更新时间"
                value={new Date(selected.updated_at).toLocaleString()}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenChat}
            onPointerEnter={onPreloadChat}
            onFocus={onPreloadChat}
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              border: 'none',
              borderRadius: 8,
              padding: '7px 18px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            打开对话
          </button>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            ...CARD_STYLE,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem 1.25rem',
            padding: '1rem 1.25rem',
          }}
        >
          <DetailField label="状态" value={statusLabel(selected.state_status)} />
          <DetailField label="更新时间" value={new Date(selected.updated_at).toLocaleString()} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              会话 ID
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'monospace' }}>
                {selected.id.slice(0, 8)}…
              </span>
              <button
                type="button"
                onClick={onCopyId}
                style={{ ...ACTION_BUTTON_STYLE, padding: '3px 8px' }}
              >
                {copiedId ? '已复制' : '复制'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" onClick={onExport} style={ACTION_BUTTON_STYLE}>
              导出会话
            </button>
          </div>
        </div>

        <section
          style={{
            ...CARD_STYLE,
            padding: '1rem 1.1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>
                会话文件快照
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                查看本会话记录下来的文件变更、对比旧快照与最新状态，并执行恢复预览或恢复。
              </div>
            </div>
            {readModel?.sessionSummary ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <SummaryPill label="快照" value={String(readModel.sessionSummary.snapshotCount)} />
                <SummaryPill label="回合" value={String(readModel.sessionSummary.turnCount)} />
                <SummaryPill label="文件" value={String(readModel.sessionSummary.totalFileDiffs)} />
                <SummaryPill
                  label="保证"
                  value={formatGuaranteeLevel(readModel.sessionSummary.weakestGuaranteeLevel)}
                />
              </div>
            ) : null}
          </div>

          {readModelLoading ? (
            <InlineInfo text="正在加载会话文件快照…" />
          ) : readModelError ? (
            <InlineInfo tone="error" text={readModelError} />
          ) : !readModel || turns.length === 0 ? (
            <InlineInfo text="当前会话还没有可比较或恢复的文件快照。" />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <SummaryPill label="新增" value={`+${readModel.sessionSummary.totalAdditions}`} />
                <SummaryPill label="删除" value={`-${readModel.sessionSummary.totalDeletions}`} />
                <SummaryPill
                  label="来源"
                  value={
                    readModel.sessionSummary.sourceKinds
                      .map((item) => formatSourceKind(item))
                      .join(' / ') || '无'
                  }
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {turns.map((turn) => {
                  const active = turn.snapshotRef === activeTurn?.snapshotRef;
                  const comparisonLoading =
                    comparisonState.loading && comparisonState.snapshotRef === turn.snapshotRef;
                  const previewLoading =
                    previewState.loading && previewState.snapshotRef === turn.snapshotRef;
                  const applyLoading =
                    applyState.status === 'loading' && applyState.snapshotRef === turn.snapshotRef;
                  const applyMessage =
                    applyState.snapshotRef === turn.snapshotRef ? applyState.message : null;
                  const applyTone =
                    applyState.status === 'success'
                      ? 'success'
                      : applyState.status === 'error'
                        ? 'warning'
                        : 'neutral';

                  return (
                    <div
                      key={turn.snapshotRef}
                      style={{
                        borderRadius: 12,
                        border: active
                          ? '1px solid var(--accent)'
                          : '1px solid var(--border-subtle)',
                        background: active
                          ? 'var(--accent-muted)'
                          : 'color-mix(in oklch, var(--surface) 90%, var(--bg-2) 10%)',
                        overflow: 'hidden',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveSnapshotRef(turn.snapshotRef)}
                        style={{
                          width: '100%',
                          padding: '10px 11px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          alignItems: 'stretch',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <SummaryPill label="时间" value={formatSnapshotTime(turn.createdAt)} />
                            <SummaryPill
                              label="范围"
                              value={formatScopeKind(turn.summary.scopeKind)}
                            />
                            {turn.snapshotRef === latestSnapshotRef ? (
                              <SummaryPill label="位置" value="最新" />
                            ) : null}
                          </div>
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--text-3)',
                              fontFamily: 'monospace',
                            }}
                          >
                            {compactSnapshotRef(turn.snapshotRef)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <SummaryPill label="文件" value={String(turn.summary.files)} />
                          <SummaryPill label="新增" value={`+${turn.summary.additions}`} />
                          <SummaryPill label="删除" value={`-${turn.summary.deletions}`} />
                          <SummaryPill
                            label="保证"
                            value={formatGuaranteeLevel(turn.summary.guaranteeLevel)}
                          />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                          {renderTurnFiles(turn.files) || '该回合暂无文件条目'}
                        </div>
                      </button>

                      {active ? (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            padding: '0 11px 11px',
                          }}
                        >
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => void handleCompareToLatest()}
                              disabled={turn.snapshotRef === latestSnapshotRef || comparisonLoading}
                              style={{
                                ...ACTION_BUTTON_STYLE,
                                opacity: turn.snapshotRef === latestSnapshotRef ? 0.55 : 1,
                              }}
                            >
                              {turn.snapshotRef === latestSnapshotRef
                                ? '已是最新快照'
                                : comparisonLoading
                                  ? '对比中…'
                                  : '与最新对比'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handlePreviewRestore()}
                              disabled={previewLoading}
                              style={ACTION_BUTTON_STYLE}
                            >
                              {previewLoading ? '预览中…' : '恢复预览'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleApplyRestore()}
                              disabled={applyLoading}
                              style={{
                                ...ACTION_BUTTON_STYLE,
                                borderColor: hasPreviewConflicts
                                  ? 'color-mix(in oklch, var(--warning) 38%, var(--border))'
                                  : 'var(--border)',
                                color: hasPreviewConflicts ? 'var(--warning)' : 'var(--text-2)',
                              }}
                            >
                              {applyLoading
                                ? '恢复中…'
                                : hasPreviewConflicts
                                  ? '应用恢复（强制）'
                                  : '应用恢复'}
                            </button>
                          </div>

                          {comparisonState.snapshotRef === turn.snapshotRef &&
                          comparisonState.error ? (
                            <InlineInfo tone="error" text={comparisonState.error} />
                          ) : null}
                          {previewState.snapshotRef === turn.snapshotRef && previewState.error ? (
                            <InlineInfo tone="error" text={previewState.error} />
                          ) : null}
                          {applyMessage ? (
                            <InlineInfo tone={applyTone} text={applyMessage} />
                          ) : null}
                          {activeComparison ? (
                            <ComparisonPanel comparison={activeComparison} />
                          ) : null}
                          {activePreview ? <RestorePreviewPanel preview={activePreview} /> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {selected.metadata_json && selectedWorkingDirectory ? (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reviewLoading ? (
              <InlineInfo text="正在加载工作区文件改动审阅…" />
            ) : reviewError ? (
              <InlineInfo tone="error" text={reviewError} />
            ) : reviewChanges.length > 0 ? (
              <FileChangeReviewPanel
                changes={reviewChanges}
                loadDiff={async (filePath: string) => {
                  const cached = reviewDiff[filePath];
                  if (cached !== undefined) return cached;
                  const response = await fetch(
                    `${gatewayUrl}/workspace/review/diff?path=${encodeURIComponent(selectedWorkingDirectory)}&filePath=${encodeURIComponent(filePath)}`,
                    { headers: { Authorization: `Bearer ${token}` } },
                  );
                  if (!response.ok) return '';
                  const data = (await response.json()) as { diff: string };
                  setReviewDiff((prev) => ({ ...prev, [filePath]: data.diff ?? '' }));
                  return data.diff ?? '';
                }}
                onAccept={(filePath: string) => {
                  setReviewChanges((prev) => prev.filter((change) => change.path !== filePath));
                }}
                onRevert={async (filePath: string) => {
                  const response = await fetch(`${gatewayUrl}/workspace/review/revert`, {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      path: selectedWorkingDirectory,
                      filePath,
                    }),
                  });
                  if (!response.ok) {
                    throw new Error('revert failed');
                  }
                  setReviewChanges((prev) => prev.filter((change) => change.path !== filePath));
                  setReviewDiff((prev) => {
                    const next = { ...prev };
                    delete next[filePath];
                    return next;
                  });
                }}
              />
            ) : (
              <InlineInfo text="当前工作区没有需要审阅的未提交改动。" />
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
