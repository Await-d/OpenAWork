/**
 * 模板编辑器中部：按层分组的成员 roster 编辑器（紧凑 chip-grid 模型）。
 *
 * 复查后再次重构，解决「行太高 / 滚动太长 / 调整不顺手」：
 *   - 每层把 catalog 内全部 specialty 平铺成一排可换行的小 chip，一屏看完全部 20 个成员
 *   - 单击 chip = 加入 / 移除（最快的批量操作）
 *   - 已选 chip 右侧有 ⚙，点开浮层（popover）微调：显示名、工具集、必选；不顶动布局
 *   - 层头：全选 / 清空 批量操作
 *   - 只读模式仅展示已选 chip，无任何控制
 */

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import {
  TEAM_RUNTIME_LAYER_ORDER,
  type FixedTeamMemberSlot,
  type TeamMemberSpecialty,
  type TeamRuntimeLayer,
} from '@openAwork/shared';
import {
  SPECIALTY_LABEL,
  SPECIALTY_SHORT,
  TEAM_LAYER_META,
  LAYER_ALLOWED_TOOLSETS,
  TOOLSET_LABEL,
} from './template-architecture.js';
import {
  clearLayer,
  groupRosterByLayer,
  selectAllInLayer,
  slotKey,
  specialtyOptionsForLayer,
  toggleSpecialty,
} from './template-roster-state.js';
import type { ModelCandidate } from './model-assignment.js';

/** 能力选项（skill / mcp）的最小形状，避免直接耦合 hook 类型。 */
export interface CapabilityRef {
  id: string;
  label: string;
  description?: string;
}

const ALL_TOOLS = ['read', 'write', 'shell', 'lsp', 'test', 'review', 'web', 'desktop'] as const;

interface Props {
  roster: FixedTeamMemberSlot[];
  editable: boolean;
  /** 候选模型池（解析自模板 modelPool），仅用于在 chip 上回显已分配模型的名称。 */
  modelPool?: ModelCandidate[];
  /** 可绑定的能力目录（已安装/启用），用于成员 ⚙ 浮层里管理 skills / mcp 默认绑定。 */
  skillOptions?: CapabilityRef[];
  mcpOptions?: CapabilityRef[];
  onChange?: (roster: FixedTeamMemberSlot[]) => void;
  /** 点击「+ 自定义角色」时回调（带目标层）；不传则不显示该入口。 */
  onAddCustom?: (layer: TeamRuntimeLayer) => void;
  /** 点击某个自定义角色卡的编辑时回调。 */
  onEditCustom?: (slot: FixedTeamMemberSlot) => void;
  /** 把某个自定义角色移动到另一层时回调。 */
  onMoveCustom?: (slotId: string, targetLayer: TeamRuntimeLayer) => void;
  /** 点击层级「查看提示词」时回调（预览该层 SOUL 人格 + 指令栈）；不传则不显示入口。 */
  onPreviewPrompt?: (layer: TeamRuntimeLayer) => void;
}

const SECTION_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 14,
  flexWrap: 'wrap',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in oklch, var(--border-default) 40%, transparent)',
  background: 'color-mix(in oklch, var(--bg-base) 60%, transparent)',
};

/** 左侧层信息列：层名 / 副标题 / 计数 / 批量操作。固定宽度，chips 占据其余空间。 */
const SECTION_META_COL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  width: 172,
  flexShrink: 0,
  alignContent: 'start',
};

/** 右侧成员区：与左列之间用一条细分隔线区隔。成员排成等宽网格，整齐可扫读。 */
const SECTION_CHIPS_COL_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 200,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
  gap: 6,
  alignContent: 'flex-start',
  paddingLeft: 14,
  borderLeft: '1px solid color-mix(in oklch, var(--border-default) 45%, transparent)',
};

const TEXT_BTN: CSSProperties = {
  appearance: 'none',
  border: 'none',
  background: 'transparent',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 6,
};

interface DetailAnchor {
  key: string;
  layer: TeamRuntimeLayer;
  specialty: TeamMemberSpecialty;
  rect: DOMRect;
}

