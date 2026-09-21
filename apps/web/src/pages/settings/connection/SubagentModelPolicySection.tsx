import type { SubagentModelPolicyRef } from '../state/settings-types.js';
import { SettingsOptionCardRow } from '../shared/settings-option-card-row.js';
import type { SettingsOptionCard } from '../shared/settings-option-card-row.js';

/**
 * 「子代理」区块的选择控件：决定聊天中由 task 工具派生的子代理使用哪个模型。
 *
 * 纯展示组件——草稿状态与保存由 Settings 页默认模型画像的统一保存流程接管，
 * 这里只把用户选择回传给父级。思考强度不在此配置，始终按任务类别自动决定。
 */

interface SubagentModelPolicySectionProps {
  policy: SubagentModelPolicyRef;
  onChange: (policy: SubagentModelPolicyRef) => void;
  /** 父级加载 / 保存期间可整体禁用选择。 */
  disabled?: boolean;
}

const OPTIONS: readonly SettingsOptionCard<SubagentModelPolicyRef['modelMode']>[] = [
  {
    value: 'auto',
    label: '自动',
    description: '模型与思考都按任务类别自动选择（当前默认）。',
  },
  {
    value: 'inherit-main',
    label: '跟随主会话',
    description: '模型使用主对话当前模型，思考仍按任务自动。',
  },
];

export function SubagentModelPolicySection({
  policy,
  onChange,
  disabled = false,
}: SubagentModelPolicySectionProps) {
  return (
    <SettingsOptionCardRow
      ariaLabel="子代理模型来源"
      options={OPTIONS.map((option) => ({ ...option, disabled }))}
      value={policy.modelMode}
      onChange={(modelMode) => onChange({ modelMode })}
      minCardWidth={220}
      divider={false}
    />
  );
}
