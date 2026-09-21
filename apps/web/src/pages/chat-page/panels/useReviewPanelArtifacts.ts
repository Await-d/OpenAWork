import { useEffect, useMemo, useState } from 'react';
import type { ArtifactRecord, ArtifactVersionRecord } from '@openAwork/artifacts';
import { createArtifactsClient } from '@openAwork/web-client';
import {
  getReviewPanelArtifactErrorMessage,
  hasInlineArtifactContent,
  resolveReviewPanelArtifactPreview,
  resolveSelectedArtifact,
  type ReviewPanelArtifactContentFallback,
  type ReviewPanelArtifactsState,
  type ReviewPanelArtifactPreviewState,
} from './review-panel-artifact-model.js';
import { isAbortError } from './review-panel-model.js';

export interface UseReviewPanelArtifactsInput {
  readonly gatewayUrl: string;
  readonly opened: boolean;
  readonly revision?: number;
  readonly sessionId: string | null;
  readonly token: string | null;
}

export interface UseReviewPanelArtifactsResult {
  readonly artifactsState: ReviewPanelArtifactsState;
  readonly preview: ReviewPanelArtifactPreviewState;
  readonly reload: () => void;
  readonly selectArtifact: (artifactId: string) => void;
  readonly selectedArtifact: ArtifactRecord | null;
  readonly selectedArtifactId: string | null;
}

const WAITING_MESSAGE = '等待会话上下文';

export function useReviewPanelArtifacts({
  gatewayUrl,
  opened,
  revision = 0,
  sessionId,
  token,
}: UseReviewPanelArtifactsInput): UseReviewPanelArtifactsResult {
  const artifactsClient = useMemo(
    () => createArtifactsClient<ArtifactRecord, ArtifactVersionRecord>(gatewayUrl),
    [gatewayUrl],
  );
  const [artifacts, setArtifacts] = useState<readonly ArtifactRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [fallbackContent, setFallbackContent] = useState<ReviewPanelArtifactContentFallback>({
    kind: 'idle',
  });

  useEffect(() => {
    if (!opened) {
      return;
    }

    if (!token || !sessionId) {
      setArtifacts(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setArtifacts(null);
    setLoading(true);
    setError(null);

    void artifactsClient
      .listForSession(token, sessionId, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) {
          return;
        }
        const nextArtifacts = payload.contentArtifacts ?? [];
        setArtifacts(nextArtifacts);
        setSelectedArtifactId((current) =>
          current && nextArtifacts.some((artifact) => artifact.id === current)
            ? current
            : (nextArtifacts[0]?.id ?? null),
        );
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted || isAbortError(loadError)) {
          return;
        }
        setArtifacts(null);
        setError(getReviewPanelArtifactErrorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [artifactsClient, opened, reloadTick, revision, sessionId, token]);

  const selectedArtifact = resolveSelectedArtifact(artifacts, selectedArtifactId);

  useEffect(() => {
    if (
      !opened ||
      !token ||
      selectedArtifact === null ||
      hasInlineArtifactContent(selectedArtifact)
    ) {
      setFallbackContent((current) => (current.kind === 'idle' ? current : { kind: 'idle' }));
      return;
    }

    const artifactId = selectedArtifact.id;
    const controller = new AbortController();
    setFallbackContent({ kind: 'loading', artifactId });

    void artifactsClient
      .get(token, artifactId, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) {
          return;
        }
        setFallbackContent({
          kind: 'ready',
          artifactId,
          content: payload.artifact?.content ?? '',
        });
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted || isAbortError(loadError)) {
          return;
        }
        setFallbackContent({
          kind: 'error',
          artifactId,
          message: getReviewPanelArtifactErrorMessage(loadError),
        });
      });

    return () => controller.abort();
  }, [artifactsClient, opened, selectedArtifact, token]);

  const preview = resolveReviewPanelArtifactPreview(selectedArtifact, fallbackContent);

  let artifactsState: ReviewPanelArtifactsState;
  if (!opened || !token || !sessionId) {
    artifactsState = { kind: 'waiting', message: WAITING_MESSAGE };
  } else if (loading && !artifacts) {
    artifactsState = { kind: 'loading' };
  } else if (error) {
    artifactsState = { kind: 'error', message: error };
  } else if (!artifacts) {
    artifactsState = { kind: 'loading' };
  } else {
    artifactsState = { kind: 'ready', artifacts };
  }

  return {
    artifactsState,
    preview,
    reload: () => setReloadTick((tick) => tick + 1),
    selectArtifact: (artifactId: string) => setSelectedArtifactId(artifactId),
    selectedArtifact,
    selectedArtifactId,
  };
}
