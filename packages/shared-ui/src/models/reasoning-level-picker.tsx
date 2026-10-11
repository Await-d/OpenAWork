import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { color, radius, tokens } from '../tokens.js';
import { describeReasoningEffort, isSupportedReasoningEffort } from './model-reasoning-support.js';
import type { SupportedReasoningEffort } from './model-reasoning-support.js';

/**
 * 思考档位(reasoning effort)编辑器组件集。
 *
 * 用于「设置 → 模型与提供商」里为单个模型声明可用档位(`reasoningOptions`),
 * 以及批量快速把一组档位应用到多个模型。声明为空 = 自动(交由后端 / 聊天侧按
 * providerType + modelId 推断)。
 *
 * 档位的写回结构与 `AIModelConfigItem.reasoningOptions` 保持一致:
 * `{ type: 'effort', values: string[] }` 数组,空表示未声明。
 */

/** 与模型配置一致的可写档位声明项。 */
export type ReasoningOptionRecord = { type: string; values?: string[] };

/** 全部可选推理档位(与后端与聊天侧一致)。 */
export const REASONING_LEVEL_OPTIONS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly SupportedReasoningEffort[];

/** 档位的短标签(用于紧凑展示)。 */
const LEVEL_SHORT_LABEL: Record<SupportedReasoningEffort, string> = {
  none: 'none',
  minimal: 'min',
  low: 'low',
  medium: 'med',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

/** 从 `reasoningOptions` 读出已声明的 effort 档位(按声明顺序,过滤非法值)。 */
export function readDeclaredReasoningLevels(
  options?: readonly { type: string; values?: readonly string[] }[],
): SupportedReasoningEffort[] {
  const values = options?.find((option) => option.type === 'effort')?.values;
  if (!values) return [];
  return values.filter(isSupportedReasoningEffort);
}

/** 把档位数组写回 `reasoningOptions`(空数组 = 清除声明,返回 undefined)。 */
export function buildReasoningOptions(
  levels: readonly SupportedReasoningEffort[],
): ReasoningOptionRecord[] | undefined {
  if (levels.length === 0) return undefined;
  return [{ type: 'effort', values: [...levels] }];
}

/** 档位集合的紧凑文案:自动 / 全部 / none / low / high。 */
export function formatReasoningLevels(levels: readonly SupportedReasoningEffort[]): string {
  if (levels.length === 0) return '自动';
  if (levels.length === REASONING_LEVEL_OPTIONS.length) return '全部';
  return levels.map((level) => LEVEL_SHORT_LABEL[level]).join(' / ');
}

const chipStyle = (active: boolean, chipDisabled: boolean): CSSProperties => ({
  border: `1px solid ${active ? color.accentBorder : color.borderDefault}`,
  borderRadius: 'var(--radius-pill, 9999px)',
  background: active ? color.accentMuted : 'transparent',
  color: active ? color.accent : 'var(--fg-default)',
  padding: '2px 8px',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1.5,
  cursor: chipDisabled ? 'not-allowed' : 'pointer',
  opacity: chipDisabled ? 0.5 : 1,
  whiteSpace: 'nowrap',
});

export interface ReasoningLevelChipsProps {
  /** 已声明的档位;空数组表示「自动」。 */
  selected: readonly SupportedReasoningEffort[];
  disabled?: boolean;
  /** 是否显示「自动」按钮(点击即清除声明)。 */
  showAuto?: boolean;
  onChange: (next: SupportedReasoningEffort[]) => void;
}

/** 档位多选 chip 行(单模型编辑与批量面板共用)。 */
export function ReasoningLevelChips({
  selected,
  disabled = false,
  showAuto = true,
  onChange,
}: ReasoningLevelChipsProps) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(level: SupportedReasoningEffort) {
    const next = selectedSet.has(level)
      ? selected.filter((item) => item !== level)
      : [...selected, level];
    onChange(next);
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {showAuto ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([])}
          title="不声明档位,交由后端按平台与模型 id 自动推断"
          style={chipStyle(selected.length === 0, disabled)}
        >
          自动
        </button>
      ) : null}
      {REASONING_LEVEL_OPTIONS.map((level) => (
        <button
          key={level}
          type="button"
          disabled={disabled}
          onClick={() => toggle(level)}
          title={describeReasoningEffort(level)}
          style={chipStyle(selectedSet.has(level), disabled)}
        >
          {level}
        </button>
      ))}
    </div>
  );
}

export interface ModelReasoningLevelCellProps {
  /** 当前模型已声明的档位。 */
  levels: readonly SupportedReasoningEffort[];
  /** 模型是否启用思考;未启用时档位不生效(仅提示)。 */
  supportsThinking?: boolean;
  disabled?: boolean;
  onChange: (next: SupportedReasoningEffort[]) => void;
}

