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

/**
 * 工作区身份：路径 + 所属 SSH 连接。
 *
 * 工作区的完整身份是 `(sshConnectionId, workspacePath)` 二元组。远端目录路径
 * 只在**单台主机内**唯一——两台不同服务器的 `/srv/app` 是两个毫不相干的工作区，
 * 只按路径分组会把它们的会话合成一个组，并连带共享折叠态、别名与批量删除集合。
 * 本地工作区的 `sshConnectionId` 恒为 `null`。
 */
export interface WorkspaceIdentity {
  readonly workspacePath: string | null;
  readonly sshConnectionId: string | null;
}

export interface WorkspaceSessionGroup<TSession extends SessionWithWorkspaceLike> {
  workspacePath: string | null;
  workspaceLabel: string;
  /**
   * 组内会话绑定的 SSH 连接 id。
   *
   * 非空即表示该工作区是远端目录（`workspacePath` 为**该主机上**的绝对路径），
   * 会话列表据此渲染 SSH 标识与连接名，避免与同名本地目录或其它主机的同名目录混淆。
   * 组内会话全部未绑定时为 `null`。
   */
  sshConnectionId?: string | null;
  /**
   * 本组的身份键，由 {@link getWorkspaceGroupKey} 从 `workspacePath` 与
   * `sshConnectionId` 统一算出。
   *
   * 渲染层一律用这个字段，不要自己重算：折叠态、会话计数、批量删除集合都由本键
   * 存取，而这三者的 Map 键同样来自本函数——一旦某处用裸路径重算，远端分组的
   * 计数会静默变成 0、折叠失效，且不报任何错。
   */
  readonly groupKey: string;
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
 * 分组键内部字段分隔符。
 *
 * 用 U+0000（路径与 SSH 连接 id 中都不可能出现）而非 `/` 或 `:`，避免连接 id
 * 与路径拼接后产生可歧义的字符串——`getWorkspaceGroupKey` 的输出同时被当作
 * localStorage 折叠态键与 DOM id，歧义会直接导致分组串位。
 */
const WORKSPACE_GROUP_KEY_SEPARATOR = '\u0000';

/**
 * 工作区分组键：**完整工作区身份**（SSH 连接 + 路径）。
 *
 * 远端工作区必须带上 `sshConnectionId`——否则两台服务器的同名目录会落进同一个
 * 分组，表现为「新建的 ssh 工作区把旧的那个合并了」。
 *
 * `workspacePath` 为 `null`（未绑定工作区）时返回固定占位键，与连接维度无关；
 * 本地工作区（`sshConnectionId` 为空）返回裸路径，与历史键保持一致，
 * 使已持久化的本地分组折叠态继续有效。
 */
export function getWorkspaceGroupKey(
  workspacePath: string | null,
  sshConnectionId?: string | null,
): string {
  if (workspacePath === null) {
    return UNBOUND_WORKSPACE_GROUP_KEY;
  }

  const connectionId = sshConnectionId?.trim();
  return connectionId
    ? `${connectionId}${WORKSPACE_GROUP_KEY_SEPARATOR}${workspacePath}`
    : workspacePath;
}

/**
 * 该工作区是否处于折叠态。
 *
 * 远端分组键在引入连接维度后由裸路径升级为复合键，旧持久化数据里存的仍是裸路径。
 * 这里同时比对两个键，让升级前的折叠偏好对**远端工作区**继续生效；
 * 读取侧兼容即可，无需重写历史存储。
 */
export function isWorkspaceGroupCollapsed(
  collapsedGroupKeys: ReadonlySet<string>,
  workspacePath: string | null,
  sshConnectionId?: string | null,
): boolean {
  if (collapsedGroupKeys.has(getWorkspaceGroupKey(workspacePath, sshConnectionId))) {
    return true;
  }

  // 仅远端分组需要回落：本地分组的新旧键本就相同。
  if (sshConnectionId && workspacePath !== null && collapsedGroupKeys.has(workspacePath)) {
    return true;
  }

  return false;
}

/** 两个工作区是否指向同一个工作区身份。 */
export function isSameWorkspace(
  left: Pick<WorkspaceIdentity, 'workspacePath' | 'sshConnectionId'>,
  right: Pick<WorkspaceIdentity, 'workspacePath' | 'sshConnectionId'>,
): boolean {
  return (
    (left.sshConnectionId ?? null) === (right.sshConnectionId ?? null) &&
    left.workspacePath === right.workspacePath
  );
}

/**
 * 会话的会话组标题。
 *
 * 会话列表分组标题、/sessions 分组标题、首页项目名与相关删除确认文案统一取此值，
 * 避免各处出现「未绑定工作区」等不一致措辞。
 */
export const UNBOUND_WORKSPACE_LABEL = '会话';

/** 会话的路径占位文案（分组副标题 / 项目路径行）。 */
export const UNBOUND_WORKSPACE_PATH_LABEL = '未指定路径';

/**
 * 会话组展示名 = 用户自定义名称（别名）优先，回落到路径末段。
 *
 * 分组标题的默认值 {@link WorkspaceSessionGroup.workspaceLabel} 由纯函数计算，
 * 读不到别名；别名来自 localStorage，只能由 UI 层通过 `useWorkspaceDisplayName`
 * 注入解析函数。未绑定工作区的分组没有可命名的对象，直接沿用默认标签。
 */
export function resolveWorkspaceGroupDisplayName(
  group: { workspacePath: string | null; workspaceLabel: string; sshConnectionId?: string | null },
  resolveDisplayName: (workspacePath: string | null, sshConnectionId?: string | null) => string,
): string {
  return group.workspacePath === null
    ? group.workspaceLabel
    : resolveDisplayName(group.workspacePath, group.sshConnectionId ?? null);
}

export function countSessionsByWorkspace<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
): Map<string, number> {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const resolvedBindingCache = new Map<string, SessionWorkspaceBinding>();
  const counts = new Map<string, number>();

  for (const session of sessions) {
    const binding = resolveSessionWorkspaceBinding(session, sessionsById, resolvedBindingCache);
    const groupKey = getWorkspaceGroupKey(binding.workspacePath, binding.sshConnectionId);
    counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1);
  }

  return counts;
}

