import { useCallback, useState } from 'react';
import { copyTextToClipboard } from '../../../layout/file-tree/file-tree-actions.js';

/**
 * Inline copy-to-clipboard button (OpenCowork-style). Shows a glyph that
 * flips to a tick for ~1.5s after a successful copy.
 */
export function CopyBtn({ text, title }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = useCallback(() => {
    // 必须走公共封装：`navigator.clipboard` 在非安全上下文（http + 内网 IP/域名）下
    // 是 undefined，直接调用会抛 TypeError 打断 React 事件派发并打崩页面。
    void copyTextToClipboard(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((copyError: unknown) => {
        console.warn('复制到剪贴板失败', copyError);
      });
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