/** 表格里的「思考档位」单元格:默认显示紧凑摘要,点击展开档位 chip 进行编辑。 */
export function ModelReasoningLevelCell({
  levels,
  supportsThinking,
  disabled = false,
  onChange,
}: ModelReasoningLevelCellProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = formatReasoningLevels(levels);
  const custom = levels.length > 0;

  if (expanded && !disabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
        <ReasoningLevelChips selected={levels} onChange={onChange} />
        {supportsThinking === false ? (
          <span style={{ fontSize: 10, color: tokens.color.muted, lineHeight: 1.4 }}>
            未启用「思考」,档位暂不生效。
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: 'none',
            color: color.accent,
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          完成
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setExpanded(true)}
      title="点击声明该模型可用的思考档位"
      style={{
        border: `1px solid ${custom ? color.contrastBorder : color.borderDefault}`,
        borderRadius: radius.sm,
        background: custom ? color.contrastMuted : 'transparent',
        color: custom ? 'var(--contrast)' : 'var(--fg-muted)',
        padding: '2px 7px',
        fontSize: 10,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {summary}
    </button>
  );
}

/** 批量应用的作用范围。 */
export type BatchReasoningScope = 'thinking' | 'unset' | 'all';

export interface BatchReasoningTarget {
  modelId: string;
  /** 目标档位声明;缺省表示清除(回到「自动」)。 */
  reasoningOptions?: ReasoningOptionRecord[];
}

export interface BatchReasoningLevelPanelProps {
  models: ReadonlyArray<{
    id: string;
    label: string;
    supportsThinking?: boolean;
    levels: readonly SupportedReasoningEffort[];
  }>;
  disabled?: boolean;
  onApply: (targets: BatchReasoningTarget[], label: string) => void;
  onClose: () => void;
}

const SCOPE_OPTIONS: ReadonlyArray<{
  value: BatchReasoningScope;
  label: string;
  description: string;
}> = [
  { value: 'thinking', label: '支持思考的模型', description: '只改已声明支持思考的模型' },
  { value: 'unset', label: '未声明档位的模型', description: '只补「自动」的模型,不动已有声明' },
  { value: 'all', label: '全部模型', description: '对当前提供商的全部模型生效' },
];

/**
 * 批量思考档位面板:选一组档位 + 一个作用范围,一次性应用到多个模型
 * (由调用方合并为**一次**保存)。
 */
export function BatchReasoningLevelPanel({
  models,
  disabled = false,
  onApply,
  onClose,
}: BatchReasoningLevelPanelProps) {
  const [levels, setLevels] = useState<SupportedReasoningEffort[]>([]);
  const [scope, setScope] = useState<BatchReasoningScope>('thinking');

  const targets = useMemo(
    () =>
      models.filter((model) => {
        if (scope === 'all') return true;
        if (scope === 'thinking') return model.supportsThinking === true;
        return model.levels.length === 0;
      }),
    [models, scope],
  );

  const options = buildReasoningOptions(levels);
  const actionLabel = levels.length === 0 ? '清除档位' : '应用档位';
  const canApply = !disabled && targets.length > 0;

  return (
    <div
      data-testid="batch-reasoning-panel"
      style={{
        marginTop: tokens.spacing.sm,
        border: `1px solid ${tokens.color.borderSubtle}`,
        borderRadius: tokens.radius.md,
        background: tokens.color.surface2,
        padding: `${tokens.spacing.sm}px ${tokens.spacing.md}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacing.sm,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: tokens.color.text }}>
          批量设置思考档位
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: `1px solid ${color.borderEmphasis}`,
            borderRadius: radius.sm,
            color: 'var(--fg-muted)',
            padding: '0.2rem 0.6rem',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          关闭
        </button>
      </div>

      <div style={{ fontSize: 11, color: tokens.color.muted, lineHeight: 1.5 }}>
        选择要声明的档位(不选 = 清除声明、回到「自动」),再选作用范围。「自动」时由后端按平台与模型
        id 推断可用档位。
      </div>

      <ReasoningLevelChips selected={levels} disabled={disabled} onChange={setLevels} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SCOPE_OPTIONS.map((option) => {
          const active = scope === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              title={option.description}
              onClick={() => setScope(option.value)}
              style={{
                border: `1px solid ${active ? color.accentBorder : color.borderDefault}`,
                borderRadius: radius.sm,
                background: active ? color.accentMuted : 'transparent',
                color: active ? color.accent : 'var(--fg-default)',
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 600,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {option.label}({targets.length})
            </button>
          );
        })}
      </div>

      <div
        style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.sm, flexWrap: 'wrap' }}
      >
        <button
          type="button"
          disabled={!canApply}
          onClick={() =>
            onApply(
              targets.map((model) => ({
                modelId: model.id,
                ...(options ? { reasoningOptions: options } : {}),
              })),
              `${actionLabel} → ${targets.length} 个模型`,
            )
          }
          style={{
            background: canApply ? color.accent : color.borderDefault,
            color: 'var(--fg-on-accent)',
            border: 'none',
            borderRadius: radius.sm,
            padding: '0.3rem 0.9rem',
            fontSize: 12,
            fontWeight: 500,
            cursor: canApply ? 'pointer' : 'not-allowed',
            opacity: canApply ? 1 : 0.6,
            whiteSpace: 'nowrap',
          }}
        >
          {actionLabel}({targets.length})
        </button>
        <span style={{ fontSize: 11, color: tokens.color.muted }}>
          写入档位:{levels.length === 0 ? '自动(清除声明)' : formatReasoningLevels(levels)}
        </span>
      </div>
    </div>
  );
}
