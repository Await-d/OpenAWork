/**
 * 待发队列的服务端同步通道。
 *
 * 队列原本只活在浏览器（localStorage + IndexedDB），刷新 / 换端即不可见。现在网关是
 * 唯一真相源，本 hook 把三条命令式操作收敛到一处：
 *
 * - `hydrate`：进入会话时从网关拉全量（替代原先读 localStorage 快照）
 * - `enqueue`：入队即落库，保证刷新不丢
 * - `remove`：移出队列 / 恢复到输入框时删记录（「会话空闲」校验由 claim 路由一并向网关收敛）
 *
 * 「消费成功后的清理」不在此列，原因见 `ComposerQueueBackend` 里的说明。
 *
 * 附件二进制仍留在 IndexedDB（`queued-composer-file-store.ts`），网关只存附件元数据
 * 用于重建预览；本地 Blob 取不到时条目会被标记 `requiresAttachmentRebind`，提示用户
 * 重新选择文件，而不是静默丢附件。
 */

import { useCallback, useMemo, useRef } from 'react';
import {
  createComposerQueueClient,
  type ComposerQueueBatchClaim,
  type ComposerQueueClaimResult,
  type ComposerQueueClient,
  type ComposerQueueItem,
} from '@openAwork/web-client';
import { logger } from '../../../../utils/log/logger.js';
import { resolveComposerQueueClientId } from './composer-queue-client-id.js';
import type { PersistedQueuedComposerMessage } from './queued-composer-state.js';

/**
 * 一次请求的完整定位信息。
 *
 * `client` 一并带出来而非让调用方闭包捕获：`gatewayUrl` 为空时 client 是 null，
 * 把它收进这个可空对象，调用点只需判一次 `target` 即可同时完成「可用性检查 +
 * 类型窄化」，不必到处写非空断言。
 */
interface QueueTarget {
  activeSessionId: string;
  activeToken: string;
  client: ComposerQueueClient;
}

export interface UseComposerQueueBackendOptions {
  gatewayUrl: string;
  sessionId: string | null;
  token: string | null;
}

export interface ComposerQueueBackend {
  /**
   * 拉取该会话的服务端队列。
   *
   * 未登录 / 网关不可用时返回 `null` 而非空数组——两者语义不同：空数组意味着「服务端
   * 确认没有待发条目」，`null` 意味着「没问成」，调用方据此决定是否保留本地兜底数据。
   */
  hydrate: () => Promise<PersistedQueuedComposerMessage[] | null>;
  enqueue: (item: PersistedQueuedComposerMessage) => Promise<boolean>;
  remove: (itemId: string) => Promise<boolean>;
  /**
   * 认领一条待发消息的发送权（多端互斥 + 会话空闲校验，两者同源于网关）。
   *
   * 三态语义，调用方必须区分：
   * - `claimed: true`：拿到发送权，可以发；
   * - `claimed: false` + `reason: 'held_by_other'`：**另一端正在处理该条目**，跳过并
   *   以服务端为准重新收敛——这不是错误，重试只会加剧竞争；
   * - `claimed: false` + `reason: 'session_running'`：**会话仍被单飞锁占用**（另一端
   *   的请求 / 网关自己唤醒的 run / 上一回合收尾），此时发出去必被拒成
   *   SESSION_ALREADY_RUNNING——条目应保留并退避重试；
   * - 抛错：没问成（网关不可达）。此时状态未知，调用方同样应跳过而非硬发，否则
   *   会出现「claim 失败但发送成功」的重复发送窗口。
   */
  claim: (itemId: string) => Promise<ComposerQueueClaimResult>;
  claimMany: (itemIds: readonly string[]) => Promise<ComposerQueueBatchClaim[]>;
  /** 发送失败时交还发送权，让别的端（或自己下一轮）能接手，不必等租约过期。 */
  releaseClaim: (itemId: string) => Promise<void>;
  // 刻意**不**提供 `probeSessionIdle`：「会话空闲」的校验已并入网关 claim 路由
  // （与 409 单飞锁判定同源，见 `session-composer-queue.ts`），客户端无需二次探测。
  // 刻意**不**提供 `consume`：消费清理发生在 `run-send-message.ts` 的各条
  // return true 分支上，那里的 sessionId 是分支局部变量（`sid` /
  // `requestOriginSessionId`），拿不到 hook 上下文。故该职责由那里的模块级
  // `cleanupConsumedQueuedMessage` 承担，两边不要各写一份。
}

/**
 * 把网关返回的队列条目对齐成前端持久化形状。
 *
 * 入库的是服务端权威数据，但 `requiresAttachmentRebind` 最终要由客户端判定——它取决于
 * 本地 IndexedDB 里有没有对应 Blob，服务端无从得知。故此处一律先置 `false`，由
 * `hydrateQueuedComposerMessage` + `restoreQueuedComposerFiles` 在拿到本地文件后再修正。
 */
