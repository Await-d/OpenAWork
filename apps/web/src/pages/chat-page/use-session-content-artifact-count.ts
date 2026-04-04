import { useEffect, useState } from 'react';
import type { SessionArtifactsResponse } from '../artifacts/artifact-workspace-types.js';

interface UseSessionContentArtifactCountOptions {
  currentSessionId: string | null;
  gatewayUrl: string;
  refreshKey?: number;
  token: string | null;
}

type SessionContentArtifactCountStatus = 'idle' | 'loading' | 'ready' | 'error';

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

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

    void fetch(`${gatewayUrl}/sessions/${currentSessionId}/artifacts`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    })
      .then((response) => parseJsonResponse<SessionArtifactsResponse>(response))
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setContentArtifactCount((payload.contentArtifacts ?? []).length);
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
