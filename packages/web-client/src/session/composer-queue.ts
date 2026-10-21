import { HttpError } from './sessions.js';
import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

/**
 * 会话待发队列客户端。
 *
 * 待发队列原先只存在于浏览器本地（localStorage + IndexedDB），刷新或换端即不可见。
 * 迁到网关后本客户端是唯一的写入通道——`apps/` 下任何直接 `fetch` 网关的写法都被
 * 项目规约禁止，消费端必须经由此处。
 *
 * 附件二进制不在此传输：只同步附件元数据，用于重建队列预览。真正的 File 优先由
 * 客户端 IndexedDB 持有；跨端（换设备 / 清缓存）取不到本地 Blob 时，凭条目里的
 * `attachmentItems[].artifactId` 经由 `createArtifactsClient` 的
 * `downloadFromSession` 拉回二进制，两者都不可得才置 `requiresAttachmentRebind`。
 */

/** 与网关 `ComposerQueueAttachment` 对齐，并与 shared-ui 的 `AttachmentItem` 保持同一取值域。 */
export interface ComposerQueueAttachment {
  /**
   * 附件跨端副本的网关产物 id（`POST /sessions/:id/artifacts` 的返回）。
   * 入队时先不带它落库、上传成功后再经 `updateAttachments` 回填；缺失表示该附件
   * 没有跨端副本（上传失败或旧版本客户端写入）。
   */
  artifactId?: string;
  id: string;
  name: string;
  sizeBytes: number;
  type: 'audio' | 'file' | 'image' | 'video';
}

export interface ComposerQueueItem {
  attachmentItems: ComposerQueueAttachment[];
  enqueuedAt: number;
  id: string;
  requiresAttachmentRebind: boolean;
  text: string;
}

export interface EnqueueComposerQueueInput {
  attachmentItems: ComposerQueueAttachment[];
  /** 客户端生成的 UUID，兼作幂等键。 */
  itemId: string;
  requiresAttachmentRebind: boolean;
  text: string;
}

export interface EnqueueComposerQueueResult {
  created: boolean;
  item: ComposerQueueItem;
}

export interface UpdateComposerQueueAttachmentsInput {
  attachmentItems: ComposerQueueAttachment[];
  /**
   * 附件就绪后清除「需重新选择附件」标记。
   *
   * 该标记同时来自两个不足：本地 IndexedDB 写失败、条目没有跨端副本。上传成功即
   * 第二个不足消失，配合水合时的远端下载，条目在任意端都能取回附件，标记无意义。
   */
  requiresAttachmentRebind?: boolean;
}

/** `claimed: false` 时的拒绝原因。 */
export type ComposerQueueClaimRejectionReason = 'held_by_other' | 'session_running';

export interface ComposerQueueClaimResult {
  claimed: boolean;
  /**
   * 拒绝原因,仅 `claimed: false` 时存在:
   * - `held_by_other`:另一端已持有**这条条目**的发送权,跳过即可;
   * - `session_running`:**会话**仍被单飞锁占用(另一端的请求 / 网关自己唤醒的 run /
   *   上一回合收尾),条目应保留并退避重试。
   * 旧网关不返回该字段,此时视作 `held_by_other`。
   */
  reason?: ComposerQueueClaimRejectionReason;
}

export interface ComposerQueueBatchClaim {
  claimed: boolean;
  itemId: string;
  reason?: ComposerQueueClaimRejectionReason;
}

