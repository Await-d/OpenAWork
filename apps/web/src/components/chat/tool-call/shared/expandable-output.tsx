import { useState } from 'react';
import { CopyBtn } from './copy-btn.js';

/**
 * Generic monospace output block with line-count + copy button + truncation
 * fallback. Used as the universal last-resort renderer when no domain-aware
 * preview matches.
 *
 * Outputs longer than `maxChars` are collapsed by default with a gradient
 * fade-out and an expand button. This prevents long shell outputs or JSON
 * dumps from dominating the chat viewport.
 */
export function ExpandableOutput({
  text,
  maxChars = 400,
  maxLines = 12,
  defaultExpanded = false,
  compact = false,
}: {
  text: string;
  maxChars?: number;
  maxLines?: number;
  defaultExpanded?: boolean;
  compact?: boolean;
}) {
  const lines = text.split('\n');
  const lineCount = lines.length;
  const charCount = text.length;
  const isLongByChars = charCount > maxChars;
  const isLongByLines = lineCount > maxLines;
  const isLong = isLongByChars || isLongByLines;

  const [expanded, setExpanded] = useState(defaultExpanded);

  const displayed = (() => {
    if (!isLong || expanded) return text;
    // Truncate by lines first (more readable), then by chars as fallback
    if (isLongByLines) {
      const truncated = lines.slice(0, maxLines).join('\n');
      return truncated.length > maxChars ? `${truncated.slice(0, maxChars)}` : truncated;
    }
    return text.slice(0, maxChars);
  })();

  return (
    <div className={compact ? 'tool-output-compact' : 'tool-output'}>
      <div className="tool-output-header">
        <span className="tool-output-meta">
          {lineCount} 行 · {formatSize(charCount)}
        </span>
        <CopyBtn text={text} />
      </div>
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <pre className={compact ? 'tool-output-pre-compact' : 'tool-output-pre'}>{displayed}</pre>
        {/* Gradient fade when collapsed */}
        {isLong && !expanded && (
          <div
            aria-hidden="true"
            className="tool-output-fade"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'linear-gradient(transparent, var(--bg-overlay)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      {isLong && (
        <button type="button" className="tool-output-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `展开全部 (${lineCount} 行, ${formatSize(charCount)})`}
        </button>
      )}
    </div>
  );
}

function formatSize(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}M`;
  if (chars >= 1_000) return `${(chars / 1_000).toFixed(1)}K`;
  return `${chars} 字符`;
}
