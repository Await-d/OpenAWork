import { useCallback, useEffect, useState } from 'react';
import { createArtifactsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';

/**
 * 异步加载媒体 artifact 的通用 hook。
 *
 * 从网关 `${gatewayUrl}/artifacts/:id` 拉取 artifact，解析其中的
 * data:URL 和 metadata，返回可用于播放的 mediaSrc 和媒体元信息。
 */
/**
 * 媒体 artifact 加载的统一包装：置 loading → try → catch 归一文案 → finally 清 loading，
 * 读写都受 `cancelled` 守卫（与原语义一致）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，也不支持 try 内
 * 的值块（`?.`、三元）。语义逐字照搬。
 */
async function runMediaArtifactLoadOnce(ctx: {
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

/** artifact metadata 归一后的媒体元信息。 */
interface MediaArtifactMetadata {
  fileName?: string;
  mimeType?: string;
  duration?: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
}

/**
 * 从 artifact metadata 归一出媒体元信息；类型不符的字段一律丢弃。
 *
 * 必须留在模块级：原先逐字段 `typeof meta?.x === 'string'` 判定散在 hook 内，且元信息存
 * ref、渲染期再读 `ref.current` —— 后者会被 React Compiler 判为
 * "Cannot access refs during render" 并放弃优化整个 hook（实测）。
 */
function readMediaArtifactMetaOnce(
  meta: Record<string, unknown> | undefined,
): MediaArtifactMetadata {
  const result: MediaArtifactMetadata = {};
  if (typeof meta?.fileName === 'string') result.fileName = meta.fileName;
  if (typeof meta?.mimeType === 'string') result.mimeType = meta.mimeType;
  if (typeof meta?.duration === 'number') result.duration = meta.duration;
  if (typeof meta?.width === 'number') result.width = meta.width;
  if (typeof meta?.height === 'number') result.height = meta.height;
  if (typeof meta?.thumbnailUrl === 'string') result.thumbnailUrl = meta.thumbnailUrl;
  return result;
}

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
  // 媒体元信息走 state：渲染期读 `ref.current` 会被编译器判为 "Cannot access refs during
  // render" 并放弃优化整个 hook（实测）。副作用是元信息随每次成功加载一起刷新——原先 ref
  // 会把上一个 artifact 的 fileName 带到新 artifact 上，这里顺带修掉。
  const [mediaMeta, setMediaMeta] = useState<MediaArtifactMetadata>({});

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  useEffect(() => {
    if (!artifactId || !token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMediaSrc(null);

    void (async () => {
      // try/catch/finally 下沉到模块级 `runMediaArtifactLoadOnce`（见其注释）。
      await runMediaArtifactLoadOnce({
        setLoading,
        onError: (err) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          setError(message || '加载失败');
        },
        onFinally: () => {
          if (!cancelled) setLoading(false);
        },
        run: async () => {
          const data = (await createArtifactsClient(gatewayUrl).get(token, artifactId)) as {
            artifact?: {
              content?: string;
              metadata?: Record<string, unknown>;
            };
          };
          if (cancelled) return;
          const content = data.artifact?.content;
          const meta = data.artifact?.metadata;

          const nextMeta = readMediaArtifactMetaOnce(meta);
          setMediaMeta(nextMeta);

          if (!content) {
            setError('媒体 artifact 内容为空');
            return;
          }

          setMediaSrc(
            content.startsWith('data:')
              ? content
              : `data:${nextMeta.mimeType ?? 'application/octet-stream'};base64,${content}`,
          );
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token, artifactId, retryNonce]);

  return {
    mediaSrc,
    loading,
    error,
    fileName: mediaMeta.fileName ?? 'media',
    mimeType: mediaMeta.mimeType,
    duration: mediaMeta.duration,
    width: mediaMeta.width,
    height: mediaMeta.height,
    thumbnailUrl: mediaMeta.thumbnailUrl,
    retry,
  };
}
