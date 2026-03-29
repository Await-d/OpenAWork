import { useNavigate, useLocation } from 'react-router';

const navItems = [
  { label: 'Sessions', path: '/sessions' },
  { label: 'Artifacts', path: '/artifacts' },
  { label: 'Settings', path: '/settings' },
];

export default function TitleBar() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div
      data-tauri-drag-region
      className="h-10 w-full shrink-0 flex items-center px-3 gap-2"
      style={{
        background: 'hsl(var(--background) / 0.8)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid hsl(var(--border) / 0.5)',
      }}
    >
      <span
        className="text-xs font-semibold select-none"
        style={{ color: 'hsl(var(--foreground) / 0.9)', letterSpacing: '0.04em' }}
        data-tauri-drag-region
      >
        OpenAWork
      </span>

      <div className="flex-1" data-tauri-drag-region />

      <div className="flex items-center gap-0.5" style={{ pointerEvents: 'auto' }}>
        {navItems.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => void navigate(item.path)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors duration-150"
              style={{
                background: active ? 'hsl(var(--primary) / 0.12)' : 'transparent',
                color: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
