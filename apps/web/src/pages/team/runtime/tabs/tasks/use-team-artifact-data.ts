import { useEffect, useRef, useState } from 'react';
import { createTeamPhaseAClient, type TeamPhaseAClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../../stores/team/team-events.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from '../../../hooks/recoverable-read-model.js';
import { useRecoverableRetryController } from '../../../hooks/use-recoverable-retry.js';

export interface ArtifactData {
  id: string;
  content: string;
  phase: string | null;
  title: string;
}

interface UseTeamArtifactDataOptions {
  pm1ArtifactSessionId: string | null;
  pm2ArtifactSessionId: string | null;
}

interface UseTeamArtifactDataResult {
  artifactError: string | null;
  artifactLoading: boolean;
  planArtifact: ArtifactData | null;
  refreshArtifacts: () => void;
  reviewArtifact: ArtifactData | null;
  specArtifact: ArtifactData | null;
  tasksArtifact: ArtifactData | null;
}

const TEAM_ARTIFACTS_RETRY_BASE_MS = 2_000;
const TEAM_ARTIFACTS_RETRY_MAX_MS = 30_000;

export function computeTeamArtifactsRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_ARTIFACTS_RETRY_BASE_MS,
    maxMs: TEAM_ARTIFACTS_RETRY_MAX_MS,
  });
}

export function formatTeamArtifactsLoadError(input: {
  hasCachedArtifacts: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载团队产物链失败。',
    hasRetainedData: input.hasCachedArtifacts,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '产物链',
    retryable: input.result.retryable,
  });
}

function toArtifactData(
  artifacts: Array<{ id: string; content: string; phase: string | null; title: string }>,
): ArtifactData | null {
  const first = artifacts[0];
  return first
    ? {
        id: first.id,
        content: first.content,
        phase: first.phase,
        title: first.title,
      }
    : null;
}

async function loadLatestArtifactResult(input: {
  client: TeamPhaseAClient;
  phase: string;
  sessionId: string;
  token: string;
}) {
  const result = await input.client.listTeamArtifactsResult(input.token, {
    phase: input.phase,
    sessionId: input.sessionId,
  });
  return {
    ...result,
    artifact: result.ok ? toArtifactData(result.artifacts) : null,
  };
}

async function loadLatestReviewArtifactResult(input: {
  client: TeamPhaseAClient;
  sessionId: string;
  token: string;
}) {
  const modern = await loadLatestArtifactResult({
    client: input.client,
    phase: 'review',
    sessionId: input.sessionId,
    token: input.token,
  });
  if (!modern.ok || modern.artifact) {
    return modern;
  }
  return loadLatestArtifactResult({
    client: input.client,
    phase: 'review_report',
    sessionId: input.sessionId,
    token: input.token,
  });
}

function getArtifactMessagePrefix(key: 'plan' | 'review' | 'spec' | 'tasks'): string {
  switch (key) {
    case 'plan':
      return 'plan';
    case 'review':
      return 'review';
    case 'spec':
      return 'spec';
    case 'tasks':
      return 'tasks';
  }
}

