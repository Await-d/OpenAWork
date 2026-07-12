/**
 * 思考配置控件：一个轻量的开关 + 推理强度下拉。
 *
 * 用于模型配置弹窗中「整层」和「单成员」行尾的思考模式微调。
 * 当模型不支持思考时（supportsThinking=false 或 undefined）控件降级为
 * 提示文字，不阻断操作。
 */

import { type CSSProperties } from 'react';
import type { TeamReasoningEffort } from '@openAwork/shared';
import { REASONING_EFFORT_OPTIONS } from './model-assignment.js';

export interface ThinkingConfigValue {
  thinkingEnabled: boolean;
  reasoningEffort?: TeamReasoningEffort;
}

interface Props {
  value: ThinkingConfigValue | null;
  /** 当前选定模型是否支持思考。undefined 时按「未知但允许」处理。 */
  modelSupportsThinking?: boolean;
  editable: boolean;
  onChange: (value: ThinkingConfigValue | null) => void;
  /** compact 模式下隐藏标签文字，只显示控件。 */
  compact?: boolean;
}

const TOGGLE_BASE: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--border-subtle)',
  borderRadius: 999,
  width: 30,
  height: 16,
  padding: 0,
  cursor: 'pointer',
  position: 'relative',
  flexShrink: 0,
  transition: 'background 0.15s',
};

const TOGGLE_KNOB: CSSProperties = {
  position: 'absolute',
  top: 1,
  left: 1,
  width: 12,
  height: 12,
  borderRadius: '50%',
  background: 'var(--fg-on-accent)',
  transition: 'transform 0.15s',
};

const SELECT_STYLE: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 600,
  padding: '3px 18px 3px 6px',
  borderRadius: 6,
  cursor: 'pointer',
  outline: 'none',
  maxWidth: '100%',
};

export function ThinkingConfigControl({
  value,
  modelSupportsThinking,
  editable,
  onChange,
  compact,
}: Props) {
  const enabled = value?.thinkingEnabled === true;
  const effort = value?.reasoningEffort ?? 'medium';
  const supports = modelSupportsThinking !== false; // undefined → 允许操作
  const disabled = !editable || !supports;

  if (!supports && !compact) {
    return (
      <span style={{ fontSize: 9, color: 'var(--fg-subtle)' }} title="当前模型不支持思考模式">
        思考 ✕
      </span>
    );
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (enabled) {
            // 关闭 → 清空思考配置
            onChange(null);
          } else {
            // 开启 → 默认 medium
            onChange({ thinkingEnabled: true, reasoningEffort: 'medium' });
          }
        }}
        title={enabled ? '点击关闭思考模式' : '点击开启思考模式'}
        style={{
          ...TOGGLE_BASE,
          background: enabled ? 'var(--accent)' : 'var(--bg-surface)',
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          borderColor: enabled ? 'var(--accent)' : 'var(--border-subtle)',
        }}
      >
        <span
          style={{
            ...TOGGLE_KNOB,
            transform: enabled ? 'translateX(14px)' : 'translateX(0)',
          }}
        />
      </button>
      {enabled && (
        <select
          disabled={disabled}
          value={effort}
          onChange={(e) => {
            onChange({
              thinkingEnabled: true,
              reasoningEffort: e.target.value as TeamReasoningEffort,
            });
          }}
          title="思考强度等级"
          style={SELECT_STYLE}
        >
          {REASONING_EFFORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
      {!enabled && !compact && <span style={{ fontSize: 9, color: 'var(--fg-subtle)' }}>思考</span>}
    </div>
  );
}
