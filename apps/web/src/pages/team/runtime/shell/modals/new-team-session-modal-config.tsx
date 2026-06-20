import type { CSSProperties, ReactNode } from 'react';
import type { TeamSessionCreationStep } from '../../data/team-session-creation.types.js';

export interface StepDescriptor {
  key: TeamSessionCreationStep;
  index: number;
  title: string;
  hint: string;
  icon: ReactNode;
}

export type SourceTab = 'blank' | 'template';

export const ICON_SPARKLES = (
  <svg
    aria-hidden="true"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
    <path d="M5 3v4M19 17v4M3 5h4M17 19h4" />
  </svg>
);

export const ICON_USERS = (
  <svg
    aria-hidden="true"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const ICON_PLUS_USERS = (
  <svg
    aria-hidden="true"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="19" y1="8" x2="19" y2="14" />
    <line x1="22" y1="11" x2="16" y2="11" />
  </svg>
);

export const ICON_CLIPBOARD = (
  <svg
    aria-hidden="true"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="2" width="6" height="4" rx="1" />
    <path d="M9 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4" />
    <path d="M9 13h6M9 17h6" />
  </svg>
);

export const ICON_BLANK = (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

export const ICON_TEMPLATE = (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="7" rx="1" />
    <rect x="3" y="14" width="9" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export const ICON_LOCK = (
  <svg
    aria-hidden="true"
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const STEPS: StepDescriptor[] = [
  {
    key: 'source',
    index: 1,
    title: '选择来源',
    hint: '空白模板 / 工作流 / 已保存',
    icon: ICON_SPARKLES,
  },
  {
    key: 'required-roles',
    index: 2,
    title: '核心角色',
    hint: '4 个固定角色配置',
    icon: ICON_USERS,
  },
  {
    key: 'optional-members',
    index: 3,
    title: '额外成员',
    hint: '按需追加 agent',
    icon: ICON_PLUS_USERS,
  },
  { key: 'review', index: 4, title: '确认创建', hint: '检查并提交', icon: ICON_CLIPBOARD },
];

export const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 800,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(4px)',
  padding: 16,
};

export const MODAL_STYLE: CSSProperties = {
  position: 'relative',
  width: 760,
  maxWidth: '96vw',
  maxHeight: '92vh',
  overflow: 'hidden',
  borderRadius: 18,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4)',
  display: 'grid',
  gridTemplateColumns: '240px 1fr',
};

export const STEPPER_PANE_STYLE: CSSProperties = {
  background:
    'linear-gradient(170deg, color-mix(in srgb, var(--accent) 18%, var(--bg-overlay)) 0%, color-mix(in srgb, var(--accent) 6%, var(--bg-overlay)) 100%)',
  padding: '22px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  borderRight: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
};

export const STEPPER_HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  marginBottom: 8,
};

export const STEPPER_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 8px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  alignSelf: 'flex-start',
};

export const STEP_ITEM_BASE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--fg-muted)',
  position: 'relative',
  transition: 'background 120ms ease, color 120ms ease',
  cursor: 'default',
};

export const STEP_ITEM_ACTIVE_STYLE: CSSProperties = {
  ...STEP_ITEM_BASE_STYLE,
  background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
  color: 'var(--fg-strong)',
};

export const STEP_ITEM_DONE_STYLE: CSSProperties = {
  ...STEP_ITEM_BASE_STYLE,
  color: 'var(--fg-default)',
};

export const STEP_INDEX_BASE_STYLE: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  fontSize: 11,
  fontWeight: 700,
  background: 'color-mix(in srgb, var(--fg-muted) 18%, transparent)',
  color: 'var(--fg-muted)',
  flexShrink: 0,
  border: '1.5px solid transparent',
};

export const STEP_INDEX_ACTIVE_STYLE: CSSProperties = {
  ...STEP_INDEX_BASE_STYLE,
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  boxShadow: '0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)',
};

export const STEP_INDEX_DONE_STYLE: CSSProperties = {
  ...STEP_INDEX_BASE_STYLE,
  background: 'color-mix(in srgb, var(--success) 18%, transparent)',
  color: 'var(--success)',
  borderColor: 'color-mix(in srgb, var(--success) 50%, transparent)',
};

export const FORM_PANE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '92vh',
  overflow: 'hidden',
};

export const FORM_HEADER_STYLE: CSSProperties = {
  padding: '20px 24px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
  flexShrink: 0,
};

export const FORM_BODY_STYLE: CSSProperties = {
  padding: '18px 24px 20px',
  flex: 1,
  overflowY: 'auto',
  display: 'grid',
  gap: 14,
};

export const FORM_FOOTER_STYLE: CSSProperties = {
  padding: '12px 24px',
  borderTop: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexShrink: 0,
  background: 'var(--bg-overlay)',
};

export const FIELD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
};

export const LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-default)',
};

export const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

export const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
  color: 'var(--fg-strong)',
  fontSize: 13,
  fontFamily: 'inherit',
};

export const SOURCE_TAB_BAR_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
  padding: 4,
  borderRadius: 10,
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
};

export const SOURCE_TAB_BTN_BASE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 5,
  padding: '10px 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 120ms ease, color 120ms ease',
};

export const SOURCE_TAB_BTN_ACTIVE_STYLE: CSSProperties = {
  ...SOURCE_TAB_BTN_BASE_STYLE,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  boxShadow: '0 1px 4px color-mix(in srgb, #000 10%, transparent)',
};

