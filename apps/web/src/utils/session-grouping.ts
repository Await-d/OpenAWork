import { extractParentSessionId, extractWorkingDirectory } from './session-metadata.js';

export interface SessionWithWorkspaceLike {
  id: string;
  title?: string | null;
  updated_at: string;
  metadata_json?: string;
}

export interface WorkspaceSessionGroup<TSession extends SessionWithWorkspaceLike> {
  workspacePath: string | null;
  workspaceLabel: string;
  sessions: TSession[];
}

export interface WorkspaceSessionTreeNode<TSession extends SessionWithWorkspaceLike> {
  children: WorkspaceSessionTreeNode<TSession>[];
  session: TSession;
}

export interface WorkspaceSessionTreeGroup<
  TSession extends SessionWithWorkspaceLike,
> extends WorkspaceSessionGroup<TSession> {
  roots: WorkspaceSessionTreeNode<TSession>[];
}

export interface WorkspaceSessionCollections<TSession extends SessionWithWorkspaceLike> {
  groups: WorkspaceSessionGroup<TSession>[];
  sessionCountByWorkspace: Map<string, number>;
  sessionIdsByGroupKey: Map<string, string[]>;
  treeGroups: WorkspaceSessionTreeGroup<TSession>[];
}

export const UNBOUND_WORKSPACE_GROUP_KEY = '__unbound__';

export function getWorkspaceGroupKey(workspacePath: string | null): string {
  return workspacePath ?? UNBOUND_WORKSPACE_GROUP_KEY;
}

export function countSessionsByWorkspace<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
): Map<string, number> {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const resolvedWorkspaceCache = new Map<string, string | null>();
  const counts = new Map<string, number>();

  for (const session of sessions) {
    const groupKey = getWorkspaceGroupKey(
      resolveSessionWorkspacePath(session, sessionsById, resolvedWorkspaceCache),
    );
    counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1);
  }

  return counts;
}

export function groupSessionsByWorkspace<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
  savedWorkspacePaths: readonly string[] = [],
): WorkspaceSessionGroup<TSession>[] {
  const orderedSessions = [...sessions].sort(compareSessionsByUpdatedAt);
  const groups = new Map<string, WorkspaceSessionGroup<TSession>>();
  const savedWorkspaceOrder = new Map<string, number>();
  const sessionsById = new Map(orderedSessions.map((session) => [session.id, session]));
  const resolvedWorkspaceCache = new Map<string, string | null>();

  savedWorkspacePaths.forEach((path, index) => {
    const normalizedPath = normalizeWorkspacePath(path);
    if (!normalizedPath) {
      return;
    }

    if (!savedWorkspaceOrder.has(normalizedPath)) {
      savedWorkspaceOrder.set(normalizedPath, index);
    }

    if (!groups.has(normalizedPath)) {
      groups.set(normalizedPath, {
        workspacePath: normalizedPath,
        workspaceLabel: basename(normalizedPath),
        sessions: [],
      });
    }
  });

  for (const session of orderedSessions) {
    const workspacePath = resolveSessionWorkspacePath(
      session,
      sessionsById,
      resolvedWorkspaceCache,
    );
    const groupKey = getWorkspaceGroupKey(workspacePath);
    const existing = groups.get(groupKey);

    if (existing) {
      existing.sessions.push(session);
      continue;
    }

    const nextGroup: WorkspaceSessionGroup<TSession> = {
      workspacePath,
      workspaceLabel: workspacePath ? basename(workspacePath) : '未绑定工作区',
      sessions: [session],
    };
    groups.set(groupKey, nextGroup);
  }

  return sortWorkspaceGroups(Array.from(groups.values()), savedWorkspaceOrder);
}

export function groupSessionTreesByWorkspace<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
  savedWorkspacePaths: readonly string[] = [],
): WorkspaceSessionTreeGroup<TSession>[] {
  return buildWorkspaceSessionCollections(sessions, savedWorkspacePaths).treeGroups;
}

export function buildWorkspaceSessionCollections<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
  savedWorkspacePaths: readonly string[] = [],
): WorkspaceSessionCollections<TSession> {
  const groups = groupSessionsByWorkspace(sessions, savedWorkspacePaths);
  const sessionCountByWorkspace = new Map<string, number>();
  const sessionIdsByGroupKey = new Map<string, string[]>();
  const treeGroups = groups.map((group) => {
    const groupKey = getWorkspaceGroupKey(group.workspacePath);
    sessionCountByWorkspace.set(groupKey, group.sessions.length);
    sessionIdsByGroupKey.set(
      groupKey,
      group.sessions.map((session) => session.id),
    );

    return {
      ...group,
      roots: buildWorkspaceSessionTree(group.sessions),
    };
  });

  return {
    groups,
    sessionCountByWorkspace,
    sessionIdsByGroupKey,
    treeGroups,
  };
}

export function filterSessionTreeGroupsByQuery<TSession extends SessionWithWorkspaceLike>(
  groups: WorkspaceSessionTreeGroup<TSession>[],
  query: string,
): WorkspaceSessionTreeGroup<TSession>[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return groups;
  }

  return groups.map((group) => {
    const roots = group.roots
      .map((node) => filterSessionTreeNode(node, normalizedQuery))
      .filter((node): node is WorkspaceSessionTreeNode<TSession> => node !== null);

    return {
      ...group,
      roots,
      sessions: flattenSessionTreeNodes(roots).map((node) => node.session),
    };
  });
}

