/**
 * QuickTerminalToggle — small chip-style button that toggles the bottom
 * QuickTerminalPanel. Lives next to the SessionTerminalsChip in
 * ChatTopBar so the two terminal entry points are co-located.
 *
 * The visual matches SessionTerminalsChip (height 26, padding 0 8) so
 * the right-side pill stays consistent.
 */

interface QuickTerminalToggleProps {
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function QuickTerminalToggle({ open, onToggle, disabled }: QuickTerminalToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={open}
      onClick={onToggle}
      disabled={disabled}
      title={open ? '收起快捷终端面板' : '打开快捷终端(VS Code 风格底部面板)'}
      style={{
        height: 26,
        padding: '0 8px',
        borderRadius: 5,
        border: 'none',
        background: open ? 'color-mix(in srgb, var(--aux) 18%, var(--bg-overlay))' : 'transparent',
        color: open ? 'var(--aux))' : 'var(--fg-muted)',
        boxShadow: open
          ? 'inset 0 0 0 1px color-mix(in srgb, var(--aux) 50%, var(--border-default))'
          : 'none',
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9 L10 12 L7 15" />
        <line x1="13" y1="15" x2="17" y2="15" />
      </svg>
      <span>面板</span>
    </button>
  );
}
