import { useEffect, useState } from 'react';
import type { ArtifactRecord, ArtifactVersionRecord } from '@openAwork/artifacts';
import { tokens } from '@openAwork/shared-ui';
import { toast } from '../../components/ToastNotification.js';
import { ArtifactCodeEditor } from './artifact-code-editor.js';
import { ArtifactPreviewSurface } from './artifact-preview-surface.js';
import {
  buildArtifactDownloadName,
  canPreviewArtifact,
  formatArtifactTimestamp,
  formatArtifactTypeLabel,
} from './artifact-workbench-utils.js';
import { ArtifactVersionTimeline } from './artifact-version-timeline.js';

interface ArtifactWorkbenchProps {
  artifact: ArtifactRecord | null;
  revertingVersionId: string | null;
  saving: boolean;
  versions: ArtifactVersionRecord[];
  onRevert: (versionId: string) => void;
  onSave: (draft: { content: string; title: string }) => void;
}

export function ArtifactWorkbench({
  artifact,
  revertingVersionId,
  saving,
  versions,
  onRevert,
  onSave,
}: ArtifactWorkbenchProps) {
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [mode, setMode] = useState<'code' | 'preview'>('code');

  useEffect(() => {
    setDraftTitle(artifact?.title ?? '');
    setDraftContent(artifact?.content ?? '');
    setMode(canPreviewArtifact(artifact?.type ?? 'code') ? 'preview' : 'code');
  }, [artifact?.id, artifact?.version, artifact?.title, artifact?.content, artifact?.type]);

  useEffect(() => {
    if (!artifact) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!saving) {
          onSave({ title: draftTitle, content: draftContent });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [artifact, draftContent, draftTitle, onSave, saving]);

  if (!artifact) {
    return (
      <section
        aria-label="产物工作区"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 520,
          padding: tokens.spacing.xl,
          borderRadius: tokens.radius.xl,
          border: `1px solid ${tokens.color.borderSubtle}`,
          background:
            'linear-gradient(180deg, color-mix(in oklch, var(--surface) 82%, transparent), color-mix(in oklch, var(--bg) 92%, transparent))',
          color: 'var(--text-3)',
          textAlign: 'center',
          lineHeight: 1.7,
        }}
      >
        选择一个 artifact 开始编辑与预览。
      </section>
    );
  }

  const dirty = artifact.title !== draftTitle || artifact.content !== draftContent;
  const previewable = canPreviewArtifact(artifact.type);

  return (
    <section
      aria-label="产物工作区"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacing.lg,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.spacing.md,
          padding: tokens.spacing.lg,
          borderRadius: tokens.radius.xl,
          border: `1px solid ${tokens.color.borderSubtle}`,
          background:
            'radial-gradient(circle at top left, color-mix(in oklch, var(--accent) 16%, transparent), transparent 36%), color-mix(in oklch, var(--surface) 84%, transparent)',
          boxShadow: tokens.shadow.md,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: tokens.spacing.md,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Artifact Workbench
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>标题</span>
              <input
                aria-label="产物标题"
                autoComplete="off"
                name="artifact-title"
                type="text"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.currentTarget.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span style={badgeStyle}>{formatArtifactTypeLabel(artifact.type)}</span>
              <span style={badgeStyle}>v{artifact.version}</span>
              <span style={badgeStyle}>{formatArtifactTimestamp(artifact.updatedAt)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {previewable && (
                <div
                  role="tablist"
                  aria-label="预览模式"
                  style={{
                    display: 'inline-flex',
                    padding: 2,
                    borderRadius: 999,
                    border: `1px solid ${tokens.color.borderSubtle}`,
                    background: 'color-mix(in oklch, var(--surface) 72%, transparent)',
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={mode === 'preview'}
                    onClick={() => setMode('preview')}
                    style={mode === 'preview' ? activeTabButtonStyle : inactiveTabButtonStyle}
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'code'}
                    onClick={() => setMode('code')}
                    style={mode === 'code' ? activeTabButtonStyle : inactiveTabButtonStyle}
                  >
                    代码
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(draftContent);
                  toast('已复制当前产物内容', 'success');
                }}
                style={secondaryButtonStyle}
              >
                复制内容
              </button>
              <button
                type="button"
                onClick={() => downloadArtifact(draftTitle, artifact.type, draftContent)}
                style={secondaryButtonStyle}
              >
                下载
              </button>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => onSave({ title: draftTitle, content: draftContent })}
                style={{
                  ...primaryButtonStyle,
                  opacity: !dirty || saving ? 0.55 : 1,
                  cursor: !dirty || saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? '保存中…' : dirty ? '保存更改' : '已保存'}
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.sm }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>内容</span>
          </label>
          {mode === 'preview' && previewable ? (
            <ArtifactPreviewSurface artifact={artifact} content={draftContent} />
          ) : (
            <ArtifactCodeEditor
              content={draftContent}
              type={artifact.type}
              onChange={setDraftContent}
            />
          )}
        </div>
      </div>
      <ArtifactVersionTimeline
        currentVersion={artifact.version}
        revertingVersionId={revertingVersionId}
        versions={versions}
        onRevert={onRevert}
      />
    </section>
  );
}

function downloadArtifact(title: string, type: ArtifactRecord['type'], content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildArtifactDownloadName({ title, type });
  anchor.click();
  URL.revokeObjectURL(url);
}

const inputStyle: React.CSSProperties = {
  minHeight: 40,
  padding: '0 12px',
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.color.borderSubtle}`,
  background: 'color-mix(in oklch, var(--surface) 88%, var(--bg) 12%)',
  color: 'var(--text)',
  fontSize: 13,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1,
  padding: '4px 7px',
  borderRadius: 999,
  background: 'color-mix(in oklch, var(--surface) 72%, transparent)',
  color: 'var(--text-2)',
  border: `1px solid ${tokens.color.borderSubtle}`,
};

const activeTabButtonStyle: React.CSSProperties = {
  height: 30,
  padding: '0 12px',
  border: 'none',
  borderRadius: 999,
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const inactiveTabButtonStyle: React.CSSProperties = {
  height: 30,
  padding: '0 12px',
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--text-2)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const primaryButtonStyle: React.CSSProperties = {
  height: 34,
  padding: '0 12px',
  borderRadius: tokens.radius.md,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  fontSize: 12,
  fontWeight: 700,
};

const secondaryButtonStyle: React.CSSProperties = {
  height: 34,
  padding: '0 12px',
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.color.borderSubtle}`,
  background: 'color-mix(in oklch, var(--surface) 72%, transparent)',
  color: 'var(--text)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
