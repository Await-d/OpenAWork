import React from 'react';

export interface ChatImageGenerationResultStripProps {
  artifactTitle: string;
  modelLabel: string;
  onContinueEditing?: () => void;
  onOpenArtifactsWorkspace: () => void;
}

export function ChatImageGenerationResultStrip({
  artifactTitle,
  modelLabel,
  onContinueEditing,
  onOpenArtifactsWorkspace,
}: ChatImageGenerationResultStripProps) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 740,
        margin: '0 auto 10px',
        borderRadius: 12,
        border: '1px solid color-mix(in oklch, var(--accent) 24%, var(--border-subtle)',
        background:
          'linear-gradient(180deg, color-mix(in oklch, var(--bg-overlay) 92%, var(--accent) 8%), var(--bg-overlay)',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              padding: '0 8px',
              borderRadius: 999,
              background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
              color: 'var(--accent)',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            最新图片结果
          </span>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 600 }}>
            {modelLabel}
          </span>
        </div>
        <strong
          style={{
            fontSize: 12,
            color: 'var(--fg-strong)',
            lineHeight: 1.45,
            wordBreak: 'break-word',
          }}
        >
          {artifactTitle}
        </strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          图片已生成并写入产物工作区，可以继续切回普通对话，或直接查看结果。
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {onContinueEditing && (
          <button
            type="button"
            onClick={onContinueEditing}
            className="btn-secondary"
            style={{
              height: 30,
              padding: '0 12px',
              borderRadius: 9,
              whiteSpace: 'nowrap',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            继续编辑这张图
          </button>
        )}
        <button
          type="button"
          onClick={onOpenArtifactsWorkspace}
          className="btn-secondary"
          style={{
            height: 30,
            padding: '0 12px',
            borderRadius: 9,
            whiteSpace: 'nowrap',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          打开产物工作区
        </button>
      </div>
    </div>
  );
}
