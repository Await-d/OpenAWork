/**
 * 模型配置弹窗（统一入口）。
 *
 * 把原先分散在三处的模型配置（元数据头的「模型池」、工具条的「智能分配」、
 * roster 编辑器里的「整层 / 单成员模型下拉」）收拢到一个弹窗里，分三步：
 *   ① 模型池：从真实 provider 勾选候选模型
 *   ② 智能分配：选策略 + 一键按层分配 / 清除
 *   ③ 按层 / 按成员微调：每层「整层统一」下拉 + 每个成员单独下拉
 *
 * 弹窗直接编辑模板草稿（通过回调写回），改动并入页面底部统一的保存条；
 * 因此弹窗本身只需要一个「完成」按钮关闭即可，无需独立的提交 / 取消。
 */

import { type CSSProperties, useEffect } from 'react';
import { TEAM_RUNTIME_LAYER_ORDER, type FixedTeamMemberSlot } from '@openAwork/shared';
import type {
  WorkflowTeamTemplateModelRef,
  WorkflowTeamTemplateModelStrategy,
} from '@openAwork/web-client';
import type { ChatSettingsProvider } from '../../../../utils/chat/chat-session-defaults.js';
import { TEAM_LAYER_META, SPECIALTY_LABEL } from './template-architecture.js';
import { TemplateModelPoolPicker } from './TemplateModelPoolPicker.js';
import { ModelSelect } from './ModelSelect.js';
import {
  MODEL_STRATEGY_OPTIONS,
  countAssignedModels,
  setLayerModel,
  setSlotModel,
  type ModelAssignment,
  type ModelCandidate,
} from './model-assignment.js';
import { groupRosterByLayer } from './template-roster-state.js';

interface Props {
  open: boolean;
  editable: boolean;
  roster: FixedTeamMemberSlot[];
  pool: WorkflowTeamTemplateModelRef[];
  poolCandidates: ModelCandidate[];
  strategy: WorkflowTeamTemplateModelStrategy;
  providers: ChatSettingsProvider[];
  catalogLoading: boolean;
  catalogError: string | null;
  onReloadCatalog: () => void;
  onChangePool: (pool: WorkflowTeamTemplateModelRef[]) => void;
  onChangeStrategy: (strategy: WorkflowTeamTemplateModelStrategy) => void;
  /** 智能分配进行中（调上游 LLM）。 */
  assigning: boolean;
  /** 最近一次 AI 分配的每层推荐理由（layer -> reason）。 */
  assignReasons: Record<string, string>;
  onAssign: () => void;
  onClearAssign: () => void;
  onChangeRoster: (roster: FixedTeamMemberSlot[]) => void;
  onClose: () => void;
}

const SECTION_TITLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: 'var(--fg-strong)',
};

const SECTION_HINT: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

const STRATEGY_BTN = (active: boolean): CSSProperties => ({
  appearance: 'none',
  border: active ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
  background: active ? 'color-mix(in oklch, var(--accent) 14%, transparent)' : 'var(--bg-base)',
  color: active ? 'var(--accent)' : 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 700,
  padding: '6px 12px',
  borderRadius: 8,
  cursor: 'pointer',
});

