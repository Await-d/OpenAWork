import { MessageFoldShell, shouldFoldMessageContent } from './message-fold-shell.js';

/**
 * 用户消息正文的默认折叠。
 *
 * 为什么用户侧也需要：输入框允许粘贴任意长度的内容（整段日志、源码、长 prompt），
 * 而用户消息是 `white-space: pre-wrap` 的纯文本，长度不受任何约束——一条几万字符
 * 的消息会把整页撑开，后续对话被推到几屏之外，滚动条也被这一条消息独占。助手侧早已
 * 有等价处理（`CollapsibleAssistantContent`），用户侧此前缺了这一层。
 *
 * 与助手侧的两点差异：
 *
 * 1. **不豁免「最新一条」**：助手侧最新回复不折叠是为了不把答案藏起来；用户消息折叠
 *    只是收起自己刚发的正文，前 ~60vh 依然可见，而「刚发出就撑开整页」恰恰是这里要
 *    解决的问题，所以不做最新一条豁免。
 * 2. **不参与围栏块折叠协商**：正文是纯文本，不存在需要让位的内部折叠控件，因此
 *    不提供 `MessageFoldContext`（那是给 markdown 里的代码块 / 思考块用的）。
 */
export function CollapsibleUserContent({ content }: { content: string }) {
  if (!shouldFoldMessageContent(content)) {
    // 未折叠时保持 inline 包裹：有附件的消息里正文原本就是 `<span>`，结构不变。
    return <span>{content}</span>;
  }

  return (
    <MessageFoldShell content={content} scope="user">
      {content}
    </MessageFoldShell>
  );
}
