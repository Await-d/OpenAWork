import { useCallback, useEffect, useState } from 'react';
import { createArtifactsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';

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
/**
 * 生成图 artifact 加载的统一包装：置 loading → try → catch 交给 `onError` → finally 收尾
 * （取消时不再 setState）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，也不支持 try 内
 * 的值块（`?.`、`??`、三元）。语义逐字照搬。
 */
async function runGenerateImageArtifactLoadOnce(ctx: {
  setLoading: (loading: boolean) => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setLoading(true);
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  } finally {
    ctx.onFinally();
  }
}

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
  // 走 state 而非 ref：渲染期读 `ref.current` 会被 React Compiler 判为 "Cannot access
  // refs during render" 并放弃优化整个 hook（实测）。
  const [fileName, setFileName] = useState<string>('generated-image.png');

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
      // try/catch/finally 下沉到模块级 `runGenerateImageArtifactLoadOnce`（见其注释）。
      await runGenerateImageArtifactLoadOnce({
        setLoading: setImageLoading,
        onError: (err) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          console.error('[generate_image] artifact fetch threw', {
            artifactId,
            error: err,
          });
          setFetchError(message || '加载失败');
        },
        onFinally: () => {
          if (!cancelled) setImageLoading(false);
        },
        run: async () => {
          const data = (await createArtifactsClient(gatewayUrl).get(token, artifactId)) as {
            artifact?: { content?: string; metadata?: Record<string, unknown> };
          };
          if (cancelled) return;
          const content = data.artifact?.content;
          const meta = data.artifact?.metadata;
          if (meta?.fileName && typeof meta.fileName === 'string') {
            setFileName(meta.fileName);
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
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token, artifactId, retryNonce]);

  return {
    imageSrc,
    imageLoading,
    fetchError,
    fileName,
    retry,
  };
}
