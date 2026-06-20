/**
 * 260531-team-page · Wave 4 增强 · useTeamWorkspaceArtifacts
 *
 * 拉取整个 team workspace 范围内的产物（spec/plan/tasks/review 等），用于知识图谱
 * 的 workspace 级知识产物节点（不局限于某个运行阶段）。
 *
 * 后端 `/team/artifacts` 已支持仅按 teamWorkspaceId 查询，并返回
 * `parentArtifactId`——因此能为图谱建立 artifact → artifact 的派生边。
 *
 * 设计：轻量只读 + 离线/未连接降级，不做激进重试（图谱是辅助视图）。
 */

import { useEffect, useRef, useState } from 'react';
import { createTeamPhaseAClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../stores/team/team-events.js';

export interface WorkspaceArtifact {
  content?: string;
  createdAt?: string;
  id: string;
  parentArtifactId?: string | null;
  sessionId: string;
  phase: string | null;
  teamWorkspaceId?: string | null;
  title: string;
  type?: string;
  updatedAt?: string;
  version?: number;
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
  const loadedWorkspaceIdRef = useRef<string | null>(null);

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
          if (loadedWorkspaceIdRef.current !== teamWorkspaceId) {
            setArtifacts([]);
          }
          setLoading(false);
          return;
        }
        const next: WorkspaceArtifact[] = [];
        for (const a of result.artifacts) {
          next.push({
            ...(a.content ? { content: a.content } : {}),
            ...(a.createdAt ? { createdAt: a.createdAt } : {}),
            id: a.id,
            ...(a.parentArtifactId !== undefined ? { parentArtifactId: a.parentArtifactId } : {}),
            phase: a.phase,
            sessionId: a.sessionId ?? '',
            ...(a.teamWorkspaceId !== undefined ? { teamWorkspaceId: a.teamWorkspaceId } : {}),
            title: a.title,
            ...(a.type ? { type: a.type } : {}),
            ...(a.updatedAt ? { updatedAt: a.updatedAt } : {}),
            ...(typeof a.version === 'number' ? { version: a.version } : {}),
          });
        }
        setArtifacts(next);
        loadedWorkspaceIdRef.current = teamWorkspaceId;
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (reqIdRef.current !== reqId) return;
        setError(err instanceof Error ? err.message : '加载工作区产物失败。');
        if (loadedWorkspaceIdRef.current !== teamWorkspaceId) {
          setArtifacts([]);
        }
        setLoading(false);
      });
  }, [token, gatewayUrl, teamWorkspaceId, recoveredAt]);

  return { artifacts, loading, error };
}
