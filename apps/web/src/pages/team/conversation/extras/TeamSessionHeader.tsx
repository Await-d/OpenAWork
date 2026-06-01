/**
 * TeamSessionHeader · 对话区顶部持久信息条
 *
 * 始终显示在消息列表上方（不随消息数量变化而消失），让用户随时知道：
 *   - 当前团队配置（来源 / 核心角色 / provider）
 *   - 当前状态（idle / routing / dispatching / clarifying）
 *   - 操作提示
 *
 * 数据来源：sessions.metadata_json.teamDefinition（通过 sessionMetadata prop 传入）
 */

import { useMemo, type CSSProperties } from 'react';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';

export interface TeamSessionHeaderProps {
  roleLayer?: string | null;
  substate?: string | null;
  stateStatus?: string | null;
  sessionMetadata?: Record<string, unknown> | null;
}

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 20%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 3%, var(--bg-overlay))',
  flexShrink: 0,
  flexWrap: 'wrap',
  minHeight: 36,
};

const TOP_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  flex: 1,
  minWidth: 0,
};

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
};

const ROLE_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 6,
  fontSize: 10,
  fontWeight: 600,
  background: 'var(--bg-overlay)',
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  color: 'var(--fg-default)',
};

const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

function colorForRole(role: string): string {
  switch (role) {
    case 'planner':
      return 'var(--accent)';
    case 'researcher':
      return 'var(--chart-7)';
    case 'executor':
      return 'var(--success)';
    case 'reviewer':
      return 'var(--warning)';
    case 'leader':
      return 'var(--chart-5)';
    default:
      return 'var(--fg-muted)';
  }
}

function substateLabel(substate: string | null | undefined): string {
  switch (substate) {
    case 'routing':
      return '🔄 正在分析意图…';
    case 'dispatching':
      return '📤 已派发给规划层';
    case 'clarifying':
      return '❓ 等待你回答澄清问题';
    case 'drafting_spec':
      return '📝 正在生成规格…';
    case 'spec_ready':
      return '✅ 规格已就绪';
    case 'drafting_plan':
      return '📋 正在生成计划…';
    case 'plan_ready':
      return '✅ 计划已就绪';
    case 'drafting_tasks':
      return '📦 正在生成任务…';
    case 'tasks_ready':
      return '✅ 任务已就绪';
    case 'completed':
      return '🎉 已完成';
    case 'idle':
    case null:
    case undefined:
      return '';
    default:
      return `⏳ ${substate}`;
  }
}

function roleLayerLabel(roleLayer: string | null | undefined): { text: string; color: string } {
  // 统一走 role-layer-identity（唯一事实源），避免本组件再各写一份与对话身份头
  // / substate 进度条 / 状态栏不一致的层级名 + 配色。代号用括号标注（如「执行层 (e)」）。
  const id = getRoleLayerIdentity(roleLayer);
  return {
    text: id.code ? `${id.label} (${id.code})` : id.label,
    color: id.color,
  };
}

export function TeamSessionHeader({
  roleLayer,
  substate,
  stateStatus,
  sessionMetadata,
}: TeamSessionHeaderProps) {
  const layerInfo = roleLayerLabel(roleLayer);
  const statusText = substateLabel(substate);
  const teamDef = useMemo(() => parseTeamDef(sessionMetadata), [sessionMetadata]);

  return (
    <div style={HEADER_STYLE}>
      <div style={TOP_ROW_STYLE}>
        {/* 层级标识 */}
        <span
          style={{
            ...BADGE_STYLE,
            background: `color-mix(in srgb, ${layerInfo.color} 15%, transparent)`,
            color: layerInfo.color,
            border: `1px solid color-mix(in srgb, ${layerInfo.color} 30%, transparent)`,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: layerInfo.color }} />
          {layerInfo.text}
        </span>

        {/* 状态 */}
        {stateStatus === 'running' ? (
          <span
            style={{
              ...BADGE_STYLE,
              background: 'color-mix(in srgb, var(--success) 15%, transparent)',
              color: 'var(--success)',
            }}
          >
            运行中
          </span>
        ) : stateStatus === 'paused' ? (
          <span
            style={{
              ...BADGE_STYLE,
              background: 'color-mix(in srgb, var(--warning) 15%, transparent)',
              color: 'var(--warning)',
            }}
          >
            已暂停
          </span>
        ) : null}

        {/* substate 进度提示（内联） */}
        {statusText ? <span style={HINT_STYLE}>{statusText}</span> : null}
      </div>

      {/* 角色 chips（仅在有 teamDef 时显示，紧凑排列） */}
      {teamDef && teamDef.roles.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {teamDef.roles.map((r) => (
            <span key={r.role} style={ROLE_CHIP_STYLE}>
              <span
                style={{ width: 5, height: 5, borderRadius: 999, background: colorForRole(r.role) }}
              />
              {r.role}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── 内部解析 ─────────────────────────────────────────────────────────────

interface ParsedTeamDef {
  sourceLabel: string;
  roles: Array<{ role: string; label: string }>;
}

function parseTeamDef(metadata?: Record<string, unknown> | null): ParsedTeamDef | null {
  if (!metadata) return null;
  const td = metadata['teamDefinition'];
  if (!td || typeof td !== 'object') return null;
  const teamDef = td as Record<string, unknown>;

  const sourceObj = (teamDef['source'] as Record<string, unknown> | undefined) ?? {};
  const kind = typeof sourceObj['kind'] === 'string' ? sourceObj['kind'] : 'blank';
  const templateName =
    typeof sourceObj['templateName'] === 'string' ? sourceObj['templateName'] : null;
  const sourceLabel = kind === 'blank' ? '空白' : (templateName ?? '模板');

  const required = Array.isArray(teamDef['requiredRoleBindings'])
    ? (teamDef['requiredRoleBindings'] as unknown[])
    : [];
  const roles = required
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const rec = entry as Record<string, unknown>;
      const role = typeof rec['role'] === 'string' ? rec['role'] : null;
      const label = typeof rec['agentLabel'] === 'string' ? rec['agentLabel'] : '';
      if (!role) return null;
      return { role, label };
    })
    .filter((x): x is { role: string; label: string } => x !== null);

  return { sourceLabel, roles };
}
