export type HomeSessionTimeGroupKey = 'today' | 'yesterday' | 'earlier';

export interface HomeSessionLike {
  readonly id: string;
  readonly metadata_json?: string;
  readonly state_status?: 'idle' | 'running' | 'paused';
  readonly title: string | null;
  readonly updated_at: string;
}

export interface HomeProjectSummary {
  readonly key: string;
  readonly label: string;
  readonly path: string | null;
  readonly sessionCount: number;
  readonly runningCount: number;
}

export interface HomeSessionTimeGroup<TSession extends HomeSessionLike> {
  readonly key: HomeSessionTimeGroupKey;
  readonly label: string;
  readonly sessions: readonly TSession[];
}

interface ParsedSessionMetadata {
  readonly modelId: string | null;
  readonly workingDirectory: string | null;
}

const UNBOUND_PROJECT_KEY = '__unbound__';
const DAY_MS = 86_400_000;

export function getProjectKey(path: string | null): string {
  return path ?? UNBOUND_PROJECT_KEY;
}

export function getSessionTitle(session: Pick<HomeSessionLike, 'id' | 'title'>): string {
  const title = session.title?.trim();
  return title && title.length > 0 ? title : `会话 ${session.id.slice(0, 8)}`;
}

export function getWorkspaceName(path: string | null): string {
  if (!path) {
    return '未绑定工作区';
  }

  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function getWorkingDirectory(metadataJson: string | undefined): string | null {
  return parseSessionMetadata(metadataJson).workingDirectory;
}

export function getSessionSearchText(session: HomeSessionLike): string {
  const workspacePath = getWorkingDirectory(session.metadata_json);
  const metadata = parseSessionMetadata(session.metadata_json);
  const fields = [
    session.id,
    getSessionTitle(session),
    workspacePath,
    workspacePath ? getWorkspaceName(workspacePath) : null,
    session.state_status ?? null,
    metadata.modelId,
    session.metadata_json ?? null,
  ];

  return fields
    .filter((field): field is string => Boolean(field))
    .join(' ')
    .toLowerCase();
}

export function formatRelativeTime(value: string | null | undefined, now = new Date()): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return '未知时间';
  }

  const minutes = Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} 天前`;
  }

  return new Intl.DateTimeFormat('zh-CN', { day: '2-digit', month: '2-digit' }).format(
    new Date(timestamp),
  );
}

export function buildHomeProjects<TSession extends HomeSessionLike>(
  sessions: readonly TSession[],
): HomeProjectSummary[] {
  const projectsByKey = new Map<string, HomeProjectSummary>();

  for (const session of sessions) {
    const path = getWorkingDirectory(session.metadata_json);
    const key = getProjectKey(path);
    const existing = projectsByKey.get(key);
    const runningIncrement = session.state_status === 'running' ? 1 : 0;

    projectsByKey.set(key, {
      key,
      label: existing?.label ?? getWorkspaceName(path),
      path,
      runningCount: (existing?.runningCount ?? 0) + runningIncrement,
      sessionCount: (existing?.sessionCount ?? 0) + 1,
    });
  }

  return Array.from(projectsByKey.values()).sort((left, right) => {
    if (right.runningCount !== left.runningCount) {
      return right.runningCount - left.runningCount;
    }
    return right.sessionCount - left.sessionCount;
  });
}

export function filterSessionsByProject<TSession extends HomeSessionLike>(
  sessions: readonly TSession[],
  selectedProjectKey: string,
): TSession[] {
  if (selectedProjectKey === 'all') {
    return [...sessions];
  }

  return sessions.filter(
    (session) => getProjectKey(getWorkingDirectory(session.metadata_json)) === selectedProjectKey,
  );
}

export function searchHomeSessions<TSession extends HomeSessionLike>(
  sessions: readonly TSession[],
  query: string,
): TSession[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return sessions.filter((session) => getSessionSearchText(session).includes(normalizedQuery));
}

export function groupSessionsByTime<TSession extends HomeSessionLike>(
  sessions: readonly TSession[],
  now = new Date(),
): HomeSessionTimeGroup<TSession>[] {
  const buckets: Record<HomeSessionTimeGroupKey, TSession[]> = {
    earlier: [],
    today: [],
    yesterday: [],
  };

  for (const session of [...sessions].sort(compareSessionsByUpdatedAt)) {
    buckets[getTimeGroupKey(session.updated_at, now)].push(session);
  }

  const groups: HomeSessionTimeGroup<TSession>[] = [
    { key: 'today', label: '今天', sessions: buckets.today },
    { key: 'yesterday', label: '昨天', sessions: buckets.yesterday },
    { key: 'earlier', label: '更早', sessions: buckets.earlier },
  ];

  return groups.filter((group) => group.sessions.length > 0);
}

function compareSessionsByUpdatedAt(left: HomeSessionLike, right: HomeSessionLike): number {
  return (parseTimestamp(right.updated_at) ?? 0) - (parseTimestamp(left.updated_at) ?? 0);
}

function getTimeGroupKey(value: string, now: Date): HomeSessionTimeGroupKey {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return 'earlier';
  }

  const targetStart = startOfLocalDay(new Date(timestamp)).getTime();
  const todayStart = startOfLocalDay(now).getTime();
  const yesterdayStart = todayStart - DAY_MS;

  if (targetStart === todayStart) {
    return 'today';
  }
  if (targetStart === yesterdayStart) {
    return 'yesterday';
  }
  return 'earlier';
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function parseSessionMetadata(metadataJson: string | undefined): ParsedSessionMetadata {
  if (!metadataJson) {
    return { modelId: null, workingDirectory: null };
  }

  try {
    const parsed = JSON.parse(metadataJson);
    if (typeof parsed !== 'object' || parsed === null) {
      return { modelId: null, workingDirectory: null };
    }

    const modelId = Reflect.get(parsed, 'modelId');
    const workingDirectory = Reflect.get(parsed, 'workingDirectory');

    return {
      modelId: typeof modelId === 'string' && modelId.trim().length > 0 ? modelId.trim() : null,
      workingDirectory:
        typeof workingDirectory === 'string' && workingDirectory.trim().length > 0
          ? workingDirectory.trim()
          : null,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { modelId: null, workingDirectory: null };
    }
    throw error;
  }
}