function toPersistedItem(item: ComposerQueueItem): PersistedQueuedComposerMessage {
  return {
    attachmentItems: item.attachmentItems.map((attachment) => ({ ...attachment })),
    enqueuedAt: item.enqueuedAt,
    id: item.id,
    requiresAttachmentRebind: false,
    text: item.text,
  };
}

export function useComposerQueueBackend(
  options: UseComposerQueueBackendOptions,
): ComposerQueueBackend {
  const { gatewayUrl, sessionId, token } = options;

  const client = useMemo(
    () => (gatewayUrl.length > 0 ? createComposerQueueClient(gatewayUrl) : null),
    [gatewayUrl],
  );

  // 入队 / 消费是「先乐观改内存、随后打后端」的时序，sessionId 可能在请求飞行途中切换。
  // 回调一律读取调用当时的 ref，避免把 A 会话的条目写进 B 会话。
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const resolveTarget = useCallback((): QueueTarget | null => {
    const activeSessionId = sessionIdRef.current;
    const activeToken = tokenRef.current;
    if (!client || !activeSessionId || !activeToken) {
      return null;
    }
    return { activeSessionId, activeToken, client };
  }, [client]);

  const hydrate = useCallback(async (): Promise<PersistedQueuedComposerMessage[] | null> => {
    const target = resolveTarget();
    if (!target) {
      return null;
    }
    try {
      const items = await target.client.list(target.activeToken, target.activeSessionId);
      return items.map(toPersistedItem);
    } catch (error) {
      // 水合失败不能打断会话渲染——本地 IndexedDB 兜底仍可能救回带附件的条目。
      logger.warn('待发队列水合失败，保留本地数据', error);
      return null;
    }
  }, [resolveTarget]);

  const enqueue = useCallback(
    async (item: PersistedQueuedComposerMessage): Promise<boolean> => {
      const target = resolveTarget();
      if (!target) {
        return false;
      }
      try {
        await target.client.enqueue(target.activeToken, target.activeSessionId, {
          attachmentItems: item.attachmentItems,
          itemId: item.id,
          requiresAttachmentRebind: item.requiresAttachmentRebind,
          text: item.text,
        });
        return true;
      } catch (error) {
        logger.warn('待发队列入队失败', error);
        return false;
      }
    },
    [resolveTarget],
  );

  const remove = useCallback(
    async (itemId: string): Promise<boolean> => {
      const target = resolveTarget();
      if (!target) {
        return false;
      }
      try {
        await target.client.remove(target.activeToken, target.activeSessionId, itemId);
        return true;
      } catch (error) {
        logger.warn('待发队列移除失败', error);
        return false;
      }
    },
    [resolveTarget],
  );

  // clientId 每标签页一个、刷新稳定，故用 ref 固化：它不参与任何请求竞态的判定，
  // 但必须在整个 hook 生命周期内保持同一个值，否则 claim / release 会认到不同的端。
  const clientIdRef = useRef<string | null>(null);
  if (clientIdRef.current === null) {
    clientIdRef.current = resolveComposerQueueClientId();
  }
  const claim = useCallback(
    async (itemId: string): Promise<ComposerQueueClaimResult> => {
      const target = resolveTarget();
      if (!target) {
        // 网关未就绪：所有权无从确认，交给调用方按「没问成」处理。
        throw new Error('待发队列发送权认领失败：网关尚未就绪。');
      }
      // 每次都问网关，不做本地「已持有」缓存：服务端对同一 clientId 的重复 claim 是
      // 幂等续期，而本地缓存会让「会话仍被单飞锁占用（session_running）」与「租约已
      // 过期」的真实状态被旧结论遮蔽——被拒回流后同 id 重发会绕过网关判定，形成无
      // 退避的重发循环，甚至在租约过期后与他端重复发送。三态语义（拿到 / 他人持有 /
      // 没问成）必须让调用方基于服务端的实时结论行动。
      return target.client.claim(target.activeToken, target.activeSessionId, itemId, {
        clientId: clientIdRef.current as string,
      });
    },
    [resolveTarget],
  );

  const claimMany = useCallback(
    async (itemIds: readonly string[]): Promise<ComposerQueueBatchClaim[]> => {
      const target = resolveTarget();
      if (!target) {
        throw new Error('待发队列发送权批量认领失败：网关尚未就绪。');
      }
      // 与 claim 同理：全量交由服务端裁决，拒绝理由（reason）实时可见。
      return target.client.claimMany(target.activeToken, target.activeSessionId, itemIds, {
        clientId: clientIdRef.current as string,
      });
    },
    [resolveTarget],
  );

  const releaseClaim = useCallback(
    async (itemId: string): Promise<void> => {
      const target = resolveTarget();
      if (!target) {
        return;
      }
      try {
        await target.client.releaseClaim(
          target.activeToken,
          target.activeSessionId,
          itemId,
          clientIdRef.current as string,
        );
      } catch (error) {
        // 交还失败不影响正确性：服务端租约会自行过期，条目仍会被接手。
        logger.warn('待发队列发送权交还失败', error);
      }
    },
    [resolveTarget],
  );

  return { claim, claimMany, enqueue, hydrate, releaseClaim, remove };
}
