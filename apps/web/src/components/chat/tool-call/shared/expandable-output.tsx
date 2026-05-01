import { useState } from 'react';
import { CopyBtn } from './copy-btn.js';

/**
 * Generic monospace output block with line-count + copy button + truncation
 * fallback. Used as the universal last-resort renderer when no domain-aware
 * preview matches.
 */
export function ExpandableOutput({ text, maxChars = 500 }: { text: string; maxChars?: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxChars;
  const lineCount = text.split('\n').length;
  const displayed = isLong && !expanded ? `${text.slice(0, maxChars)}…` : text;

  return (
    <div>
      <div className="tool-output-header">
        <span className="tool-output-meta">{lineCount} lines</span>
        <CopyBtn text={text} />
      </div>
      <pre className="tool-output-pre">{displayed}</pre>
      {isLong && (
        <button type="button" className="tool-output-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `显示全部 (${lineCount} 行, ${text.length} 字符)`}
        </button>
      )}
    </div>
  );
}
