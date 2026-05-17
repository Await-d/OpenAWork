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

import type { CSSProperties } from 'react';

export interface TeamSessionEmptyStateProps {
  /** session 的 role_layer（来自 sessions 表）。null 时显示通用文案。 */
  roleLayer?: string | null;
  /** session 的 state_status（idle/running/paused）。 */
  stateStatus?: 'idle' | 'running' | 'paused' | null;
  /** session loading 中。 */
  isLoading?: boolean;
  /**
   * 已解析的 sessions.metadata_json（来自 useSessionConversationState）。
   * reception 会话从这里读 `teamDefinition` 渲染团队组成。
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
  border: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 70%, transparent)',
  fontSize: 11,
  color: 'var(--text-3)',
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
  gap: 14,
  margin: '24px auto',
  padding: '20px 22px',
  maxWidth: 560,
  borderRadius: 16,
  border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 5%, var(--surface))',
};

const CARD_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
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
  color: 'var(--text)',
  lineHeight: 1.3,
};

const CARD_SUBTITLE_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-2)',
  lineHeight: 1.55,
};

const SECTION_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
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
  background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  fontSize: 12,
};

const ROLE_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flexShrink: 0,
};

const OPTIONAL_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  fontSize: 11,
  color: 'var(--text-2)',
};

const HINT_BLOCK_STYLE: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  background: 'color-mix(in srgb, var(--bg-2) 50%, var(--surface))',
  border: '1px dashed color-mix(in srgb, var(--accent) 30%, transparent)',
  fontSize: 12,
  color: 'var(--text-2)',
  lineHeight: 1.6,
};

function colorForRole(role: string): string {
  switch (role) {
    case 'planner':
      return '#6366f1';
    case 'researcher':
      return '#0ea5e9';
    case 'executor':
      return '#22c55e';
    case 'reviewer':
      return '#f59e0b';
    case 'leader':
      return '#a855f7';
    default:
      return '#71717a';
  }
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

      <div>
        <div style={SECTION_LABEL_STYLE}>来源</div>
        <span style={CARD_SUBTITLE_STYLE}>
          {teamDef.sourceLabel}
          {teamDef.defaultProvider ? ` · provider ${teamDef.defaultProvider}` : ''}
        </span>
      </div>

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
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>{binding.role}</span>
                <span
                  style={{
                    color: 'var(--text-3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {binding.agentLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {teamDef.optionalMembers.length > 0 ? (
        <div>
          <div style={SECTION_LABEL_STYLE}>额外成员（{teamDef.optionalMembers.length}）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {teamDef.optionalMembers.map((member, idx) => (
              <span key={`${member.agentLabel}-${idx}`} style={OPTIONAL_CHIP_STYLE}>
                <span style={{ color: 'var(--text-3)' }}>
                  {describeOptionalGroup(member.canonicalRole)}
                </span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{member.agentLabel}</span>
              </span>
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
                  color: 'var(--text)',
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
        <strong style={{ color: 'var(--text)' }}>下一步：</strong>
        在下方输入框告诉接待层你想做什么。比如「帮我实现 GitHub OAuth 登录」「修复 issue
        #42」。团队不会在你发声之前自动开始工作。
      </div>
    </div>
  );
}
