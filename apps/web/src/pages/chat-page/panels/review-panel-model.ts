import {
  HttpError,
  type SessionFileChangesProjection,
  type SessionFileDiffEntry,
  type SessionFileReviewDecision,
} from '@openAwork/web-client';

export type ChangeScope = 'all' | 'current';
export type DiffViewMode = 'unified' | 'split';

export interface ReviewPanelReviewTarget {
  readonly filePath: string;
  readonly requestId: string;
}

export interface ReviewPanelConflictDetails {
  readonly count: number;
  readonly files: readonly string[];
}

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
  ReviewPanelErrorState | ReviewPanelLoadingState | ReviewPanelReadyState | ReviewPanelWaitingState;

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

export function formatReviewDecision(decision?: SessionFileReviewDecision): string {
  if (decision === 'accepted') return '已接受';
  if (decision === 'rejected') return '已拒绝';
  return '待审查';
}

export function getReviewPanelFileActionKey(file: SessionFileDiffEntry): string {
  return file.requestId ? `${file.requestId}\u0000${file.file}` : file.file;
}

export function isReviewPanelManualRevert(file: SessionFileDiffEntry): boolean {
  return file.sourceKind === 'manual_revert';
}

export function isReviewPanelFileActionable(file: SessionFileDiffEntry): boolean {
  return Boolean(file.requestId) && !file.reviewStatus && !isReviewPanelManualRevert(file);
}

export function selectReviewPanelReviewTarget(
  file: SessionFileDiffEntry,
): ReviewPanelReviewTarget | null {
  // manual_revert 记录的是用户自己的回滚，再次审查会反向重放为 Agent 变更。
  if (!file.requestId || isReviewPanelManualRevert(file)) {
    return null;
  }
  return { filePath: file.file, requestId: file.requestId };
}

export function selectReviewPanelPendingFiles(
  files: readonly SessionFileDiffEntry[],
): readonly SessionFileDiffEntry[] {
  return files.filter(isReviewPanelFileActionable);
}

export function getReviewPanelActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export function isReviewPanelConflictError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 409;
}

export function readReviewPanelConflictDetails(error: unknown): ReviewPanelConflictDetails | null {
  if (!isReviewPanelConflictError(error)) {
    return null;
  }
  const payload = (error as HttpError).data;
  if (!isRecord(payload) || !isRecord(payload.workspaceReview)) {
    return null;
  }
  const conflicts = payload.workspaceReview.conflicts;
  if (!Array.isArray(conflicts)) {
    return null;
  }
  const files: string[] = [];
  for (const conflict of conflicts) {
    if (
      isRecord(conflict) &&
      typeof conflict.filePath === 'string' &&
      conflict.filePath.length > 0
    ) {
      files.push(conflict.filePath);
    }
  }
  return { count: conflicts.length, files };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
