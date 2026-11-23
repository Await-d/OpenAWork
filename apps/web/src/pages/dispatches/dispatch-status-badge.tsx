import type { DispatchStatus } from '@openAwork/shared';
import { statusLabels } from './dispatch-labels.js';

/** 状态语义映射：只表达「活跃 / 成功 / 需处理 / 中性」四类，不复用主题色做装饰。 */
const statusTone: Record<DispatchStatus, 'active' | 'done' | 'alert' | 'idle'> = {
  draft: 'idle',
  queued: 'active',
  running: 'active',
  succeeded: 'done',
  partial: 'active',
  failed: 'alert',
  interrupted: 'alert',
  cancelled: 'idle',
};

export function DispatchStatusBadge({ status }: { status: DispatchStatus }) {
  return (
    <span className="dispatch-status" data-tone={statusTone[status]}>
      <span className="dispatch-status-dot" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

/** 进度只在真正进入队列后才有意义；草稿阶段显示事项数量，避免出现「0/0 项完成」。 */
export function dispatchProgressLabel(status: DispatchStatus, succeeded: number, total: number) {
  if (status === 'draft') return total > 0 ? `${total} 个事项待确认` : '尚未生成事项';
  if (total === 0) return '暂无事项';
  return `${succeeded}/${total} 项完成`;
}
