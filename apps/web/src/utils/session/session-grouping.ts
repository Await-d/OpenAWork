import {
  extractParentSessionId,
  extractSshConnectionId,
  extractWorkingDirectory,
} from './session-metadata.js';
import { getPathBasename } from '../workspace-path.js';

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

/**
 * 会话的会话组标题。
 *
 * 会话列表分组标题、/sessions 分组标题、首页项目名与相关删除确认文案统一取此值，
 * 避免各处出现「未绑定工作区」等不一致措辞。
 */
export const UNBOUND_WORKSPACE_LABEL = '会话';

/** 会话的路径占位文案（分组副标题 / 项目路径行）。 */
export const UNBOUND_WORKSPACE_PATH_LABEL = '未指定路径';

export function getWorkspaceGroupKey(workspacePath: string | null): string {
  return workspacePath ?? UNBOUND_WORKSPACE_GROUP_KEY;
}

export function countSessionsByWorkspace<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
): Map<string, number> {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const resolvedBindingCache = new Map<string, SessionWorkspaceBinding>();
  const counts = new Map<string, number>();

  for (const session of sessions) {
    const groupKey = getWorkspaceGroupKey(
      resolveSessionWorkspaceBinding(session, sessionsById, resolvedBindingCache).workspacePath,
    );
    counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1);
  }

  return counts;
}

export function groupSessionsByWorkspace<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
  savedWorkspacePaths: readonly string[] = [],
  pinnedSessionIds: readonly string[] = [],
): WorkspaceSessionGroup<TSession>[] {
  const orderedSessions = [...sessions].sort((a, b) =>
    compareSessionsByUpdatedAt(a, b, pinnedSessionIds),
  );
  const groups = new Map<string, WorkspaceSessionGroup<TSession>>();
  const savedWorkspaceOrder = new Map<string, number>();
  const sessionsById = new Map(orderedSessions.map((session) => [session.id, session]));
  const resolvedBindingCache = new Map<string, SessionWorkspaceBinding>();

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
    const workspacePath = resolveSessionWorkspaceBinding(
      session,
      sessionsById,
      resolvedBindingCache,
    ).workspacePath;
    const groupKey = getWorkspaceGroupKey(workspacePath);
    const existing = groups.get(groupKey);

    if (existing) {
      existing.sessions.push(session);
      continue;
    }

    const nextGroup: WorkspaceSessionGroup<TSession> = {
      workspacePath,
      workspaceLabel: workspacePath ? basename(workspacePath) : UNBOUND_WORKSPACE_LABEL,
      sessions: [session],
    };
    groups.set(groupKey, nextGroup);
  }

  return sortWorkspaceGroups(Array.from(groups.values()), savedWorkspaceOrder);
}

export function groupSessionTreesByWorkspace<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
  savedWorkspacePaths: readonly string[] = [],
  pinnedSessionIds: readonly string[] = [],
): WorkspaceSessionTreeGroup<TSession>[] {
  return buildWorkspaceSessionCollections(sessions, savedWorkspacePaths, pinnedSessionIds)
    .treeGroups;
}

export function buildWorkspaceSessionCollections<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
  savedWorkspacePaths: readonly string[] = [],
  pinnedSessionIds: readonly string[] = [],
): WorkspaceSessionCollections<TSession> {
  const groups = groupSessionsByWorkspace(sessions, savedWorkspacePaths, pinnedSessionIds);
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

export function listWorkspacePathsFromSessions<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
): string[] {
  const orderedSessions = [...sessions].sort(compareSessionsByUpdatedAt);
  const sessionsById = new Map(orderedSessions.map((session) => [session.id, session]));
  const resolvedBindingCache = new Map<string, SessionWorkspaceBinding>();
  const workspacePaths: string[] = [];
  const seenWorkspacePaths = new Set<string>();

  for (const session of orderedSessions) {
    const workspacePath = resolveSessionWorkspaceBinding(
      session,
      sessionsById,
      resolvedBindingCache,
    ).workspacePath;
    if (!workspacePath || seenWorkspacePaths.has(workspacePath)) {
      continue;
    }

    seenWorkspacePaths.add(workspacePath);
    workspacePaths.push(workspacePath);
  }

  return workspacePaths;
}

export function filterSessionTreeGroupsByQuery<TSession extends SessionWithWorkspaceLike>(
  groups: WorkspaceSessionTreeGroup<TSession>[],
  query: string,
): WorkspaceSessionTreeGroup<TSession>[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return groups;
  }

  return filterSessionTreeGroupsByMatcher(groups, (session) =>
    matchesSessionQuery(session, normalizedQuery),
  );
}

/**
 * 按自定义匹配函数过滤会话树：保留命中的节点及其祖先链，
 * 供「标题命中 ∪ 消息内容命中」等组合条件复用。
 */
