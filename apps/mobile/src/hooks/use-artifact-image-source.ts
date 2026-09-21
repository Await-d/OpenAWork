/**
 * 按 `artifactId` 取图片内容的移动端取数层（Phase 1 / T-03~T-05）。
 *
 * 链路：`web-client` 的 `artifacts.get` → `content` 载荷守卫 → base64 落盘到
 * 应用私有 cache 目录 →（必要时）`Image.getSize` 探测尺寸 → 返回
 * `loading / error / ready` 三态与 `{ uri, width, height }`。
 *
 * 纯逻辑（LRU、去重、载荷决策、文件名派生、尺寸派生）全部在
 * `./artifact-image-cache`，本文件只负责副作用编排，保持「薄 hook」。
 *
 * 说明：
 * - 落盘目录选择 `Paths.cache`（而非 `Paths.document`）：产物图是可再生的
 *   派生数据，允许系统在存储紧张或应用卸载时回收；document 目录会被系统
 *   备份且不会自动回收，长期堆积需要自建 GC。
 * - 只有「三态之外的 idle」用于表达「artifactId 为空 / 未登录」，此时不发任何请求。
 */

import { useCallback, useEffect, useState } from 'react';
import { Image } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { createArtifactsClient } from '@openAwork/web-client';
import { useAuthStore } from '../store/auth';
import {
  ARTIFACT_IMAGE_CACHE_CAPACITY,
  ARTIFACT_IMAGE_CACHE_DIRECTORY_NAME,
  ArtifactImageFailureTracker,
  ArtifactImageInFlight,
  ArtifactImageLruCache,
  buildArtifactImageFileName,
  decideArtifactImagePayload,
  deriveArtifactImageCacheKey,
  deriveArtifactImageMetadata,
  describeArtifactImageError,
  describeArtifactImageRejectReason,
  resolveArtifactImageDimensions,
  type ArtifactImageDimensions,
  type ArtifactImageSourceRecord,
} from './artifact-image-cache';

/** 尺寸探测兜底超时：`Image.getSize` 的失败回调并非所有平台都可靠触发。 */
const ARTIFACT_IMAGE_SIZE_PROBE_TIMEOUT_MS = 5000;

/**
 * 模块级共享状态：同一 `artifactId` 在多个气泡 / 页面之间只取一次、只写一次盘。
 * 均为普通 JS 对象，无 RN 依赖，可在 module 加载时安全创建。
 */
const sourceCache = new ArtifactImageLruCache<ArtifactImageSourceRecord>(
  ARTIFACT_IMAGE_CACHE_CAPACITY,
);

export type ArtifactImageSourceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | {
      status: 'ready';
      uri: string;
      mimeType: string;
      /**
       * RN `<Image>` 必须显式宽高：metadata 与 `Image.getSize` 都拿不到时为
       * `null`，由调用方决定占位策略（不要伪造尺寸，避免拉伸变形）。
       */
      width: number | null;
      height: number | null;
    };

export type ArtifactImageSourceResult = ArtifactImageSourceState & { retry: () => void };

type ArtifactImageLoadOutcome =
  { kind: 'ready'; record: ArtifactImageSourceRecord } | { kind: 'failed'; message: string };

const inFlightRequests = new ArtifactImageInFlight<ArtifactImageLoadOutcome>();
const failureTracker = new ArtifactImageFailureTracker();

interface LoadArtifactImageInput {
  artifactId: string;
  cacheKey: string;
  gatewayUrl: string;
  signal: AbortSignal;
  token: string;
}

function toReadyState(record: ArtifactImageSourceRecord): ArtifactImageSourceState {
  return {
    status: 'ready',
    uri: record.uri,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
  };
}

/**
 * 删除未完成的临时文件；失败只记录日志，不能覆盖原始写入错误。
 */
function deletePartiallyWrittenFile(file: File): void {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch (cleanupError) {
    console.warn('[artifact-image] 清理未完成的临时文件失败', cleanupError);
  }
}

/**
 * base64 → 临时文件。同名文件已存在时直接复用（应用重启后内存 LRU 为空，
 * 但磁盘缓存仍有效，可避免重复下载与写盘）。
 */
