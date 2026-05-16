import { useCallback, useEffect, useRef, useState } from 'react';
import { createArtifactsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth.js';

/**
 * Encapsulates the asynchronous artifact fetch for a `generate_image` tool
 * card: hits `${gatewayUrl}/artifacts/:id`, decodes the base64 payload, and
 * exposes the resulting state (loading / image src / error / file name).
 *
 * The hook also returns a `retry()` callback which bumps an internal nonce
 * and re-runs the effect — fixing the legacy bug where the on-screen "重试"
 * button could not actually retry because the previous version's effect
 * dependency list didn't include the nonce.
 */
export function useGenerateImageArtifact(artifactId: string | undefined): {
  imageSrc: string | null;
  imageLoading: boolean;
  fetchError: string | null;
  fileName: string;
  retry: () => void;
} {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  // Latest filename: filled from the artifact metadata when the response
  // arrives, falling back to a sane default until then.
  const fileNameRef = useRef<string>('generated-image.png');

  const retry = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!artifactId || !token) return;
    let cancelled = false;
    setImageLoading(true);
    setFetchError(null);
    setImageSrc(null);
    void (async () => {
      try {
        const data = (await createArtifactsClient(gatewayUrl).get(token, artifactId)) as {
          artifact?: { content?: string; metadata?: Record<string, unknown> };
        };
        if (cancelled) return;
        const content = data.artifact?.content;
        const meta = data.artifact?.metadata;
        if (meta?.fileName && typeof meta.fileName === 'string') {
          fileNameRef.current = meta.fileName;
        }
        if (!content) {
          console.error('[generate_image] artifact content empty', {
            artifactId,
            artifact: data.artifact,
          });
          setFetchError('图片 artifact 内容为空');
          return;
        }
        setImageSrc(
          content.startsWith('data:')
            ? content
            : `data:${(meta?.mimeType as string) ?? 'image/png'};base64,${content}`,
        );
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[generate_image] artifact fetch threw', {
          artifactId,
          error: err,
        });
        setFetchError(message || '加载失败');
      } finally {
        if (!cancelled) setImageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token, artifactId, retryNonce]);

  return {
    imageSrc,
    imageLoading,
    fetchError,
    fileName: fileNameRef.current,
    retry,
  };
}