export interface ComposerQueueClient {
  /**
   * 独占一条待发消息的发送权。
   *
   * `claimed: false` 是正常结果（不是失败），按 `reason` 分流：
   * - `held_by_other`：另一端正在处理**这条条目**，跳过并以服务端队列为准收敛，
   *   不要重试或报错；
   * - `session_running`：**会话**仍被网关单飞锁占用（另一端的请求 / 网关自己唤醒的
   *   run / 上一回合正在收尾），此时发出去必被拒成 SESSION_ALREADY_RUNNING——条目
   *   应保留并退避重试。
   */
  claim(
    token: string,
    sessionId: string,
    itemId: string,
    input: { clientId: string; leaseMs?: number },
    options?: { signal?: AbortSignal },
  ): Promise<ComposerQueueClaimResult>;
  claimMany(
    token: string,
    sessionId: string,
    itemIds: readonly string[],
    input: { clientId: string; leaseMs?: number },
    options?: { signal?: AbortSignal },
  ): Promise<ComposerQueueBatchClaim[]>;
  clear(token: string, sessionId: string, options?: { signal?: AbortSignal }): Promise<number>;
  enqueue(
    token: string,
    sessionId: string,
    input: EnqueueComposerQueueInput,
    options?: { signal?: AbortSignal },
  ): Promise<EnqueueComposerQueueResult>;
  list(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ComposerQueueItem[]>;
  /** 发送失败时交还发送权，避免条目要等租约过期才能被别的端接手。 */
  releaseClaim(
    token: string,
    sessionId: string,
    itemId: string,
    clientId: string,
    options?: { signal?: AbortSignal },
  ): Promise<boolean>;
  remove(
    token: string,
    sessionId: string,
    itemId: string,
    options?: { signal?: AbortSignal },
  ): Promise<boolean>;
  /**
   * 回填附件跨端引用（附件副本上传成功后调用）。
   *
   * 条目在两步之间可能已被消费 / 移出，网关对此回 404——本方法**不抛错**而是返回
   * `null`，调用方据此把刚上传的副本当孤儿回收（而不是重试一个永远不会成功的回填）。
   */
  updateAttachments(
    token: string,
    sessionId: string,
    itemId: string,
    input: UpdateComposerQueueAttachmentsInput,
    options?: { signal?: AbortSignal },
  ): Promise<ComposerQueueItem | null>;
}

const ACTION_LIST = '读取待发队列';
const ACTION_ENQUEUE = '加入待发队列';
const ACTION_REMOVE = '移出待发队列';
const ACTION_CLEAR = '清空待发队列';
const ACTION_CLAIM = '获取待发消息发送权';
const ACTION_CLAIM_MANY = '批量获取待发消息发送权';
const ACTION_RELEASE = '交还待发消息发送权';
const ACTION_UPDATE_ATTACHMENTS = '回填待发队列附件引用';

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function buildActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标会话不存在，无法${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function normalizeError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage(
      (error.data ?? undefined) as JsonErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericFetchErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

/**
 * 统一处理「非 2xx → 结构化错误」。
 *
 * 队列条目的形状由客户端收紧解析而非直接信任响应：网关是权威数据源，但客户端
 * 不应因为一条脏数据就让整个队列渲染崩掉。
 */
async function readJsonOrThrow(response: Response, actionLabel: string): Promise<unknown> {
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as JsonErrorData | null;
    throw new HttpError(
      buildActionErrorMessage(actionLabel, response.status, data ?? undefined),
      response.status,
      data ?? undefined,
    );
  }
  return (await response.json().catch(() => null)) as unknown;
}

function toAttachment(value: unknown): ComposerQueueAttachment | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return null;
  }
  const sizeBytes = candidate.sizeBytes;
  const rawType = candidate.type;
  const rawArtifactId = candidate.artifactId;
  return {
    ...(typeof rawArtifactId === 'string' && rawArtifactId.length > 0
      ? { artifactId: rawArtifactId }
      : {}),
    id: candidate.id,
    name: candidate.name,
    sizeBytes: typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) ? sizeBytes : 0,
    type: rawType === 'image' || rawType === 'audio' || rawType === 'video' ? rawType : 'file',
  };
}

function toComposerQueueItem(value: unknown): ComposerQueueItem | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return null;
  }
  const rawAttachments = candidate.attachmentItems;
  const attachmentItems = Array.isArray(rawAttachments)
    ? rawAttachments
        .map(toAttachment)
        .filter((item): item is ComposerQueueAttachment => item !== null)
    : [];
  const enqueuedAt = candidate.enqueuedAt;
  return {
    attachmentItems,
    enqueuedAt: typeof enqueuedAt === 'number' && Number.isFinite(enqueuedAt) ? enqueuedAt : 0,
    id: candidate.id,
    requiresAttachmentRebind: candidate.requiresAttachmentRebind === true,
    text: typeof candidate.text === 'string' ? candidate.text : '',
  };
}

