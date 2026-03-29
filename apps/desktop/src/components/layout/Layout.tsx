import TitleBar from './TitleBar.js';
import NavRail from './NavRail.js';
import SessionListPanel from './SessionListPanel.js';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: 'hsl(var(--background))' }}
    >
      <TitleBar />
      <div className="flex flex-1 overflow-hidden px-1 pt-1 pb-1.5">
        <div
          className="flex flex-1 overflow-hidden rounded-lg"
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'hsl(var(--background) / 0.85)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 12px 40px -20px rgba(0,0,0,0.55)',
          }}
        >
          <NavRail />
          <SessionListPanel />
          <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
        </div>
      </div>
    </div>
  );
}
