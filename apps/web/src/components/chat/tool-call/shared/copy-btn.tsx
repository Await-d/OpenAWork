import { useCallback, useState } from 'react';

/**
 * Inline copy-to-clipboard button (OpenCowork-style). Shows a glyph that
 * flips to a tick for ~1.5s after a successful copy.
 */
export function CopyBtn({ text, title }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button
      type="button"
      className="tool-call-copy-btn"
      onClick={handleClick}
      title={title ?? 'Copy'}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}
