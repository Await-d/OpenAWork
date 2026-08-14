/**
 * TeamSessionEmptyState · 极简版（含 reception 初始化引导）
 *
 * 渲染策略：
 *   1. 加载中 → spinner + "加载会话…"
 *   2. paused → "会话已暂停"
 *   3. **reception session（团队接待会话）且 messages 为空** →
 *      渲染团队组成卡片（来源 / 核心角色 / 可选成员 / provider）+ 引导提示，
 *      告诉用户在 composer 里输入第一条意图，团队会按需展开 b → c → d → e/f/g。
 *      数据来源：sessions.metadata_json.teamDefinition（后端 /sessions 路径写入）。
 *   4. 其他 idle / running / null → 不渲染（让 composer 顶上来）
 *
 * 注意：reception 引导只在"无消息"时显示。一旦用户发出第一条消息，message 流就会
 * 接管，不再渲染本组件——避免重复信息。
 *
 * 关联文档：
 *   - docs/team-architecture-l1-baseline.md L1.3 §1.3.2（编排由首条消息触发）
 *   - docs/team-architecture-deferred-decisions.md D26（b 直答 vs 走 c 路由）
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { TEAM_RUNTIME_LAYER_LABELS, TEAM_RUNTIME_LAYER_ORDER } from '@openAwork/shared';
import type { TeamRuntimeLayer } from '@openAwork/shared';

export interface TeamSessionEmptyStateProps {
  /** session 的 role_layer（来自 sessions 表）。null 时显示通用文案。 */
  roleLayer?: string | null;
  /** session 的 state_status（idle/running/paused）。 */
  stateStatus?: 'idle' | 'running' | 'paused' | null;
  /** session loading 中。 */
  isLoading?: boolean;
  /**
   * 已解析的 sessions.metadata_json（来自 useSessionConversationState）。
   * reception 会话从这里读 `teamDefinition` 渲染团队组成，读 `teamInit` 渲染初始化清单。
   */
  sessionMetadata?: Record<string, unknown> | null;
  /**
   * 用户点击 starter chip 时调用，建议把文本填入 composer 输入框（不直接发送，
   * 让用户确认后再发出，对齐 D31 "starter 仍须用户主动确认"）。
   */
  onSelectStarter?: (text: string) => void;
}

// ─── 团队定义的最小化解析结果 ─────────────────────────────────────────────

interface ParsedTeamDefinition {
  sourceKind: 'blank' | 'builtin-template' | 'saved-template' | 'unknown';
  sourceLabel: string;
  defaultProvider: string | null;
  requiredRoleBindings: Array<{
    role: string;
    agentLabel: string;
  }>;
  memberSlots: Array<{
    id: string;
    layer: TeamRuntimeLayer;
    specialty: string;
    displayName: string;
    agentLabel: string | null;
    required: boolean;
  }>;
  optionalMembers: Array<{
    agentLabel: string;
    canonicalRole: string | null;
  }>;
  /** 模板内置 starter chips（D 项），点击 chip → 填入 composer。 */
  starterSuggestions: string[];
}

