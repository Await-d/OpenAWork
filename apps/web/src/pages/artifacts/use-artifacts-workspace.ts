import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ArtifactContentType,
  ArtifactRecord,
  ArtifactVersionRecord,
} from '@openAwork/artifacts';
import { toast } from '../../components/ToastNotification.js';
import type {
  ArtifactSessionSummary,
  ArtifactVersionsResponse,
  SessionArtifactsResponse,
  SessionsListResponse,
} from './artifact-workspace-types.js';

interface UseArtifactsWorkspaceOptions {
  gatewayUrl: string;
  preferredSessionId?: string | null;
  token: string | null;
}

interface CreateArtifactDraft {
  content: string;
  title: string;
  type: ArtifactContentType;
}

function buildHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function useArtifactsWorkspace({
  gatewayUrl,
  preferredSessionId = null,
  token,
}: UseArtifactsWorkspaceOptions) {
  const [error, setError] = useState<string | null>(null);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revertingVersionId, setRevertingVersionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<ArtifactSessionSummary[]>([]);
  const [sessionArtifacts, setSessionArtifacts] = useState<ArtifactRecord[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactRecord | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ArtifactVersionRecord[]>([]);

  const fetchJson = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      if (!token) {
        throw new Error('未登录');
      }
      const response = await fetch(`${gatewayUrl}${path}`, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`,
        },
      });
      return parseJsonResponse<T>(response);
    },
    [gatewayUrl, token],
  );

  const loadSessions = useCallback(async () => {
    if (!token) {
      setSessions([]);
      setSelectedSessionId(null);
      return;
    }

    setLoadingSessions(true);
    setError(null);
    try {
      const payload = await fetchJson<SessionsListResponse>('/sessions');
      const nextSessions = (payload.sessions ?? []).map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updated_at,
      }));
      setSessions(nextSessions);

      const resolvedPreferredSessionId =
        preferredSessionId && nextSessions.some((session) => session.id === preferredSessionId)
          ? preferredSessionId
          : null;

      setSelectedSessionId((current) =>
        current && nextSessions.some((session) => session.id === current)
          ? current
          : (resolvedPreferredSessionId ?? nextSessions[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载会话失败');
    } finally {
      setLoadingSessions(false);
    }
  }, [fetchJson, preferredSessionId, token]);

  const loadSessionArtifacts = useCallback(
    async (sessionId: string) => {
      setLoadingArtifacts(true);
      setError(null);
      try {
        const payload = await fetchJson<SessionArtifactsResponse>(
          `/sessions/${sessionId}/artifacts`,
        );
        const nextArtifacts = payload.contentArtifacts ?? [];
        setSessionArtifacts(nextArtifacts);
        setSelectedArtifactId((current) =>
          current && nextArtifacts.some((artifact) => artifact.id === current)
            ? current
            : (nextArtifacts[0]?.id ?? null),
        );
      } catch (loadError) {
        setSessionArtifacts([]);
        setSelectedArtifactId(null);
        setSelectedArtifact(null);
        setVersions([]);
        setError(loadError instanceof Error ? loadError.message : '加载产物失败');
      } finally {
        setLoadingArtifacts(false);
      }
    },
    [fetchJson],
  );

  const loadArtifactVersions = useCallback(
    async (artifactId: string) => {
      try {
        const payload = await fetchJson<ArtifactVersionsResponse>(
          `/artifacts/${artifactId}/versions`,
        );
        setSelectedArtifact(payload.artifact);
        setVersions(payload.versions);
      } catch (loadError) {
        setSelectedArtifact(null);
        setVersions([]);
        setError(loadError instanceof Error ? loadError.message : '加载版本失败');
      }
    },
    [fetchJson],
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionArtifacts([]);
      setSelectedArtifactId(null);
      setSelectedArtifact(null);
      setVersions([]);
      return;
    }
    void loadSessionArtifacts(selectedSessionId);
  }, [loadSessionArtifacts, selectedSessionId]);

  useEffect(() => {
    if (!selectedArtifactId) {
      setSelectedArtifact(null);
      setVersions([]);
      return;
    }
    void loadArtifactVersions(selectedArtifactId);
  }, [loadArtifactVersions, selectedArtifactId]);

  useEffect(() => {
    if (!preferredSessionId || sessions.length === 0) {
      return;
    }

    if (!sessions.some((session) => session.id === preferredSessionId)) {
      return;
    }

    setSelectedSessionId((current) =>
      current === preferredSessionId ? current : preferredSessionId,
    );
  }, [preferredSessionId, sessions]);

  const createArtifact = useCallback(
    async (draft: CreateArtifactDraft) => {
      if (!token || !selectedSessionId) {
        toast('请先选择一个会话', 'warning');
        return;
      }

      setSaving(true);
      setError(null);
      try {
        const payload = await fetchJson<{ artifact: ArtifactRecord }>('/artifacts', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: selectedSessionId,
            title: draft.title,
            content: draft.content,
            type: draft.type,
            createdBy: 'user',
          }),
        });
        await loadSessionArtifacts(selectedSessionId);
        setSelectedArtifactId(payload.artifact.id);
        toast('已创建新产物', 'success');
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : '创建产物失败';
        setError(message);
        toast(message, 'error');
      } finally {
        setSaving(false);
      }
    },
    [fetchJson, loadSessionArtifacts, selectedSessionId, token],
  );

  const saveArtifact = useCallback(
    async (draft: { title: string; content: string }) => {
      if (!token || !selectedArtifactId || !selectedSessionId) {
        return;
      }

      setSaving(true);
      setError(null);
      try {
        await fetchJson<{ artifact: ArtifactRecord }>(`/artifacts/${selectedArtifactId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: draft.title,
            content: draft.content,
            createdBy: 'user',
          }),
        });
        await loadSessionArtifacts(selectedSessionId);
        await loadArtifactVersions(selectedArtifactId);
        toast('已保存产物版本', 'success');
      } catch (saveError) {
        const message = saveError instanceof Error ? saveError.message : '保存产物失败';
        setError(message);
        toast(message, 'error');
      } finally {
        setSaving(false);
      }
    },
    [
      fetchJson,
      loadArtifactVersions,
      loadSessionArtifacts,
      selectedArtifactId,
      selectedSessionId,
      token,
    ],
  );

  const revertArtifact = useCallback(
    async (versionId: string) => {
      if (!token || !selectedArtifactId || !selectedSessionId) {
        return;
      }

      setRevertingVersionId(versionId);
      setError(null);
      try {
        await fetchJson<{ artifact: ArtifactRecord }>(`/artifacts/${selectedArtifactId}/revert`, {
          method: 'POST',
          body: JSON.stringify({ versionId, createdBy: 'user' }),
        });
        await loadSessionArtifacts(selectedSessionId);
        await loadArtifactVersions(selectedArtifactId);
        toast('已恢复到指定版本', 'success');
      } catch (revertError) {
        const message = revertError instanceof Error ? revertError.message : '恢复版本失败';
        setError(message);
        toast(message, 'error');
      } finally {
        setRevertingVersionId(null);
      }
    },
    [
      fetchJson,
      loadArtifactVersions,
      loadSessionArtifacts,
      selectedArtifactId,
      selectedSessionId,
      token,
    ],
  );

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  return {
    createArtifact,
    error,
    loadingArtifacts,
    loadingSessions,
    revertingVersionId,
    saveArtifact,
    saving,
    selectedArtifact,
    selectedArtifactId,
    selectedSession,
    selectedSessionId,
    sessionArtifacts,
    sessions,
    setSelectedArtifactId,
    setSelectedSessionId,
    versions,
    revertArtifact,
  };
}
