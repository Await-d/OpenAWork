/**
 * 模板花名册工具条：实时统计 + 快捷预设（恢复默认 / 仅必选 / 清空）。
 *
 * 模型配置入口已上移到 TemplateMetaHeader 第一行的「配置模型」按钮，这里只保留
 * roster 组建相关的快捷预设。
 */

import type { CSSProperties } from 'react';
import { TEAM_RUNTIME_LAYER_ORDER, type FixedTeamMemberSlot } from '@openAwork/shared';
import { TEAM_LAYER_META } from './template-architecture.js';

interface Props {
  roster: FixedTeamMemberSlot[];
  editable: boolean;
  onApplyDefault: () => void;
  onApplyRequiredOnly: () => void;
  onClearAll: () => void;
}

const QUICK_BTN: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 700,
  padding: '5px 10px',
  borderRadius: 8,
  cursor: 'pointer',
};

export function TemplateRosterToolbar({
  roster,
  editable,
  onApplyDefault,
  onApplyRequiredOnly,
  onClearAll,
}: Props) {
  const total = roster.length;
  const requiredCount = roster.filter((slot) => slot.required).length;
  const countByLayer = new Map<string, number>();
  for (const slot of roster) {
    countByLayer.set(slot.layer, (countByLayer.get(slot.layer) ?? 0) + 1);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'color-mix(in oklch, var(--bg-surface) 50%, transparent)',
      }}
    >
      {/* Live composition */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: 'var(--fg-strong)',
            letterSpacing: '0.02em',
          }}
        >
          团队花名册
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--fg-muted)',
            padding: '1px 8px',
            borderRadius: 999,
            background: 'var(--bg-surface)',
          }}
        >
          {total} 人
        </span>
        {requiredCount > 0 && (
          <span style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 700 }}>
            {requiredCount} 必选
          </span>
        )}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {TEAM_RUNTIME_LAYER_ORDER.map((layer) => {
            const count = countByLayer.get(layer) ?? 0;
            const meta = TEAM_LAYER_META[layer];
            return (
              <span
                key={layer}
                title={`${meta.label} · ${count} 人`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10,
                  fontWeight: 700,
                  color: count > 0 ? meta.color : 'var(--fg-muted)',
                  opacity: count > 0 ? 1 : 0.5,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: count > 0 ? meta.color : 'var(--border-default)',
                  }}
                />
                {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* Quick presets */}
      {editable && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={QUICK_BTN} onClick={onApplyDefault} title="套用系统默认 20 人花名册">
            恢复默认
          </button>
          <button
            type="button"
            style={QUICK_BTN}
            onClick={onApplyRequiredOnly}
            title="只保留 catalog 中标记为必选的核心成员"
          >
            仅必选
          </button>
          <button
            type="button"
            style={{ ...QUICK_BTN, color: 'var(--danger)', borderColor: 'color-mix(in oklch, var(--danger) 30%, transparent)' }}
            onClick={onClearAll}
          >
            清空全部
          </button>
        </div>
      )}
    </div>
  );
}