export function groupSessionsByWorkspace<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
  savedWorkspaces: readonly WorkspaceIdentity[] = [],
  pinnedSessionIds: readonly string[] = [],
): WorkspaceSessionGroup<TSession>[] {
  const orderedSessions = [...sessions].sort((a, b) =>
    compareSessionsByUpdatedAt(a, b, pinnedSessionIds),
  );
  const groups = new Map<string, WorkspaceSessionGroup<TSession>>();
  const sessionsById = new Map(orderedSessions.map((session) => [session.id, session]));
  const resolvedBindingCache = new Map<string, SessionWorkspaceBinding>();

  savedWorkspaces.forEach((workspace) => {
    const normalizedPath = normalizeWorkspacePath(workspace.workspacePath);
    if (!normalizedPath) {
      return;
    }

    const groupKey = getWorkspaceGroupKey(normalizedPath, workspace.sshConnectionId);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        workspacePath: normalizedPath,
        workspaceLabel: basename(normalizedPath),
        sshConnectionId: workspace.sshConnectionId ?? null,
        sessions: [],
      });
    }
  });

  for (const session of orderedSessions) {
    const binding = resolveSessionWorkspaceBinding(session, sessionsById, resolvedBindingCache);
    const workspacePath = binding.workspacePath;
    const groupKey = getWorkspaceGroupKey(workspacePath, binding.sshConnectionId);
    const existing = groups.get(groupKey);

    if (existing) {
      existing.sessions.push(session);
      // 不再按「组内首个解析出 SSH 绑定的会话」升级整组标识：分组键已含连接维度，
      // 能命中同一组的会话必然来自同一台主机，升级分支既不会触发，真触发时反而会让
      // `groupKey` 与 `sshConnectionId` 指向不同工作区。
      continue;
    }

    const nextGroup: WorkspaceSessionGroup<TSession> = {
      groupKey,
      workspacePath,
      workspaceLabel: workspacePath ? basename(workspacePath) : UNBOUND_WORKSPACE_LABEL,
      sshConnectionId: binding.sshConnectionId,
      sessions: [session],
    };
    groups.set(groupKey, nextGroup);
  }

  return sortWorkspaceGroups(Array.from(groups.values()));
}

export function groupSessionTreesByWorkspace<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
  savedWorkspaces: readonly WorkspaceIdentity[] = [],
  pinnedSessionIds: readonly string[] = [],
): WorkspaceSessionTreeGroup<TSession>[] {
  return buildWorkspaceSessionCollections(sessions, savedWorkspaces, pinnedSessionIds).treeGroups;
}