function materializeBase64ArtifactImage(input: {
  base64: string;
  cacheKey: string;
  mimeType: string;
}): { uri: string; mimeType: string } {
  const directory = new Directory(Paths.cache, ARTIFACT_IMAGE_CACHE_DIRECTORY_NAME);
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
  const file = new File(directory, buildArtifactImageFileName(input.cacheKey, input.mimeType));
  if (!file.exists) {
    file.create({ intermediates: true, overwrite: true });
    try {
      file.write(input.base64, { encoding: 'base64' });
    } catch (writeError) {
      deletePartiallyWrittenFile(file);
      throw writeError;
    }
  }
  return { uri: file.uri, mimeType: input.mimeType };
}

/**
 * `Image.getSize` 探测尺寸：成功、失败、超时都会 settle，永不 reject，
 * 因此不会产生未处理的 rejection。
 */
function probeArtifactImageDimensions(uri: string): Promise<ArtifactImageDimensions | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (dimensions: ArtifactImageDimensions | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      resolve(dimensions);
    };
    timer = setTimeout(() => finish(null), ARTIFACT_IMAGE_SIZE_PROBE_TIMEOUT_MS);
    try {
      Image.getSize(
        uri,
        (width, height) => finish(width > 0 && height > 0 ? { width, height } : null),
        () => finish(null),
      );
    } catch (probeError) {
      console.warn('[artifact-image] 尺寸探测调用失败', probeError);
      finish(null);
    }
  });
}

async function loadArtifactImageRecord(
  input: LoadArtifactImageInput,
): Promise<ArtifactImageLoadOutcome> {
  const data = await createArtifactsClient(input.gatewayUrl).get(input.token, input.artifactId, {
    signal: input.signal,
  });
  const artifact = data.artifact;
  if (!artifact || typeof artifact !== 'object') {
    return { kind: 'failed', message: '网关未返回产物内容。' };
  }
  const metadata = deriveArtifactImageMetadata(artifact['metadata']);
  const decision = decideArtifactImagePayload(artifact['content'], metadata.mimeType);
  if (decision.kind === 'reject') {
    return { kind: 'failed', message: describeArtifactImageRejectReason(decision.reason) };
  }

  const materialized =
    decision.kind === 'direct-uri'
      ? { uri: decision.uri, mimeType: decision.mimeType }
      : materializeBase64ArtifactImage({
          base64: decision.base64,
          cacheKey: input.cacheKey,
          mimeType: decision.mimeType,
        });

  const probed = await probeArtifactImageDimensions(materialized.uri);
  const dimensions = resolveArtifactImageDimensions(metadata.dimensions, probed);
  return {
    kind: 'ready',
    record: {
      uri: materialized.uri,
      mimeType: materialized.mimeType,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    },
  };
}

/**
 * 取数 hook。
 *
 * - `artifactId` 为空 / 未登录（无 token）→ `idle`，不发请求；
 * - 命中内存 LRU → 直接 `ready`，不闪 loading；
 * - 同一 `artifactId` 并发 → 共享一次请求（in-flight 去重）；
 * - 组件卸载 / 请求被中断 → 不再 `setState`；
 * - 失败：记录重试预算（3 次 / 30s 冷却）并返回 `error`，绝不抛未处理 rejection。
 */
