import { tokens } from '@openAwork/shared-ui';
import type { ArtifactSessionSummary } from './artifact-workspace-types.js';
import { formatArtifactTimestamp } from './artifact-workbench-utils.js';

interface ArtifactSessionRailProps {
  loading: boolean;
  selectedSessionId: string | null;
  sessions: ArtifactSessionSummary[];
  onSelect: (sessionId: string) => void;
}

export function ArtifactSessionRail({
  loading,
  selectedSessionId,
  sessions,
  onSelect,
}: ArtifactSessionRailProps) {
  return (
    <section
      aria-label="会话列表"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacing.sm,
        minWidth: 0,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Session Rail
        </div>
        <h2
          style={{
            margin: '6px 0 0',
            fontSize: 18,
            color: 'var(--text)',
            textWrap: 'balance',
          }}
        >
          按会话浏览产物工作区
        </h2>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.spacing.xs,
          padding: tokens.spacing.sm,
          borderRadius: tokens.radius.lg,
          border: `1px solid ${tokens.color.borderSubtle}`,
          background: 'color-mix(in oklch, var(--surface) 82%, transparent)',
          boxShadow: tokens.shadow.sm,
          minHeight: 260,
        }}
      >
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>加载会话…</div>
        ) : sessions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
            还没有可浏览的会话。先在聊天页产出一个 artifact，工作区就会出现在这里。
          </div>
        ) : (
          sessions.map((session) => {
            const selected = session.id === selectedSessionId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 11px',
                  borderRadius: tokens.radius.md,
                  border: selected
                    ? '1px solid color-mix(in oklch, var(--accent) 44%, var(--border))'
                    : `1px solid ${tokens.color.borderSubtle}`,
                  background: selected
                    ? 'color-mix(in oklch, var(--accent) 16%, var(--surface) 84%)'
                    : 'color-mix(in oklch, var(--surface) 64%, transparent)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--text)',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={session.title ?? '未命名会话'}
                >
                  {session.title ?? '未命名会话'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
                  {session.id.slice(0, 8)}…
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  最近更新 {formatArtifactTimestamp(session.updatedAt)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
