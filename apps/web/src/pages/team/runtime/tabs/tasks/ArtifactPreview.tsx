/**
 * 260515-team-phase-c · T-06 / T-07
 *
 * 产物查看器 + 标记高亮。
 * 渲染 Markdown 产物内容，高亮 [NEEDS CLARIFICATION] / [P] / [US1] 标记。
 */

import { useMemo, type CSSProperties } from 'react';
import MarkdownMessageContent from '../../../../../components/chat/markdown/markdown-message-content.js';

const CONTAINER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-base))',
  overflow: 'auto',
  maxHeight: 600,
};

const BADGE_STYLES: Record<string, CSSProperties> = {
  clarification: {
    display: 'inline-flex',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    background: 'color-mix(in srgb, var(--danger) 12%, var(--bg-overlay))',
    color: 'var(--danger))',
    border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
  },
  parallel: {
    display: 'inline-flex',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    background: 'color-mix(in srgb, var(--aux) 12%, var(--bg-overlay))',
    color: 'var(--aux))',
    border: '1px solid color-mix(in srgb, var(--aux) 30%, transparent)',
  },
  story: {
    display: 'inline-flex',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    background: 'color-mix(in srgb, var(--success) 12%, var(--bg-overlay))',
    color: 'var(--success))',
    border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
  },
};

interface HighlightedSegment {
  type: 'text' | 'clarification' | 'parallel' | 'story';
  content: string;
}

function highlightMarkers(text: string): HighlightedSegment[] {
  const segments: HighlightedSegment[] = [];
  const re = /(\[NEEDS CLARIFICATION:[^\]]*\])|(\[P\])|(\[US\d+\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    if (match[1]) {
      segments.push({ type: 'clarification', content: match[1] });
    } else if (match[2]) {
      segments.push({ type: 'parallel', content: match[2] });
    } else if (match[3]) {
      segments.push({ type: 'story', content: match[3] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

export interface ArtifactPreviewProps {
  title: string;
  content: string;
  phase?: string;
  version?: number;
}

export function ArtifactPreview({ title, content, phase, version }: ArtifactPreviewProps) {
  const segments = useMemo(() => highlightMarkers(content), [content]);

  const clarificationCount = segments.filter((s) => s.type === 'clarification').length;

  return (
    <div style={CONTAINER_STYLE}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {phase ? `${phase} ` : ''}v{version ?? 1}
          {clarificationCount > 0 ? ` · ${clarificationCount} 待澄清` : ''}
        </span>
      </header>
      <div
        style={{
          display: 'grid',
          gap: 8,
          color: 'var(--fg-strong)',
          margin: 0,
        }}
      >
        {segments.map((seg, i) => {
          if (seg.type === 'text') {
            if (!seg.content) {
              return null;
            }
            return <MarkdownMessageContent key={i} content={seg.content} />;
          }
          const style = BADGE_STYLES[seg.type] ?? {};
          return (
            <span key={i} style={{ ...style, justifySelf: 'start' }}>
              {seg.content}
            </span>
          );
        })}
      </div>
    </div>
  );
}
