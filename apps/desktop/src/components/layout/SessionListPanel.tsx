import { useEffect, useState } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import { useNavigate, useLocation, useParams } from 'react-router';
import { useAuthStore } from '../../../../web/src/stores/auth.js';

interface SessionRow {
  id: string;
  state_status: string;
  updated_at: string;
}

export default function SessionListPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const { sessionId: activeSessionId } = useParams<{ sessionId: string }>();
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const visible = location.pathname === '/sessions' || location.pathname.startsWith('/chat/');

  useEffect(() => {
    if (!visible || !token) return;
    createSessionsClient(gatewayUrl)
      .list(token ?? '')
      .then((list) => {
        const nextSessions: SessionRow[] = list.map(
          (session): SessionRow => ({
            id: session.id,
            state_status: session.state_status ?? 'idle',
            updated_at: String(session.updatedAt ?? ''),
          }),
        );
        setSessions(nextSessions);
      })
      .catch((error) => {
        console.warn('Failed to load desktop session list', error);
      });
  }, [visible, token, gatewayUrl]);

  async function createSession() {
    if (!token) return;
    const session = await createSessionsClient(gatewayUrl).create(token ?? '');
    if (session.id) void navigate(`/chat/${session.id}`);
  }

  if (!visible) return null;

  return (
    <div
      className="shrink-0 h-full flex flex-col"
      style={{
        width: 240,
        borderRight: '1px solid hsl(var(--border))',
        background: 'hsl(var(--muted) / 0.15)',
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid hsl(var(--border) / 0.6)' }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          Sessions
        </span>
        <button
          type="button"
          aria-label="New session"
          onClick={() => void createSession()}
          className="size-6 rounded-md flex items-center justify-center text-xs font-bold transition-colors duration-150"
          style={{
            background: 'hsl(var(--primary) / 0.15)',
            color: 'hsl(var(--primary))',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1 px-1">
        {sessions.length === 0 ? (
          <p className="px-2 py-3 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            No sessions yet.
          </p>
        ) : (
          sessions.map((s) => {
            const active = s.id === activeSessionId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => void navigate(`/chat/${s.id}`)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors duration-150"
                style={{
                  background: active ? 'hsl(var(--accent) / 0.1)' : 'transparent',
                  color: active ? 'hsl(var(--accent))' : 'hsl(var(--foreground) / 0.8)',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span className="truncate leading-4" style={{ fontSize: 13 }}>
                  {s.id.slice(0, 8)}\u2026
                </span>
                <span
                  className="ml-auto shrink-0"
                  style={{ fontSize: 10, color: 'hsl(var(--muted-foreground) / 0.5)' }}
                >
                  {s.state_status}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