function buildWorkspaceSessionTree<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
): WorkspaceSessionTreeNode<TSession>[] {
  const nodeBySessionId = new Map<string, WorkspaceSessionTreeNode<TSession>>(
    sessions.map((session) => [
      session.id,
      {
        session,
        children: [],
      },
    ]),
  );
  const roots: WorkspaceSessionTreeNode<TSession>[] = [];

  for (const session of sessions) {
    const node = nodeBySessionId.get(session.id);
    if (!node) {
      continue;
    }

    const parentSessionId = extractParentSessionId(session.metadata_json);
    if (!parentSessionId) {
      roots.push(node);
      continue;
    }

    const parentNode = nodeBySessionId.get(parentSessionId);
    if (!parentNode) {
      roots.push(node);
      continue;
    }

    parentNode.children.push(node);
  }

  return roots;
}

function filterSessionTreeNode<TSession extends SessionWithWorkspaceLike>(
  node: WorkspaceSessionTreeNode<TSession>,
  query: string,
): WorkspaceSessionTreeNode<TSession> | null {
  const filteredChildren = node.children
    .map((child) => filterSessionTreeNode(child, query))
    .filter((child): child is WorkspaceSessionTreeNode<TSession> => child !== null);

  if (!matchesSessionQuery(node.session, query) && filteredChildren.length === 0) {
    return null;
  }

  return {
    session: node.session,
    children: filteredChildren,
  };
}

function flattenSessionTreeNodes<TSession extends SessionWithWorkspaceLike>(
  roots: WorkspaceSessionTreeNode<TSession>[],
): WorkspaceSessionTreeNode<TSession>[] {
  const flattened: WorkspaceSessionTreeNode<TSession>[] = [];

  const visit = (node: WorkspaceSessionTreeNode<TSession>) => {
    flattened.push(node);
    for (const child of node.children) {
      visit(child);
    }
  };

  for (const root of roots) {
    visit(root);
  }

  return flattened;
}

function matchesSessionQuery<TSession extends SessionWithWorkspaceLike>(
  session: TSession,
  query: string,
): boolean {
  return (session.title ?? session.id).toLowerCase().includes(query);
}

function sortWorkspaceGroups<TSession extends SessionWithWorkspaceLike>(
  groups: WorkspaceSessionGroup<TSession>[],
  savedWorkspaceOrder: Map<string, number>,
): WorkspaceSessionGroup<TSession>[] {
  const orderedGroups = [...groups];

  orderedGroups.sort((a, b) => {
    if (a.workspacePath === null && b.workspacePath !== null) return 1;
    if (a.workspacePath !== null && b.workspacePath === null) return -1;

    const aHasSessions = a.sessions.length > 0;
    const bHasSessions = b.sessions.length > 0;
    if (aHasSessions && !bHasSessions) return -1;
    if (!aHasSessions && bHasSessions) return 1;

    const byLatest = getLatestUpdatedAt(b.sessions).localeCompare(getLatestUpdatedAt(a.sessions));
    if (byLatest !== 0) {
      return byLatest;
    }

    const aSavedOrder =
      a.workspacePath === null
        ? Number.MAX_SAFE_INTEGER
        : (savedWorkspaceOrder.get(a.workspacePath) ?? Number.MAX_SAFE_INTEGER);
    const bSavedOrder =
      b.workspacePath === null
        ? Number.MAX_SAFE_INTEGER
        : (savedWorkspaceOrder.get(b.workspacePath) ?? Number.MAX_SAFE_INTEGER);
    return aSavedOrder - bSavedOrder;
  });

  return orderedGroups;
}

function compareSessionsByUpdatedAt<TSession extends SessionWithWorkspaceLike>(
  a: TSession,
  b: TSession,
): number {
  const byUpdatedAt = b.updated_at.localeCompare(a.updated_at);
  if (byUpdatedAt !== 0) {
    return byUpdatedAt;
  }

  return a.id.localeCompare(b.id);
}

function getLatestUpdatedAt<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
): string {
  return sessions.reduce((latest, session) => {
    return session.updated_at.localeCompare(latest) > 0 ? session.updated_at : latest;
  }, '');
}

function resolveSessionWorkspacePath<TSession extends SessionWithWorkspaceLike>(
  session: TSession,
  sessionsById: Map<string, TSession>,
  resolvedWorkspaceCache: Map<string, string | null>,
  activeSessionIds: Set<string> = new Set(),
): string | null {
  const cachedWorkspacePath = resolvedWorkspaceCache.get(session.id);
  if (cachedWorkspacePath !== undefined) {
    return cachedWorkspacePath;
  }

  const ownWorkspacePath = extractWorkingDirectory(session.metadata_json);
  if (ownWorkspacePath !== null) {
    resolvedWorkspaceCache.set(session.id, ownWorkspacePath);
    return ownWorkspacePath;
  }

  const parentSessionId = extractParentSessionId(session.metadata_json);
  if (!parentSessionId || activeSessionIds.has(session.id)) {
    resolvedWorkspaceCache.set(session.id, null);
    return null;
  }

  const parentSession = sessionsById.get(parentSessionId);
  if (!parentSession) {
    resolvedWorkspaceCache.set(session.id, null);
    return null;
  }

  activeSessionIds.add(session.id);
  const inheritedWorkspacePath = resolveSessionWorkspacePath(
    parentSession,
    sessionsById,
    resolvedWorkspaceCache,
    activeSessionIds,
  );
  activeSessionIds.delete(session.id);
  resolvedWorkspaceCache.set(session.id, inheritedWorkspacePath);
  return inheritedWorkspacePath;
}

function normalizeWorkspacePath(path: string): string | null {
  const normalized = path.trim();
  return normalized.length > 0 ? normalized : null;
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? path) : path;
}
