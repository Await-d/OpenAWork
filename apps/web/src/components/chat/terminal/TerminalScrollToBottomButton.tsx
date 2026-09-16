/**
 * 「滚动到底部」浮动按钮：只在用户往上翻（viewport 离开底部）时出现，
 * 点击回到最新输出。终端在跑 watch/构建时，用户翻看历史后不用一路滚回底。
 */

import { ArrowDownIcon } from './TerminalIcons.js';

export interface TerminalScrollToBottomButtonProps {
  onClick: () => void;
}

export function TerminalScrollToBottomButton({ onClick }: TerminalScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      className="terminal-overlay-btn terminal-scroll-bottom"
      data-testid="terminal-scroll-bottom"
      aria-label="滚动到终端底部"
      title="滚动到底部"
      onClick={onClick}
    >
      <ArrowDownIcon />
    </button>
  );
}
