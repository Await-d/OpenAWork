import type { CSSProperties } from 'react';
import type { SubagentLimitsRef } from '../state/settings-types.js';
import {
  parseBoundedIntegerInput,
  SUBAGENT_LIMITS_GUARDRAILS,
} from '../shared/settings-page-helpers.js';
import { IS } from '../shared/settings-section-styles.js';

/**
 * 「子代理」区块的数量限制编辑：同时运行上限 / 任务树累计上限 / 嵌套深度上限。
 *
 * 纯展示 + 受控输入组件——草稿状态与保存由「保存默认值」统一流程接管（与
 * `SubagentModelPolicySection` 同模式）。数值在**下一次子代理派发时**生效：
 * 网关每次派发都会从用户设置读取，因此无需重启；已在运行的子代理不受影响。
 */

interface SubagentLimitsSectionProps {
  limits: SubagentLimitsRef;
  onChange: (limits: SubagentLimitsRef) => void;
  /** 父级加载 / 保存期间可整体禁用输入。 */
  disabled?: boolean;
}

interface LimitField {
  readonly key: keyof SubagentLimitsRef;
  readonly ariaLabel: string;
  readonly label: string;
  readonly hint: string;
  readonly bounds: { readonly min: number; readonly max: number };
}

const LIMIT_FIELDS: readonly LimitField[] = [
  {
    key: 'maxRunningPerRoot',
    ariaLabel: '子代理同时运行上限',
    label: '同时运行上限',
    hint: `同一任务树中同时运行的子代理数（${SUBAGENT_LIMITS_GUARDRAILS.maxRunningPerRoot.min}–${SUBAGENT_LIMITS_GUARDRAILS.maxRunningPerRoot.max}）。超出后新的委派会被拒绝。`,
    bounds: SUBAGENT_LIMITS_GUARDRAILS.maxRunningPerRoot,
  },
  {
    key: 'maxTotalPerRoot',
    ariaLabel: '子代理任务树累计上限',
    label: '任务树累计上限',
    hint: `同一任务树下累计创建的子代理数，含已完成（${SUBAGENT_LIMITS_GUARDRAILS.maxTotalPerRoot.min}–${SUBAGENT_LIMITS_GUARDRAILS.maxTotalPerRoot.max}）。`,
    bounds: SUBAGENT_LIMITS_GUARDRAILS.maxTotalPerRoot,
  },
  {
    key: 'maxNestingDepth',
    ariaLabel: '子代理嵌套深度上限',
    label: '嵌套深度上限',
    hint: `子代理可继续派生的层数（${SUBAGENT_LIMITS_GUARDRAILS.maxNestingDepth.min}–${SUBAGENT_LIMITS_GUARDRAILS.maxNestingDepth.max}）。1 = 子代理不能再派生。`,
    bounds: SUBAGENT_LIMITS_GUARDRAILS.maxNestingDepth,
  },
];

const LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--fg-default)',
};

const HINT_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

export function SubagentLimitsSection({
  limits,
  onChange,
  disabled = false,
}: SubagentLimitsSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <style>{`
        /*
         * 默认视觉属性放在类里而不是内联 style：内联优先级高于 :hover /
         * :focus-visible，写在内联会让这两态被静默覆盖。
         */
        .subagent-limit-input {
          transition: border-color 120ms ease, box-shadow 120ms ease;
        }
        .subagent-limit-input:hover:not(:disabled) {
          border-color: var(--border-strong);
        }
        .subagent-limit-input:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px var(--accent-subtle);
        }
        .subagent-limit-input:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
      `}</style>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {LIMIT_FIELDS.map((field) => (
          <label
            key={field.key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              flex: '1 1 180px',
              minWidth: 180,
              maxWidth: 280,
            }}
          >
            <span style={LABEL_STYLE}>{field.label}</span>
            <input
              className="subagent-limit-input"
              type="number"
              inputMode="numeric"
              min={field.bounds.min}
              max={field.bounds.max}
              step={1}
              value={limits[field.key]}
              disabled={disabled}
              aria-label={field.ariaLabel}
              onChange={(event) => {
                const next = parseBoundedIntegerInput(
                  event.target.value,
                  field.bounds.min,
                  field.bounds.max,
                );
                if (next !== null) {
                  onChange({ ...limits, [field.key]: next });
                }
              }}
              style={{ ...IS, width: '100%' }}
            />
            <span style={HINT_STYLE}>{field.hint}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