export function createComposerQueueClient(gatewayUrl: string): ComposerQueueClient {
  const base = (sessionId: string): string =>
    `${gatewayUrl}/sessions/${encodeURIComponent(sessionId)}/composer-queue`;
  const claimUrl = (sessionId: string, itemId: string): string =>
    `${base(sessionId)}/${encodeURIComponent(itemId)}/claim`;
  const claimManyUrl = (sessionId: string): string => `${base(sessionId)}/claim`;

  return {
    async claim(token, sessionId, itemId, input, options) {
      try {
        const response = await fetchWithTimeout(claimUrl(sessionId, itemId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(token) },
          body: JSON.stringify({
            clientId: input.clientId,
            ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
          }),
          signal: options?.signal,
        });
        const payload = (await readJsonOrThrow(response, ACTION_CLAIM)) as {
          claimed?: unknown;
          reason?: unknown;
        } | null;
        const claimed = payload?.claimed === true;
        if (claimed) {
          return { claimed };
        }
        // reason 收敛为封闭枚举：旧网关不返回该字段，按「他端持有」处理，调用方无需判空。
        const reason = payload?.reason === 'session_running' ? 'session_running' : 'held_by_other';
        return { claimed, reason };
      } catch (error) {
        throw normalizeError(ACTION_CLAIM, error);
      }
    },

    async claimMany(token, sessionId, itemIds, input, options) {
      try {
        const response = await fetchWithTimeout(claimManyUrl(sessionId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(token) },
          body: JSON.stringify({
            clientId: input.clientId,
            itemIds,
            ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
          }),
          signal: options?.signal,
        });
        const payload = (await readJsonOrThrow(response, ACTION_CLAIM_MANY)) as {
          claims?: unknown;
        } | null;
        if (!Array.isArray(payload?.claims)) {
          throw new Error(`${ACTION_CLAIM_MANY}失败：网关未返回可识别的结果。`);
        }
        return payload.claims.flatMap((value): ComposerQueueBatchClaim[] => {
          if (typeof value !== 'object' || value === null) {
            return [];
          }
          const candidate = value as Record<string, unknown>;
          if (typeof candidate.itemId !== 'string' || candidate.itemId.length === 0) {
            return [];
          }
          const claimed = candidate.claimed === true;
          if (claimed) {
            return [{ claimed, itemId: candidate.itemId }];
          }
          const reason =
            candidate.reason === 'session_running' ? 'session_running' : 'held_by_other';
          return [{ claimed, itemId: candidate.itemId, reason }];
        });
      } catch (error) {
        throw normalizeError(ACTION_CLAIM_MANY, error);
      }
    },

    async releaseClaim(token, sessionId, itemId, clientId, options) {
      try {
        const response = await fetchWithTimeout(claimUrl(sessionId, itemId), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...authHeader(token) },
          body: JSON.stringify({ clientId }),
          signal: options?.signal,
        });
        const payload = (await readJsonOrThrow(response, ACTION_RELEASE)) as {
          released?: unknown;
        } | null;
        return payload?.released === true;
      } catch (error) {
        throw normalizeError(ACTION_RELEASE, error);
      }
    },

    async list(token, sessionId, options) {
      try {
        const response = await fetchWithTimeout(base(sessionId), {
          method: 'GET',
          headers: authHeader(token),
          signal: options?.signal,
        });
        const payload = (await readJsonOrThrow(response, ACTION_LIST)) as {
          items?: unknown;
        } | null;
        const rawItems = payload?.items;
        if (!Array.isArray(rawItems)) {
          return [];
        }
        return rawItems
          .map(toComposerQueueItem)
          .filter((item): item is ComposerQueueItem => item !== null);
      } catch (error) {
        throw normalizeError(ACTION_LIST, error);
      }
    },

    async enqueue(token, sessionId, input, options) {
      try {
        const response = await fetchWithTimeout(base(sessionId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(token) },
          body: JSON.stringify({
            attachmentItems: input.attachmentItems,
            itemId: input.itemId,
            requiresAttachmentRebind: input.requiresAttachmentRebind,
            text: input.text,
          }),
          signal: options?.signal,
        });
        const payload = (await readJsonOrThrow(response, ACTION_ENQUEUE)) as {
          created?: unknown;
          item?: unknown;
        } | null;
        const item = toComposerQueueItem(payload?.item);
        if (!item) {
          throw new Error(`${ACTION_ENQUEUE}失败：网关未返回可识别的队列条目。`);
        }
        return { created: payload?.created === true, item };
      } catch (error) {
        throw normalizeError(ACTION_ENQUEUE, error);
      }
    },

    async remove(token, sessionId, itemId, options) {
      try {
        const response = await fetchWithTimeout(
          `${base(sessionId)}/${encodeURIComponent(itemId)}`,
          {
            method: 'DELETE',
            headers: authHeader(token),
            signal: options?.signal,
          },
        );
        const payload = (await readJsonOrThrow(response, ACTION_REMOVE)) as {
          removed?: unknown;
        } | null;
        return payload?.removed === true;
      } catch (error) {
        throw normalizeError(ACTION_REMOVE, error);
      }
    },

    async updateAttachments(token, sessionId, itemId, input, options) {
      try {
        const response = await fetchWithTimeout(
          `${base(sessionId)}/${encodeURIComponent(itemId)}/attachments`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({
              attachmentItems: input.attachmentItems,
              ...(input.requiresAttachmentRebind === undefined
                ? {}
                : { requiresAttachmentRebind: input.requiresAttachmentRebind }),
            }),
            signal: options?.signal,
          },
        );
        // 404 是「条目已不在队列」（已被消费 / 移出）的正常结果，按 null 交给调用方
        // 回收孤儿副本；其余错误照常抛出。
        if (response.status === 404) {
          return null;
        }
        const payload = (await readJsonOrThrow(response, ACTION_UPDATE_ATTACHMENTS)) as {
          item?: unknown;
        } | null;
        const item = toComposerQueueItem(payload?.item);
        if (!item) {
          throw new Error(`${ACTION_UPDATE_ATTACHMENTS}失败：网关未返回可识别的队列条目。`);
        }
        return item;
      } catch (error) {
        throw normalizeError(ACTION_UPDATE_ATTACHMENTS, error);
      }
    },

    async clear(token, sessionId, options) {
      try {
        const response = await fetchWithTimeout(base(sessionId), {
          method: 'DELETE',
          headers: authHeader(token),
          signal: options?.signal,
        });
        const payload = (await readJsonOrThrow(response, ACTION_CLEAR)) as {
          removedCount?: unknown;
        } | null;
        return typeof payload?.removedCount === 'number' ? payload.removedCount : 0;
      } catch (error) {
        throw normalizeError(ACTION_CLEAR, error);
      }
    },
  };
}
