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
  gap: 6,
  padding: '5px 10px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 20%, transparent)',
  background: 'var(--bg-overlay)',
  flexShrink: 0,
  flexWrap: 'wrap',
  minHeight: 28,
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
  gap: 3,
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
};

const ROLE_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  background: 'var(--bg-surface)',
  color: 'var(--fg-muted)',
};

const ROLE_CHIP_TEXT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 3,
  minWidth: 0,
};

const ROLE_AGENT_LABEL_STYLE: CSSProperties = {
  color: 'var(--fg-subtle)',
  fontSize: 10,
  maxWidth: 100,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const CONFIG_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
  width: '100%',
};

const CONFIG_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '1px 6px',
  borderRadius: 4,
  background: 'var(--bg-surface)',
  color: 'var(--fg-subtle)',
  fontSize: 10,
  fontWeight: 500,
};

const SOURCE_PILL_STYLE: CSSProperties = {
  ...CONFIG_PILL_STYLE,
  color: 'var(--accent)',
};

const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.4,
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

const ROLE_LABELS: Record<string, string> = {
  leader: '团队负责人',
  planner: '规划师',
  researcher: '研究员',
  executor: '执行者',
  reviewer: '评审员',
  general: '通用助手',
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function buildActionHint(input: {
  roleLayer?: string | null;
  stateStatus?: string | null;
  substate?: string | null;
}): string | null {
  if (input.stateStatus === 'paused') {
    return '提示：恢复运行树后，本层会从当前状态继续。';
  }
  if (input.substate === 'clarifying') {
    return '提示：先回答当前澄清，团队会在下一轮继续推进。';
  }
  if (input.substate === 'dispatching') {
    return '提示：可切到“任务与产物”查看当前派发包。';
  }
  if (input.substate === 'completed') {
    return '提示：本层已完成，可回看产物或评审结果。';
  }
  if (input.stateStatus === 'running' && input.roleLayer && input.roleLayer !== 'reception') {
    return '提示：当前层正在执行，可继续补充上下文或查看任务细节。';
  }
  return null;
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
  const actionHint = useMemo(
    () => buildActionHint({ roleLayer, stateStatus, substate }),
    [roleLayer, stateStatus, substate],
  );

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

      {teamDef || actionHint ? (
        <div style={CONFIG_ROW_STYLE}>
          {teamDef ? (
            <span style={SOURCE_PILL_STYLE} title={teamDef.sourceLabel}>
              来源 · {teamDef.sourceLabel}
            </span>
          ) : null}
          {teamDef?.defaultProvider ? (
            <span style={CONFIG_PILL_STYLE}>模型 · {teamDef.defaultProvider}</span>
          ) : null}
          {teamDef?.roles.map((role) => (
            <span
              key={role.role}
              style={ROLE_CHIP_STYLE}
              title={role.label ? `${roleLabel(role.role)} · ${role.label}` : roleLabel(role.role)}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: colorForRole(role.role),
                }}
              />
              <span style={ROLE_CHIP_TEXT_STYLE}>
                <span>{roleLabel(role.role)}</span>
                {role.label ? <span style={ROLE_AGENT_LABEL_STYLE}>{role.label}</span> : null}
              </span>
            </span>
          ))}
          {actionHint ? <span style={HINT_STYLE}>{actionHint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── 内部解析 ─────────────────────────────────────────────────────────────

interface ParsedTeamDef {
  sourceLabel: string;
  defaultProvider: string | null;
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
  const sourceLabel =
    kind === 'blank'
      ? '空白会话'
      : kind === 'builtin-template'
        ? `内置模板${templateName ? ` · ${templateName}` : ''}`
        : kind === 'saved-template'
          ? `已保存模板${templateName ? ` · ${templateName}` : ''}`
          : (templateName ?? '模板');
  const defaultProvider =
    typeof teamDef['defaultProvider'] === 'string' && teamDef['defaultProvider']
      ? teamDef['defaultProvider']
      : null;

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

  return { sourceLabel, defaultProvider, roles };
}
