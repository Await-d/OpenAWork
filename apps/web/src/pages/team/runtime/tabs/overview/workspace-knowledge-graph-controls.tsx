/**
 * 知识图谱统一控制按钮组件。
 * 提供多种视觉变体以适配不同上下文（工具栏、画布浮动、检查器面板）。
 */

export type GraphBtnVariant = 'default' | 'ghost' | 'icon' | 'action';

export function GraphBtn({
  disabled = false,
  label,
  title,
  onClick,
  variant = 'default',
}: {
  disabled?: boolean;
  label: string;
  title?: string;
  onClick: () => void;
  variant?: GraphBtnVariant;
}) {
  return (
    <button
      type="button"
      aria-label={title ?? label}
      className={`workspace-knowledge-graph-control-button${variant !== 'default' ? ` is-${variant}` : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );
}