export function TemplateLayerRosterEditor({
  roster,
  editable,
  modelPool = [],
  skillOptions = [],
  mcpOptions = [],
  onChange,
  onAddCustom,
  onEditCustom,
  onMoveCustom,
  onPreviewPrompt,
}: Props) {
  const grouped = groupRosterByLayer(roster);
  const selectedKeys = new Set(roster.map((slot) => slotKey(slot.layer, slot.specialty)));
  const [detail, setDetail] = useState<DetailAnchor | null>(null);

  function emit(next: FixedTeamMemberSlot[]) {
    onChange?.(next);
  }

  function updateSlot(targetKey: string, patch: Partial<FixedTeamMemberSlot>) {
    emit(
      roster.map((slot) =>
        slotKey(slot.layer, slot.specialty) === targetKey
          ? {
              ...slot,
              ...patch,
              toolsets: patch.toolsets ? [...patch.toolsets] : [...slot.toolsets],
            }
          : slot,
      ),
    );
  }

  const detailSlot = detail
    ? roster.find((s) => slotKey(s.layer, s.specialty) === detail.key)
    : undefined;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {TEAM_RUNTIME_LAYER_ORDER.map((layer) => {
        const meta = TEAM_LAYER_META[layer];
        const layerSlots = grouped.get(layer) ?? [];
        const options = specialtyOptionsForLayer(layer);
        const selectedCount = layerSlots.length;
        const visibleSpecialties = editable ? options : layerSlots.map((s) => s.specialty);
        // 自定义角色单独渲染（不在 (layer, specialty) 网格内，同层可多个）。
        const customSlots = layerSlots.filter((s) => s.specialty === 'custom');
        const presetVisible = visibleSpecialties.filter((s) => s !== 'custom');

        // 该层模型绑定概览：全部默认 / 统一某模型 / 混合。
        const boundSlots = layerSlots.filter((s) => s.modelId);
        const layerModelSummary = ((): { text: string; tone: 'default' | 'uniform' | 'mixed' } => {
          if (selectedCount === 0) return { text: '', tone: 'default' };
          if (boundSlots.length === 0) return { text: '模型：默认解析', tone: 'default' };
          const keys = new Set(boundSlots.map((s) => `${s.providerId ?? ''}::${s.modelId}`));
          if (boundSlots.length === selectedCount && keys.size === 1) {
            const m = modelPool.find(
              (c) =>
                c.modelId === boundSlots[0]!.modelId && c.providerId === boundSlots[0]!.providerId,
            );
            return {
              text: `模型：${m?.label ?? boundSlots[0]!.modelId}`,
              tone: 'uniform',
            };
          }
          return {
            text: `模型：混合（${boundSlots.length}/${selectedCount} 已指定）`,
            tone: 'mixed',
          };
        })();

        return (
          <section key={layer} style={SECTION_STYLE}>
            {/* 左列：层信息 + 计数 + 批量操作 */}
            <div style={SECTION_META_COL_STYLE}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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
                <span
                  style={{
                    fontSize: 10,
                    color: meta.color,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: meta.tint,
                    flexShrink: 0,
                    marginLeft: 'auto',
                  }}
                >
                  {selectedCount}
                  {editable ? ` / ${options.length}` : ''}
                </span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  lineHeight: 1.45,
                }}
              >
                {meta.caption}
              </span>
              {selectedCount > 0 && layerModelSummary.text && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: 1.4,
                    color:
                      layerModelSummary.tone === 'default'
                        ? 'var(--fg-subtle)'
                        : layerModelSummary.tone === 'mixed'
                          ? 'var(--warning)'
                          : meta.color,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={layerModelSummary.text}
                >
                  {layerModelSummary.text}
                </span>
              )}
              {onPreviewPrompt && (
                <button
                  type="button"
                  style={{
                    ...TEXT_BTN,
                    color: meta.color,
                    alignSelf: 'flex-start',
                    padding: '2px 0',
                  }}
                  onClick={() => onPreviewPrompt(layer)}
                  title="预览该层角色的 SOUL 人格提示词与完整指令栈（只读）"
                >
                  🧬 查看提示词
                </button>
              )}
              {editable && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    style={{ ...TEXT_BTN, color: meta.color }}
                    onClick={() => emit(selectAllInLayer(roster, layer))}
                    disabled={selectedCount === options.length}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    style={{ ...TEXT_BTN, color: 'var(--fg-muted)' }}
                    onClick={() => emit(clearLayer(roster, layer))}
                    disabled={selectedCount === 0}
                  >
                    清空
                  </button>
                </div>
              )}
            </div>

            {/* 右列：成员 chips */}
            {presetVisible.length === 0 && customSlots.length === 0 && !editable ? (
              <span
                style={{
                  flex: 1,
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  minWidth: 200,
                  paddingLeft: 14,
                  borderLeft:
                    '1px solid color-mix(in oklch, var(--border-default) 45%, transparent)',
                  alignSelf: 'stretch',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                该层暂无成员。
              </span>
            ) : (
              <div style={SECTION_CHIPS_COL_STYLE}>
                {presetVisible.map((specialty) => {
                  const key = slotKey(layer, specialty);
                  const selected = selectedKeys.has(key);
                  const slot = layerSlots.find((s) => s.specialty === specialty);
                  const poolMatch = slot?.modelId
                    ? modelPool.find(
                        (m) => m.modelId === slot.modelId && m.providerId === slot.providerId,
                      )
                    : undefined;
                  const modelLabel = slot?.modelId ? (poolMatch?.label ?? slot.modelId) : undefined;
                  const providerName = poolMatch?.providerName ?? slot?.providerId;
                  return (
                    <SpecialtyChip
                      key={specialty}
                      specialty={specialty}
                      selected={selected}
                      displayName={slot?.displayName}
                      required={slot?.required ?? false}
                      modelLabel={modelLabel}
                      providerName={providerName}
                      layerColor={meta.color}
                      layerTint={meta.tint}
                      editable={editable}
                      detailOpen={detail?.key === key}
                      onToggle={() => emit(toggleSpecialty(roster, layer, specialty))}
                      onOpenDetail={(rect) => setDetail({ key, layer, specialty, rect })}
                    />
                  );
                })}

                {/* 自定义角色卡（同层可多个） */}
                {customSlots.map((slot) => {
                  const poolMatch = slot.modelId
                    ? modelPool.find(
                        (m) => m.modelId === slot.modelId && m.providerId === slot.providerId,
                      )
                    : undefined;
                  const modelLabel = slot.modelId ? (poolMatch?.label ?? slot.modelId) : undefined;
                  const providerName = poolMatch?.providerName ?? slot.providerId;
                  return (
                    <CustomRoleCard
                      key={slot.id}
                      slot={slot}
                      modelLabel={modelLabel}
                      providerName={providerName}
                      layerColor={meta.color}
                      layerTint={meta.tint}
                      editable={editable}
                      onEdit={() => onEditCustom?.(slot)}
                      onRemove={() => emit(roster.filter((s) => s.id !== slot.id))}
                      {...(onMoveCustom
                        ? { onMove: (target: TeamRuntimeLayer) => onMoveCustom(slot.id, target) }
                        : {})}
                    />
                  );
                })}

                {/* 「+ 自定义角色」入口卡 */}
                {editable && onAddCustom && (
                  <button
                    type="button"
                    onClick={() => onAddCustom(layer)}
                    title="为该层新增一个自定义角色（提示词 + 工具权限 + 模型）"
                    style={{
                      appearance: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                      borderRadius: 9,
                      border: `1px dashed color-mix(in oklch, ${meta.color} 45%, transparent)`,
                      background: 'transparent',
                      color: meta.color,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '6px 8px',
                      minHeight: 44,
                    }}
                  >
                    ✨ 自定义角色
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {/* Floating detail popover */}
      {editable && detail && detailSlot && (
        <DetailPopover
          slot={detailSlot}
          anchor={detail.rect}
          layerColor={TEAM_LAYER_META[detail.layer].color}
          layerTint={TEAM_LAYER_META[detail.layer].tint}
          skillOptions={skillOptions}
          mcpOptions={mcpOptions}
          onClose={() => setDetail(null)}
          onUpdate={(patch) => updateSlot(detail.key, patch)}
          onRemove={() => {
            emit(toggleSpecialty(roster, detail.layer, detail.specialty));
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}

function SpecialtyChip({
  specialty,
  selected,
  displayName,
  required,
  modelLabel,
  providerName,
  layerColor,
  layerTint,
  editable,
  detailOpen,
  onToggle,
  onOpenDetail,
}: {
  specialty: TeamMemberSpecialty;
  selected: boolean;
  displayName: string | undefined;
  required: boolean;
  modelLabel: string | undefined;
  providerName: string | undefined;
  layerColor: string;
  layerTint: string;
  editable: boolean;
  detailOpen: boolean;
  onToggle: () => void;
  onOpenDetail: (rect: DOMRect) => void;
}) {
  const label = displayName ?? SPECIALTY_LABEL[specialty];
  const gearRef = useRef<HTMLButtonElement>(null);

  // 成员卡：等宽两行布局。第一行 = 角色（短码 + 名称 + 必选 + ⚙）；第二行 = 绑定模型。
  return (
    <div
      style={{
        display: 'grid',
        gap: 4,
        borderRadius: 9,
        border: selected
          ? `1px solid color-mix(in oklch, ${layerColor} 45%, transparent)`
          : '1px solid var(--border-subtle)',
        background: selected ? layerTint : 'var(--bg-base)',
        boxShadow: detailOpen ? `0 0 0 2px ${layerColor}` : 'none',
        opacity: selected || !editable ? 1 : 0.6,
        padding: '6px 8px',
        minWidth: 0,
        transition: 'all 0.1s',
      }}
    >
      {/* Row 1: role */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <button
          type="button"
          onClick={editable ? onToggle : undefined}
          disabled={!editable}
          title={editable ? (selected ? '点击移除' : '点击加入') : SPECIALTY_LABEL[specialty]}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: 0,
            cursor: editable ? 'pointer' : 'default',
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 18,
              height: 15,
              padding: '0 3px',
              borderRadius: 4,
              fontSize: 8,
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: selected ? layerColor : 'var(--fg-muted)',
              background: selected
                ? `color-mix(in oklch, ${layerColor} 16%, transparent)`
                : 'var(--bg-surface)',
              flexShrink: 0,
            }}
          >
            {SPECIALTY_SHORT[specialty]}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              fontWeight: 600,
              textAlign: 'left',
              color: selected ? 'var(--fg-strong)' : 'var(--fg-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
          {required && (
            <span
              style={{ fontSize: 8, fontWeight: 800, color: 'var(--warning)', flexShrink: 0 }}
              title="固定必选"
            >
              ★
            </span>
          )}
        </button>
        {selected && editable && (
          <button
            ref={gearRef}
            type="button"
            title="微调成员（名称 / 工具集 / 必选）"
            onClick={() => {
              const rect = gearRef.current?.getBoundingClientRect();
              if (rect) onOpenDetail(rect);
            }}
            style={{
              appearance: 'none',
              border: 'none',
              background: detailOpen ? layerColor : 'var(--bg-surface)',
              color: detailOpen ? 'var(--bg-base)' : 'var(--fg-muted)',
              cursor: 'pointer',
              width: 18,
              height: 18,
              borderRadius: 5,
              fontSize: 10,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ⚙
          </button>
        )}
      </div>

      {/* Row 2: bound model (only for selected members) */}
      {selected && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 0,
            fontSize: 9,
            fontWeight: 700,
            color: modelLabel ? layerColor : 'var(--fg-subtle)',
          }}
          title={
            modelLabel
              ? `绑定模型：${providerName ? `${providerName} · ` : ''}${modelLabel}`
              : '未指定模型，运行时按默认解析（层默认 → 模板 → 全局选择）'
          }
        >
          <span style={{ flexShrink: 0, opacity: 0.7 }}>{modelLabel ? '◈' : '○'}</span>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {modelLabel
              ? providerName
                ? `${providerName} · ${modelLabel}`
                : modelLabel
              : '默认模型'}
          </span>
        </div>
      )}
    </div>
  );
}

/** 自定义角色卡：与 SpecialtyChip 同款两行布局，但点击 = 编辑（不是 toggle），并带删除。 */
function CustomRoleCard({
  slot,
  modelLabel,
  providerName,
  layerColor,
  layerTint,
  editable,
  onEdit,
  onRemove,
  onMove,
}: {
  slot: FixedTeamMemberSlot;
  modelLabel: string | undefined;
  providerName: string | undefined;
  layerColor: string;
  layerTint: string;
  editable: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMove?: (target: TeamRuntimeLayer) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 4,
        borderRadius: 9,
        border: `1px solid color-mix(in oklch, ${layerColor} 45%, transparent)`,
        background: layerTint,
        padding: '6px 8px',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <button
          type="button"
          onClick={editable ? onEdit : undefined}
          disabled={!editable}
          title={editable ? '编辑自定义角色' : slot.displayName}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: 0,
            cursor: editable ? 'pointer' : 'default',
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 18,
              height: 15,
              padding: '0 3px',
              borderRadius: 4,
              fontSize: 9,
              color: layerColor,
              background: `color-mix(in oklch, ${layerColor} 20%, transparent)`,
              flexShrink: 0,
            }}
          >
            ✨
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              fontWeight: 600,
              textAlign: 'left',
              color: 'var(--fg-strong)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {slot.displayName}
          </span>
          {slot.required && (
            <span
              style={{ fontSize: 8, fontWeight: 800, color: 'var(--warning)', flexShrink: 0 }}
              title="固定必选"
            >
              ★
            </span>
          )}
        </button>
        {editable && (
          <button
            type="button"
            onClick={onRemove}
            title="移除该自定义角色"
            style={{
              appearance: 'none',
              border: 'none',
              background: 'var(--bg-surface)',
              color: 'var(--danger)',
              cursor: 'pointer',
              width: 18,
              height: 18,
              borderRadius: 5,
              fontSize: 11,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minWidth: 0,
          fontSize: 9,
          fontWeight: 700,
          color: modelLabel ? layerColor : 'var(--fg-subtle)',
        }}
        title={
          modelLabel
            ? `绑定模型：${providerName ? `${providerName} · ` : ''}${modelLabel}`
            : '未指定模型，运行时按默认解析'
        }
      >
        <span style={{ flexShrink: 0, opacity: 0.7 }}>{modelLabel ? '◈' : '○'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {modelLabel
            ? providerName
              ? `${providerName} · ${modelLabel}`
              : modelLabel
            : '默认模型'}
        </span>
        {editable && onMove && (
          <select
            value={slot.layer}
            onChange={(e) => {
              const target = e.target.value as TeamRuntimeLayer;
              if (target !== slot.layer) onMove(target);
            }}
            title="移动到其他层"
            onClick={(e) => e.stopPropagation()}
            style={{
              marginLeft: 'auto',
              flexShrink: 0,
              appearance: 'none',
              fontSize: 8,
              fontWeight: 700,
              padding: '1px 4px',
              borderRadius: 4,
              border: `1px solid color-mix(in oklch, ${layerColor} 35%, transparent)`,
              background: 'var(--bg-surface)',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
            }}
          >
            {TEAM_RUNTIME_LAYER_ORDER.map((l) => (
              <option key={l} value={l}>
                {l === slot.layer
                  ? `↕ ${TEAM_LAYER_META[l].label}`
                  : `→ ${TEAM_LAYER_META[l].label}`}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

/** 浮层内的能力多选小节（skills / mcp 复用）。 */
function CapabilityToggleSection({
  title,
  options,
  selected,
  layerColor,
  layerTint,
  onChange,
}: {
  title: string;
  options: CapabilityRef[];
  selected: string[];
  layerColor: string;
  layerTint: string;
  onChange: (next: string[]) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-muted)' }}>
        {title} · 已选 {selected.length}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {options.map((opt) => {
          const on = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              title={opt.description}
              onClick={() =>
                onChange(on ? selected.filter((x) => x !== opt.id) : [...selected, opt.id])
              }
              style={{
                appearance: 'none',
                fontSize: 10,
                fontWeight: 700,
                padding: '3px 9px',
                borderRadius: 999,
                border: `1px solid ${on ? layerColor : 'var(--border-subtle)'}`,
                background: on ? layerTint : 'transparent',
                color: on ? layerColor : 'var(--fg-muted)',
                cursor: 'pointer',
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {on ? '✓ ' : ''}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DetailPopover({
  slot,
  anchor,
  layerColor,
  layerTint,
  skillOptions,
  mcpOptions,
  onClose,
  onUpdate,
  onRemove,
}: {
  slot: FixedTeamMemberSlot;
  anchor: DOMRect;
  layerColor: string;
  layerTint: string;
  skillOptions: CapabilityRef[];
  mcpOptions: CapabilityRef[];
  onClose: () => void;
  onUpdate: (patch: Partial<FixedTeamMemberSlot>) => void;
  onRemove: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(slot.displayName);

  // Close on outside click / Escape
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    // Defer to avoid catching the opening click
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Commit name on unmount-ish: commit on blur instead
  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== slot.displayName) {
      onUpdate({ displayName: trimmed });
    } else if (!trimmed) {
      setName(slot.displayName);
    }
  };

  const PANEL_WIDTH = 260;
  const margin = 8;
  let left = anchor.left;
  if (left + PANEL_WIDTH + margin > window.innerWidth) {
    left = window.innerWidth - PANEL_WIDTH - margin;
  }
  if (left < margin) left = margin;
  const top = anchor.bottom + 6;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top,
        left,
        width: PANEL_WIDTH,
        zIndex: 1000,
        background: 'var(--bg-overlay)',
        border: `1px solid color-mix(in oklch, ${layerColor} 35%, transparent)`,
        borderRadius: 12,
        boxShadow: 'var(--shadow-lg)',
        padding: 12,
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: layerColor,
            padding: '2px 8px',
            borderRadius: 999,
            background: layerTint,
          }}
        >
          {SPECIALTY_LABEL[slot.specialty]}
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'transparent',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Name */}
      <label style={{ display: 'grid', gap: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-muted)' }}>人物名称</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          style={{
            fontSize: 12,
            padding: '6px 8px',
            border: `1px solid ${layerColor}`,
            borderRadius: 6,
            background: 'var(--bg-base)',
            color: 'var(--fg-strong)',
            outline: 'none',
          }}
        />
      </label>

      {/* Toolsets */}
      <div style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-muted)' }}>
          工具集（toolsets）
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {ALL_TOOLS.map((tool) => {
            const enabled = slot.toolsets.includes(tool);
            const allowed = LAYER_ALLOWED_TOOLSETS[slot.layer]?.includes(tool) ?? false;
            const canToggle = allowed || enabled;
            return (
              <button
                key={tool}
                type="button"
                disabled={!canToggle}
                title={
                  canToggle
                    ? undefined
                    : `${TEAM_LAYER_META[slot.layer].label}不允许使用「${TOOLSET_LABEL[tool] ?? tool}」工具`
                }
                onClick={() => {
                  if (!canToggle) return;
                  const next = enabled
                    ? slot.toolsets.filter((t) => t !== tool)
                    : [...slot.toolsets, tool];
                  onUpdate({ toolsets: next, toolsetsCustomized: true });
                }}
                style={{
                  appearance: 'none',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 9px',
                  borderRadius: 999,
                  border: `1px solid ${enabled ? layerColor : 'var(--border-subtle)'}`,
                  background: enabled ? layerTint : 'transparent',
                  color: enabled ? layerColor : 'var(--fg-muted)',
                  cursor: canToggle ? 'pointer' : 'not-allowed',
                  opacity: allowed || enabled ? 1 : 0.4,
                }}
              >
                {TOOLSET_LABEL[tool] ?? tool}
              </button>
            );
          })}
        </div>
      </div>

      {/* Skills */}
      {skillOptions.length > 0 && (
        <CapabilityToggleSection
          title="Skills"
          options={skillOptions}
          selected={slot.skillIds ?? []}
          layerColor={layerColor}
          layerTint={layerTint}
          onChange={(next) => onUpdate({ skillIds: next })}
        />
      )}

      {/* MCP servers */}
      {mcpOptions.length > 0 && (
        <CapabilityToggleSection
          title="MCP 服务"
          options={mcpOptions}
          selected={slot.mcpServerIds ?? []}
          layerColor={layerColor}
          layerTint={layerTint}
          onChange={(next) => onUpdate({ mcpServerIds: next })}
        />
      )}

      {/* Required + remove */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
      >
        <label
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            fontSize: 11,
            color: 'var(--fg-default)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={slot.required}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            style={{ accentColor: layerColor }}
          />
          固定必选
        </label>
        <button
          type="button"
          onClick={onRemove}
          style={{
            appearance: 'none',
            border: '1px solid color-mix(in oklch, var(--danger) 35%, transparent)',
            background: 'transparent',
            color: 'var(--danger)',
            fontSize: 10,
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          移除成员
        </button>
      </div>
    </div>
  );
}
