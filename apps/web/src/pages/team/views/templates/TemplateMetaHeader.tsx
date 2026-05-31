/**
 * 模板元数据头部（紧凑横向 band）。
 *
 * 复查重构：原来元数据独占右侧 320px 竖列，挤占 roster 宽度且割裂操作。
 * 改为工作区顶部一条紧凑 band：
 *   - 第一行：模板名（大号 inline 输入）+ 规模 pills + 复制 / 删除
 *   - 折叠区「更多设置」：描述 / 重点 / 适用场景 / 默认 provider / 推荐起步
 */

import { type CSSProperties, useState } from 'react';
import type { WorkflowTemplateScale } from '@openAwork/web-client';
import { CopyIcon, TrashIcon } from '../../runtime/shared/TeamIcons.js';
import type { TemplateEditorState } from './template-roster-state.js';

interface Props {
  state: TemplateEditorState;
  editable: boolean;
  creating: boolean;
  isSeed: boolean;
  busy: boolean;
  /** 模型池候选数（用于「配置模型」按钮状态角标）。 */
  modelPoolSize: number;
  /** 已分配模型的成员数。 */
  assignedModelCount: number;
  /** 成员总数（角标分母）。 */
  memberTotal: number;
  onOpenModelConfig: () => void;
  onChange: (patch: Partial<TemplateEditorState>) => void;
  onApplyScalePreset: (scale: WorkflowTemplateScale) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const SCALE_OPTIONS: Array<{ value: WorkflowTemplateScale; label: string; hint: string }> = [
  { value: 'small', label: '小型', hint: '核心 6 人' },
  { value: 'medium', label: '中型', hint: '标配 8 人' },
  { value: 'large', label: '大型', hint: '双线 14 人' },
  { value: 'full', label: '完整', hint: '全 20 人' },
];

const FIELD_LABEL: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const INPUT: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 7,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
};

