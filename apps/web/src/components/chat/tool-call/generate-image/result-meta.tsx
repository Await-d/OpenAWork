import type { GenerateImageResult } from './parse.js';

/**
 * Meta row shown beneath the generated image: title pill, file-name code
 * chip, and (when the model rewrote the prompt) the revised prompt
 * preview clamped to two lines. All three fields are optional — the row
 * still renders with just the title chip if the rest are missing.
 */
export function GenerateImageResultMeta({ result }: { result: GenerateImageResult }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 18,
            padding: '0 7px',
            borderRadius: 999,
            background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          图片已生成
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={result.title}
        >
          {result.title}
        </span>
      </div>
      {result.fileName && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-3)',
            lineHeight: 1.4,
            paddingLeft: 2,
          }}
        >
          <span style={{ opacity: 0.6, flexShrink: 0 }}>文件:</span>
          <code
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono, monospace)',
              background: 'color-mix(in oklch, var(--text-3) 8%, transparent)',
              padding: '1px 6px',
              borderRadius: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={result.fileName}
          >
            {result.fileName}
          </code>
        </div>
      )}
      {result.revisedPrompt && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            lineHeight: 1.5,
            paddingLeft: 2,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={result.revisedPrompt}
        >
          <span style={{ fontStyle: 'italic', opacity: 0.7 }}>优化后:</span> {result.revisedPrompt}
        </div>
      )}
    </div>
  );
}
