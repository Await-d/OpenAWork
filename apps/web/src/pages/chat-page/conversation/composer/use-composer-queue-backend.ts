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
 * **附件跨端**：入队后附件会被上传到网关（磁盘型产物）作为跨端副本，artifactId 经
 * `updateQueuedAttachments` 回填条目；换端水合时本地 IndexedDB 缺 Blob，则凭它经
 * `downloadQueuedAttachments` 拉回二进制。两条路都走不通时条目才被标记
 * `requiresAttachmentRebind`，提示用户重新选择文件，而不是静默丢附件。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  createArtifactsClient,
  createComposerQueueClient,
  type ArtifactsClient,
  type ComposerQueueBatchClaim,
  type ComposerQueueClaimResult,
  type ComposerQueueClient,
  type ComposerQueueItem,
} from '@openAwork/web-client';
import {
  fileToBase64,
  inferMimeTypeFromFileName,
  resolveFileMimeType,
} from '../../../../components/conversation-runtime/attachments/attachment-upload.js';
import { logger } from '../../../../utils/log/logger.js';
import { resolveComposerQueueClientId } from './composer-queue-client-id.js';
import type {
  PersistedQueuedComposerMessage,
  QueuedComposerAttachment,
} from './queued-composer-state.js';

/**
 * 单条队列消息允许上传的跨端副本总量上限。
 *
 * 跨端副本的代价是服务端磁盘（没有配额体系），而附件本身没有总量限制；取 64MiB 够
 * 覆盖常见的「截图 + 文档」，又不至于让一条排队消息在服务端落下一个大目录。超限时
 * 不上传——条目退回「仅本端可用」，与上传失败同一条降级路径（本端仍可正常自动发送）。
 */
const COMPOSER_QUEUE_REMOTE_ATTACHMENT_TOTAL_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 单个附件的跨端副本上限。
 *
 * 上传路由的 `bodyLimit` 是 40MiB，而请求体里带的是 base64（膨胀约 4/3）——原文件
 * 一旦超过 24MiB 就必然被 413 拒掉。提前跳过既省下一次注定失败的大流量上传，也让
 * 失败原因在日志里直白可见（而不是笼统的「网络异常」）。
 */
const COMPOSER_QUEUE_REMOTE_ATTACHMENT_FILE_MAX_BYTES = 24 * 1024 * 1024;

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
  /** 附件跨端副本的上传 / 下载面（`/sessions/:id/artifacts`）。 */
  artifactsClient: ArtifactsClient<{ id: string }>;
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
  /**
   * 上传附件跨端副本，返回合并了 `artifactId` 的附件列表。
   *
   * 顺序上传而非并行：单条消息最多 32 个附件，并行 base64 编码会同时持有全部文件的
   * 内存副本。任一文件失败即回滚已上传的副本并返回 `null`——条目退回「仅本端可用」，
   * 全部成功才由调用方回填，保证条目要么完整跨端、要么完全本地。
   */
  uploadQueuedAttachments: (input: {
    attachmentItems: readonly QueuedComposerAttachment[];
    files: readonly File[];
  }) => Promise<QueuedComposerAttachment[] | null>;
  /**
   * 把附件列表（含 `artifactId`）回填到服务端条目。
   *
   * 三态：`updated`（已回填）/ `missing`（条目已被消费或移出，调用方应回收刚上传的
   * 副本）/ `failed`（网络之类，保留副本但暂不回填——不删，留给后续水合窗口）。
   */
  updateQueuedAttachments: (
    itemId: string,
    input: {
      attachmentItems: readonly QueuedComposerAttachment[];
      /** 附件副本已就绪时置 false，清除「需重新选择附件」标记。 */
      requiresAttachmentRebind?: boolean;
    },
  ) => Promise<'failed' | 'missing' | 'updated'>;
  /**
   * 凭 `artifactId` 逐条下载跨端副本并重建 `File`（顺序与附件列表同序）。
   *
   * 任一附件缺少 `artifactId` 或下载失败即返回 `null`：水合恢复是「全有或全无」的
   * 语义——部分恢复会让 files 与 attachmentItems 数量脱节，而队列消费 / 恢复回输入框
   * 都依赖两者同序同长。
   */
  downloadQueuedAttachments: (
    attachmentItems: readonly QueuedComposerAttachment[],
  ) => Promise<File[] | null>;
  /** best-effort 回收孤儿副本（上传成功但条目已消失时）。失败只记日志。 */
  discardQueuedAttachmentArtifacts: (artifactIds: readonly string[]) => Promise<void>;
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
 * 「本地 IndexedDB 或跨端副本（`artifactId`）能不能把 Blob 找回来」，服务端无从得知。
 * 故此处一律先置 `false`，由 `hydrateQueuedComposerMessage` 之后的水合步骤
 * （`restoreQueuedComposerFiles` → `downloadQueuedAttachments`）在拿到文件后再修正。
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

