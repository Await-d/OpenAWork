import { useEffect, useState } from 'react';
import { createTeamClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';

/**
 * Fetches the set of session IDs that belong to team workspaces by reading
 * `/team/runtime` (no `teamWorkspaceId` filter, which returns the global
 * runtime snapshot containing all team-owned sessions across workspaces the
 * user can access).
 *
 * Best-effort: if the request fails (no team access, network, etc.) we return
 * an empty Set and `failed=true` so callers can degrade gracefully without
 * showing a noisy error.
 */
export interface UseTeamSessionIdsResult {
  /** Whether the team runtime fetch finished (success or failure). */
  ready: boolean;
  /** Whether the fetch failed; consumers should fall back to a single bucket. */
  failed: boolean;
  /** IDs of every session known to belong to a team workspace. */
  teamSessionIds: Set<string>;
}

export function useTeamSessionIds(): UseTeamSessionIdsResult {
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [state, setState] = useState<UseTeamSessionIdsResult>({
    ready: false,
    failed: false,
    teamSessionIds: new Set(),
  });

  useEffect(() => {
    if (!accessToken || !gatewayUrl) {
      setState({ ready: true, failed: false, teamSessionIds: new Set() });
      return;
    }

    let cancelled = false;
    const client = createTeamClient(gatewayUrl);
    void client
      .getRuntimeResult(accessToken)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok || !result.runtime) {
          setState({ ready: true, failed: true, teamSessionIds: new Set() });
          return;
        }
        const ids = new Set<string>();
        for (const session of result.runtime.sessions) {
          // 只收集用户创建的根团队会话,排除层级角色派生的子会话
          // (parentSessionId 不为 null 的会话是角色层级的子会话,
          //  不应在会话列表中独立展示)。
          if (session.parentSessionId !== null) {
            continue;
          }
          ids.add(session.id);
        }
        setState({ ready: true, failed: false, teamSessionIds: ids });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ ready: true, failed: true, teamSessionIds: new Set() });
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, gatewayUrl]);

  return state;
}
