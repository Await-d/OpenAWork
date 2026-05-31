/**
 * 池内模型选择下拉：用于「整层模型」与「单槽位模型」微调。
 * 选项仅限模板候选池（modelPool 解析出的 ModelCandidate）。
 */

import type { CSSProperties } from 'react';
import { compareModelsByName, type ModelAssignment, type ModelCandidate } from './model-assignment.js';

interface Props {
  value: ModelAssignment | null;
  options: ModelCandidate[];
  editable: boolean;
  placeholder?: string;
  onChange: (assignment: ModelAssignment | null) => void;
  style?: CSSProperties;
}

const SELECT_STYLE: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 600,
  padding: '3px 22px 3px 8px',
  borderRadius: 6,
  cursor: 'pointer',
  outline: 'none',
  maxWidth: '100%',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%237b8a9e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 6px center',
};

function encode(ref: ModelAssignment): string {
  return `${ref.providerId}::${ref.modelId}`;
}

export function ModelSelect({ value, options, editable, placeholder, onChange, style }: Props) {
  const current = value ? encode(value) : '';
  const known = options.some((opt) => encode(opt) === current);

  // 按「供应商名 → 模型名」排序，模型名用数字感知比较，便于用户在下拉里快速定位。
  const sortedOptions = [...options].sort((a, b) => {
    const byProvider = a.providerName.localeCompare(b.providerName, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    return byProvider !== 0 ? byProvider : compareModelsByName(a, b);
  });

  return (
    <select
      disabled={!editable}
      value={known ? current : ''}
      onChange={(e) => {
        const val = e.target.value;
        if (!val) {
          onChange(null);
          return;
        }
        const [providerId, modelId] = val.split('::');
        if (providerId && modelId) onChange({ providerId, modelId });
      }}
      style={{ ...SELECT_STYLE, ...style }}
      title={value ? `${value.providerId} · ${value.modelId}` : placeholder}
    >
      <option value="">{placeholder ?? '默认（自动解析）'}</option>
      {/* 当前值不在池中时，仍显示一个占位项避免静默丢失 */}
      {value && !known && (
        <option value={current}>{`${value.modelId}（已不在池中）`}</option>
      )}
      {sortedOptions.map((opt) => (
        <option key={encode(opt)} value={encode(opt)}>
          {opt.providerName} · {opt.label}
        </option>
      ))}
    </select>
  );
}
