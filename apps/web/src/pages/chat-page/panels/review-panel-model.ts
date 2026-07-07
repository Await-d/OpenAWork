import type { SessionFileChangesProjection, SessionFileDiffEntry } from '@openAwork/web-client';

export type ChangeScope = 'all' | 'current';
export type DiffViewMode = 'unified' | 'split';

export const CHANGE_SCOPE_OPTIONS: readonly {
  readonly label: string;
  readonly value: ChangeScope;
}[] = [
  { value: 'all', label: '全部' },
  { value: 'current', label: '当前' },
];

export const DIFF_VIEW_MODE_OPTIONS: readonly {
  readonly label: string;
  readonly value: DiffViewMode;
}[] = [
  { value: 'unified', label: '统一' },
  { value: 'split', label: '分割' },
];

export interface ReviewPanelReadyState {
  readonly kind: 'ready';
  readonly projection: SessionFileChangesProjection;
}

export interface ReviewPanelWaitingState {
  readonly kind: 'waiting';
  readonly message: string;
}

export interface ReviewPanelLoadingState {
  readonly kind: 'loading';
}

export interface ReviewPanelErrorState {
  readonly kind: 'error';
  readonly message: string;
}

export type ReviewPanelContentState =
  | ReviewPanelErrorState
  | ReviewPanelLoadingState
  | ReviewPanelReadyState
  | ReviewPanelWaitingState;

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function getReviewPanelErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '加载文件变更失败';
}

export function selectReviewPanelFiles(
  projection: SessionFileChangesProjection,
  scope: ChangeScope,
): readonly SessionFileDiffEntry[] {
  if (scope === 'all') {
    return projection.fileDiffs;
  }

  const latestRequestSnapshot = projection.snapshots.find(
    (snapshot) => snapshot.scopeKind === 'request' && snapshot.files && snapshot.files.length > 0,
  );
  return latestRequestSnapshot?.files ?? projection.fileDiffs;
}

function resolveScopedGuarantee(files: readonly SessionFileDiffEntry[]): string | undefined {
  if (files.some((file) => file.guaranteeLevel === 'weak')) {
    return 'weak';
  }

  if (files.some((file) => file.guaranteeLevel === 'medium')) {
    return 'medium';
  }

  if (files.some((file) => file.guaranteeLevel === 'strong')) {
    return 'strong';
  }

  return undefined;
}

export function formatReviewPanelStatus(
  contentState: ReviewPanelContentState,
  changeScope: ChangeScope,
): string {
  if (contentState.kind === 'waiting') {
    return contentState.message;
  }

  if (contentState.kind === 'error') {
    return contentState.message;
  }

  if (contentState.kind === 'loading') {
    return '正在加载文件变更';
  }

  const files = selectReviewPanelFiles(contentState.projection, changeScope);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const guarantee = formatGuaranteeLevel(resolveScopedGuarantee(files));

  return `${files.length} 文件 · +${additions} / -${deletions} · ${guarantee}`;
}

export function formatSourceKind(sourceKind?: string): string {
  if (sourceKind === 'structured_tool_diff') return '结构化工具';
  if (sourceKind === 'session_snapshot') return '会话快照';
  if (sourceKind === 'restore_replay') return '恢复回放';
  if (sourceKind === 'workspace_reconcile') return '工作区校准';
  if (sourceKind === 'manual_revert') return '手动回滚';
  return sourceKind ?? '未知来源';
}

export function formatGuaranteeLevel(level?: string): string {
  if (level === 'strong') return '强保证';
  if (level === 'medium') return '中保证';
  if (level === 'weak') return '弱保证';
  return '未标注';
}

export function formatFileStatus(status?: string): string {
  if (status === 'added') return '新增';
  if (status === 'deleted') return '删除';
  return '修改';
}
