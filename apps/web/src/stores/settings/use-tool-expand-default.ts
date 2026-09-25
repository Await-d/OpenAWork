import { useDisplayPreferencesStore, classifyToolName } from './display-preferences.js';

/**
 * 返回一个函数，调用后传入工具名，返回该工具是否应该默认展开。
 *
 * 逻辑：
 * 1. 文件编辑 / 写入（`fileEdit` 类别）默认展开——对齐参考实现（opencode）的文件卡：
 *    内容变更直接可见；用户显式关闭该类别开关时不再展开。
 * 2. 其余类别：全局开关 `toolCallsExpandedByDefault` 为 false → 返回 false（全部折叠）；
 *    为 true → 查找 `toolExpandedOverrides[category]`。
 *
 * 注意：调用方仍需自行叠加 running/failed 状态判断——本 hook 只返回
 * 用户偏好维度的默认展开值。
 */
export function useToolExpandDefault(): (toolName: string) => boolean {
  const globalExpand = useDisplayPreferencesStore((s) => s.toolCallsExpandedByDefault);
  const overrides = useDisplayPreferencesStore((s) => s.toolExpandedOverrides);

  return (toolName: string): boolean => {
    const category = classifyToolName(toolName);
    if (category === 'fileEdit') return overrides[category] ?? true;
    if (!globalExpand) return false;
    return overrides[category] ?? false;
  };
}
