import type { SessionWithWorkspaceLike } from './session-grouping.js';
import { resolveSessionWorkspaceBindingById } from './session-grouping.js';

/**
 * 「新建会话」的工作区继承解析。
 *
 * 目标：从哪个上下文点「新建会话」，就默认落到那个上下文的工作区，而不是沿用
 * 全局选中值——否则在 A 工作区的会话里点「新建会话」会创建到上一次选中的 B，
 * 用户还得手动改绑。解析优先级：
 *
 * 1. 显式传入的路径（工作区分组「+」、文件树右键、项目等）优先；显式传 `null`
 *    表示该入口本身就是「不绑定工作区」（如「会话」未绑定分组的快捷入口）。
 * 2. 否则继承当前上下文会话的工作区绑定：先取 ChatPage 已解析出的实时缓存（含
 *    SSH / 父会话链兜底），再退回会话列表 metadata（沿父会话继承）。上下文会话
 *    已确认未绑定时返回空绑定，不回落全局选中值——继承「未绑定」同样是继承。
 * 3. 上下文不可解析（列表被路径筛选 / 分页截断 / 尚未加载）时，回落全局选中值。
 *
 * SSH 远端会话必须把 `sshConnectionId` 与远端路径一起继承（两个字段各自沿父链
 * 解析，与 `useWorkspace` / 网关口径一致）：只带走路径会让网关按本地工作区校验
 * 远端路径，或把远端路径绑定到错误的连接。
 */

export interface ActiveSessionWorkspaceSnapshot {
  readonly sessionId: string;
  readonly path: string | null;
  readonly sshConnectionId?: string | null;
}

export interface NewSessionWorkspaceInput {
  /** 显式工作区：string=指定；null=显式不绑定；undefined=按上下文继承。 */
  readonly explicitWorkspacePath?: string | null;
  /** 当前上下文会话（正在查看的会话）id；无上下文时传 null。 */
  readonly contextSessionId?: string | null;
  /** ChatPage 已解析出的会话工作区缓存（含父链 / SSH 兜底结果）。 */
  readonly activeSessionWorkspace?: ActiveSessionWorkspaceSnapshot | null;
  /** 已加载的会话列表（可能被路径筛选 / 分页截断）。 */
  readonly sessions?: readonly SessionWithWorkspaceLike[];
  /** 上下文不可解析时的兜底（通常是全局选中工作区）。 */
  readonly fallbackWorkspacePath?: string | null;
}

export interface ResolvedNewSessionWorkspace {
  readonly workspacePath: string | null;
  /**
   * 仅当工作区来自「上下文会话继承」时给出：string=远端连接，null=本地工作区。
   * 显式路径 / 全局兜底时为 `undefined`，表示不改动现有草稿 SSH 绑定
   * （沿用既有行为，避免把远端分组入口的连接绑定误清掉）。
   */
  readonly sshConnectionId?: string | null;
}

export function resolveNewSessionWorkspace(
  input: NewSessionWorkspaceInput,
): ResolvedNewSessionWorkspace {
  if (input.explicitWorkspacePath !== undefined) {
    const workspacePath = normalizeWorkspacePath(input.explicitWorkspacePath);
    return workspacePath === null
      ? // 显式「不绑定工作区」：同时清掉可能残留的草稿 SSH 绑定。
        { workspacePath: null, sshConnectionId: null }
      : { workspacePath };
  }

  const contextSessionId = input.contextSessionId?.trim();
  if (contextSessionId) {
    const cachedWorkspace = input.activeSessionWorkspace;
    if (cachedWorkspace?.sessionId === contextSessionId) {
      return {
        workspacePath: normalizeWorkspacePath(cachedWorkspace.path),
        sshConnectionId: cachedWorkspace.sshConnectionId ?? null,
      };
    }

    if (input.sessions) {
      const binding = resolveSessionWorkspaceBindingById(input.sessions, contextSessionId);
      if (binding !== undefined) {
        return {
          workspacePath: binding.workspacePath,
          sshConnectionId: binding.sshConnectionId,
        };
      }
    }
  }

  return { workspacePath: normalizeWorkspacePath(input.fallbackWorkspacePath ?? null) };
}

function normalizeWorkspacePath(path: string | null): string | null {
  const normalized = path?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}
