import type { SubagentNoticeState } from '@openAwork/shared';
import { sqliteGet } from '../infra/db.js';
import { completeBackground, listPersistedBackgroundJobs } from './task-job.js';
import { deliverTaskCompletion } from './task-job-delivery.js';

/**
 * 单通道交付的**重启恢复扫描**（T-26）。
 *
 * 背景：单通道交付在父会话繁忙时选择「留库待消费」而非定时重试——通知已落库，
 * 因此永不丢失，但需要一次启动扫描来补偿「进程在延后窗口内重启」的情况。
 *
 * 语义：
 *   - 逐条重投（幂等：`notificationId` 既作消息 id 又作唤醒请求键）；
 *   - 父会话已不存在 → 由 `deliverTaskCompletion` 清理记录；
 *   - 子会话记录也查不到（用户 id 无处可取）→ 直接清理，避免死行；
 *   - 单条失败不影响其余记录（启动阶段必须容错）。
 */

const RECOVERY_NOTICE_FALLBACK = '子代理执行已结束（网关重启后补偿投递）。';

export interface TaskJobRecoverySummary {
  attempted: number;
  woken: number;
  deferred: number;
  skipped: number;
  dropped: number;
  failed: number;
}

function mapStatusToNoticeState(status: string): SubagentNoticeState {
  if (status === 'error') {
    return 'failed';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return 'done';
}

export async function recoverPendingTaskDeliveries(): Promise<TaskJobRecoverySummary> {
  const summary: TaskJobRecoverySummary = {
    attempted: 0,
    woken: 0,
    deferred: 0,
    skipped: 0,
    dropped: 0,
    failed: 0,
  };

  for (const job of listPersistedBackgroundJobs()) {
    // 用户 id 从子会话取：`task_jobs.id` 对 `sessions` 有 FK CASCADE，
    // 子会话行一定存在（父会话可能已被删除，那种情况由交付层负责清理）。
    const child = sqliteGet<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE id = ? LIMIT 1',
      [job.recovery.childSessionId],
    );
    if (!child) {
      completeBackground(job.notificationId);
      summary.dropped += 1;
      continue;
    }

    summary.attempted += 1;
    try {
      const result = await deliverTaskCompletion({
        agent: job.recovery.agent,
        childSessionId: job.recovery.childSessionId,
        description: job.recovery.description,
        notificationId: job.notificationId,
        parentSessionId: job.recovery.parentSessionId,
        state: mapStatusToNoticeState(job.status),
        text: job.error?.trim() || job.output?.trim() || RECOVERY_NOTICE_FALLBACK,
        userId: child.user_id,
      });

      if (result.wake === 'woken') {
        summary.woken += 1;
      } else if (result.wake === 'deferred') {
        summary.deferred += 1;
      } else {
        summary.skipped += 1;
      }
    } catch {
      // 单条失败不阻断启动恢复；该记录保留，下次启动或用户下一轮仍可消费。
      summary.failed += 1;
    }
  }

  return summary;
}
