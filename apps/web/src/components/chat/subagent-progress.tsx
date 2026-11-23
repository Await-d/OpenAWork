import { createContext, useContext, useState, type ReactNode } from 'react';
import './subagent-progress.css';
import type { SubagentNotice } from '@openAwork/shared';
import { ShellProgressProvider, type ShellCreation } from './shell-progress.js';

export interface SubagentCreation {
  sessionId: string;
  createdAt?: number;
}

/** Creation time, never status/update time; ties and missing timestamps use the id. */
export function orderSubagentSessions(items: readonly SubagentCreation[]): string[] {
  const created = new Map<string, number>();
  for (const item of items) {
    if (!item.sessionId) continue;
    const time = Number.isFinite(item.createdAt) ? (item.createdAt ?? 0) : 0;
    const previous = created.get(item.sessionId);
    // A resumed task must not turn an older child into a newly created session.
    created.set(item.sessionId, previous === undefined ? time : Math.min(previous, time));
  }
  return [...created.keys()].sort(
    (left, right) =>
      (created.get(right) ?? 0) - (created.get(left) ?? 0) || left.localeCompare(right),
  );
}

interface SubagentProgress {
  knownIds: ReadonlySet<string>;
  visibleIds: ReadonlySet<string>;
  orderedIds: readonly string[];
  remaining: number;
  loadMore: () => void;
}

const SubagentProgressContext = createContext<SubagentProgress | null>(null);

export function SubagentProgressProvider({
  sessions,
  notices = [],
  shells,
  parentSessionId = null,
  children,
}: {
  sessions: readonly SubagentCreation[];
  notices?: readonly SubagentNotice[];
  shells?: readonly ShellCreation[];
  parentSessionId?: string | null;
  children: ReactNode;
}) {
  const known = new Set(sessions.map((session) => session.sessionId));
  const noticeSessions = notices
    .filter(
      (notice) =>
        notice.source === 'subagent' &&
        notice.targetSessionId &&
        !known.has(notice.targetSessionId),
    )
    .map((notice) => ({ sessionId: notice.targetSessionId ?? '' }));
  const progress = useLocalSubagentProgress([...sessions, ...noticeSessions], parentSessionId);
  return (
    <SubagentProgressContext value={progress}>
      {shells ? (
        <ShellProgressProvider shells={shells} parentSessionId={parentSessionId}>
          {children}
        </ShellProgressProvider>
      ) : (
        children
      )}
    </SubagentProgressContext>
  );
}

function useLocalSubagentProgress(
  sessions: readonly SubagentCreation[],
  scope: string | null = null,
): SubagentProgress {
  const [page, setPage] = useState({ scope, limit: 5 });
  const limit = page.scope === scope ? page.limit : 5;
  if (page.scope !== scope) setPage({ scope, limit: 5 });
  const orderedIds = orderSubagentSessions(sessions);
  return {
    orderedIds,
    knownIds: new Set(orderedIds),
    visibleIds: new Set(orderedIds.slice(0, limit)),
    remaining: Math.max(0, orderedIds.length - limit),
    loadMore: () => setPage((previous) => ({ scope, limit: previous.limit + 5 })),
  };
}

export function useSubagentProgress() {
  return useContext(SubagentProgressContext);
}

/** Standalone panels share the same paging behavior without requiring a ChatPage. */
export function useProgressiveSubagents<T>(
  items: readonly T[],
  identify: (item: T) => SubagentCreation,
  parentSessionId: string | null = null,
) {
  const shared = useSubagentProgress();
  const local = useLocalSubagentProgress(items.map(identify), parentSessionId);
  const progress = shared ?? local;
  const rank = new Map(progress.orderedIds.map((id, index) => [id, index]));
  const visible = items
    .filter((item) => progress.visibleIds.has(identify(item).sessionId))
    .sort(
      (left, right) =>
        (rank.get(identify(left).sessionId) ?? 0) - (rank.get(identify(right).sessionId) ?? 0),
    );
  return { ...progress, visible };
}

export function SubagentLoadMore({ progress }: { progress?: SubagentProgress | null }) {
  const shared = useSubagentProgress();
  const value = progress ?? shared;
  if (!value || value.remaining === 0) return null;
  return (
    <button type="button" className="subagent-load-more" onClick={value.loadMore}>
      加载更多子代理（{Math.min(5, value.remaining)} 个，剩余 {value.remaining} 个）
    </button>
  );
}
