import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useStickyHeaderOpacity } from './hooks/useStickyHeaderOpacity.js';
import {
  formatRelativeTime,
  getSessionTitle,
  getWorkspaceName,
  getWorkingDirectory,
  groupSessionsByTime,
} from './utils/session-grouping.js';
import type { HomeSessionLike } from './utils/session-grouping.js';

interface HomeSessionListProps<TSession extends HomeSessionLike> {
  readonly children: ReactNode;
  readonly emptyDescription: string;
  readonly sessions: readonly TSession[];
  readonly title: string;
  readonly onCreateSession: () => void;
  readonly onOpenSession: (sessionId: string, title: string | null | undefined) => void;
}

export function HomeSessionList<TSession extends HomeSessionLike>({
  children,
  emptyDescription,
  sessions,
  title,
  onCreateSession,
  onOpenSession,
}: HomeSessionListProps<TSession>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupSessionsByTime(sessions), [sessions]);
  const groupKeys = useMemo(() => groups.map((group) => group.key), [groups]);
  const headerOpacity = useStickyHeaderOpacity(scrollRef, groupKeys);

  return (
    <section className="home-session-panel" aria-label="最近会话">
      <header className="home-session-panel-header">
        <div>
          <span className="home-eyebrow">最近会话</span>
          <h2>{title}</h2>
          <p className="home-session-panel-summary">
            {sessions.length === 0
              ? '还没有可见会话'
              : `共 ${sessions.length} 个会话，按最近更新时间排序`}
          </p>
        </div>
        <button type="button" className="home-primary-action" onClick={onCreateSession}>
          新建会话
        </button>
      </header>

      <div className="home-session-search-slot">{children}</div>

      <div ref={scrollRef} className="home-session-scroll">
        {groups.length === 0 ? (
          <div className="home-empty-state">
            <strong>还没有会话</strong>
            <span>{emptyDescription}</span>
          </div>
        ) : (
          groups.map((group) => (
            <section
              key={group.key}
              className="home-session-group"
              aria-labelledby={`home-${group.key}`}
            >
              <header
                id={`home-${group.key}`}
                className="home-session-group-header"
                data-home-group-header={group.key}
                style={{ opacity: headerOpacity[group.key] ?? 1 }}
              >
                <span>{group.label}</span>
                <small>{group.sessions.length}</small>
              </header>
              <div className="home-session-group-list">
                {group.sessions.map((session) => {
                  const workspacePath = getWorkingDirectory(session.metadata_json);
                  return (
                    <button
                      key={session.id}
                      type="button"
                      className="home-session-row"
                      onClick={() => onOpenSession(session.id, session.title)}
                    >
                      <span className="home-session-avatar" aria-hidden="true">
                        {getSessionTitle(session).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="home-session-copy">
                        <span className="home-session-title">{getSessionTitle(session)}</span>
                        <span className="home-session-meta">
                          {getWorkspaceName(workspacePath)} ·{' '}
                          {formatRelativeTime(session.updated_at)}
                        </span>
                      </span>
                      <span
                        className="home-session-state"
                        data-state={session.state_status ?? 'idle'}
                      >
                        {formatSessionState(session.state_status)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </section>
  );
}

function formatSessionState(state: HomeSessionLike['state_status']): string {
  switch (state) {
    case 'paused':
      return '暂停';
    case 'running':
      return '运行';
    case 'idle':
    case undefined:
      return '空闲';
  }
}
