import { useCallback, useEffect, useState } from 'react';
import { createArtifactsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';

export interface GenerateImageThumbnail {
  artifactId: string;
  fileName: string;
  imageSrc: string;
}

/**
 * 多张产出（`n>1`）时取回首张之外其余产物的图源，供工具卡渲染缩略图条。
 *
 * 为什么另起一个 hook 而不是扩展 `useGenerateImageArtifact`：
 * 后者被工具卡、结果条缩略图、工具图片预览三处共用，且已有测试按
 * `toHaveBeenCalledWith('artifact-1')` 断言单参调用——改签名会连带影响那三处。
 * 首张仍走原 hook（保持加载态 / 错误态 / 重试的既有语义），这里只负责「其余几张」。
 *
 * 任一缩略图失败只丢弃它自己，不影响已经拿到的图：多图属于增量信息，
 * 为一张失败把整条链路判成错误会让用户连首图都看不到。
 */
/**
 * 读取单个生成图缩略图；内容缺失或读取失败返回 null（与原 try/catch 语义一致）。
 *
 * 必须留在模块级：try 内的 `?.` / `??` / 三元都是值块，会让编译器报
 * "Support value blocks ... within a try/catch statement" 并放弃优化整个 hook（实测）。
 */
async function loadGenerateImageThumbnailOnce(
  client: ReturnType<typeof createArtifactsClient>,
  token: string,
  artifactId: string,
): Promise<GenerateImageThumbnail | null> {
  try {
    const data = (await client.get(token, artifactId)) as {
      artifact?: { content?: string; metadata?: Record<string, unknown> };
    };
    const content = data.artifact?.content;
    if (!content) return null;
    const metadata = data.artifact?.metadata;
    const mimeType =
      typeof metadata?.['mimeType'] === 'string' ? metadata['mimeType'] : 'image/png';
    const fileName =
      typeof metadata?.['fileName'] === 'string' ? metadata['fileName'] : 'generated.png';
    return {
      artifactId,
      fileName,
      imageSrc: content.startsWith('data:') ? content : `data:${mimeType};base64,${content}`,
    };
  } catch {
    return null;
  }
}

export function useGenerateImageArtifactThumbnails(artifactIds: readonly string[]): {
  thumbnails: GenerateImageThumbnail[];
  loading: boolean;
  retry: () => void;
} {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);
  const [thumbnails, setThumbnails] = useState<GenerateImageThumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  // 依赖用内容签名而不是数组引用：调用方每轮渲染都会 slice 出新数组，
  // 直接依赖它会让 effect 每帧重跑一次取图。
  const idsKey = artifactIds.join('\u0000');

  const retry = useCallback(() => {
    setRetryNonce((nonce) => nonce + 1);
  }, []);

  useEffect(() => {
    const ids = idsKey.length === 0 ? [] : idsKey.split('\u0000');
    if (ids.length === 0 || !token) {
      setThumbnails([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      const client = createArtifactsClient(gatewayUrl);
      const loaded = await Promise.all(
        ids.map((artifactId) => loadGenerateImageThumbnailOnce(client, token, artifactId)),
      );
      if (cancelled) return;
      setThumbnails(loaded.filter((item): item is GenerateImageThumbnail => item !== null));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, idsKey, retryNonce, token]);

  return { thumbnails, loading, retry };
}
