import { useDisplayPreferencesStore, classifyToolName } from './display-preferences.js';

/**
 * 返回一个函数，调用后传入工具名，返回该工具是否应该默认展开。
 *
 * 逻辑：
 * 1. 全局开关 `toolCallsExpandedByDefault` 为 false → 返回 false（所有工具默认折叠）
 * 2. 全局开关为 true → 查找 `toolExpandedOverrides[category]`，按类别返回
 *
 * 注意：调用方仍需自行叠加 running/failed 状态判断——本 hook 只返回
 * 用户偏好维度的默认展开值。
 */
export function useToolExpandDefault(): (toolName: string) => boolean {
  const globalExpand = useDisplayPreferencesStore((s) => s.toolCallsExpandedByDefault);
  const overrides = useDisplayPreferencesStore((s) => s.toolExpandedOverrides);

  return (toolName: string): boolean => {
    if (!globalExpand) return false;
    const category = classifyToolName(toolName);
    return overrides[category] ?? false;
  };
}
