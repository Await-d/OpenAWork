import { useCallback, useEffect, useState } from 'react';
import { createArtifactsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';

/**
 * 加载「上传到会话的二进制附件」（磁盘型产物），产出可播放 / 可下载的 object URL。
 *
 * ## 为什么不能复用 `useMediaArtifact`
 *
 * `useMediaArtifact` 走 `GET /artifacts/:id` —— 查的是 **SQLite 内容型产物表**；而
 * `POST /sessions/:sessionId/artifacts`（`uploadChatAttachments` 用的）写入的是**磁盘型**
 * 产物索引，**两者不可互换**：
 *
 * - `services/agent-gateway/src/routes/artifacts.ts:364-365`：「那条路由查的是 `artifacts`
 *   表，上传路由写入的产物不在其中，两者不可互换」
 * - `packages/web-client/src/infra/artifacts.ts:147-148`：同上，并指明「跨端恢复附件必须
 *   走这条读取面」
 *
 * 用错端点的表现是 **404 → 卡片静默降级为文件卡片**（不报错、不崩溃），所以必须有测试锁住。
 *
 * ## object URL 生命周期
 *
 * 由本 hook 独占负责：依赖变化与卸载时 revoke；若异步返回时组件已取消，立即 revoke 新
 * 建的 URL（否则会漏一个）。
 */

/**
 * try/catch/finally 下沉到模块级：React Compiler 1.0.0 不支持组件体内 `try/catch` 的
 * `finally` 子句（同一处置见 `use-media-artifact.ts:11-32`）。
 */
async function runSessionArtifactLoadOnce(ctx: {
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

export interface SessionArtifactBlob {
  /** 可交给 `<audio>` / `<video>` 的 object URL；未就绪时为 null。 */
  objectUrl: string | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useSessionArtifactBlob(
  sessionId: string | undefined,
  artifactId: string | undefined,
): SessionArtifactBlob {
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const token = useAuthStore((state) => state.accessToken);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const retry = useCallback(() => setRetryNonce((nonce) => nonce + 1), []);

  useEffect(() => {
    // 三者缺一不可：没有 sessionId 就只能查内容型端点，而上传附件不在那里 —— 宁可
    // 停在「未就绪」，也不要发一个注定 404 的请求。
    if (!sessionId || !artifactId || !token) return;

    let cancelled = false;
    let activeUrl: string | null = null;
    setLoading(true);
    setError(null);
    setObjectUrl(null);

    void (async () => {
      await runSessionArtifactLoadOnce({
        setLoading,
        onError: (loadError) => {
          if (cancelled) return;
          const message = loadError instanceof Error ? loadError.message : String(loadError);
          setError(message || '加载失败');
        },
        onFinally: () => {
          if (!cancelled) setLoading(false);
        },
        run: async () => {
          const blob = await createArtifactsClient(gatewayUrl).downloadFromSession(
            token,
            sessionId,
            artifactId,
          );
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            // 组件已取消：这个 URL 没人会 revoke，必须当场回收。
            URL.revokeObjectURL(url);
            return;
          }
          activeUrl = url;
          setObjectUrl(url);
        },
      });
    })();

    return () => {
      cancelled = true;
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
        activeUrl = null;
      }
    };
  }, [gatewayUrl, token, sessionId, artifactId, retryNonce]);

  return { objectUrl, loading, error, retry };
}
