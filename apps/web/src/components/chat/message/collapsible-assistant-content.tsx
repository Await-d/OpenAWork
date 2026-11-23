import { createContext, type ReactNode, useContext } from 'react';
import { isSubagentResultSectionVisible } from '@openAwork/shared';
import { FoldDisabledContext, MessageFoldContext } from '../markdown/fold-policy.js';
import { MessageFoldShell, shouldFoldMessageContent } from './message-fold-shell.js';

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
 * answer stays fully visible — and `FoldDisabledContext` is provided
 * so fenced blocks inside it also skip their own fold.
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
  const isLong = shouldFoldMessageContent(content);
  const hasVisibleResults = isSubagentResultSectionVisible(content);

  // 最新一条已完成回复整体不折叠时，块级折叠（代码块 / Markdown 预览块）也必须跟着
  // 禁用：它承载着用户刚问的问题的答案，若在 finalize 瞬间把块收起来，刚读完的内容
  // 会突然塌缩，且该块高度突变会把视口向上顶（视口上跳）。这里透传 context，让围栏块
  // 跳过自身折叠；历史回复仍走下面的整条折叠逻辑。
  if (isLatest) return <FoldDisabledContext value={true}>{children}</FoldDisabledContext>;

  // 子代理结构化结果（<results> 的 files / findings / answer / … 分节）是结论本身，
  // 折叠掉等于把答案藏起来：跳过整条折叠，让其完整展示。
  if (hasVisibleResults) return <>{children}</>;

  if (!isLong) return <>{children}</>;

  return (
    <MessageFoldContext value={true}>
      <MessageFoldShell content={content} scope="assistant">
        {children}
      </MessageFoldShell>
    </MessageFoldContext>
  );
}