export function useTeamArtifactData(
  options: UseTeamArtifactDataOptions,
): UseTeamArtifactDataResult {
  const { accessToken, gatewayUrl } = useAuthStore();
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [specArtifact, setSpecArtifact] = useState<ArtifactData | null>(null);
  const [planArtifact, setPlanArtifact] = useState<ArtifactData | null>(null);
  const [tasksArtifact, setTasksArtifact] = useState<ArtifactData | null>(null);
  const [reviewArtifact, setReviewArtifact] = useState<ArtifactData | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const artifactContextKeyRef = useRef('');
  const artifactsRef = useRef<{
    plan: ArtifactData | null;
    review: ArtifactData | null;
    spec: ArtifactData | null;
    tasks: ArtifactData | null;
  }>({
    plan: null,
    review: null,
    spec: null,
    tasks: null,
  });
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  useEffect(() => {
    artifactsRef.current = {
      plan: planArtifact,
      review: reviewArtifact,
      spec: specArtifact,
      tasks: tasksArtifact,
    };
  }, [planArtifact, reviewArtifact, specArtifact, tasksArtifact]);

  useEffect(() => {
    let cancelled = false;
    const contextKey = [
      options.pm1ArtifactSessionId ?? '',
      options.pm2ArtifactSessionId ?? '',
    ].join('|');
    clearRetry();

    if (!accessToken || !gatewayUrl) {
      artifactContextKeyRef.current = '';
      resetRetry();
      setArtifactLoading(false);
      setArtifactError(null);
      setSpecArtifact(null);
      setPlanArtifact(null);
      setTasksArtifact(null);
      setReviewArtifact(null);
      return () => {
        cancelled = true;
      };
    }

    if (!options.pm1ArtifactSessionId && !options.pm2ArtifactSessionId) {
      artifactContextKeyRef.current = contextKey;
      resetRetry();
      setArtifactLoading(false);
      setArtifactError(null);
      setSpecArtifact(null);
      setPlanArtifact(null);
      setTasksArtifact(null);
      setReviewArtifact(null);
      return () => {
        cancelled = true;
      };
    }

    const isContextChanged = artifactContextKeyRef.current !== contextKey;
    artifactContextKeyRef.current = contextKey;
    if (isContextChanged) {
      setSpecArtifact(null);
      setPlanArtifact(null);
      setTasksArtifact(null);
      setReviewArtifact(null);
    }

    const hasCachedArtifacts = Object.values(artifactsRef.current).some(
      (artifact) => artifact !== null,
    );
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setArtifactLoading(false);
      setArtifactError(
        formatTeamArtifactsLoadError({
          hasCachedArtifacts,
          result: {
            errorMessage: '当前网络离线，团队产物链暂时不可用。',
            retryable: true,
          },
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    const client = createTeamPhaseAClient(gatewayUrl);
    setArtifactLoading(!hasCachedArtifacts);
    setArtifactError(null);

    void Promise.all([
      options.pm1ArtifactSessionId
        ? loadLatestArtifactResult({
            client,
            phase: 'spec',
            sessionId: options.pm1ArtifactSessionId,
            token: accessToken,
          })
        : Promise.resolve({ ok: true, retryable: false, artifact: null, artifacts: [] }),
      options.pm1ArtifactSessionId
        ? loadLatestArtifactResult({
            client,
            phase: 'plan',
            sessionId: options.pm1ArtifactSessionId,
            token: accessToken,
          })
        : Promise.resolve({ ok: true, retryable: false, artifact: null, artifacts: [] }),
      options.pm1ArtifactSessionId
        ? loadLatestArtifactResult({
            client,
            phase: 'tasks',
            sessionId: options.pm1ArtifactSessionId,
            token: accessToken,
          })
        : Promise.resolve({ ok: true, retryable: false, artifact: null, artifacts: [] }),
      options.pm2ArtifactSessionId
        ? loadLatestReviewArtifactResult({
            client,
            sessionId: options.pm2ArtifactSessionId,
            token: accessToken,
          })
        : Promise.resolve({ ok: true, retryable: false, artifact: null, artifacts: [] }),
    ]).then(([specResult, planResult, tasksResult, reviewResult]) => {
      if (cancelled) {
        return;
      }

      const applyResult = (
        key: 'plan' | 'review' | 'spec' | 'tasks',
        result: {
          ok: boolean;
          artifact: ArtifactData | null;
          errorMessage?: string;
          retryable: boolean;
        },
        setter: (
          value: ArtifactData | null | ((current: ArtifactData | null) => ArtifactData | null),
        ) => void,
      ): string | null => {
        if (result.ok) {
          setter(result.artifact);
          return null;
        }
        if (isContextChanged) {
          setter(null);
        } else {
          setter((current) => current);
        }
        return `${getArtifactMessagePrefix(key)}：${formatTeamArtifactsLoadError({
          hasCachedArtifacts,
          result,
        })}`;
      };

      const errors = [
        applyResult('spec', specResult, setSpecArtifact),
        applyResult('plan', planResult, setPlanArtifact),
        applyResult('tasks', tasksResult, setTasksArtifact),
        applyResult('review', reviewResult, setReviewArtifact),
      ].filter((message): message is string => Boolean(message));

      const failedResult = [specResult, planResult, tasksResult, reviewResult].find(
        (result) => !result.ok,
      );
      if (failedResult) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamArtifactsRetryDelay,
          onRetry: () => {
            setReloadTick((current) => current + 1);
          },
          retryable: failedResult.retryable,
        });
        setArtifactLoading(false);
        setArtifactError(
          errors
            .map((message) => (nextRetryAtMs ? `${message} 系统将自动重试。` : message))
            .join('；'),
        );
        return;
      }

      resetRetry();
      setArtifactLoading(false);
      setArtifactError(null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    clearRetry,
    gatewayUrl,
    options.pm1ArtifactSessionId,
    options.pm2ArtifactSessionId,
    reloadTick,
    resetRetry,
    scheduleRetry,
  ]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (!accessToken || !gatewayUrl || typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      resetRetry();
      setReloadTick((current) => current + 1);
    };
    const handleOffline = () => {
      resetRetry();
      setArtifactLoading(false);
      setArtifactError(
        formatTeamArtifactsLoadError({
          hasCachedArtifacts: Object.values(artifactsRef.current).some(
            (artifact) => artifact !== null,
          ),
          result: {
            errorMessage: '当前网络离线，团队产物链暂时不可用。',
            retryable: true,
          },
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [accessToken, gatewayUrl, resetRetry]);

  useEffect(() => {
    if (!accessToken || !gatewayUrl || !teamEventsRecoveredAt) {
      return;
    }
    resetRetry();
    setReloadTick((current) => current + 1);
  }, [accessToken, gatewayUrl, resetRetry, teamEventsRecoveredAt]);

  return {
    artifactError,
    artifactLoading,
    planArtifact,
    refreshArtifacts: () => {
      resetRetry();
      setReloadTick((current) => current + 1);
    },
    reviewArtifact,
    specArtifact,
    tasksArtifact,
  };
}
