export type DelegatedTaskReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const DEFAULT_DELEGATED_TASK_REASONING_EFFORT: DelegatedTaskReasoningEffort = 'medium';

const CATEGORY_REASONING_EFFORT: Record<string, DelegatedTaskReasoningEffort> = {
  quick: 'minimal',
  'unspecified-low': 'low',
  writing: 'medium',
  'visual-engineering': 'medium',
  deep: 'high',
  'unspecified-high': 'high',
  artistry: 'high',
  ultrabrain: 'xhigh',
};

/**
 * 自动创建的子代理的思考档位由任务强度决定，强度信号来自主代理（AI）判定的
 * `task` 工具 category。始终返回合法档位：无法识别时回落 medium。
 */
export function resolveDelegatedTaskReasoningEffort(
  category: string | undefined,
): DelegatedTaskReasoningEffort {
  const normalized = category?.trim().toLowerCase();
  if (!normalized || !Object.hasOwn(CATEGORY_REASONING_EFFORT, normalized)) {
    return DEFAULT_DELEGATED_TASK_REASONING_EFFORT;
  }
  return CATEGORY_REASONING_EFFORT[normalized] as DelegatedTaskReasoningEffort;
}
