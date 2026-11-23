import { useState, type ReactNode } from 'react';

/**
 * 消息正文折叠阈值（字符数）。
 *
 * 这不是「精确的像素高度」判断，而是「这段正文大概率会占掉一屏以上」的廉价启发式：
 * 放在字符层面（而非行数）是为了对纯文本 / markdown / 工具输出三种形态都稳定，且
 * 判定成本是 O(1)——长会话里每帧都要对每条消息跑一次。
 *
 * 助手消息（`CollapsibleAssistantContent`）与用户消息（`CollapsibleUserContent`）
 * 共用同一个阈值，避免同一屏里出现两套「多长算长」的标准。
 */
export const MESSAGE_FOLD_CHAR_THRESHOLD = 1500;

/** 正文是否超过折叠阈值。 */
export function shouldFoldMessageContent(content: string): boolean {
  return content.length > MESSAGE_FOLD_CHAR_THRESHOLD;
}

/**
 * 长正文折叠壳：把 children 裁到 ~60vh（复用 `.chat-markdown-fold-*` 样式），底部
 * 悬浮「展开全部 · N 字符」，展开后换成「收起」。
 *
 * 只承载「裁剪 + 展开控件」这一层 UI，**不携带任何角色语义**：折叠归属
 * （`MessageFoldContext`）、「最新一条不折叠」之类的策略一律由调用方决定。助手侧
 * 需要与围栏块（代码块 / 思考块）协商谁折叠，用户侧是纯文本、没有内部折叠控件，
 * 两者的差异不该被塞进这个壳里。
 */
export function MessageFoldShell({
  content,
  children,
  scope,
}: {
  /** 正文原文，仅用于在展开按钮上显示字符数。 */
  content: string;
  children: ReactNode;
  /** 折叠来源，落到 `data-fold-scope` 便于样式与测试区分，不参与逻辑判定。 */
  scope: 'assistant' | 'user';
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="chat-markdown-fold-container"
      data-expanded={expanded ? 'true' : 'false'}
      data-fold-scope={scope}
    >
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
