import { isPathWithinRoot } from '../workspace-path.js';

interface TeamSessionRouteGroup {
  readonly sessions: ReadonlyArray<{ readonly id: string }>;
  readonly workspacePath?: string | null;
}

export function buildTeamSessionRoute(teamWorkspaceId: string, sessionId: string): string {
  return `/team/${encodeURIComponent(teamWorkspaceId)}?sessionId=${encodeURIComponent(sessionId)}`;
}

export function resolveTeamSessionFromRoute(input: {
  readonly defaultSessionId: string;
  readonly groups: readonly TeamSessionRouteGroup[];
  readonly requestedSessionId: string | null;
}): string | null {
  const requestedSessionId = input.requestedSessionId?.trim() ?? '';
  if (requestedSessionId) {
    const requestedSessionExists = input.groups.some((group) =>
      group.sessions.some((session) => session.id === requestedSessionId),
    );
    if (requestedSessionExists) {
      return requestedSessionId;
    }
  }

  if (!input.defaultSessionId) {
    return null;
  }

  return input.groups.some((group) =>
    group.sessions.some((session) => session.id === input.defaultSessionId),
  )
    ? input.defaultSessionId
    : null;
}

/**
 * 找到某个团队会话所在的会话分组路径。
 * 用于 URL 缺少 workspace 路径时反推该会话归属的工作区。
 */
export function resolveTeamSessionWorkspacePath(input: {
  readonly groups: readonly TeamSessionRouteGroup[];
  readonly sessionId: string;
}): string | null {
  const group = input.groups.find((candidate) =>
    candidate.sessions.some((session) => session.id === input.sessionId),
  );
  if (!group) {
    return null;
  }
  const workspacePath = group.workspacePath?.trim();
  return workspacePath ? workspacePath : null;
}

/**
 * 把会话的工作区路径映射到团队工作区 id。
 * 与 TeamPageV2 的跨工作区切换使用同一套前缀匹配规则。
 */
export function resolveTeamWorkspaceIdForWorkspacePath(input: {
  readonly workspacePath: string | null;
  readonly workspaces: readonly {
    readonly id: string;
    readonly defaultWorkingRoot?: string | null;
  }[];
}): string | null {
  const workspacePath = input.workspacePath?.trim();
  if (!workspacePath) {
    return null;
  }

  const workspace = input.workspaces.find(
    (candidate) =>
      candidate.defaultWorkingRoot != null &&
      isPathWithinRoot(workspacePath, candidate.defaultWorkingRoot),
  );
  return workspace?.id ?? null;
}