export function useArtifactImageSource(artifactId?: string | null): ArtifactImageSourceResult {
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const token = useAuthStore((state) => state.accessToken);
  const [state, setState] = useState<ArtifactImageSourceState>({ status: 'idle' });
  const [retryNonce, setRetryNonce] = useState(0);

  const retry = useCallback(() => {
    if (!artifactId) {
      return;
    }
    const cacheKey = deriveArtifactImageCacheKey(gatewayUrl, artifactId);
    if (cacheKey !== null) {
      // 用户主动重试：清空失败登记，重新获得完整重试预算。
      failureTracker.clear(cacheKey);
    }
    setRetryNonce((current) => current + 1);
  }, [artifactId, gatewayUrl]);

  useEffect(() => {
    if (!artifactId || !token) {
      setState({ status: 'idle' });
      return;
    }
    const cacheKey = deriveArtifactImageCacheKey(gatewayUrl, artifactId);
    if (cacheKey === null) {
      setState({ status: 'idle' });
      return;
    }

    const cached = sourceCache.get(cacheKey);
    if (cached) {
      setState(toReadyState(cached));
      return;
    }

    if (!failureTracker.canAttempt(cacheKey, Date.now())) {
      setState({
        status: 'error',
        error: failureTracker.get(cacheKey)?.message ?? '图片加载失败。',
      });
      return;
    }

    let disposed = false;
    setState({ status: 'loading' });
    const pending = inFlightRequests.run(cacheKey, (signal) =>
      loadArtifactImageRecord({ artifactId, cacheKey, gatewayUrl, signal, token }),
    );

    void pending
      .then((outcome) => {
        if (disposed) {
          return;
        }
        if (outcome.kind === 'failed') {
          failureTracker.recordFailure(cacheKey, outcome.message, Date.now());
          setState({ status: 'error', error: outcome.message });
          return;
        }
        sourceCache.set(cacheKey, outcome.record);
        failureTracker.clear(cacheKey);
        setState(toReadyState(outcome.record));
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        const message = describeArtifactImageError(error);
        failureTracker.recordFailure(cacheKey, message, Date.now());
        setState({ status: 'error', error: message });
      });

    return () => {
      disposed = true;
      // 最后一个消费者离开时才中断共享请求。
      inFlightRequests.release(cacheKey);
    };
  }, [artifactId, gatewayUrl, retryNonce, token]);

  return { ...state, retry };
}

/** 非 hook 取数入口的入参。 */
export interface ResolveArtifactImageSourceInput {
  readonly artifactId: string;
  readonly gatewayUrl: string;
  readonly token: string;
}

/** 非 hook 取数入口的结果：只有「已有可用地址」与「失败」两种终态。 */
export type ResolvedArtifactImageSource =
  | {
      readonly status: 'ready';
      readonly uri: string;
      readonly mimeType: string;
      readonly width: number | null;
      readonly height: number | null;
    }
  | { readonly status: 'error'; readonly error: string };

function toResolvedReadyState(record: ArtifactImageSourceRecord): ResolvedArtifactImageSource {
  return {
    status: 'ready',
    uri: record.uri,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
  };
}

/**
 * 非 hook 版本的取数入口（W3 图集解析）：一次调用解析一个 `artifactId`。
 *
 * 与 `useArtifactImageSource` **共享同一套模块级 LRU / in-flight 去重 / 失败预算**：
 * - 同一条消息内重复 id 的并发调用只发一次请求（in-flight 合并）；
 * - 气泡已经用 hook 加载过的图片直接命中 LRU，不重复下载；
 * - 结果**永不 reject**（失败统一转成 `{ status: 'error' }`），调用点可安全地
 *   `Promise.all` 并发解析整条消息的图片。
 *
 * 与 hook 的差异只在生命周期：本函数不受组件卸载影响，过期结果由调用点自行忽略。
 */
export async function resolveArtifactImageSource(
  input: ResolveArtifactImageSourceInput,
): Promise<ResolvedArtifactImageSource> {
  const cacheKey = deriveArtifactImageCacheKey(input.gatewayUrl, input.artifactId);
  if (cacheKey === null) {
    return { status: 'error', error: '图片产物缺少有效标识。' };
  }

  const cached = sourceCache.get(cacheKey);
  if (cached) {
    return toResolvedReadyState(cached);
  }

  if (!failureTracker.canAttempt(cacheKey, Date.now())) {
    return {
      status: 'error',
      error: failureTracker.get(cacheKey)?.message ?? '图片加载失败。',
    };
  }

  try {
    const outcome = await inFlightRequests.run(cacheKey, (signal) =>
      loadArtifactImageRecord({
        artifactId: input.artifactId,
        cacheKey,
        gatewayUrl: input.gatewayUrl,
        signal,
        token: input.token,
      }),
    );
    if (outcome.kind === 'failed') {
      failureTracker.recordFailure(cacheKey, outcome.message, Date.now());
      return { status: 'error', error: outcome.message };
    }
    sourceCache.set(cacheKey, outcome.record);
    failureTracker.clear(cacheKey);
    return toResolvedReadyState(outcome.record);
  } catch (error) {
    const message = describeArtifactImageError(error);
    failureTracker.recordFailure(cacheKey, message, Date.now());
    return { status: 'error', error: message };
  } finally {
    // 与 hook 的消费者计数对称：共享请求在最后一个消费者离开时才中断。
    inFlightRequests.release(cacheKey);
  }
}
