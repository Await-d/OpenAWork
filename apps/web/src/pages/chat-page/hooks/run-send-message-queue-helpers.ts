import type { AttachmentItem } from '@openAwork/shared-ui';
import { createComposerQueueClient } from '@openAwork/web-client';

import { logger } from '../../../utils/log/logger.js';
import { deleteQueuedComposerFiles } from '../conversation/composer/queued-composer-file-store.js';

/**
 * 待发队列条目已被真正发出 / 执行后，清理它在两端的残留。
 *
 * 挂在「消费成功」而不是「出队」时刻是刻意的：flush 会先把队首从内存摘掉再发送，
 * 发送失败时还要放回去。若出队即抹掉服务端记录，失败重试就会凭空丢消息——这是
 * `use-unified-composer-state.ts` 里 requeue 语义的前提。
 *
 * **所有返回 true 的分支都必须调用它。** 服务端记录只在显式调用时才会删除（队列已
 * 改为后端落库，不再有 persist effect 自动同步），漏掉任何一条都会让条目在下一次
 * 水合时复活。当前调用点：图片生成、标准聊天流、内置 `/open`、client slash command、
 * server slash command。
 *
 * 两端都要清：本地是附件 Blob（IndexedDB，scope 为空时无附件可清），远端是队列
 * 记录（网关 SQLite）。远端清理失败只记日志——此时消息已进会话历史，队列残留只是
 * 冗余记录，不该反过来影响发送结果。
 *
 * 远端删除会**联动回收附件的跨端副本**（磁盘型产物，见网关
 * `session/composer-queue-artifact-purge.ts`）：发送路径已经把附件重新上传成新副本，
 * 队列里那份不再有消费者，留着只会占磁盘。
 */
export function cleanupConsumedQueuedMessage(input: {
  gatewayUrl: string;
  queuedComposerScope: string | null;
  queuedMessageId: string | undefined;
  /** 未进入任何会话时为 null，此时只清本地附件、不动远端。 */
  sessionId: string | null;
  token: string | null;
}): void {
  const { gatewayUrl, queuedComposerScope, queuedMessageId, sessionId, token } = input;
  if (!queuedMessageId) {
    return;
  }

  if (queuedComposerScope) {
    void deleteQueuedComposerFiles({ queueId: queuedMessageId, scope: queuedComposerScope });
  }

  if (!sessionId || !token || gatewayUrl.length === 0) {
    return;
  }
  void createComposerQueueClient(gatewayUrl)
    .remove(token, sessionId, queuedMessageId)
    .catch((error: unknown) => {
      logger.warn('待发队列消费后清理失败', error);
    });
}

/**
 * 队列来源的发送被网关单飞锁拒成 `SESSION_ALREADY_RUNNING` 时的服务端兜底回流。
 *
 * 消费时刻（`cleanupConsumedQueuedMessage`）已经删掉了服务端记录；若只在编辑器侧
 * 回填本地而网关记录缺失，下一轮 flush 会 claim 落空、把条目当作「他端持有」丢弃。
 * 这里用原 itemId 幂等重写服务端记录（重复入队不产生第二条），保证哪怕编辑器已
 * 卸载、回流事件无人接收，条目也只会晚发不会丢。
 */
export function reEnqueueRejectedQueuedMessage(input: {
  attachmentItems: AttachmentItem[];
  gatewayUrl: string;
  itemId: string;
  sessionId: string;
  text: string;
  token: string | null;
}): void {
  const { attachmentItems, gatewayUrl, itemId, sessionId, text, token } = input;
  if (!sessionId || !token || gatewayUrl.length === 0) {
    return;
  }
  void createComposerQueueClient(gatewayUrl)
    .enqueue(token, sessionId, {
      attachmentItems: attachmentItems.map((attachment) => ({ ...attachment })),
      itemId,
      requiresAttachmentRebind: false,
      text,
    })
    .catch((error: unknown) => {
      logger.warn('被拒队列消息回流重排失败', error);
    });
}
