import { useState } from 'react';
import type { ArtifactRecord } from '@openAwork/artifacts';
import { Link } from 'react-router';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import { copyTextToClipboard } from '../../../components/layout/file-tree/file-tree-actions.js';
import {
  buildArtifactImageGallery,
  type ArtifactImageGallery,
} from '../../artifacts/views/artifact-image-gallery.js';
import { ArtifactPreviewSurface } from '../../artifacts/views/artifact-preview-surface.js';
import {
  buildArtifactVirtualPath,
  canPreviewArtifact,
  formatArtifactTimestamp,
  formatArtifactTypeLabel,
} from '../../artifacts/workspace/artifact-workbench-utils.js';
import {
  buildReviewPanelArtifactsWorkspaceHref,
  type ReviewPanelArtifactsState,
  type ReviewPanelArtifactPreviewState,
} from './review-panel-artifact-model.js';
import { ReviewPanelEmptyState } from './ReviewPanelEmptyState.js';
import './ReviewPanelArtifactSection.css';

export interface ReviewPanelArtifactSectionProps {
  readonly artifactsState: ReviewPanelArtifactsState;
  readonly onReload: () => void;
  readonly onSelectArtifact: (artifactId: string) => void;
  readonly preview: ReviewPanelArtifactPreviewState;
  readonly selectedArtifact: ArtifactRecord | null;
  readonly sessionId: string | null;
}