export function buildWorkspaceSessionCollections<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
  savedWorkspaces: readonly WorkspaceIdentity[] = [],
  pinnedSessionIds: readonly string[] = [],
): WorkspaceSessionCollections<TSession> {
  const groups = groupSessionsByWorkspace(sessions, savedWorkspaces, pinnedSessionIds);
  const sessionCountByWorkspace = new Map<string, number>();
  const sessionIdsByGroupKey = new Map<string, string[]>();
  const treeGroups = groups.map((group) => {
    sessionCountByWorkspace.set(group.groupKey, group.sessions.length);
    sessionIdsByGroupKey.set(
      group.groupKey,
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

/**
 * 从会话列表反推出现过的全部工作区身份。
 *
 * 必须连同 `sshConnectionId` 一起返回：闲置工作区占位组若只按路径建组，
 * 远端目录会先被建成本地空组，随后被真正的主机会话「吸附」进去，
 * 于是不同主机的同名目录又合并到一起。
 */
export function listWorkspaceIdentitiesFromSessions<TSession extends SessionWithWorkspaceLike>(
  sessions: TSession[],
): WorkspaceIdentity[] {
  const orderedSessions = [...sessions].sort(compareSessionsByUpdatedAt);
  const sessionsById = new Map(orderedSessions.map((session) => [session.id, session]));
  const resolvedBindingCache = new Map<string, SessionWorkspaceBinding>();
  const workspaces: WorkspaceIdentity[] = [];
  const seenWorkspaces = new Set<string>();

  for (const session of orderedSessions) {
    const binding = resolveSessionWorkspaceBinding(session, sessionsById, resolvedBindingCache);
    if (!binding.workspacePath) {
      continue;
    }

    const identity: WorkspaceIdentity = {
      workspacePath: binding.workspacePath,
      sshConnectionId: binding.sshConnectionId,
    };
    const identityKey = getWorkspaceGroupKey(identity.workspacePath, identity.sshConnectionId);
    if (seenWorkspaces.has(identityKey)) {
      continue;
    }

    seenWorkspaces.add(identityKey);
    workspaces.push(identity);
  }

  return workspaces;
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

/**
 * 工作区分组排序。
 *
 * 规则：
 * - 未绑定工作区的「会话」分组永远沉底，无论其会话多新；
 * - 活跃分组（有会话）排在闲置分组之前；
 * - 同为活跃或同为闲置时按名称字母序，保证多个工作区同时活跃也不会
 *   因会话更新而互相抢位，列表位置稳定可预期。
 *
 * 排序键取 `workspaceLabel`（路径末段）而非用户自定义别名：别名是纯展示偏好，
 * 用它排序会让「清空别名恢复默认名」时列表位置突然跳动。展示层用
 * {@link resolveWorkspaceGroupDisplayName} 单独把别名渲染到标题上。
 */
function sortWorkspaceGroups<TSession extends SessionWithWorkspaceLike>(
  groups: WorkspaceSessionGroup<TSession>[],
): WorkspaceSessionGroup<TSession>[] {
  const orderedGroups = [...groups];

  orderedGroups.sort((a, b) => {
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
export type SessionWorkspaceBinding = WorkspaceIdentity;

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
  return createSessionWorkspaceBindingResolver(sessions)(sessionId);
}

/**
 * 批量解析会话工作区绑定的解析器。
 *
 * 会话列表要逐行取 SSH 标识时，若对每个会话调用
 * {@link resolveSessionWorkspaceBindingById} 会重复构建 `sessionsById` 索引，
 * 退化成 O(n²)。这里把索引与继承缓存提到闭包里按需构建，
 * 列表规模较大（数百会话）时也能保持单次线性解析。
 */
export function createSessionWorkspaceBindingResolver<TSession extends SessionWithWorkspaceLike>(
  sessions: readonly TSession[],
): (sessionId: string) => SessionWorkspaceBinding | undefined {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const resolvedBindingCache = new Map<string, SessionWorkspaceBinding>();

  return (sessionId: string) => {
    const targetSession = sessionsById.get(sessionId);
    if (!targetSession) {
      return undefined;
    }

    return resolveSessionWorkspaceBinding(targetSession, sessionsById, resolvedBindingCache);
  };
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

function normalizeWorkspacePath(path: string | null): string | null {
  const normalized = path?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function basename(path: string): string {
  return getPathBasename(path, path);
}
