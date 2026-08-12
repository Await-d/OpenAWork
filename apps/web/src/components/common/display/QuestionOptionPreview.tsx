import type { CSSProperties } from 'react';

interface QuestionOptionPreviewProps {
  preview: string;
  style?: CSSProperties;
}

const baseStyle: CSSProperties = {
  maxHeight: 192,
  margin: 0,
  overflow: 'auto',
  padding: '8px 12px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  background: 'var(--bg-base)',
  color: 'var(--fg-default)',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

export function QuestionOptionPreview({ preview, style }: QuestionOptionPreviewProps) {
  return (
    <pre aria-label="已选项预览" data-question-preview="text" style={{ ...baseStyle, ...style }}>
      {preview}
    </pre>
  );
}
