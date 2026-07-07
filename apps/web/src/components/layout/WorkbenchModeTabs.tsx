import { useLocation, useNavigate } from 'react-router';
import { useUIStateStore } from '../../stores/ui/uiState.js';

type WorkbenchMode = 'chat' | 'team';

interface ModeButtonProps {
  active: boolean;
  mode: WorkbenchMode;
  label: string;
  description: string;
  onClick: () => void;
}

function ModeIcon({ mode }: { mode: WorkbenchMode }) {
  if (mode === 'team') {
    return (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  );
}

function ModeButton({ active, mode, label, description, onClick }: ModeButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={description}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 28,
        minWidth: 0,
        padding: '0 10px',
        borderRadius: 6,
        border: active ? '1px solid var(--accent-border)' : '1px solid transparent',
        background: active
          ? 'color-mix(in oklch, var(--accent) 12%, var(--bg-overlay))'
          : 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 650,
        lineHeight: 1,
        transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background =
            'color-mix(in oklch, var(--fg-default) 6%, var(--bg-overlay))';
          e.currentTarget.style.color = 'var(--fg-default)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--fg-muted)';
        }
      }}
    >
      <ModeIcon mode={mode} />
      <span>{label}</span>
    </button>
  );
}

export function WorkbenchModeTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastChatPath = useUIStateStore((s) => s.lastChatPath);
  const navigateToHome = useUIStateStore((s) => s.navigateToHome);

  const activeMode: WorkbenchMode = location.pathname.startsWith('/team') ? 'team' : 'chat';

  return (
    <div
      aria-label="工作台模式"
      role="group"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        height: 30,
        padding: 2,
        borderRadius: 8,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-raised)',
        flexShrink: 0,
      }}
    >
      <ModeButton
        active={activeMode === 'chat'}
        mode="chat"
        label="Chat"
        description="切换到单会话 Chat 工作台"
        onClick={() => {
          const nextPath = lastChatPath ?? '/chat';
          if (nextPath === '/chat') {
            navigateToHome();
          }
          void navigate(nextPath);
        }}
      />
      <ModeButton
        active={activeMode === 'team'}
        mode="team"
        label="Team"
        description="切换到团队协作工作台"
        onClick={() => {
          void navigate('/team');
        }}
      />
    </div>
  );
}
