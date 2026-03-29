import { useNavigate, useLocation } from 'react-router';

function IconMessages() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconBox() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const navItems = [
  { path: '/sessions', icon: <IconMessages />, label: 'Sessions' },
  { path: '/artifacts', icon: <IconBox />, label: 'Artifacts' },
];

export default function NavRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const onSettings = location.pathname.startsWith('/settings');

  return (
    <div
      className="w-12 shrink-0 h-full flex flex-col items-center py-2 gap-1"
      style={{
        background: 'hsl(var(--muted) / 0.3)',
        borderRight: '1px solid hsl(var(--border))',
      }}
    >
      {navItems.map((item) => {
        const active = location.pathname.startsWith(item.path);
        return (
          <button
            key={item.path}
            type="button"
            aria-label={item.label}
            title={item.label}
            onClick={() => void navigate(item.path)}
            className="size-9 rounded-lg flex items-center justify-center transition-colors duration-150"
            style={{
              background: active ? 'hsl(var(--primary) / 0.1)' : 'transparent',
              color: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {item.icon}
          </button>
        );
      })}

      <div className="flex-1" />

      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        onClick={() => void navigate('/settings')}
        className="size-9 rounded-lg flex items-center justify-center transition-colors duration-150"
        style={{
          background: onSettings ? 'hsl(var(--primary) / 0.1)' : 'transparent',
          color: onSettings ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <IconSettings />
      </button>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          marginBottom: 4,
        }}
      >
        <span
          className="select-none"
          style={{ fontSize: 9, color: 'hsl(var(--muted-foreground) / 0.4)' }}
        >
          v0.1
        </span>
        <a
          href="https://github.com/Await-d/OpenAWork"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub 仓库"
          style={{ color: 'hsl(var(--muted-foreground) / 0.4)', display: 'flex', lineHeight: 1 }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="currentColor"
            role="img"
            aria-label="GitHub 仓库"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    </div>
  );
}
