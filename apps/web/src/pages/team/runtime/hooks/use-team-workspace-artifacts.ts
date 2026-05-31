/**
 * 260531-team-page · Wave 4 增强 · useTeamWorkspaceArtifacts
 *
 * 拉取整个 team workspace 范围内的产物（spec/plan/tasks/review 等），用于知识图谱
 * 的 workspace 级产物节点（不局限于单个选中 session）。
 *
 * 后端 `/team/artifacts` 已支持仅按 teamWorkspaceId 查询，并在每条产物上返回
 * `sessionId`——因此能为图谱建立 session → artifact 的 produces 边。
 *
 * 设计：轻量只读 + 离线/未连接降级，不做激进重试（图谱是辅助视图）。
 */

import { useEffect, useRef, useState } from 'react';
import { createTeamPhaseAClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../stores/team/team-events.js';

export interface WorkspaceArtifact {
  id: string;
  sessionId: string;
  phase: string | null;
  title: string;
}

export interface UseTeamWorkspaceArtifactsResult {
  artifacts: WorkspaceArtifact[];
  loading: boolean;
  error: string | null;
}

export function useTeamWorkspaceArtifacts(
  teamWorkspaceId: string | null | undefined,
): UseTeamWorkspaceArtifactsResult {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const recoveredAt = useTeamEventsConnectionStore((s) => s.lastRecoveredAt);
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    if (!token || !gatewayUrl || !teamWorkspaceId) {
      setArtifacts([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const client = createTeamPhaseAClient(gatewayUrl);
    void client
      .listTeamArtifactsResult(token, { teamWorkspaceId })
      .then((result) => {
        if (reqIdRef.current !== reqId) return;
        if (!result.ok) {
          setError(result.errorMessage ?? '加载工作区产物失败。');
          setArtifacts([]);
          setLoading(false);
          return;
        }
        // 仅保留带 sessionId 的产物（图谱 produces 边需要它）。
        const next: WorkspaceArtifact[] = [];
        for (const a of result.artifacts) {
          if (!a.sessionId) continue;
          next.push({ id: a.id, sessionId: a.sessionId, phase: a.phase, title: a.title });
        }
        setArtifacts(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (reqIdRef.current !== reqId) return;
        setError(err instanceof Error ? err.message : '加载工作区产物失败。');
        setArtifacts([]);
        setLoading(false);
      });
  }, [token, gatewayUrl, teamWorkspaceId, recoveredAt]);

  return { artifacts, loading, error };
}
