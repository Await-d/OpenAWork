import { createContext, type ReactNode, useContext, useState } from 'react';

/**
 * Threshold above which an assistant message body is collapsed by
 * default. Picked to roughly match a screen height of plain prose:
 * shorter answers stay fully visible, while long reports / file
 * dumps get a "展开全部" affordance so they don't push subsequent
 * messages off-screen.
 *
 * Lives at the character level (not lines) so the heuristic is
 * cheap and stable across markdown structures.
 */
const FOLD_CHAR_THRESHOLD = 1500;

/**
 * Provider-supplied id of the most recent non-streaming assistant
 * message. The latest reply usually contains the answer to whatever
 * the user just asked; auto-collapsing it would hide the punchline
 * behind a "展开全部" button. Set this to the latest message id from
 * `ChatPage` and `CollapsibleAssistantContent` will skip the fold for
 * just that one message — older long replies still collapse to keep
 * the scrollback compact.
 */
export const LatestAssistantMessageContext = createContext<string | null>(null);

/**
 * Wrap a long assistant message body in a fold container that clips
 * the overflow to ~60vh and reveals a "展开全部" button at the
 * bottom. Short messages render their children unchanged so we
 * don't pay any layout cost on the common case.
 *
 * Streaming bodies must NOT be wrapped — the user is actively
 * watching the response grow and we don't want the fade-out
 * indicator competing with the streaming cursor. The caller is
 * responsible for not invoking this for streaming content.
 *
 * If `messageId` matches the value supplied by
 * `LatestAssistantMessageContext`, the fold is skipped so the latest
 * answer stays fully visible.
 */
export function CollapsibleAssistantContent({
  content,
  children,
  messageId,
}: {
  content: string;
  children: ReactNode;
  messageId?: string;
}) {
  const latestAssistantId = useContext(LatestAssistantMessageContext);
  const isLatest = messageId !== undefined && messageId === latestAssistantId;
  const isLong = content.length > FOLD_CHAR_THRESHOLD;
  const [expanded, setExpanded] = useState(false);

  if (!isLong || isLatest) return <>{children}</>;

  return (
    <div className="chat-markdown-fold-container" data-expanded={expanded ? 'true' : 'false'}>
      <div className="chat-markdown-fold-body">{children}</div>
      {!expanded && (
        <button
          type="button"
          className="chat-markdown-fold-expand"
          onClick={() => setExpanded(true)}
          aria-label="展开全部消息内容"
        >
          展开全部 · {content.length.toLocaleString()} 字符
        </button>
      )}
      {expanded && (
        <button
          type="button"
          className="chat-markdown-fold-collapse"
          onClick={() => setExpanded(false)}
          aria-label="收起消息内容"
        >
          收起
        </button>
      )}
    </div>
  );
}