/**
 * 上传单个附件并返回其产物 id；网关未返回可识别 id 时抛错（交由调用方的 catch 兜底）。
 *
 * 必须留在模块级：try 内的 `throw` 会让编译器报 "Support ThrowStatement inside of
 * try/catch" 并放弃优化整个 hook（实测）。语义逐字照搬。
 */
async function uploadQueueAttachmentOnce(
  upload: () => Promise<{ artifact: { id?: string } }>,
): Promise<string> {
  const { artifact } = await upload();
  if (typeof artifact.id !== 'string' || artifact.id.length === 0) {
    throw new Error('网关未返回可识别的产物 id。');
  }
  return artifact.id;
}

export function useComposerQueueBackend(
  options: UseComposerQueueBackendOptions,
): ComposerQueueBackend {
  const { gatewayUrl, sessionId, token } = options;

  const client = useMemo(
    () => (gatewayUrl.length > 0 ? createComposerQueueClient(gatewayUrl) : null),
    [gatewayUrl],
  );
  const artifactsClient = useMemo(
    () => (gatewayUrl.length > 0 ? createArtifactsClient<{ id: string }>(gatewayUrl) : null),
    [gatewayUrl],
  );

  // 入队 / 消费是「先乐观改内存、随后打后端」的时序，sessionId 可能在请求飞行途中切换。
  // 回调一律读取调用当时的 ref，避免把 A 会话的条目写进 B 会话。
  const sessionIdRef = useRef(sessionId);
  const tokenRef = useRef(token);
  // 渲染期直接写 ref 会被编译器判为 "Cannot update ref during render" 并放弃优化整个 hook，
  // 故改为 effect 同步；回调一律在事件 / 异步路径里读取（晚于提交），拿到的仍是最新的
  // sessionId / token，与原来的「读取调用当时的 ref」语义一致。
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const resolveTarget = useCallback((): QueueTarget | null => {
    const activeSessionId = sessionIdRef.current;
    const activeToken = tokenRef.current;
    if (!client || !artifactsClient || !activeSessionId || !activeToken) {
      return null;
    }
    return { activeSessionId, activeToken, artifactsClient, client };
  }, [artifactsClient, client]);

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

  const discardQueuedAttachmentArtifacts = useCallback(
    async (artifactIds: readonly string[]): Promise<void> => {
      const target = resolveTarget();
      if (!target || artifactIds.length === 0) {
        return;
      }
      await Promise.all(
        artifactIds.map((artifactId) =>
          target.artifactsClient
            .removeFromSession(target.activeToken, target.activeSessionId, artifactId)
            .catch((error: unknown) => {
              // 回收是 best-effort：删不掉只是磁盘残留，服务端条目已删、无人再引用。
              logger.warn('待发队列附件副本回收失败', error);
            }),
        ),
      );
    },
    [resolveTarget],
  );

  const uploadQueuedAttachments = useCallback(
    async (input: {
      attachmentItems: readonly QueuedComposerAttachment[];
      files: readonly File[];
    }): Promise<QueuedComposerAttachment[] | null> => {
      const target = resolveTarget();
      if (!target) {
        return null;
      }
      const { attachmentItems, files } = input;
      if (files.length === 0) {
        return null;
      }
      // 「同序同长」是附件链路的核心契约；契约破坏时宁可不传，也不能把文件挂错条目。
      if (files.length !== attachmentItems.length) {
        logger.warn('待发队列附件与文件数量不一致，跳过跨端上传');
        return null;
      }
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > COMPOSER_QUEUE_REMOTE_ATTACHMENT_TOTAL_MAX_BYTES) {
        logger.warn('待发队列附件超出跨端副本上限，条目仅保留本端可用');
        return null;
      }

      const uploadedArtifactIds: string[] = [];
      const uploadedItems: QueuedComposerAttachment[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const attachmentItem = attachmentItems[index];
        if (!file || !attachmentItem) {
          await discardQueuedAttachmentArtifacts(uploadedArtifactIds);
          return null;
        }
        if (file.size > COMPOSER_QUEUE_REMOTE_ATTACHMENT_FILE_MAX_BYTES) {
          logger.warn('待发队列附件超过单个跨端副本上限，条目仅保留本端可用', {
            name: attachmentItem.name,
            sizeBytes: file.size,
          });
          await discardQueuedAttachmentArtifacts(uploadedArtifactIds);
          return null;
        }
        try {
          const contentBase64 = await fileToBase64(file);
          // 「上传 + 校验产物 id」下沉到模块级 `uploadQueueAttachmentOnce`（见其注释）。
          const artifactId = await uploadQueueAttachmentOnce(() =>
            target.artifactsClient.uploadToSession(target.activeToken, target.activeSessionId, {
              name: attachmentItem.name,
              mimeType: resolveFileMimeType(file),
              sizeBytes: file.size,
              contentBase64,
            }),
          );
          uploadedArtifactIds.push(artifactId);
          uploadedItems.push({ ...attachmentItem, artifactId });
        } catch (error) {
          logger.warn('待发队列附件跨端上传失败，条目保持本端可用', error);
          // 半途失败要清掉已上传的部分：留下就是无人引用的服务端磁盘残留。
          await discardQueuedAttachmentArtifacts(uploadedArtifactIds);
          return null;
        }
      }
      return uploadedItems;
    },
    [discardQueuedAttachmentArtifacts, resolveTarget],
  );

  const updateQueuedAttachments = useCallback(
    async (
      itemId: string,
      input: {
        attachmentItems: readonly QueuedComposerAttachment[];
        requiresAttachmentRebind?: boolean;
      },
    ): Promise<'failed' | 'missing' | 'updated'> => {
      const target = resolveTarget();
      if (!target) {
        return 'failed';
      }
      // 请求参数里的 `...(cond ? … : {})` 是值块：留在 try 内会让编译器报
      // "Support value blocks … within a try/catch statement"，故先在 try 外构造好。
      const updatePayload = {
        attachmentItems: [...input.attachmentItems],
        ...(input.requiresAttachmentRebind === undefined
          ? {}
          : { requiresAttachmentRebind: input.requiresAttachmentRebind }),
      };
      // 三元判定（值块）移回 try 外：try 里只留赋值，判定按 `item` 是否为空计算。
      let item: Awaited<ReturnType<typeof target.client.updateAttachments>> | undefined;
      try {
        item = await target.client.updateAttachments(
          target.activeToken,
          target.activeSessionId,
          itemId,
          updatePayload,
        );
      } catch (error) {
        // 回填失败不回收副本：条目可能仍在队列里，只是这次没问成；留着还有水合窗口。
        logger.warn('待发队列附件引用回填失败', error);
        return 'failed';
      }
      return item ? 'updated' : 'missing';
    },
    [resolveTarget],
  );

  const downloadQueuedAttachments = useCallback(
    async (attachmentItems: readonly QueuedComposerAttachment[]): Promise<File[] | null> => {
      const target = resolveTarget();
      if (!target) {
        return null;
      }
      if (attachmentItems.length === 0) {
        return [];
      }
      // 顺序下载：与上传同理，避免同时把多个大附件读进内存并发打满网关。
      const files: File[] = [];
      for (const attachmentItem of attachmentItems) {
        if (!attachmentItem.artifactId) {
          return null;
        }
        let blob: Blob;
        try {
          blob = await target.artifactsClient.downloadFromSession(
            target.activeToken,
            target.activeSessionId,
            attachmentItem.artifactId,
          );
        } catch (error) {
          logger.warn('待发队列附件跨端恢复失败', error);
          return null;
        }
        // 值块（`||` / `...(cond ? … : {})`）移出 try：编译器对 try 内值块会放弃优化整个 hook。
        const mimeType = blob.type || inferMimeTypeFromFileName(attachmentItem.name);
        files.push(
          new File([blob], attachmentItem.name, {
            lastModified: Date.now(),
            ...(mimeType ? { type: mimeType } : {}),
          }),
        );
      }
      return files;
    },
    [resolveTarget],
  );

  return {
    claim,
    claimMany,
    discardQueuedAttachmentArtifacts,
    downloadQueuedAttachments,
    enqueue,
    hydrate,
    releaseClaim,
    remove,
    updateQueuedAttachments,
    uploadQueuedAttachments,
  };
}