export function TemplateMetaHeader({
  state,
  editable,
  creating,
  isSeed,
  busy,
  modelPoolSize,
  assignedModelCount,
  memberTotal,
  onOpenModelConfig,
  onChange,
  onApplyScalePreset,
  onDuplicate,
  onDelete,
}: Props) {
  // 默认展开：新建时（要填）或只读模板带有可读详情时（让用户一眼看到设定）。
  const hasDetails =
    state.description.trim().length > 0 ||
    state.focus.trim().length > 0 ||
    state.recommendedFor.trim().length > 0;
  const [expanded, setExpanded] = useState(creating || (!editable && hasDetails));

  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-overlay)',
      }}
    >
      {/* Row 1: name + scale + actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <input
          disabled={!editable}
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="未命名模板"
          style={{
            flex: '1 1 220px',
            minWidth: 160,
            padding: '6px 10px',
            borderRadius: 8,
            border: editable ? '1px solid var(--border-subtle)' : '1px solid transparent',
            background: editable ? 'var(--bg-base)' : 'transparent',
            color: 'var(--fg-strong)',
            fontSize: 16,
            fontWeight: 800,
            outline: 'none',
          }}
        />

        {/* Scale segmented control */}
        <div
          style={{
            display: 'inline-flex',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {SCALE_OPTIONS.map((opt, i) => {
            const active = state.scale === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={!editable}
                onClick={() => onChange({ scale: opt.value })}
                title={opt.hint}
                style={{
                  appearance: 'none',
                  border: 'none',
                  borderRight:
                    i < SCALE_OPTIONS.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--fg-muted)',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '6px 12px',
                  cursor: editable ? 'pointer' : 'default',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {editable && (
          <button
            type="button"
            onClick={() => onApplyScalePreset(state.scale)}
            title="用当前规模对应的成员组合覆盖花名册"
            style={{
              appearance: 'none',
              border: '1px dashed color-mix(in oklch, var(--accent) 40%, transparent)',
              background: 'transparent',
              color: 'var(--accent)',
              fontSize: 10,
              fontWeight: 700,
              padding: '6px 10px',
              borderRadius: 8,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            套用规模
          </button>
        )}

        {/* Model config entry (disabled / grayed when read-only) */}
        <button
          type="button"
          onClick={editable ? onOpenModelConfig : undefined}
          disabled={!editable}
          title={
            editable
              ? '选模型池 · 一键智能分配 · 按层/按成员微调'
              : '系统默认模板只读，复制后可配置模型'
          }
          style={{
            appearance: 'none',
            border: editable ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
            background: editable
              ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
              : 'var(--bg-base)',
            color: editable ? 'var(--accent)' : 'var(--fg-subtle)',
            fontSize: 11,
            fontWeight: 700,
            padding: '6px 11px',
            borderRadius: 8,
            cursor: editable ? 'pointer' : 'not-allowed',
            opacity: editable ? 1 : 0.6,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          ⚙ 配置模型
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: assignedModelCount > 0 && editable ? 'var(--accent)' : 'var(--fg-muted)',
              opacity: 0.85,
            }}
          >
            {modelPoolSize === 0
              ? '未设池'
              : assignedModelCount > 0
                ? `${assignedModelCount}/${memberTotal}`
                : `池 ${modelPoolSize}`}
          </span>
        </button>

        {/* Secondary actions */}
        {!creating && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={onDuplicate}
              disabled={busy}
              style={actionBtn('var(--fg-default)', 'var(--border-subtle)', busy)}
            >
              <CopyIcon size={11} color="currentColor" />
              {isSeed ? '复制为我的模板' : '复制'}
            </button>
            {!isSeed && (
              <button
                type="button"
                onClick={onDelete}
                style={actionBtn(
                  'var(--danger)',
                  'color-mix(in oklch, var(--danger) 35%, transparent)',
                  false,
                )}
              >
                <TrashIcon size={11} color="currentColor" />
                删除
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            appearance: 'none',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
            color: 'var(--fg-muted)',
            fontSize: 10,
            fontWeight: 700,
            padding: '6px 10px',
            borderRadius: 8,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {expanded ? '收起详情 ▲' : editable ? '更多设置 ▾' : '查看详情 ▾'}
        </button>
      </div>

      {/* Collapsible details */}
      {expanded && (
        <div
          style={{
            display: 'grid',
            gap: 10,
            paddingTop: 10,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {!editable && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                color: 'var(--fg-muted)',
                padding: '6px 10px',
                borderRadius: 8,
                background: 'color-mix(in oklch, var(--accent) 6%, transparent)',
                border: '1px solid color-mix(in oklch, var(--accent) 20%, transparent)',
              }}
            >
              <span>🔒</span>
              系统默认模板为只读，下面是它的设定详情。点上方「复制为我的模板」即可编辑这些字段。
            </div>
          )}

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={FIELD_LABEL}>模板描述</span>
            {editable ? (
              <textarea
                value={state.description}
                onChange={(e) => onChange({ description: e.target.value })}
                rows={2}
                placeholder="一句话说明这个模板的定位和适用范围…"
                style={{ ...INPUT, resize: 'vertical', minHeight: 48, fontFamily: 'inherit' }}
              />
            ) : (
              <ReadonlyValue value={state.description} placeholder="（未填写描述）" multiline />
            )}
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={FIELD_LABEL}>重点方向</span>
              {editable ? (
                <input
                  value={state.focus}
                  onChange={(e) => onChange({ focus: e.target.value })}
                  placeholder="代码评审 / MVP 实现"
                  style={INPUT}
                />
              ) : (
                <ReadonlyValue value={state.focus} placeholder="（未设置）" />
              )}
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={FIELD_LABEL}>适用场景</span>
              {editable ? (
                <input
                  value={state.recommendedFor}
                  onChange={(e) => onChange({ recommendedFor: e.target.value })}
                  placeholder="新需求快速立项"
                  style={INPUT}
                />
              ) : (
                <ReadonlyValue value={state.recommendedFor} placeholder="（未设置）" />
              )}
            </label>
          </div>

          {editable ? (
            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                cursor: 'pointer',
                fontSize: 11,
                color: 'var(--fg-default)',
              }}
            >
              <input
                type="checkbox"
                checked={state.recommendedDefault}
                onChange={(e) => onChange({ recommendedDefault: e.target.checked })}
                style={{ accentColor: 'var(--success)' }}
              />
              标记为推荐起步（出现在新建会话向导的「推荐模板」分组顶部）
            </label>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'flex', gap: 6 }}>
              <span style={{ fontWeight: 700 }}>推荐起步：</span>
              <span
                style={{ color: state.recommendedDefault ? 'var(--success)' : 'var(--fg-subtle)' }}
              >
                {state.recommendedDefault ? '✓ 已标记为推荐起步' : '未标记'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 只读字段值展示：有值显示值，无值显示灰色占位，不用 disabled input（避免"坏掉"观感）。 */
function ReadonlyValue({
  value,
  placeholder,
  multiline,
}: {
  value: string;
  placeholder: string;
  multiline?: boolean;
}) {
  const has = value.trim().length > 0;
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.55,
        color: has ? 'var(--fg-strong)' : 'var(--fg-subtle)',
        padding: '6px 8px',
        borderRadius: 7,
        background: 'color-mix(in oklch, var(--bg-surface) 50%, transparent)',
        border: '1px solid var(--border-subtle)',
        minHeight: multiline ? 40 : undefined,
        whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {has ? value : placeholder}
    </div>
  );
}

function actionBtn(color: string, borderColor: string, busy: boolean): CSSProperties {
  return {
    padding: '6px 11px',
    borderRadius: 8,
    border: `1px solid ${borderColor}`,
    background: 'var(--bg-base)',
    color,
    fontSize: 11,
    fontWeight: 600,
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.5 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };
}
