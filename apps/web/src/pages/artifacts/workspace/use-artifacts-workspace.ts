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

/**
 * 统一的「busy + try/catch/finally」动作包装（产物工作台）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * try 内的值块（条件 / 逻辑 / 三元），本文件 7 处 try/catch/finally 会让整个 hook
 * 脱靶（实测）。语义逐字照搬：`run` 的全流程仍在 try 内；`busyValue` / `idleValue`
 * 覆盖「true/false」与「目标 id/null」两种 busy 形态；不传 `setBusy` 表示该动作没有
 * busy 标志（如加载版本列表）。
 */
async function runArtifactsActionOnce<T>(ctx: {
  setBusy?: (value: T) => void;
  busyValue?: T;
  idleValue?: T;
  /** 传了才捕获并按调用方的方式提示；不传则异常继续向上抛。 */
  onError?: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  if (ctx.setBusy && ctx.busyValue !== undefined) {
    ctx.setBusy(ctx.busyValue);
  }
  try {
    await ctx.run();
  } catch (error) {
    if (!ctx.onError) {
      throw error;
    }
    ctx.onError(error);
  } finally {
    if (ctx.setBusy && ctx.idleValue !== undefined) {
      ctx.setBusy(ctx.idleValue);
    }
  }
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
    await runArtifactsActionOnce<boolean>({
      busyValue: true,
      idleValue: false,
      setBusy: setLoadingSessions,
      onError: (loadError) => {
        setError(loadError instanceof Error ? loadError.message : '加载会话失败');
      },
      run: async () => {
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
      },
    });
  }, [preferredSessionId, sessionsClient, token]);

  const loadSessionArtifacts = useCallback(
    async (sessionId: string) => {
      if (!token) return;
      setLoadingArtifacts(true);
      setError(null);
      await runArtifactsActionOnce<boolean>({
        busyValue: true,
        idleValue: false,
        setBusy: setLoadingArtifacts,
        onError: (loadError) => {
          setSessionArtifacts([]);
          setSelectedArtifactId(null);
          setSelectedArtifact(null);
          setVersions([]);
          setError(loadError instanceof Error ? loadError.message : '加载产物失败');
        },
        run: async () => {
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
        },
      });
    },
    [artifactsClient, token],
  );

  const loadArtifactVersions = useCallback(
    async (artifactId: string) => {
      if (!token) return;
      // 该动作没有 busy 标志，故不传 setBusy（见 runArtifactsActionOnce 注释）。
      await runArtifactsActionOnce<null>({
        onError: (loadError) => {
          setSelectedArtifact(null);
          setVersions([]);
          setError(loadError instanceof Error ? loadError.message : '加载版本失败');
        },
        run: async () => {
          const payload = (await artifactsClient.listVersions(
            token,
            artifactId,
          )) as unknown as ArtifactVersionsResponse;
          setSelectedArtifact(payload.artifact);
          setVersions(payload.versions);
        },
      });
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
      await runArtifactsActionOnce<boolean>({
        busyValue: true,
        idleValue: false,
        setBusy: setSaving,
        onError: (createError) => {
          const message = createError instanceof Error ? createError.message : '创建产物失败';
          setError(message);
          toast(message, 'error');
        },
        run: async () => {
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
        },
      });
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
      await runArtifactsActionOnce<boolean>({
        busyValue: true,
        idleValue: false,
        setBusy: setSaving,
        onError: (saveError) => {
          const message = saveError instanceof Error ? saveError.message : '保存产物失败';
          setError(message);
          toast(message, 'error');
        },
        run: async () => {
          await artifactsClient.update(token, selectedArtifactId, {
            title: draft.title,
            content: draft.content,
            createdBy: 'user',
          });
          await loadSessionArtifacts(selectedSessionId);
          await loadArtifactVersions(selectedArtifactId);
          toast('已保存产物版本', 'success');
        },
      });
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

      setError(null);
      await runArtifactsActionOnce<string | null>({
        busyValue: versionId,
        idleValue: null,
        setBusy: setRevertingVersionId,
        onError: (revertError) => {
          const message = revertError instanceof Error ? revertError.message : '恢复版本失败';
          setError(message);
          toast(message, 'error');
        },
        run: async () => {
          await artifactsClient.revert(token, selectedArtifactId, {
            versionId,
            createdBy: 'user',
          });
          await loadSessionArtifacts(selectedSessionId);
          await loadArtifactVersions(selectedArtifactId);
          toast('已恢复到指定版本', 'success');
        },
      });
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

    setError(null);
    await runArtifactsActionOnce<string | null>({
      busyValue: artifactId,
      idleValue: null,
      setBusy: setDeletingArtifactId,
      onError: async (removeError) => {
        const message = removeError instanceof Error ? removeError.message : '删除产物失败';
        setError(message);
        toast(message, 'error');
        await loadSessionArtifacts(selectedSessionId);
      },
      run: async () => {
        await artifactsClient.remove(token, artifactId);
        setSelectedArtifactId(null);
        setSelectedArtifact(null);
        setVersions([]);
        await loadSessionArtifacts(selectedSessionId);
        toast('已删除产物', 'success');
      },
    });
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