export function filterSessionTreeGroupsByMatcher<TSession extends SessionWithWorkspaceLike>(
  groups: WorkspaceSessionTreeGroup<TSession>[],
  matches: (session: TSession) => boolean,
): WorkspaceSessionTreeGroup<TSession>[] {
  return groups.map((group) => {
    const roots = group.roots
      .map((node) => filterSessionTreeNode(node, matches))
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
  matches: (session: TSession) => boolean,
): WorkspaceSessionTreeNode<TSession> | null {
  const filteredChildren = node.children
    .map((child) => filterSessionTreeNode(child, matches))
    .filter((child): child is WorkspaceSessionTreeNode<TSession> => child !== null);

  if (!matches(node.session) && filteredChildren.length === 0) {
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
    // 会话的会话组永远沉底：无论组内会话多新、其他组是否为空。
    if (a.workspacePath === null && b.workspacePath !== null) return 1;
    if (a.workspacePath !== null && b.workspacePath === null) return -1;

    const aHasSessions = a.sessions.length > 0;
    const bHasSessions = b.sessions.length > 0;
    if (aHasSessions && !bHasSessions) return -1;
    if (!aHasSessions && bHasSessions) return 1;

    return a.workspaceLabel.localeCompare(b.workspaceLabel, undefined, { sensitivity: 'base' });
  });

  return orderedGroups;
}

function compareSessionsByUpdatedAt<TSession extends SessionWithWorkspaceLike>(
  a: TSession,
  b: TSession,
  pinnedSessionIds: readonly string[] = [],
): number {
  const aPinned = pinnedSessionIds.includes(a.id);
  const bPinned = pinnedSessionIds.includes(b.id);

  // 置顶的会话优先
  if (aPinned && !bPinned) return -1;
  if (!aPinned && bPinned) return 1;

  const byUpdatedAt = b.updated_at.localeCompare(a.updated_at);
  if (byUpdatedAt !== 0) {
    return byUpdatedAt;
  }

  const aTitle = (a.title ?? '').toLowerCase();
  const bTitle = (b.title ?? '').toLowerCase();
  const byTitle = aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' });
  if (byTitle !== 0) {
    return byTitle;
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

/**
 * 会话工作区绑定（路径 + SSH 连接 id）。
 *
 * 两个字段各自沿父会话链继承（与 `useWorkspace` / 网关解析口径一致）：
 * 只继承远端路径而丢掉连接 id 会让新建的会话落到错误的校验分支。
 */
export interface SessionWorkspaceBinding {
  readonly workspacePath: string | null;
  readonly sshConnectionId: string | null;
}

/**
 * 按会话 id 从已加载的会话列表解析工作区绑定（与分组共用同一套父会话继承规则）。
 *
 * 列表可能被路径筛选 / 分页截断：目标会话不在列表里时返回 `undefined`，
 * 让调用方区分「未找到（可回落）」与「已确认未绑定」。
 */
export function resolveSessionWorkspaceBindingById<TSession extends SessionWithWorkspaceLike>(
  sessions: readonly TSession[],
  sessionId: string,
): SessionWorkspaceBinding | undefined {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const targetSession = sessionsById.get(sessionId);
  if (!targetSession) {
    return undefined;
  }

  return resolveSessionWorkspaceBinding(targetSession, sessionsById, new Map());
}

function resolveSessionWorkspaceBinding<TSession extends SessionWithWorkspaceLike>(
  session: TSession,
  sessionsById: Map<string, TSession>,
  resolvedBindingCache: Map<string, SessionWorkspaceBinding>,
  activeSessionIds: Set<string> = new Set(),
): SessionWorkspaceBinding {
  const cachedBinding = resolvedBindingCache.get(session.id);
  if (cachedBinding !== undefined) {
    return cachedBinding;
  }

  const ownWorkspacePath = extractWorkingDirectory(session.metadata_json);
  const ownSshConnectionId = extractSshConnectionId(session.metadata_json);
  const ownBinding: SessionWorkspaceBinding = {
    workspacePath: ownWorkspacePath,
    sshConnectionId: ownSshConnectionId,
  };

  // 两个字段各自沿父链继承（与 useWorkspace / 网关解析口径一致）：
  // 子会话可能只带 parentSessionId，也可能只补了 workingDirectory 而 SSH
  // 绑定落在祖先层级，任一字段缺失都要继续向上找。
  const parentSessionId = extractParentSessionId(session.metadata_json);
  const parentSession =
    parentSessionId && !activeSessionIds.has(session.id)
      ? sessionsById.get(parentSessionId)
      : undefined;
  if (!parentSession) {
    resolvedBindingCache.set(session.id, ownBinding);
    return ownBinding;
  }

  activeSessionIds.add(session.id);
  const inheritedBinding = resolveSessionWorkspaceBinding(
    parentSession,
    sessionsById,
    resolvedBindingCache,
    activeSessionIds,
  );
  activeSessionIds.delete(session.id);

  const resolvedBinding: SessionWorkspaceBinding = {
    workspacePath: ownWorkspacePath ?? inheritedBinding.workspacePath,
    sshConnectionId: ownSshConnectionId ?? inheritedBinding.sshConnectionId,
  };
  resolvedBindingCache.set(session.id, resolvedBinding);
  return resolvedBinding;
}

function normalizeWorkspacePath(path: string): string | null {
  const normalized = path.trim();
  return normalized.length > 0 ? normalized : null;
}

function basename(path: string): string {
  return getPathBasename(path, path);
}