export const CARD_BASE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'var(--bg-overlay)',
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'border-color 120ms ease, background 120ms ease, transform 120ms ease',
  width: '100%',
};

export const CARD_SELECTED_STYLE: CSSProperties = {
  ...CARD_BASE_STYLE,
  borderColor: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent)',
};

export const CARD_TITLE_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export const CARD_DESC_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

export const BADGE_BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 18,
  padding: '0 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.02em',
};

export const ROLE_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '40px 1fr auto',
  gap: 12,
  alignItems: 'center',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-overlay))',
};

export const ROLE_AVATAR_STYLE: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  fontSize: 14,
  fontWeight: 800,
  color: 'var(--fg-on-accent)',
  flexShrink: 0,
};

export const AGENT_CHIP_BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'border-color 120ms ease, background 120ms ease',
};

export const AGENT_CHIP_SELECTED_STYLE: CSSProperties = {
  ...AGENT_CHIP_BASE_STYLE,
  borderColor: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-overlay))',
  color: 'var(--accent)',
};

export const REVIEW_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '16px 18px',
  borderRadius: 14,
  background: 'var(--bg-overlay)',
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
};

export const REVIEW_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  gap: 10,
  alignItems: 'flex-start',
  fontSize: 12,
  lineHeight: 1.6,
};

export const REVIEW_LABEL_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
  fontWeight: 600,
};

export const REVIEW_VALUE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
};

export const SECTION_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--fg-default)',
  fontWeight: 700,
  marginTop: 4,
};

export const SECTION_HEADER_RULE_STYLE: CSSProperties = {
  flex: 1,
  height: 1,
  background: 'color-mix(in srgb, var(--border-default) 60%, transparent)',
};

export const PRIMARY_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

export const SECONDARY_BTN_STYLE: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  cursor: 'pointer',
};

export function getInitial(label: string | undefined | null): string {
  if (!label) return '?';
  const trimmed = label.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

export function colorForRole(role: string): string {
  switch (role) {
    case 'planner':
      return 'var(--accent)';
    case 'researcher':
      return 'var(--chart-7)';
    case 'executor':
      return 'var(--success)';
    case 'reviewer':
      return 'var(--warning)';
    default:
      return 'var(--fg-muted)';
  }
}

export function describeRole(role: string): string {
  switch (role) {
    case 'planner':
      return '负责拆解任务、生成计划与里程碑';
    case 'researcher':
      return '负责检索资料、收集上下文';
    case 'executor':
      return '负责落地实现，工具调用执行';
    case 'reviewer':
      return '负责审查产物质量与一致性';
    default:
      return '';
  }
}

export interface OptionalAgentGroup {
  key: string;
  label: string;
  description: string;
  color: string;
  hint: string;
}

const OPTIONAL_GROUP_META: Record<string, Omit<OptionalAgentGroup, 'key'>> = {
  leader: {
    label: '领导层',
    description: '统筹全局，可作为团队代理人下发任务',
    color: 'var(--chart-5)',
    hint: '会出现在「领导」层级，介入跨子流程的协调与拍板。',
  },
  general: {
    label: '通用助手',
    description: '通用型 agent，灵活补位',
    color: 'var(--chart-7)',
    hint: '会出现在主对话流，按需被引用作为辅助回答与协作。',
  },
  planner: {
    label: '规划补位',
    description: '在 planner 层提供额外协作思路',
    color: 'var(--accent)',
    hint: '与核心 planner 并行，作为额外的拆解视角参与「规划」层。',
  },
  researcher: {
    label: '研究补位',
    description: '在 researcher 层补充信息源',
    color: 'var(--chart-7)',
    hint: '与核心 researcher 并行，作为额外检索通道参与「研究」层。',
  },
  executor: {
    label: '执行补位',
    description: '在 executor 层提供额外执行能力',
    color: 'var(--success)',
    hint: '与核心 executor 并行，作为额外执行节点参与「执行」层。',
  },
  reviewer: {
    label: '评审补位',
    description: '在 reviewer 层加强审查',
    color: 'var(--warning)',
    hint: '与核心 reviewer 并行，作为额外评审视角参与「评审」层。',
  },
  unknown: {
    label: '未分层',
    description: '未声明 canonical role 的 agent',
    color: 'var(--fg-muted)',
    hint: '未声明 canonical role，默认作为通用辅助 agent 加入。',
  },
};

export function getAgentGroupKey(agent: { canonicalRole?: { coreRole?: string } }): string {
  const role = agent.canonicalRole?.coreRole;
  if (typeof role === 'string' && role in OPTIONAL_GROUP_META) {
    return role;
  }
  return 'unknown';
}

export function getAgentGroupMeta(key: string): OptionalAgentGroup {
  const meta = OPTIONAL_GROUP_META[key] ?? OPTIONAL_GROUP_META['unknown']!;
  return { key, ...meta };
}

export function badgeToneStyle(tone?: string): CSSProperties {
  switch (tone) {
    case 'accent':
      return {
        background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
        color: 'var(--accent)',
      };
    case 'success':
      return {
        background: 'color-mix(in srgb, var(--success) 18%, transparent)',
        color: 'var(--success)',
      };
    case 'warning':
      return {
        background: 'color-mix(in srgb, var(--warning) 22%, transparent)',
        color: 'var(--warning)',
      };
    default:
      return {
        background: 'color-mix(in srgb, var(--fg-muted) 14%, transparent)',
        color: 'var(--fg-default)',
      };
  }
}
