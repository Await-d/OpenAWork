import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long the copy button stays in its "✓ 已复制" confirmation state
 * before reverting to the default label. Mirrors the value used by
 * the in-block code copy button so the two affordances feel uniform.
 */
const COPY_FEEDBACK_MS = 1500;

/**
 * Floating action toolbar that overlays the top-right corner of a
 * chat message bubble. The button group is invisible by default and
 * fades in when the user hovers (or focuses any descendant of) the
 * `.chat-message-row` parent — see `chat-message.css` for the hover
 * trigger. Keeping the trigger in CSS means the toolbar adds zero
 * runtime listeners per message, which matters when 100+ messages
 * are mounted.
 *
 * The toolbar is intentionally minimal: only the copy action is
 * surfaced for now. Quote / forward / regenerate live separately
 * (assistant action header, regenerate banner) so this overlay
 * stays a single-purpose primitive.
 */
export function MessageHoverActions({
  getCopyText,
  isBookmarked = false,
  onToggleBookmark,
}: {
  getCopyText: () => string;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(() => {
    const text = getCopyText();
    if (!text) return;
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) return;
    void writeText
      .call(navigator.clipboard, text)
      .then(() => {
        setCopied(true);
        if (timerRef.current != null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          setCopied(false);
        }, COPY_FEEDBACK_MS);
      })
      .catch(() => undefined);
  }, [getCopyText]);

  return (
    <div className="chat-message-hover-actions" aria-hidden={copied ? undefined : 'false'}>
      <button
        type="button"
        className="chat-message-hover-action"
        data-copied={copied ? 'true' : undefined}
        onClick={handleCopy}
        title={copied ? '已复制到剪贴板' : '复制消息内容'}
        aria-label={copied ? '已复制' : '复制消息'}
      >
        {copied ? '✓ 已复制' : '复制'}
      </button>
      {onToggleBookmark && (
        <button
          type="button"
          className="chat-message-hover-action"
          data-bookmarked={isBookmarked ? 'true' : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark();
          }}
          title={isBookmarked ? '取消收藏' : '收藏此消息'}
          aria-label={isBookmarked ? '取消收藏' : '收藏'}
          style={{
            color: isBookmarked ? 'var(--warning)' : undefined,
          }}
        >
          {isBookmarked ? '⭐' : '☆'}
        </button>
      )}
    </div>
  );
}
