import type { CSSProperties } from 'react';
import { ChatWorkbenchSignalChip } from './ChatWorkbenchSignalChip.js';
import { getPathBasename } from '../../../utils/workspace-path.js';

interface ChatWorkbenchStatusStripProps {
  readonly activeTerminalCount: number;
  readonly dialogueModeLabel: string;
  readonly editorMode: boolean;
  readonly editorPaneTab: 'code' | 'browser';
  readonly messageCount: number;
  readonly modelLabel: string | null | undefined;
  readonly onToggleReviewPanel: () => void;
  readonly onToggleTerminalPanel: () => void;
  readonly reviewPanelOpened: boolean;
  readonly sessionId: string | null;
  readonly taskCount: number;
  readonly terminalPanelOpened: boolean;
  readonly workspacePath: string | null;
}

const STRIP_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-2)',
  padding: 'var(--spacing-2) var(--spacing-4)',
  borderBottom: '1px solid var(--border-subtle)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 82%, var(--accent-subtle)), var(--bg-base))',
  color: 'var(--fg-default)',
};

const HERO_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 'var(--spacing-2)',
  alignItems: 'start',
};

const TITLE_GROUP_STYLE: CSSProperties = {
  display: 'grid',
  minWidth: 0,
  gap: 'var(--spacing-1)',
};

const EYEBROW_STYLE: CSSProperties = {
  color: 'var(--fg-subtle)',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const TITLE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontSize: 13,
  fontWeight: 800,
  lineHeight: 1.25,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const SUMMARY_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
  gap: 'var(--spacing-2)',
};

const SUMMARY_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-1)',
  minWidth: 0,
  padding: 'var(--spacing-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid color-mix(in srgb, var(--border-default) 48%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 72%, var(--bg-base))',
};

const SUMMARY_LABEL_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const SUMMARY_VALUE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontSize: 12,
  fontWeight: 750,
  lineHeight: 1.2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const SIGNAL_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 'var(--spacing-1)',
  justifyContent: 'flex-start',
  minWidth: 0,
};

function basename(path: string | null): string {
  return getPathBasename(path, '未选择工作区');
}

function formatSessionLabel(sessionId: string | null): string {
  if (!sessionId) {
    return '未创建会话';
  }
  return `会话 ${sessionId.slice(0, 8)}`;
}

function formatEditorLabel(editorMode: boolean, editorPaneTab: 'code' | 'browser'): string {
  if (!editorMode) {
    return '编辑器关闭';
  }
  return editorPaneTab === 'browser' ? '浏览器面板' : '代码面板';
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  readonly label: string;
  readonly tone?: 'accent' | 'aux' | 'contrast' | 'default';
  readonly value: string;
}) {
  const color =
    tone === 'accent'
      ? 'var(--accent)'
      : tone === 'aux'
        ? 'var(--aux)'
        : tone === 'contrast'
          ? 'var(--contrast)'
          : 'var(--fg-strong)';

  return (
    <div style={SUMMARY_CARD_STYLE}>
      <span style={SUMMARY_LABEL_STYLE}>{label}</span>
      <span style={{ ...SUMMARY_VALUE_STYLE, color }} title={value}>
        {value}
      </span>
    </div>
  );
}

export function ChatWorkbenchStatusStrip({
  activeTerminalCount,
  dialogueModeLabel,
  editorMode,
  editorPaneTab,
  messageCount,
  modelLabel,
  onToggleReviewPanel,
  onToggleTerminalPanel,
  reviewPanelOpened,
  sessionId,
  taskCount,
  terminalPanelOpened,
  workspacePath,
}: ChatWorkbenchStatusStripProps) {
  const resolvedModelLabel = modelLabel?.trim() || '未选择模型';
  const terminalLabel = terminalPanelOpened
    ? activeTerminalCount > 0
      ? `${activeTerminalCount} 个终端运行`
      : '终端已展开'
    : '终端折叠';

  return (
    <section aria-label="Chat 工作台摘要" style={STRIP_STYLE}>
      <div style={HERO_ROW_STYLE}>
        <div style={TITLE_GROUP_STYLE}>
          <span style={EYEBROW_STYLE}>Chat workbench</span>
          <span style={TITLE_STYLE}>
            {formatSessionLabel(sessionId)} · {basename(workspacePath)}
          </span>
        </div>
        <div style={SIGNAL_ROW_STYLE}>
          <ChatWorkbenchSignalChip label={`${dialogueModeLabel}模式`} tone="accent" />
          <ChatWorkbenchSignalChip
            ariaLabel={reviewPanelOpened ? '收起审查面板' : '展开审查面板'}
            label={reviewPanelOpened ? '审查展开' : '审查折叠'}
            onClick={onToggleReviewPanel}
            tone="aux"
          />
          <ChatWorkbenchSignalChip
            ariaLabel={terminalPanelOpened ? '收起终端面板' : '展开终端面板'}
            label={terminalLabel}
            onClick={onToggleTerminalPanel}
            tone="contrast"
          />
        </div>
      </div>

      <div style={SUMMARY_GRID_STYLE}>
        <SummaryCard label="对话模式" value={dialogueModeLabel} tone="accent" />
        <SummaryCard label="当前模型" value={resolvedModelLabel} tone="aux" />
        <SummaryCard label="消息" value={`${messageCount} 条`} />
        <SummaryCard label="任务" value={`${taskCount} 项`} tone="contrast" />
        <SummaryCard label="编辑区" value={formatEditorLabel(editorMode, editorPaneTab)} />
      </div>
    </section>
  );
}
