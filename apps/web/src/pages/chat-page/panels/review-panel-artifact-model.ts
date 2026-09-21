import type { ArtifactRecord } from '@openAwork/artifacts';
import { HttpError } from '@openAwork/web-client';

/** 审查面板的二级分区：文件变更（diff）与内容型产物（artifact）。 */
export type ReviewPanelSection = 'artifacts' | 'files';

export const REVIEW_PANEL_SECTION_OPTIONS: readonly {
  readonly label: string;
  readonly value: ReviewPanelSection;
}[] = [
  { value: 'files', label: '文件变更' },
  { value: 'artifacts', label: '产物' },
];

export interface ReviewPanelArtifactsReadyState {
  readonly kind: 'ready';
  readonly artifacts: readonly ArtifactRecord[];
}

export interface ReviewPanelArtifactsWaitingState {
  readonly kind: 'waiting';
  readonly message: string;
}

export interface ReviewPanelArtifactsLoadingState {
  readonly kind: 'loading';
}

export interface ReviewPanelArtifactsErrorState {
  readonly kind: 'error';
  readonly message: string;
}

export type ReviewPanelArtifactsState =
  | ReviewPanelArtifactsErrorState
  | ReviewPanelArtifactsLoadingState
  | ReviewPanelArtifactsReadyState
  | ReviewPanelArtifactsWaitingState;

/**
 * 列表条目未携带 `content` 时的补拉状态。
 *
 * 当前 TS 网关的 `GET /sessions/:id/artifacts` 返回完整 `content`，因此这条路径
 * 只在「列表被裁剪 / 替代实现」时兜底——不允许直接假设内容一定在列表里。
 */
export type ReviewPanelArtifactContentFallback =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly artifactId: string }
  | { readonly kind: 'ready'; readonly artifactId: string; readonly content: string }
  | { readonly kind: 'error'; readonly artifactId: string; readonly message: string };

export type ReviewPanelArtifactPreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly content: string };

/** 5xx / 无法判定状态的错误统一降级到这句，避免回显服务端文案与状态细节。 */
const REVIEW_PANEL_ARTIFACT_ERROR_FALLBACK = '产物加载失败，请稍后重试';

/** 只有可判定的 4xx 才允许把错误文案透出给用户（如「产物已被删除」）。 */
function isReadableClientError(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status >= 400 && error.status < 500;
}

export function getReviewPanelArtifactErrorMessage(error: unknown): string {
  if (isReadableClientError(error) && error.message.trim().length > 0) {
    return error.message;
  }

  console.error('[review-panel-artifacts] 加载产物失败', error);
  return REVIEW_PANEL_ARTIFACT_ERROR_FALLBACK;
}

/** 列表条目是否已自带可预览内容（当前网关为真；缺失时走补拉）。 */
export function hasInlineArtifactContent(artifact: ArtifactRecord | null): boolean {
  return artifact !== null && typeof artifact.content === 'string';
}

/** 选中 id 失效（产物被删除 / 切换会话）时回落到首个条目。 */
export function resolveSelectedArtifact(
  artifacts: readonly ArtifactRecord[] | null,
  selectedArtifactId: string | null,
): ArtifactRecord | null {
  if (!artifacts || artifacts.length === 0) {
    return null;
  }

  if (selectedArtifactId) {
    const matched = artifacts.find((artifact) => artifact.id === selectedArtifactId);
    if (matched) {
      return matched;
    }
  }

  return artifacts[0] ?? null;
}

export function resolveReviewPanelArtifactPreview(
  artifact: ArtifactRecord | null,
  fallback: ReviewPanelArtifactContentFallback,
): ReviewPanelArtifactPreviewState {
  if (!artifact) {
    return { kind: 'idle' };
  }

  if (typeof artifact.content === 'string') {
    return { kind: 'ready', content: artifact.content };
  }

  if (fallback.kind === 'ready' && fallback.artifactId === artifact.id) {
    return { kind: 'ready', content: fallback.content };
  }

  if (fallback.kind === 'error' && fallback.artifactId === artifact.id) {
    return { kind: 'error', message: fallback.message };
  }

  return { kind: 'loading' };
}

export function formatReviewPanelArtifactsStatus(state: ReviewPanelArtifactsState): string {
  if (state.kind === 'waiting') {
    return state.message;
  }

  if (state.kind === 'error') {
    return state.message;
  }

  if (state.kind === 'loading') {
    return '正在加载产物';
  }

  return `${state.artifacts.length} 个产物`;
}

/** 分区切换按钮文案：计数未知（未加载 / 等待上下文）时不渲染括号数字。 */
export function formatReviewPanelSectionLabel(label: string, count: number | null): string {
  return count === null ? label : `${label} (${count})`;
}

export function buildReviewPanelArtifactsWorkspaceHref(sessionId: string | null): string | null {
  if (!sessionId) {
    return null;
  }
  return `/artifacts?sessionId=${encodeURIComponent(sessionId)}`;
}
