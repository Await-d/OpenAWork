import { useEffect, useState } from 'react';
import { createArtifactsClient } from '@openAwork/web-client';
import type { SessionArtifactsResponse } from '../../../pages/artifacts/artifact-workspace-types.js';

interface UseSessionContentArtifactCountOptions {
  currentSessionId: string | null;
  gatewayUrl: string;
  refreshKey?: number;
  token: string | null;
}

type SessionContentArtifactCountStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useSessionContentArtifactCount({
  currentSessionId,
  gatewayUrl,
  refreshKey = 0,
  token,
}: UseSessionContentArtifactCountOptions): {
  contentArtifactCount: number;
  status: SessionContentArtifactCountStatus;
} {
  const [contentArtifactCount, setContentArtifactCount] = useState(0);
  const [status, setStatus] = useState<SessionContentArtifactCountStatus>('idle');

  useEffect(() => {
    void refreshKey;

    if (!currentSessionId || !token) {
      setContentArtifactCount(0);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setStatus('loading');

    void createArtifactsClient(gatewayUrl)
      .listForSession(token, currentSessionId, { signal: controller.signal })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const typed = payload as unknown as SessionArtifactsResponse;
        setContentArtifactCount((typed.contentArtifacts ?? []).length);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }

        setContentArtifactCount(0);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentSessionId, gatewayUrl, refreshKey, token]);

  return {
    contentArtifactCount,
    status,
  };
}
