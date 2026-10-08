/**
 * 会话产物列表（`GET /sessions/:id/artifacts`）的在途单飞层。
 *
 * ## 为什么需要
 *
 * 同一条 `listForSession` 请求在本页有两条消费链路：
 *
 * 1. ChatPage 常驻链路（`useSessionContentArtifacts`）——供右栏概览的产物
 *    计数与图片编辑参考图使用，**不看审阅面板是否打开**。
 * 2. 右侧审阅面板（`useReviewPanelArtifacts`）——由 `opened` 门控，额外还要
 *    完整的 `ArtifactRecord[]` 做选中态与预览。
 *
 * 两者请求参数完全一致（`listForSession` 无额外 query），差别只在消费方式。
 * 当审阅面板常开着切换会话时，两条链路会在同一时刻各发一次同样的请求。
 *
 * ## 刻意不做的事
 *
 * - **不做结果 TTL 缓存**：产物随时可能被 Agent 写入新文件，缓存会让审阅
 *   面板显示陈旧列表。本层只合并「同时在途」的重复请求。
 * - **审阅面板的 `reload()` 必须真正重取**：因此提供 `force`，它既不复用
 *   也不登记在途表，避免手动刷新被同刻的其他请求吞掉。
 *
 * ## 取消语义（引用计数）
 *
 * 共享请求不能被任一订阅者单独掐断，但**最后一个订阅者离开时必须真正取消**
 * ——否则面板卸载 / 快速切会话后，底层仍挂着一个没人要的网络请求。
 * 因此每个订阅者被 abort 时递减计数，归零才 `controller.abort()`。
 *
 * 语义与 `session-recovery-flight.ts` 同构，可对照阅读。
 */

import { createArtifactsClient } from '@openAwork/web-client';
import type { ArtifactRecord } from '@openAwork/artifacts';

export interface SessionArtifactsFlightOptions {
  gatewayUrl: string;
  token: string;
  sessionId: string;
  /** 强制重新拉取：既不复用在途请求，也不登记进在途表。 */
  force?: boolean;
  /** 只取消本次调用方的等待，不影响共享请求与其他订阅者。 */
  signal?: AbortSignal;
}

export interface SessionArtifactsReadModel {
  contentArtifacts: ArtifactRecord[];
}

interface InFlightArtifacts {
  promise: Promise<SessionArtifactsReadModel>;
  controller: AbortController;
  /** 仍在等待该响应的订阅者数量；归零时真正取消底层请求。 */
  subscribers: number;
}

const inFlightArtifacts = new Map<string, InFlightArtifacts>();

function buildArtifactsKey(options: SessionArtifactsFlightOptions): string {
  return `${options.gatewayUrl} ${options.sessionId}`;
}

function createAbortError(): DOMException {
  return new DOMException('会话产物加载已取消', 'AbortError');
}

function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbandon: () => void,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    onAbandon();
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      onAbandon();
      reject(createAbortError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * 读取会话产物列表；同一 session 同时在途的请求合并为一次网络往返。
 *
 * 产物列表没有 `messageLimit` 那样的「子集/超集」之分 —— 响应是全量列表，
 * 因此任何后来者都可直接复用，不必像 recovery 那样比较条数。
 */
export function fetchSessionArtifactsOnce(
  options: SessionArtifactsFlightOptions,
): Promise<SessionArtifactsReadModel> {
  const key = buildArtifactsKey(options);
  const isForced = options.force === true;

  const existing = isForced ? undefined : inFlightArtifacts.get(key);
  if (existing) {
    existing.subscribers += 1;
    return awaitWithSignal(existing.promise, options.signal, () => {
      existing.subscribers -= 1;
      if (existing.subscribers === 0) {
        inFlightArtifacts.delete(key);
        existing.controller.abort();
      }
    });
  }

  const controller = new AbortController();
  const request = createArtifactsClient(options.gatewayUrl)
    .listForSession(options.token, options.sessionId, { signal: controller.signal })
    .then((payload) => {
      const contentArtifacts = (payload as { contentArtifacts?: ArtifactRecord[] })
        .contentArtifacts;
      return { contentArtifacts: contentArtifacts ?? [] };
    });

  if (!isForced) {
    const entry: InFlightArtifacts = { promise: request, controller, subscribers: 1 };
    inFlightArtifacts.set(key, entry);
    const settle = () => {
      if (inFlightArtifacts.get(key) === entry) {
        inFlightArtifacts.delete(key);
      }
    };
    request.then(settle, settle);

    return awaitWithSignal(request, options.signal, () => {
      entry.subscribers -= 1;
      if (entry.subscribers === 0) {
        inFlightArtifacts.delete(key);
        controller.abort();
      }
    });
  }

  // force：独占一次请求，调用方就是唯一订阅者，abort 直接透传。
  return awaitWithSignal(request, options.signal, () => {
    controller.abort();
  });
}

/** 仅供测试：清空在途登记表。 */
export function resetSessionArtifactFlightsForTesting(): void {
  inFlightArtifacts.clear();
}
