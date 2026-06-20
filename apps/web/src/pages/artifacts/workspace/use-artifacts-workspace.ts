import { useCallback, useEffect, useMemo, useState } from 'react';
import { createArtifactsClient, createSessionsClient } from '@openAwork/web-client';
import type {
  ArtifactContentType,
  ArtifactRecord,
  ArtifactVersionRecord,
} from '@openAwork/artifacts';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import type {
  ArtifactSessionSummary,
  ArtifactVersionsResponse,
  SessionArtifactsResponse,
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

export function useArtifactsWorkspace({
  gatewayUrl,
  preferredSessionId = null,
  token,
}: UseArtifactsWorkspaceOptions) {
  const [error, setError] = useState<string | null>(null);
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(null);
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

  const artifactsClient = useMemo(
    () => createArtifactsClient<ArtifactRecord, ArtifactVersionRecord>(gatewayUrl),
    [gatewayUrl],
  );
  const sessionsClient = useMemo(() => createSessionsClient(gatewayUrl), [gatewayUrl]);

  const loadSessions = useCallback(async () => {
    if (!token) {
      setSessions([]);
      setSelectedSessionId(null);
      return;
    }

    setLoadingSessions(true);
    setError(null);
    try {
      const list = await sessionsClient.list(token);
      const nextSessions = (list ?? []).map((session) => ({
        id: session.id,
        title: session.title ?? null,
        updatedAt:
          (session as unknown as { updated_at?: string; updatedAt?: number }).updated_at ?? '',
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
  }, [preferredSessionId, sessionsClient, token]);

  const loadSessionArtifacts = useCallback(
    async (sessionId: string) => {
      if (!token) return;
      setLoadingArtifacts(true);
      setError(null);
      try {
        const payload = (await artifactsClient.listForSession(
          token,
          sessionId,
        )) as unknown as SessionArtifactsResponse;
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
    [artifactsClient, token],
  );

  const loadArtifactVersions = useCallback(
    async (artifactId: string) => {
      if (!token) return;
      try {
        const payload = (await artifactsClient.listVersions(
          token,
          artifactId,
        )) as unknown as ArtifactVersionsResponse;
        setSelectedArtifact(payload.artifact);
        setVersions(payload.versions);
      } catch (loadError) {
        setSelectedArtifact(null);
        setVersions([]);
        setError(loadError instanceof Error ? loadError.message : '加载版本失败');
      }
    },
    [artifactsClient, token],
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
        const payload = await artifactsClient.create(token, {
          sessionId: selectedSessionId,
          title: draft.title,
          content: draft.content,
          type: draft.type,
          createdBy: 'user',
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
    [artifactsClient, loadSessionArtifacts, selectedSessionId, token],
  );

  const saveArtifact = useCallback(
    async (draft: { title: string; content: string }) => {
      if (!token || !selectedArtifactId || !selectedSessionId) {
        return;
      }

      setSaving(true);
      setError(null);
      try {
        await artifactsClient.update(token, selectedArtifactId, {
          title: draft.title,
          content: draft.content,
          createdBy: 'user',
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
      artifactsClient,
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
        await artifactsClient.revert(token, selectedArtifactId, {
          versionId,
          createdBy: 'user',
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
      artifactsClient,
      loadArtifactVersions,
      loadSessionArtifacts,
      selectedArtifactId,
      selectedSessionId,
      token,
    ],
  );

  const removeArtifact = useCallback(async () => {
    if (!token || !selectedArtifactId || !selectedSessionId) {
      return;
    }

    const artifactId = selectedArtifactId;
    const confirmed = window.confirm('确定要删除当前产物吗？删除后无法恢复。');
    if (!confirmed) {
      return;
    }

    setDeletingArtifactId(artifactId);
    setError(null);
    try {
      await artifactsClient.remove(token, artifactId);
      setSelectedArtifactId(null);
      setSelectedArtifact(null);
      setVersions([]);
      await loadSessionArtifacts(selectedSessionId);
      toast('已删除产物', 'success');
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : '删除产物失败';
      setError(message);
      toast(message, 'error');
      await loadSessionArtifacts(selectedSessionId);
    } finally {
      setDeletingArtifactId(null);
    }
  }, [artifactsClient, loadSessionArtifacts, selectedArtifactId, selectedSessionId, token]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  return {
    createArtifact,
    deletingArtifactId,
    error,
    loadingArtifacts,
    loadingSessions,
    removeArtifact,
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
