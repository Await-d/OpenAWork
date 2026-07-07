import { useEffect, useMemo, useState } from 'react';
import { createSessionsClient, type SessionFileChangesProjection } from '@openAwork/web-client';
import {
  getReviewPanelErrorMessage,
  isAbortError,
  type ReviewPanelContentState,
} from './review-panel-model.js';

export interface UseReviewPanelFileChangesInput {
  readonly gatewayUrl: string;
  readonly opened: boolean;
  readonly sessionId: string | null;
  readonly token: string | null;
}

export function useReviewPanelFileChanges({
  gatewayUrl,
  opened,
  sessionId,
  token,
}: UseReviewPanelFileChangesInput): ReviewPanelContentState {
  const sessionsClient = useMemo(() => createSessionsClient(gatewayUrl), [gatewayUrl]);
  const [projection, setProjection] = useState<SessionFileChangesProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) {
      return;
    }

    if (!token || !sessionId) {
      setProjection(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setProjection(null);
    setLoading(true);
    setError(null);

    void sessionsClient
      .getFileChanges(token, sessionId, { includeText: true, signal: controller.signal })
      .then((nextProjection) => {
        if (controller.signal.aborted) {
          return;
        }
        setProjection(nextProjection);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (isAbortError(loadError)) {
          return;
        }
        setProjection(null);
        setError(getReviewPanelErrorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [opened, sessionId, sessionsClient, token]);

  if (!token || !sessionId) {
    return { kind: 'waiting', message: '等待会话上下文' };
  }

  if (loading && !projection) {
    return { kind: 'loading' };
  }

  if (error) {
    return { kind: 'error', message: error };
  }

  if (!projection) {
    return { kind: 'loading' };
  }

  return {
    kind: 'ready',
    projection,
  };
}
