/**
 * session-descendant-tree — 会话子树遍历（两套父链取并集）。
 *
 * `sessions` 上有两条语义不同、互不替代的父子链：
 *   1. `sessions.team_parent_session_id`：团队分层（reception → pm1 → pm2 → executor/reviewer），
 *      控制 / 取消走递归 CTE（见 `team/team-runtime-control-store.ts` 的 `resolveTeamRuntimeControlScope`）。
 *   2. `sessions.metadata_json.parentSessionId`：task 子会话（subagent 消息树），
 *      流取消走 BFS（见 `session/cancel-descendant-streams.ts`）。
 *
 * 回退 / 删除 / 取消级联都需要「子树全集」，只覆盖一条链都会漏。本模块把两条链
 * 合并成一张 children 索引后做 BFS，返回并集。
 *
 * 本实现从 `routes/sessions.ts` 抽出（原模块私有的 `collectDescendantSessionIds`），
 * 抽出的原因：
 *   - `session/session-turn-rollback.ts` 需要同一份子树语义，不能只靠 CTE 或只靠 metadata；
 *   - `session/` 反向 import `routes/sessions.ts` 会形成 routes ↔ session 循环导入，
 *     与计划 Phase 2.3a 对 `cascadeCancelDownstream` 的处理原则一致（不让路由模块成为依赖源）。
 *
 * 语义：返回集合**包含** `rootSessionId` 自身；无法解析的 metadata、自环父链会被安全跳过。
 */

export interface SessionTreeRow {
  id: string;
  metadata_json: string;
  team_parent_session_id?: string | null;
}

export function parseSessionParentId(metadataJson: string): string | null {
  try {
    const parsed = JSON.parse(metadataJson) as { parentSessionId?: unknown };
    return typeof parsed.parentSessionId === 'string' ? parsed.parentSessionId : null;
  } catch {
    return null;
  }
}

export function collectDescendantSessionIds(
  sessions: readonly SessionTreeRow[],
  rootSessionId: string,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();

  const linkChild = (parentSessionId: string | null | undefined, childId: string): void => {
    if (!parentSessionId || parentSessionId === childId) {
      return;
    }

    const existingChildren = childrenByParent.get(parentSessionId) ?? [];
    existingChildren.push(childId);
    childrenByParent.set(parentSessionId, existingChildren);
  };

  for (const session of sessions) {
    linkChild(parseSessionParentId(session.metadata_json), session.id);
    linkChild(session.team_parent_session_id ?? null, session.id);
  }

  const includedSessionIds = new Set<string>([rootSessionId]);
  const queue = [rootSessionId];

  while (queue.length > 0) {
    const currentSessionId = queue.shift();
    if (!currentSessionId) {
      continue;
    }

    for (const childSessionId of childrenByParent.get(currentSessionId) ?? []) {
      if (includedSessionIds.has(childSessionId)) {
        continue;
      }

      includedSessionIds.add(childSessionId);
      queue.push(childSessionId);
    }
  }

  return includedSessionIds;
}