function parseTeamDefinition(
  metadata?: Record<string, unknown> | null,
): ParsedTeamDefinition | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const td = metadata['teamDefinition'];
  if (!td || typeof td !== 'object') return null;
  const teamDef = td as Record<string, unknown>;

  // source
  const sourceObj = (teamDef['source'] as Record<string, unknown> | undefined) ?? {};
  const sourceKindRaw = typeof sourceObj['kind'] === 'string' ? sourceObj['kind'] : 'unknown';
  const sourceKind: ParsedTeamDefinition['sourceKind'] =
    sourceKindRaw === 'blank' ||
    sourceKindRaw === 'builtin-template' ||
    sourceKindRaw === 'saved-template'
      ? sourceKindRaw
      : 'unknown';
  const templateName =
    typeof sourceObj['templateName'] === 'string' ? sourceObj['templateName'] : null;
  const sourceLabel =
    sourceKind === 'blank'
      ? '空白会话'
      : sourceKind === 'saved-template'
        ? `已保存模板${templateName ? ` · ${templateName}` : ''}`
        : sourceKind === 'builtin-template'
          ? `内置模板${templateName ? ` · ${templateName}` : ''}`
          : '未知来源';

  // requiredRoleBindings
  const required = Array.isArray(teamDef['requiredRoleBindings'])
    ? (teamDef['requiredRoleBindings'] as unknown[])
    : [];
  const requiredRoleBindings = required
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const rec = entry as Record<string, unknown>;
      const role = typeof rec['role'] === 'string' ? rec['role'] : null;
      const agentLabel =
        typeof rec['agentLabel'] === 'string' && rec['agentLabel']
          ? rec['agentLabel']
          : typeof rec['agentId'] === 'string'
            ? (rec['agentId'] as string)
            : null;
      if (!role || !agentLabel) return null;
      return { role, agentLabel };
    })
    .filter((x): x is { role: string; agentLabel: string } => x !== null);

  const memberSlotsRaw = Array.isArray(teamDef['memberSlots'])
    ? (teamDef['memberSlots'] as unknown[])
    : [];
  const memberSlots = memberSlotsRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const rec = entry as Record<string, unknown>;
      const layer = typeof rec['layer'] === 'string' ? rec['layer'] : null;
      if (!layer || !TEAM_RUNTIME_LAYER_ORDER.includes(layer as TeamRuntimeLayer)) return null;
      const id =
        typeof rec['id'] === 'string' ? rec['id'] : `${layer}-${memberSlotsRaw.indexOf(entry)}`;
      const displayName = typeof rec['displayName'] === 'string' ? rec['displayName'] : null;
      const specialty = typeof rec['specialty'] === 'string' ? rec['specialty'] : 'general';
      const agentLabel = typeof rec['agentLabel'] === 'string' ? rec['agentLabel'] : null;
      const required = typeof rec['required'] === 'boolean' ? rec['required'] : false;
      if (!displayName) return null;
      return { id, layer: layer as TeamRuntimeLayer, specialty, displayName, agentLabel, required };
    })
    .filter(
      (
        x,
      ): x is {
        id: string;
        layer: TeamRuntimeLayer;
        specialty: string;
        displayName: string;
        agentLabel: string | null;
        required: boolean;
      } => x !== null,
    );

  // optionalMembers
  const optional = Array.isArray(teamDef['optionalMembers'])
    ? (teamDef['optionalMembers'] as unknown[])
    : [];
  const optionalMembers = optional
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const rec = entry as Record<string, unknown>;
      const agentLabel =
        typeof rec['agentLabel'] === 'string' && rec['agentLabel']
          ? rec['agentLabel']
          : typeof rec['agentId'] === 'string'
            ? (rec['agentId'] as string)
            : null;
      const canonicalRole = typeof rec['canonicalRole'] === 'string' ? rec['canonicalRole'] : null;
      if (!agentLabel) return null;
      return { agentLabel, canonicalRole };
    })
    .filter((x): x is { agentLabel: string; canonicalRole: string | null } => x !== null);

  const defaultProvider =
    typeof teamDef['defaultProvider'] === 'string' && teamDef['defaultProvider']
      ? (teamDef['defaultProvider'] as string)
      : null;

  // starterSuggestions（D 项）
  const starterRaw = teamDef['starterSuggestions'];
  const starterSuggestions = Array.isArray(starterRaw)
    ? (starterRaw as unknown[]).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0,
      )
    : [];

  return {
    sourceKind,
    sourceLabel,
    defaultProvider,
    memberSlots,
    requiredRoleBindings,
    optionalMembers,
    starterSuggestions,
  };
}

// ─── 样式 ─────────────────────────────────────────────────────────────────