export function ReviewPanelArtifactSection({
  artifactsState,
  onReload,
  onSelectArtifact,
  preview,
  selectedArtifact,
  sessionId,
}: ReviewPanelArtifactSectionProps) {
  if (artifactsState.kind !== 'ready') {
    return (
      <div className="review-panel-artifact-status">
        <ReviewPanelEmptyState>
          {artifactsState.kind === 'loading' ? '正在加载产物...' : artifactsState.message}
        </ReviewPanelEmptyState>
        {artifactsState.kind === 'error' ? (
          <button type="button" className="review-panel-artifact-status__retry" onClick={onReload}>
            重试
          </button>
        ) : null}
      </div>
    );
  }

  const workspaceHref = buildReviewPanelArtifactsWorkspaceHref(sessionId);
  const imageGallery = buildArtifactImageGallery(
    artifactsState.artifacts,
    selectedArtifact,
    onSelectArtifact,
  );

  return (
    <div className="review-panel-artifact-split">
      <section aria-label="产物列表" className="review-panel-artifact-list">
        <div className="review-panel-artifact-list__header">
          <span className="review-panel-artifact-list__title">产物</span>
          {workspaceHref ? (
            <Link className="review-panel-artifact-list__workspace-link" to={workspaceHref}>
              打开工作区
            </Link>
          ) : null}
        </div>
        {artifactsState.artifacts.length === 0 ? (
          <ReviewPanelEmptyState>
            本会话暂无内容型产物
            <br />
            <span className="review-panel-artifact-list__empty-hint">
              图片、Markdown、HTML 等产物会在这里出现
            </span>
          </ReviewPanelEmptyState>
        ) : (
          <ul aria-label="会话产物" className="review-panel-artifact-list__items">
            {artifactsState.artifacts.map((artifact) => (
              <li className="review-panel-artifact-list__item" key={artifact.id}>
                <ReviewPanelArtifactButton
                  artifact={artifact}
                  onSelect={() => onSelectArtifact(artifact.id)}
                  selected={artifact.id === selectedArtifact?.id}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="产物预览" className="review-panel-artifact-preview">
        <ReviewPanelArtifactPreviewBody
          imageGallery={imageGallery}
          onReload={onReload}
          preview={preview}
          selectedArtifact={selectedArtifact}
        />
      </section>
    </div>
  );
}

function ReviewPanelArtifactButton({
  artifact,
  onSelect,
  selected,
}: {
  readonly artifact: ArtifactRecord;
  readonly onSelect: () => void;
  readonly selected: boolean;
}) {
  const typeLabel = formatArtifactTypeLabel(artifact.type);
  const className = selected
    ? 'review-panel-artifact-button review-panel-artifact-button--selected'
    : 'review-panel-artifact-button';

  return (
    <button
      aria-current={selected ? 'true' : undefined}
      aria-label={`${artifact.title}，${typeLabel}，版本 ${artifact.version}，更新于 ${formatArtifactTimestamp(artifact.updatedAt)}`}
      aria-pressed={selected}
      className={className}
      onClick={onSelect}
      type="button"
    >
      <span className="review-panel-artifact-button__title-row">
        <span className="review-panel-artifact-button__badge">{typeLabel}</span>
        <span className="review-panel-artifact-button__title" title={artifact.title}>
          {artifact.title}
        </span>
      </span>
      <span className="review-panel-artifact-button__meta">
        <span>v{artifact.version}</span>
        <span>{formatArtifactTimestamp(artifact.updatedAt)}</span>
      </span>
    </button>
  );
}

function ReviewPanelArtifactPreviewBody({
  imageGallery,
  onReload,
  preview,
  selectedArtifact,
}: {
  readonly imageGallery?: ArtifactImageGallery;
  readonly onReload: () => void;
  readonly preview: ReviewPanelArtifactPreviewState;
  readonly selectedArtifact: ArtifactRecord | null;
}) {
  if (!selectedArtifact || preview.kind === 'idle') {
    return <ReviewPanelEmptyState>选择产物后查看预览。</ReviewPanelEmptyState>;
  }

  if (preview.kind === 'loading') {
    return <ReviewPanelEmptyState>正在加载产物内容...</ReviewPanelEmptyState>;
  }

  if (preview.kind === 'error') {
    return (
      <div className="review-panel-artifact-preview__error">
        <ReviewPanelEmptyState>{preview.message}</ReviewPanelEmptyState>
        <button type="button" className="review-panel-artifact-preview__retry" onClick={onReload}>
          重试
        </button>
      </div>
    );
  }

  if (canPreviewArtifact(selectedArtifact.type)) {
    return (
      <ArtifactPreviewSurface
        artifact={selectedArtifact}
        content={preview.content}
        imageGallery={imageGallery}
      />
    );
  }

  return (
    <ReviewPanelArtifactFallback
      artifact={selectedArtifact}
      content={preview.content}
      key={selectedArtifact.id}
    />
  );
}

function ReviewPanelArtifactFallback({
  artifact,
  content,
}: {
  readonly artifact: ArtifactRecord;
  readonly content: string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const isEmpty = content.length === 0;
  const lineCount = isEmpty ? 0 : content.split(/\r?\n/).length;

  const handleCopy = () => {
    void copyTextToClipboard(content)
      .then(() => {
        setCopyState('copied');
        toast('已复制产物内容', 'success');
      })
      .catch((copyError: unknown) => {
        setCopyState('error');
        toast(copyError instanceof Error ? copyError.message : '复制失败', 'error');
      });
  };

  return (
    <div className="review-panel-artifact-fallback">
      <div className="review-panel-artifact-fallback__header">
        <div className="review-panel-artifact-fallback__identity">
          <span className="review-panel-artifact-fallback__badge">
            {formatArtifactTypeLabel(artifact.type)}
          </span>
          <strong className="review-panel-artifact-fallback__title" title={artifact.title}>
            {artifact.title}
          </strong>
          <span className="review-panel-artifact-fallback__meta">
            {buildArtifactVirtualPath(artifact)} · v{artifact.version} · 更新于{' '}
            {formatArtifactTimestamp(artifact.updatedAt)} · {lineCount} 行
          </span>
        </div>
        <button
          className="review-panel-artifact-fallback__copy"
          disabled={isEmpty}
          onClick={handleCopy}
          type="button"
        >
          {copyState === 'copied' ? '已复制' : '复制内容'}
        </button>
      </div>
      <p className="review-panel-artifact-fallback__note">
        该类型暂不支持内联预览，可复制内容后到产物工作区或编辑器中查看。
      </p>
      {isEmpty ? (
        <p className="review-panel-artifact-fallback__empty">产物内容为空。</p>
      ) : (
        <pre className="review-panel-artifact-fallback__content">{content}</pre>
      )}
    </div>
  );
}