export function TemplateModelConfigModal({
  open,
  editable,
  roster,
  pool,
  poolCandidates,
  strategy,
  providers,
  catalogLoading,
  catalogError,
  onReloadCatalog,
  onChangePool,
  onChangeStrategy,
  assigning,
  assignReasons,
  onAssign,
  onClearAssign,
  onChangeRoster,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const total = roster.length;
  const assignedCount = countAssignedModels(roster);
  const poolEmpty = poolCandidates.length === 0;
  const grouped = groupRosterByLayer(roster);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 9998,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-overlay)',
          borderRadius: 14,
          width: 'min(720px, 100%)',
          maxHeight: '86vh',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          border: '1px solid var(--border-default)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
              模型配置
            </span>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              选模型池 · 一键智能分配 · 按层/按成员微调
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'var(--bg-surface)',
              borderRadius: 8,
              width: 30,
              height: 30,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              color: 'var(--fg-muted)',
              fontSize: 14,
            }}
            title="关闭"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', padding: 18, display: 'grid', gap: 18 }}>
          {/* ① 模型池 */}
          <section style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={SECTION_TITLE}>① 模型池</span>
              <span style={SECTION_HINT}>从已启用的 Provider 勾选参与分配的候选模型</span>
            </div>
            <TemplateModelPoolPicker
              providers={providers}
              loading={catalogLoading}
              error={catalogError}
              editable={editable}
              pool={pool}
              onChange={onChangePool}
              onReload={onReloadCatalog}
            />
          </section>

          {/* ② 智能分配 */}
          <section
            style={{
              display: 'grid',
              gap: 10,
              paddingTop: 14,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={SECTION_TITLE}>② 智能分配</span>
              <span style={SECTION_HINT}>
                {poolEmpty
                  ? '请先在上方勾选模型池'
                  : `候选 ${poolCandidates.length} 个 · 已分配 ${assignedCount}/${total} · 由 AI 上游推荐`}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {MODEL_STRATEGY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!editable || assigning}
                  onClick={() => onChangeStrategy(opt.value)}
                  title={opt.hint}
                  style={STRATEGY_BTN(strategy === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={onAssign}
                disabled={!editable || poolEmpty || assigning}
                style={{
                  appearance: 'none',
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '7px 16px',
                  borderRadius: 8,
                  cursor: !editable || poolEmpty || assigning ? 'not-allowed' : 'pointer',
                  opacity: !editable || poolEmpty || assigning ? 0.6 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {assigning ? '正在请求 AI 分配…' : '一键智能分配'}
              </button>
              {assignedCount > 0 && (
                <button
                  type="button"
                  onClick={onClearAssign}
                  disabled={!editable || assigning}
                  style={{
                    appearance: 'none',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-base)',
                    color: 'var(--fg-muted)',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '7px 14px',
                    borderRadius: 8,
                    cursor: assigning ? 'not-allowed' : 'pointer',
                  }}
                >
                  清除全部分配
                </button>
              )}
            </div>
          </section>

          {/* ③ 按层 / 按成员微调 */}
          <section
            style={{
              display: 'grid',
              gap: 10,
              paddingTop: 14,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={SECTION_TITLE}>③ 按层 / 按成员微调</span>
              <span style={SECTION_HINT}>「整层统一」覆盖全层；也可逐个成员单独指定</span>
            </div>
            {poolEmpty ? (
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                勾选模型池后即可在此微调。
              </span>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {TEAM_RUNTIME_LAYER_ORDER.map((layer) => {
                  const layerSlots = grouped.get(layer) ?? [];
                  if (layerSlots.length === 0) return null;
                  const meta = TEAM_LAYER_META[layer];
                  const layerModelKeys = new Set(
                    layerSlots.map((s) => (s.modelId ? `${s.providerId ?? ''}::${s.modelId}` : '')),
                  );
                  const uniformLayerModel: ModelAssignment | null =
                    layerModelKeys.size === 1 && layerSlots[0]?.modelId
                      ? {
                          providerId: layerSlots[0]!.providerId ?? '',
                          modelId: layerSlots[0]!.modelId!,
                        }
                      : null;
                  return (
                    <div
                      key={layer}
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 10,
                        padding: '10px 12px',
                        display: 'grid',
                        gap: 8,
                        background: 'var(--bg-base)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 999,
                            background: meta.color,
                            boxShadow: `0 0 0 3px ${meta.tint}`,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--fg-strong)' }}>
                          {meta.label}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
                          {layerSlots.length} 人
                        </span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>整层统一</span>
                        <ModelSelect
                          value={uniformLayerModel}
                          options={poolCandidates}
                          editable={editable}
                          placeholder={
                            layerSlots.some((s) => s.modelId) ? '混合（逐成员）' : '选择…'
                          }
                          onChange={(assignment) =>
                            onChangeRoster(setLayerModel(roster, layer, assignment))
                          }
                          style={{ minWidth: 180 }}
                        />
                      </div>
                      {assignReasons[layer] && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 5,
                            fontSize: 10,
                            lineHeight: 1.45,
                            color: 'var(--fg-muted)',
                            background: `color-mix(in oklch, ${meta.color} 7%, transparent)`,
                            border: `1px solid color-mix(in oklch, ${meta.color} 22%, transparent)`,
                            borderRadius: 7,
                            padding: '5px 8px',
                          }}
                        >
                          <span style={{ flexShrink: 0, color: meta.color, fontWeight: 700 }}>
                            AI
                          </span>
                          <span>{assignReasons[layer]}</span>
                        </div>
                      )}
                      <div
                        style={{
                          display: 'grid',
                          gap: 6,
                          paddingTop: 8,
                          borderTop: '1px solid var(--border-subtle)',
                        }}
                      >
                        {layerSlots.map((slot) => (
                          <div
                            key={slot.id}
                            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                          >
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 11,
                                color: 'var(--fg-default)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={slot.displayName}
                            >
                              {slot.displayName || SPECIALTY_LABEL[slot.specialty]}
                            </span>
                            <ModelSelect
                              value={
                                slot.modelId
                                  ? { providerId: slot.providerId ?? '', modelId: slot.modelId }
                                  : null
                              }
                              options={poolCandidates}
                              editable={editable}
                              placeholder="默认（自动解析）"
                              onChange={(assignment) =>
                                onChangeRoster(setSlotModel(roster, slot.id, assignment))
                              }
                              style={{ minWidth: 200 }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 18px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 800,
              padding: '8px 20px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