const ROW_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  margin: '12px auto',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'var(--bg-overlay)',
  fontSize: 11,
  color: 'var(--fg-muted)',
  fontWeight: 500,
};

const SPINNER_STYLE: CSSProperties = {
  width: 12,
  height: 12,
  border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  borderTopColor: 'var(--accent)',
  borderRadius: '50%',
  animation: 'team-empty-spin 0.9s linear infinite',
  flexShrink: 0,
};

const RECEPTION_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 18,
  margin: '20px auto 24px',
  padding: '24px 28px',
  width: '100%',
  maxWidth: 1280,
  borderRadius: 16,
  border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 5%, var(--bg-overlay))',
};

const CARD_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxWidth: 760,
};

const CARD_BADGE_STYLE: CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 10px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const CARD_TITLE_STYLE: CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: 'var(--fg-strong)',
  lineHeight: 1.3,
};

const CARD_SUBTITLE_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-default)',
  lineHeight: 1.55,
};

const SECTION_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
  marginBottom: 6,
};

const ROLE_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 8,
};

const ROLE_PILL_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 10,
  background: 'var(--bg-overlay)',
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  fontSize: 12,
};

const ROLE_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flexShrink: 0,
};

const MEMBER_LAYER_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
};

const MEMBER_LAYER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 12,
  background: 'var(--bg-overlay)',
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
};

const MEMBER_SLOT_GRID_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const MEMBER_SLOT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 9px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 86%, transparent)',
  fontSize: 11,
};

const OPTIONAL_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  background: 'var(--bg-overlay)',
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  fontSize: 11,
  color: 'var(--fg-default)',
};

const HINT_BLOCK_STYLE: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  background: 'var(--bg-overlay)',
  border: '1px dashed color-mix(in srgb, var(--accent) 30%, transparent)',
  fontSize: 12,
  color: 'var(--fg-default)',
  lineHeight: 1.6,
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

/** canonical role key → 中文名（核心角色卡片用）。 */
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

/** member slot specialty → 中文名（默认固定团队的胶囊用）。 */
const SPECIALTY_LABELS: Record<string, string> = {
  // pm1 / pm2
  'broad-planning': '宏观规划',
  'task-planning': '任务规划',
  'tech-lead': '技术负责',
  dispatch: '调度派发',
  release: '发布管理',
  // executor
  frontend: '前端',
  backend: '后端',
  data: '数据',
  workflow: '工作流',
  integration: '集成',
  qa: '测试验证',
  docs: '文档',
  devops: 'DevOps',
  platform: '平台',
  // reviewer
  'code-review': '代码评审',
  security: '安全',
  sre: 'SRE / 运维',
  observability: '可观测性',
  quality: '质量',
  // 通用兜底
  general: '通用',
};

function specialtyLabel(specialty: string): string {
  return SPECIALTY_LABELS[specialty] ?? specialty;
}

function describeOptionalGroup(canonicalRole: string | null): string {
  switch (canonicalRole) {
    case 'leader':
      return '领导层';
    case 'planner':
      return '规划补位';
    case 'researcher':
      return '研究补位';
    case 'executor':
      return '执行补位';
    case 'reviewer':
      return '评审补位';
    case 'general':
      return '通用助手';
    default:
      return '未分层';
  }
}

/**
 * 把额外成员按 canonicalRole 分组，组内保留原顺序。返回的组顺序遵循 leader → planner →
 * researcher → executor → reviewer → general → 未分层，便于稳定展示。
 */
function groupOptionalMembers(
  members: ParsedTeamDefinition['optionalMembers'],
): Array<{ label: string; members: ParsedTeamDefinition['optionalMembers'] }> {
  const order = ['leader', 'planner', 'researcher', 'executor', 'reviewer', 'general'];
  const byKey = new Map<string, ParsedTeamDefinition['optionalMembers']>();
  for (const member of members) {
    const key = member.canonicalRole ?? '__unknown__';
    const list = byKey.get(key);
    if (list) list.push(member);
    else byKey.set(key, [member]);
  }
  const sortedKeys = Array.from(byKey.keys()).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  });
  return sortedKeys.map((key) => ({
    label: describeOptionalGroup(key === '__unknown__' ? null : key),
    members: byKey.get(key) ?? [],
  }));
}

