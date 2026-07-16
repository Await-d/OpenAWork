/**
 * SessionHeaderBar — 会话面板顶部信息栏 (44px)。
 *
 * 显示：会话标题 + 模型 + 模式 + 工作区路径
 * 右侧工具按钮：审查面板切换 / 终端面板切换 / 更多
 */

import { getPathBasename } from '../../../utils/workspace-path.js';
import './SessionHeaderBar.css';

export interface SessionHeaderBarProps {
  readonly title: string;
  readonly modelLabel: string | null | undefined;
  readonly modeLabel: string | null | undefined;
  readonly workspacePath: string | null;
  readonly reviewPanelOpened: boolean;
  readonly terminalPanelOpened: boolean;
  readonly onToggleReviewPanel: () => void;
  readonly onToggleTerminalPanel: () => void;
  readonly onMore?: () => void;
}

function basename(path: string | null): string {
  return getPathBasename(path);
}

export function SessionHeaderBar({
  title,
  modelLabel,
  modeLabel,
  workspacePath,
  reviewPanelOpened,
  terminalPanelOpened,
  onToggleReviewPanel,
  onToggleTerminalPanel,
  onMore,
}: SessionHeaderBarProps) {
  return (
    <div className="session-header-bar">
      <div className="session-header-bar__info">
        <span className="session-header-bar__title">{title}</span>
        <span className="session-header-bar__meta">
          {modelLabel && <span className="session-header-bar__model">{modelLabel}</span>}
          {modeLabel && (
            <>
              <span>·</span>
              <span>{modeLabel}</span>
            </>
          )}
          {workspacePath && (
            <>
              <span>·</span>
              <span>{basename(workspacePath)}</span>
            </>
          )}
        </span>
      </div>

      <div className="session-header-bar__actions">
        <button
          type="button"
          className="session-header-bar__tool-button"
          data-active={reviewPanelOpened ? 'true' : 'false'}
          title={reviewPanelOpened ? '收起审查面板' : '展开审查面板'}
          onClick={onToggleReviewPanel}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
          审查
        </button>

        <button
          type="button"
          className="session-header-bar__tool-button"
          data-active={terminalPanelOpened ? 'true' : 'false'}
          title={terminalPanelOpened ? '收起终端面板' : '展开终端面板'}
          onClick={onToggleTerminalPanel}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          终端
        </button>

        {onMore && (
          <button
            type="button"
            className="session-header-bar__icon-button"
            title="更多"
            aria-label="更多"
            onClick={onMore}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
