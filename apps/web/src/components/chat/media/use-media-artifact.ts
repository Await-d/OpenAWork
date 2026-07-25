import { useCallback, useEffect, useRef, useState } from 'react';
import { createArtifactsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';

/**
 * 异步加载媒体 artifact 的通用 hook。
 *
 * 从网关 `${gatewayUrl}/artifacts/:id` 拉取 artifact，解析其中的
 * data:URL 和 metadata，返回可用于播放的 mediaSrc 和媒体元信息。
 */
export function useMediaArtifact(artifactId: string | undefined): {
  mediaSrc: string | null;
  loading: boolean;
  error: string | null;
  fileName: string;
  mimeType: string | undefined;
  duration: number | undefined;
  width: number | undefined;
  height: number | undefined;
  thumbnailUrl: string | undefined;
  retry: () => void;
} {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const fileNameRef = useRef<string>('media');
  const mimeTypeRef = useRef<string | undefined>(undefined);
  const durationRef = useRef<number | undefined>(undefined);
  const widthRef = useRef<number | undefined>(undefined);
  const heightRef = useRef<number | undefined>(undefined);
  const thumbnailUrlRef = useRef<string | undefined>(undefined);

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  useEffect(() => {
    if (!artifactId || !token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMediaSrc(null);

    void (async () => {
      try {
        const data = (await createArtifactsClient(gatewayUrl).get(token, artifactId)) as {
          artifact?: {
            content?: string;
            metadata?: Record<string, unknown>;
          };
        };
        if (cancelled) return;
        const content = data.artifact?.content;
        const meta = data.artifact?.metadata;

        if (typeof meta?.fileName === 'string') {
          fileNameRef.current = meta.fileName;
        }
        if (typeof meta?.mimeType === 'string') {
          mimeTypeRef.current = meta.mimeType;
        }
        if (typeof meta?.duration === 'number') {
          durationRef.current = meta.duration;
        }
        if (typeof meta?.width === 'number') {
          widthRef.current = meta.width;
        }
        if (typeof meta?.height === 'number') {
          heightRef.current = meta.height;
        }
        if (typeof meta?.thumbnailUrl === 'string') {
          thumbnailUrlRef.current = meta.thumbnailUrl;
        }

        if (!content) {
          setError('媒体 artifact 内容为空');
          return;
        }

        setMediaSrc(
          content.startsWith('data:')
            ? content
            : `data:${mimeTypeRef.current ?? 'application/octet-stream'};base64,${content}`,
        );
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message || '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token, artifactId, retryNonce]);

  return {
    mediaSrc,
    loading,
    error,
    fileName: fileNameRef.current,
    mimeType: mimeTypeRef.current,
    duration: durationRef.current,
    width: widthRef.current,
    height: heightRef.current,
    thumbnailUrl: thumbnailUrlRef.current,
    retry,
  };
}