// ─── 主组件 ──────────────────────────────────────────────────────────────

export function TeamSessionEmptyState({
  roleLayer,
  stateStatus,
  isLoading,
  sessionMetadata,
  onSelectStarter,
}: TeamSessionEmptyStateProps) {
  if (isLoading) {
    return (
      <div style={ROW_STYLE} role="status">
        <span style={SPINNER_STYLE} aria-hidden="true" />
        <span>加载会话…</span>
      </div>
    );
  }
  if (stateStatus === 'paused') {
    return (
      <div style={ROW_STYLE} role="status">
        <span aria-hidden>⏸</span>
        <span>会话已暂停</span>
      </div>
    );
  }

  // reception 会话 + 有 teamDefinition：渲染初始化引导卡片
  if (roleLayer === 'reception') {
    const teamDef = parseTeamDefinition(sessionMetadata);
    if (teamDef) {
      return <ReceptionStarterCard teamDef={teamDef} onSelectStarter={onSelectStarter} />;
    }
  }

  // idle / running / null：不渲染任何占位，让 composer 直接接 chat 流上方
  return null;
}

function ReceptionStarterCard({
  teamDef,
  onSelectStarter,
}: {
  teamDef: ParsedTeamDefinition;
  onSelectStarter?: (text: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const totalFixed = teamDef.memberSlots.length;
  const totalOptional = teamDef.optionalMembers.length;
  const summaryParts: string[] = [];
  if (totalFixed > 0 || totalOptional > 0)
    summaryParts.push(`${totalFixed + totalOptional} 名成员`);
  if (teamDef.defaultProvider) summaryParts.push(`provider ${teamDef.defaultProvider}`);
  summaryParts.push(teamDef.sourceLabel);

  return (
    <div style={RECEPTION_CARD_STYLE} role="status" aria-label="团队会话已就位">
      <div style={CARD_HEADER_STYLE}>
        <span style={CARD_BADGE_STYLE}>
          <span aria-hidden style={{ fontSize: 9 }}>
            ●
          </span>
          团队已就位
        </span>
        <strong style={CARD_TITLE_STYLE}>向接待层提出你的第一条需求</strong>
        <span style={CARD_SUBTITLE_STYLE}>
          团队成员已绑定，等你说一句开始。接待层会根据需求决定直接回答、走澄清，
          还是把任务派发给规划 → 执行 → 评审链路。
        </span>
      </div>

      {summaryParts.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{summaryParts.join(' · ')}</span>
          {(totalFixed > 0 || totalOptional > 0) && (
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 999,
                border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
                background: 'transparent',
                color: 'var(--accent)',
                fontSize: 11,
                cursor: 'pointer',
                flexShrink: 0,
                fontWeight: 600,
              }}
            >
              {showDetails ? '收起详情' : '查看成员'}
              <span
                style={{
                  display: 'inline-block',
                  transform: showDetails ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                  lineHeight: 1,
                }}
                aria-hidden
              >
                ▾
              </span>
            </button>
          )}
        </div>
      )}

      {teamDef.requiredRoleBindings.length > 0 ? (
        <div>
          <div style={SECTION_LABEL_STYLE}>核心角色</div>
          <div style={ROLE_GRID_STYLE}>
            {teamDef.requiredRoleBindings.map((binding) => (
              <div key={binding.role} style={ROLE_PILL_STYLE}>
                <span
                  aria-hidden
                  style={{ ...ROLE_DOT_STYLE, background: colorForRole(binding.role) }}
                />
                <span
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    lineHeight: 1.35,
                  }}
                >
                  <span style={{ fontWeight: 700, color: 'var(--fg-strong)' }}>
                    {roleLabel(binding.role)}
                  </span>
                  <span
                    style={{
                      color: 'var(--fg-muted)',
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`${binding.role} · ${binding.agentLabel}`}
                  >
                    {binding.agentLabel}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showDetails && teamDef.memberSlots.length > 0 ? (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <div style={{ ...SECTION_LABEL_STYLE, marginBottom: 0 }}>
              默认固定团队（{teamDef.memberSlots.length}）
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 10,
                color: 'var(--fg-muted)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <span style={{ color: 'var(--accent)' }}>●</span> 必选
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <span>○</span> 可选
              </span>
            </span>
          </div>
          <div style={MEMBER_LAYER_GRID_STYLE}>
            {TEAM_RUNTIME_LAYER_ORDER.map((layer) => {
              const slots = teamDef.memberSlots.filter((slot) => slot.layer === layer);
              if (slots.length === 0) return null;
              return (
                <div key={layer} style={MEMBER_LAYER_STYLE}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <strong style={{ color: 'var(--fg-strong)', fontSize: 12 }}>
                      {TEAM_RUNTIME_LAYER_LABELS[layer]}
                    </strong>
                    <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>
                      {slots.length} 人
                    </span>
                  </div>
                  <div style={MEMBER_SLOT_GRID_STYLE}>
                    {slots.map((slot) => (
                      <span key={slot.id} style={MEMBER_SLOT_STYLE} title={slot.specialty}>
                        <span
                          style={{ color: slot.required ? 'var(--accent)' : 'var(--fg-muted)' }}
                        >
                          {slot.required ? '●' : '○'}
                        </span>
                        <span style={{ fontWeight: 700, color: 'var(--fg-strong)' }}>
                          {slot.displayName}
                        </span>
                        <span style={{ color: 'var(--fg-muted)' }}>
                          {specialtyLabel(slot.specialty)}
                        </span>
                        {slot.agentLabel ? (
                          <span style={{ color: 'var(--fg-default)' }}>· {slot.agentLabel}</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {showDetails && teamDef.optionalMembers.length > 0 ? (
        <div>
          <div style={SECTION_LABEL_STYLE}>额外成员（{teamDef.optionalMembers.length}）</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {groupOptionalMembers(teamDef.optionalMembers).map((group) => (
              <div
                key={group.label}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    minWidth: 56,
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--fg-muted)',
                  }}
                >
                  {group.label}
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {group.members.map((member, idx) => (
                    <span key={`${member.agentLabel}-${idx}`} style={OPTIONAL_CHIP_STYLE}>
                      <span style={{ color: 'var(--fg-strong)', fontWeight: 600 }}>
                        {member.agentLabel}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {teamDef.starterSuggestions.length > 0 ? (
        <div>
          <div style={SECTION_LABEL_STYLE}>快捷起点</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {teamDef.starterSuggestions.map((text, idx) => (
              <button
                key={`${text}-${idx}`}
                type="button"
                onClick={() => onSelectStarter?.(text)}
                disabled={!onSelectStarter}
                style={{
                  ...OPTIONAL_CHIP_STYLE,
                  cursor: onSelectStarter ? 'pointer' : 'not-allowed',
                  opacity: onSelectStarter ? 1 : 0.55,
                  borderStyle: 'dashed',
                  color: 'var(--fg-strong)',
                }}
                title={onSelectStarter ? '填入下方输入框（不会自动发送）' : undefined}
              >
                <span aria-hidden style={{ color: 'var(--accent)' }}>
                  ▸
                </span>
                <span>{text}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div style={HINT_BLOCK_STYLE}>
        <strong style={{ color: 'var(--fg-strong)' }}>下一步：</strong>
        在下方输入框告诉接待层你想做什么。比如「帮我实现 GitHub OAuth 登录」「修复 issue
        #42」。团队不会在你发声之前自动开始工作。
      </div>
    </div>
  );
}
