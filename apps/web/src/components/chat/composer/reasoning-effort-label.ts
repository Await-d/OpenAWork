import type { ReasoningEffort } from '../../conversation-runtime/messages/support.js';

/**
 * 思考等级的短标签。
 *
 * 用于按钮、状态胶囊等紧凑位置；下拉菜单里的详细说明另见 shared-ui 的
 * `describeReasoningEffort`。两者用途不同，不要互相替代。
 */
export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最大',
};

export function formatReasoningEffortLabel(effort: ReasoningEffort): string {
  return REASONING_EFFORT_LABELS[effort];
}
