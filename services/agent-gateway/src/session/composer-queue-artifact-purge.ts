/**
 * 待发队列附件的跨端副本回收。
 *
 * 客户端入队后会把附件上传到 `/sessions/:id/artifacts`（磁盘型产物），并把返回的
 * `artifactId` 回填进队列条目，供另一台设备水合时拉回二进制。条目一旦离开队列
 * （发送成功后的清理 / 用户移出 / 恢复回输入框 / 清空），这些副本就不再有消费者：
 * 发送路径用的是客户端重新上传的新副本（消息引用的是新 artifactId）。
 *
 * 删除时机刻意放在**服务端条目被删除时**，而不是客户端逐点调用删除接口：
 * 条目删除是唯一的「离开队列」真相，客户端有 5 条消费出口 + 移出 / 恢复 / 清空
 * 共 8 个调用点，任何一处漏调都会静默泄漏磁盘文件；由服务端统一联动则不存在漏点。
 *
 * **已知边界**：`SESSION_ALREADY_RUNNING` 的兜底回流（`reEnqueueRejectedQueuedMessage`）
 * 会先删服务端记录再重建条目，此刻副本已被回收——重建后的条目在另一台设备上会退化
 * 为「需重新选择附件」（本端不受影响，本地 Blob 仍在）。这是「宁可能力降级、不留
 * 磁盘泄漏」的取舍：回流窗口小且可恢复，泄漏则是必然发生且无人清理。
 */
import type { ComposerQueueAttachment } from './composer-queue-store.js';
import { getGatewayArtifactManager } from '../infra/artifact-manager.js';
import { describeError, logGatewayWarn } from '../infra/gateway-logger.js';

/**
 * 回收一组条目附件对应的跨端副本，返回实际删掉的产物数。
 *
 * **best-effort，绝不抛错**：调用点在「条目已经删掉」之后，此时抛错会让 HTTP 响应变成
 * 500，客户端据此认为删除失败并把条目放回本地队列——而服务端记录已经不在了，两边状态
 * 就此分叉。`ArtifactManagerImpl.remove` 自身对磁盘文件容错，但索引落盘（`persistArtifacts`）
 * 在磁盘满 / 无写权限时会抛，故这里统一兜住。
 */
export function purgeComposerQueueAttachments(
  attachments: readonly ComposerQueueAttachment[],
): number {
  const artifactIds = new Set<string>();
  for (const attachment of attachments) {
    if (attachment.artifactId) {
      artifactIds.add(attachment.artifactId);
    }
  }
  if (artifactIds.size === 0) {
    return 0;
  }

  let removed = 0;
  try {
    // 一次批量删除：`remove` 逐条调用会把整个索引重写 N 遍（清空队列 / 删除会话时
    // 条目可能成百上千），这正是 O(n²) 写放大的来源。
    removed = getGatewayArtifactManager().removeMany(artifactIds);
  } catch (error) {
    logGatewayWarn('待发队列附件副本回收失败（条目已删除，仅剩磁盘残留）', {
      artifactCount: artifactIds.size,
      ...describeError(error),
    });
  }
  return removed;
}
