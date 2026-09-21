/**
 * 按消息粒度并发解析图片地址的 hook（W3 / T-15）。
 *
 * 输入是一条消息（由调用点在「用户点击图片」时提供，`null` 表示没有待解析目标），
 * 输出是该消息的查看器图集条目 + 解析状态。
 *
 * 关键约定：
 * - **并发且去重**：所有 `artifactId` 走 `Promise.all` 并发解析，重复 id 交给
 *   `use-artifact-image-source` 的模块级 in-flight 去重合并成一次请求；本 hook 不
 *   自建去重表，也不重复发请求；
 * - **已有 `imageUrl` 的条目不解析**（`collectInputImageArtifactIds` 直接跳过）；
 * - **失败不抛未处理 rejection**：取数层把失败转成 `{ status: 'error' }`，这里聚合
 *   成 `error` 文案（部分失败也提示，不静默）；失败的条目被图集丢弃；
 * - **索引稳定**：图集只在整条消息解析完成后构造一次，调用点据此先解析后打开，
 *   查看器的 `items` 在打开期间不再变化；message 变化后、effect 生效前的旧结果
 *   不会泄漏（`resolution.message` 身份校验）。
 */

import { useEffect, useMemo, useState } from 'react';
import type { MobileChatMessage, MobileInputImage } from '../chat/chat-message-content';
import {
  buildMessageImageGallery,
  collectInputImageArtifactIds,
  type MessageImageGallery,
  type MessageImageGalleryItem,
} from '../chat/chat-image-gallery';
import { useAuthStore } from '../store/auth';
import { describeArtifactImageError } from './artifact-image-cache';
import { resolveArtifactImageSource } from './use-artifact-image-source';

/** 解析状态：`empty` 表示解析完成但没有任何可渲染条目。 */
export type ChatImageGalleryStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface UseChatImageGalleryResult {
  /** 解析成功的图集条目（保序、丢弃未解析项）；非就绪态为空数组。 */
  readonly items: readonly MessageImageGalleryItem[];
  /** 源条目 → 图集下标；非就绪态恒为 -1。 */
  readonly indexOf: (source: MobileInputImage) => number;
  readonly status: ChatImageGalleryStatus;
  readonly loading: boolean;
  /** 失败提示；解析中 / 全部成功时为 `null`。 */
  readonly error: string | null;
}

interface ChatImageGalleryResolution {
  /** 本次解析对应的消息（身份校验用，防止旧结果泄漏到新消息）。 */
  readonly message: MobileChatMessage | null;
  readonly status: ChatImageGalleryStatus;
  readonly uriById: ReadonlyMap<string, string>;
  readonly error: string | null;
}

const EMPTY_URI_BY_ID: ReadonlyMap<string, string> = new Map();
const EMPTY_ITEMS: readonly MessageImageGalleryItem[] = [];
const NOT_FOUND_INDEX = (_source: MobileInputImage): number => -1;

const IDLE_RESOLUTION: ChatImageGalleryResolution = {
  message: null,
  status: 'idle',
  uriById: EMPTY_URI_BY_ID,
  error: null,
};

interface ResolvedMessageImages {
  readonly uriById: ReadonlyMap<string, string>;
  /** 去重后的失败 id 数（重复 id 只计一次）。 */
  readonly failedCount: number;
}

async function resolveMessageImages(input: {
  artifactIds: readonly string[];
  gatewayUrl: string;
  token: string;
}): Promise<ResolvedMessageImages> {
  // 并发解析：重复 id 由取数层 in-flight 合并，不需要在这里去重。
  const outcomes = await Promise.all(
    input.artifactIds.map(async (artifactId) => {
      const outcome = await resolveArtifactImageSource({
        artifactId,
        gatewayUrl: input.gatewayUrl,
        token: input.token,
      });
      return { artifactId, outcome };
    }),
  );

  const uriById = new Map<string, string>();
  const failedIds = new Set<string>();
  for (const { artifactId, outcome } of outcomes) {
    if (outcome.status === 'ready') {
      uriById.set(artifactId, outcome.uri);
    } else {
      failedIds.add(artifactId);
    }
  }
  return { uriById, failedCount: failedIds.size };
}

/**
 * 解析一条消息的图片图集。
 *
 * 调用点通常在「点击图片」时把消息传入，等 `status` 进入终态（`ready` / `empty` /
 * `error`）后再打开查看器——这样 `items` 与 `indexOf` 在打开期间保持稳定。
 */
export function useChatImageGallery(
  message: MobileChatMessage | null | undefined,
): UseChatImageGalleryResult {
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const token = useAuthStore((state) => state.accessToken);
  const [resolution, setResolution] = useState<ChatImageGalleryResolution>(IDLE_RESOLUTION);

  const inputImages = message?.inputImages;
  const artifactIds = useMemo(() => collectInputImageArtifactIds(inputImages), [inputImages]);

  useEffect(() => {
    const currentMessage = message ?? null;
    if (!currentMessage || (currentMessage.inputImages?.length ?? 0) === 0) {
      setResolution(IDLE_RESOLUTION);
      return;
    }

    if (artifactIds.length === 0) {
      // 全部条目都有可直接渲染的 imageUrl：一个请求都不发。
      setResolution({
        message: currentMessage,
        status: 'ready',
        uriById: EMPTY_URI_BY_ID,
        error: null,
      });
      return;
    }

    if (!token) {
      setResolution({
        message: currentMessage,
        status: 'error',
        uriById: EMPTY_URI_BY_ID,
        error: '登录状态已失效，无法加载图片产物。',
      });
      return;
    }

    let disposed = false;
    setResolution({
      message: currentMessage,
      status: 'loading',
      uriById: EMPTY_URI_BY_ID,
      error: null,
    });

    void resolveMessageImages({ artifactIds, gatewayUrl, token })
      .then((resolved) => {
        if (disposed) {
          return;
        }
        setResolution({
          message: currentMessage,
          status: resolved.uriById.size > 0 ? 'ready' : 'empty',
          uriById: resolved.uriById,
          error: resolved.failedCount > 0 ? `${resolved.failedCount} 张图片加载失败。` : null,
        });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        // 取数层已把失败转成 error 结果，这里是兜底防御（例如意外的同步异常）。
        console.warn('[chat-image-gallery] 解析消息图片失败', error);
        setResolution({
          message: currentMessage,
          status: 'error',
          uriById: EMPTY_URI_BY_ID,
          error: describeArtifactImageError(error),
        });
      });

    return () => {
      disposed = true;
    };
  }, [artifactIds, gatewayUrl, message, token]);

  // message 变化后、effect 生效前，旧解析结果不得泄漏给新消息（否则 indexOf 会错位）。
  const activeResolution = resolution.message === (message ?? null) ? resolution : IDLE_RESOLUTION;

  const gallery = useMemo<MessageImageGallery | undefined>(
    () =>
      activeResolution.message
        ? buildMessageImageGallery(activeResolution.message.inputImages, activeResolution.uriById)
        : undefined,
    [activeResolution],
  );

  return useMemo(
    () => ({
      items: gallery?.items ?? EMPTY_ITEMS,
      indexOf: gallery?.indexOf ?? NOT_FOUND_INDEX,
      status: activeResolution.status,
      loading: activeResolution.status === 'loading',
      error: activeResolution.error,
    }),
    [activeResolution, gallery],
  );
}
