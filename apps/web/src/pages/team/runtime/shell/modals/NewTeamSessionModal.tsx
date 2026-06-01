/**
 * NewTeamSessionModal · 创建团队会话弹窗（双栏 + 步骤指示版）
 *
 * 布局：
 *   ┌──────────────┬─────────────────────────────┐
 *   │ 左侧 (220)   │ 右侧 (1fr)                   │
 *   │ 步骤指示：    │ 步骤内容：                    │
 *   │  ① 来源       │  - source: 三个来源 tab     │
 *   │  ② 核心角色   │  - required-roles: 角色卡片  │
 *   │  ③ 额外成员   │  - optional-members: agents  │
 *   │  ④ 确认       │  - review: 总结卡片          │
 *   └──────────────┴─────────────────────────────┘
 *
 * 设计原则：
 * - 步骤可视化：左侧 vertical stepper，hover/active 高亮
 * - 内容卡片化：每个步骤的内容用 card 区域承载
 * - 模板/agent 信息丰富：name + description + badges + role chips + color
 * - 与 NewTeamWorkspaceModal 风格统一（都是 hero/aside 结构）
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { useTeamRuntimeRoleBindings } from '../../hooks/use-team-runtime-role-bindings.js';
import {
  generateDefaultSessionTitle,
  useTeamSessionCreation,
} from '../../hooks/use-team-session-creation.js';
import {
  REQUIRED_CORE_ROLES,
  type TeamSessionCreationDraft,
  type TeamSessionCreationStep,
} from '../../data/team-session-creation.types.js';
import { CheckIcon, ChevronRightIcon, XIcon } from '../../shared/TeamIcons.js';
import { recordTemplateUsage } from '../../../views/templates/template-preferences.js';

interface NewTeamSessionModalProps {
  onClose: () => void;
  onSubmitDraft: (draft: TeamSessionCreationDraft) => void | Promise<void>;
  workspaceLabel: string;
  teamWorkspaceId: string;
  defaultMemberSlots?: TeamSessionCreationDraft['memberSlots'];
}

interface StepDescriptor {
  key: TeamSessionCreationStep;
  index: number;
  title: string;
  hint: string;
  icon: ReactNode;
}

type SourceTab = 'blank' | 'template';

// ─── 图标 ─────────────────────────────────────────────

const ICON_SPARKLES = (
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

const ICON_USERS = (
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

const ICON_PLUS_USERS = (
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

const ICON_CLIPBOARD = (
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

const ICON_BLANK = (
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

const ICON_TEMPLATE = (
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

const ICON_LOCK = (
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

const STEPS: StepDescriptor[] = [
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

// ─── 样式 ────────────────────────────────────────────

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 800,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(4px)',
  padding: 16,
};

const MODAL_STYLE: CSSProperties = {
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

const STEPPER_PANE_STYLE: CSSProperties = {
  background:
    'linear-gradient(170deg, color-mix(in srgb, var(--accent) 18%, var(--bg-overlay)) 0%, color-mix(in srgb, var(--accent) 6%, var(--bg-overlay)) 100%)',
  padding: '22px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  borderRight: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
};

const STEPPER_HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  marginBottom: 8,
};

const STEPPER_BADGE_STYLE: CSSProperties = {
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

const STEP_ITEM_BASE_STYLE: CSSProperties = {
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

const STEP_ITEM_ACTIVE_STYLE: CSSProperties = {
  ...STEP_ITEM_BASE_STYLE,
  background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
  color: 'var(--fg-strong)',
};

const STEP_ITEM_DONE_STYLE: CSSProperties = {
  ...STEP_ITEM_BASE_STYLE,
  color: 'var(--fg-default)',
};

const STEP_INDEX_BASE_STYLE: CSSProperties = {
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

const STEP_INDEX_ACTIVE_STYLE: CSSProperties = {
  ...STEP_INDEX_BASE_STYLE,
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  boxShadow: '0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)',
};

const STEP_INDEX_DONE_STYLE: CSSProperties = {
  ...STEP_INDEX_BASE_STYLE,
  background: 'color-mix(in srgb, var(--success) 18%, transparent)',
  color: 'var(--success)',
  borderColor: 'color-mix(in srgb, var(--success) 50%, transparent)',
};

const FORM_PANE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '92vh',
  overflow: 'hidden',
};

const FORM_HEADER_STYLE: CSSProperties = {
  padding: '20px 24px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
  flexShrink: 0,
};

const FORM_BODY_STYLE: CSSProperties = {
  padding: '18px 24px 20px',
  flex: 1,
  overflowY: 'auto',
  display: 'grid',
  gap: 14,
};

const FORM_FOOTER_STYLE: CSSProperties = {
  padding: '12px 24px',
  borderTop: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexShrink: 0,
  background: 'var(--bg-overlay)',
};

const FIELD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-default)',
};

const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
  color: 'var(--fg-strong)',
  fontSize: 13,
  fontFamily: 'inherit',
};

const SOURCE_TAB_BAR_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
  padding: 4,
  borderRadius: 10,
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
};

const SOURCE_TAB_BTN_BASE_STYLE: CSSProperties = {
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

const SOURCE_TAB_BTN_ACTIVE_STYLE: CSSProperties = {
  ...SOURCE_TAB_BTN_BASE_STYLE,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  boxShadow: '0 1px 4px color-mix(in srgb, #000 10%, transparent)',
};

const CARD_BASE_STYLE: CSSProperties = {
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

const CARD_SELECTED_STYLE: CSSProperties = {
  ...CARD_BASE_STYLE,
  borderColor: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent)',
};

const CARD_TITLE_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const CARD_DESC_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

const BADGE_BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 18,
  padding: '0 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.02em',
};

const ROLE_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '40px 1fr auto',
  gap: 12,
  alignItems: 'center',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-overlay))',
};

const ROLE_AVATAR_STYLE: CSSProperties = {
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

const AGENT_CHIP_BASE_STYLE: CSSProperties = {
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

const AGENT_CHIP_SELECTED_STYLE: CSSProperties = {
  ...AGENT_CHIP_BASE_STYLE,
  borderColor: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-overlay))',
  color: 'var(--accent)',
};

const REVIEW_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '16px 18px',
  borderRadius: 14,
  background: 'var(--bg-overlay)',
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
};

const REVIEW_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  gap: 10,
  alignItems: 'flex-start',
  fontSize: 12,
  lineHeight: 1.6,
};

const REVIEW_LABEL_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
  fontWeight: 600,
};

const REVIEW_VALUE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
};

const SECTION_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--fg-default)',
  fontWeight: 700,
  marginTop: 4,
};

const SECTION_HEADER_RULE_STYLE: CSSProperties = {
  flex: 1,
  height: 1,
  background: 'color-mix(in srgb, var(--border-default) 60%, transparent)',
};

const PRIMARY_BTN_STYLE: CSSProperties = {
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

const SECONDARY_BTN_STYLE: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  cursor: 'pointer',
};

// ─── 工具函数 ────────────────────────────────────────────

function getInitial(label: string | undefined | null): string {
  if (!label) return '?';
  const trimmed = label.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

function colorForRole(role: string): string {
  switch (role) {
    case 'planner':
      return 'var(--accent)'; // indigo
    case 'researcher':
      return 'var(--chart-7)'; // sky
    case 'executor':
      return 'var(--success)'; // green
    case 'reviewer':
      return 'var(--warning)'; // amber
    default:
      return 'var(--fg-muted)'; // gray
  }
}

function describeRole(role: string): string {
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

/**
 * 把 agent 的 canonicalRole.coreRole 映射到团队层级 + 可读说明。
 * 在「额外成员」步骤里向用户解释加入此 agent 后，它会以哪种层级出现在团队中。
 */
interface OptionalAgentGroup {
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

function getAgentGroupKey(agent: { canonicalRole?: { coreRole?: string } }): string {
  const role = agent.canonicalRole?.coreRole;
  if (typeof role === 'string' && role in OPTIONAL_GROUP_META) {
    return role;
  }
  return 'unknown';
}

function getAgentGroupMeta(key: string): OptionalAgentGroup {
  const meta = OPTIONAL_GROUP_META[key] ?? OPTIONAL_GROUP_META['unknown']!;
  return { key, ...meta };
}

function badgeToneStyle(tone?: string): CSSProperties {
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

// ─── 主组件 ─────────────────────────────────────────

export function NewTeamSessionModal({
  onClose,
  onSubmitDraft,
  workspaceLabel,
  teamWorkspaceId,
  defaultMemberSlots,
}: NewTeamSessionModalProps) {
  const { templateLoading, templates } = useTeamRuntimeReferenceViewData();
  const roleBindings = useTeamRuntimeRoleBindings();
  const creation = useTeamSessionCreation({
    defaultMemberSlots,
    teamWorkspaceId,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 来源 tab：根据当前 source 推断（workflow 已移除，仅保留 blank / template）
  const [sourceTab, setSourceTab] = useState<SourceTab>(
    creation.draft.source.kind === 'saved-template' ? 'template' : 'blank',
  );

  const groupedTemplates = useMemo(() => {
    const groups = new Map<string, { items: typeof templates; title: string; priority: number }>();
    for (const template of templates) {
      const groupId = template.groupId ?? 'ungrouped';
      const current = groups.get(groupId) ?? {
        items: [] as typeof templates,
        title: template.groupTitle ?? '模板',
        priority: template.groupPriority ?? Number.MAX_SAFE_INTEGER,
      };
      current.items.push(template);
      groups.set(groupId, current);
    }
    return Array.from(groups.entries())
      .sort(([, left], [, right]) => left.priority - right.priority)
      .map(([id, group]) => ({ id, ...group }));
  }, [templates]);

  const availableOptionalAgents = useMemo(() => {
    const requiredAgentIds = new Set(
      Object.values(creation.draft.requiredRoleBindings).filter((value): value is string =>
        Boolean(value),
      ),
    );
    return roleBindings.agents.filter((agent) => agent.enabled && !requiredAgentIds.has(agent.id));
  }, [creation.draft.requiredRoleBindings, roleBindings.agents]);

  const agentById = useMemo(
    () => new Map(roleBindings.agents.map((agent) => [agent.id, agent])),
    [roleBindings.agents],
  );

  const handleSubmit = async () => {
    if (!creation.canSubmit || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      // 提交前若标题为空，自动填入默认标题（不阻塞用户）
      if (!creation.draft.title.trim()) {
        creation.fillDefaultTitle();
      }
      const finalDraft = {
        ...creation.draft,
        title: creation.draft.title.trim() || generateDefaultSessionTitle(),
      };
      await onSubmitDraft(finalDraft);
      // 据模板新建会话成功后，记录一次模板使用（最近 + 次数），供模板页统计展示。
      if (finalDraft.source.kind === 'saved-template' && finalDraft.source.templateId) {
        recordTemplateUsage(finalDraft.source.templateId);
      }
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '创建团队会话失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === creation.step);

  return (
    <div style={OVERLAY_STYLE}>
      <button
        type="button"
        aria-label="关闭创建会话弹窗"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
      <div style={MODAL_STYLE} role="dialog" aria-modal="true" aria-labelledby="new-session-title">
        {/* ─── 左侧步骤指示器 ─── */}
        <aside style={STEPPER_PANE_STYLE} aria-label="创建步骤">
          <div style={STEPPER_HEADER_STYLE}>
            <div style={STEPPER_BADGE_STYLE}>
              <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="6" />
              </svg>
              Session
            </div>
            <strong
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: 'var(--fg-strong)',
                lineHeight: 1.3,
              }}
            >
              新建团队会话
            </strong>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              工作区：<strong style={{ color: 'var(--fg-default)' }}>{workspaceLabel}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {STEPS.map((s, i) => {
              const active = i === stepIndex;
              const done = i < stepIndex;
              const itemStyle = active
                ? STEP_ITEM_ACTIVE_STYLE
                : done
                  ? STEP_ITEM_DONE_STYLE
                  : STEP_ITEM_BASE_STYLE;
              const indexStyle = active
                ? STEP_INDEX_ACTIVE_STYLE
                : done
                  ? STEP_INDEX_DONE_STYLE
                  : STEP_INDEX_BASE_STYLE;
              return (
                <div key={s.key} style={itemStyle}>
                  <span style={indexStyle} aria-hidden="true">
                    {done ? (
                      <CheckIcon
                        size={14}
                        color={active ? 'var(--fg-on-accent)' : 'var(--success)'}
                      />
                    ) : (
                      s.index
                    )}
                  </span>
                  <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: active ? 'var(--fg-strong)' : 'inherit',
                      }}
                    >
                      {s.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--fg-muted)',
                        lineHeight: 1.4,
                      }}
                    >
                      {s.hint}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ─── 右侧表单 ─── */}
        <div style={FORM_PANE_STYLE}>
          <div style={FORM_HEADER_STYLE}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                id="new-session-title"
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: 'var(--fg-strong)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ color: 'var(--accent)' }}>{STEPS[stepIndex]?.icon}</span>
                {STEPS[stepIndex]?.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--fg-muted)',
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {creation.step === 'source' &&
                  '选择新会话从何处启动：从空白开始、套用工作流，或复用已保存的模板配置。'}
                {creation.step === 'required-roles' &&
                  '4 个核心角色由系统固定 agent 预绑定。可在此填写会话标题（留空则自动生成）。'}
                {creation.step === 'optional-members' &&
                  '在核心角色之外可加入更多 agent，按其声明的层级（leader / general / planner …）参与对应阶段。'}
                {creation.step === 'review' && '请确认会话配置，提交后即立即创建并进入。'}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--fg-muted)',
                padding: 4,
                cursor: 'pointer',
                display: 'inline-flex',
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              <XIcon size={14} color="var(--fg-muted)" />
            </button>
          </div>

          <div style={FORM_BODY_STYLE}>
            {/* ── Step: source ───────────────────────────── */}
            {creation.step === 'source' ? (
              <>
                <div style={SOURCE_TAB_BAR_STYLE} role="tablist" aria-label="来源类别">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sourceTab === 'blank'}
                    onClick={() => {
                      setSourceTab('blank');
                      creation.setSource({ kind: 'blank' });
                    }}
                    style={
                      sourceTab === 'blank'
                        ? SOURCE_TAB_BTN_ACTIVE_STYLE
                        : SOURCE_TAB_BTN_BASE_STYLE
                    }
                  >
                    <span style={{ color: sourceTab === 'blank' ? 'var(--accent)' : undefined }}>
                      {ICON_BLANK}
                    </span>
                    空白会话
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sourceTab === 'template'}
                    onClick={() => setSourceTab('template')}
                    style={
                      sourceTab === 'template'
                        ? SOURCE_TAB_BTN_ACTIVE_STYLE
                        : SOURCE_TAB_BTN_BASE_STYLE
                    }
                  >
                    <span style={{ color: sourceTab === 'template' ? 'var(--accent)' : undefined }}>
                      {ICON_TEMPLATE}
                    </span>
                    已保存模板
                  </button>
                </div>

                {sourceTab === 'blank' ? (
                  <button
                    type="button"
                    onClick={() => creation.setSource({ kind: 'blank' })}
                    style={
                      creation.draft.source.kind === 'blank' ? CARD_SELECTED_STYLE : CARD_BASE_STYLE
                    }
                  >
                    <div style={CARD_TITLE_STYLE}>
                      <span
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          display: 'grid',
                          placeItems: 'center',
                          background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                          color: 'var(--accent)',
                        }}
                      >
                        {ICON_BLANK}
                      </span>
                      空白团队
                      {creation.draft.source.kind === 'blank' ? (
                        <span style={{ marginLeft: 'auto' }}>
                          <CheckIcon size={14} color="var(--accent)" />
                        </span>
                      ) : null}
                    </div>
                    <div style={CARD_DESC_STYLE}>
                      使用系统预置的 4 个核心角色（planner / researcher / executor /
                      reviewer），随后可按需追加额外 agent 成员。会话标题可留空，提交时会自动以
                      <strong style={{ color: 'var(--fg-default)' }}>「团队会话 + 时间戳」</strong>
                      命名。
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {REQUIRED_CORE_ROLES.map((role) => (
                        <span
                          key={role}
                          style={{
                            ...BADGE_BASE_STYLE,
                            background: `color-mix(in srgb, ${colorForRole(role)} 16%, transparent)`,
                            color: colorForRole(role),
                          }}
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </button>
                ) : null}

                {sourceTab === 'template' ? (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {/* 旧版兼容警告 */}
                    <div
                      role="note"
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
                        fontSize: 11,
                        color: 'var(--fg-default)',
                        lineHeight: 1.6,
                      }}
                    >
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--warning)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ flexShrink: 0, marginTop: 1 }}
                      >
                        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <span>
                        <strong style={{ color: 'var(--warning)' }}>实验性功能：</strong>
                        已保存模板沿用旧版数据结构，与新版会话契约可能不完全兼容；新版的模板体系仍在设计中。建议优先选择「空白会话」开始。
                      </span>
                    </div>

                    {templateLoading ? (
                      <div
                        style={{
                          padding: 24,
                          textAlign: 'center',
                          color: 'var(--fg-muted)',
                          fontSize: 12,
                        }}
                      >
                        正在加载模板…
                      </div>
                    ) : templates.length === 0 ? (
                      <div
                        style={{
                          padding: '32px 24px',
                          textAlign: 'center',
                          borderRadius: 12,
                          border:
                            '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
                          color: 'var(--fg-muted)',
                          fontSize: 12,
                          display: 'grid',
                          gap: 8,
                          justifyItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 24 }}>📋</span>
                        <span>暂无可用模板</span>
                        <span style={{ fontSize: 11 }}>切换到「空白会话」即可继续创建。</span>
                      </div>
                    ) : (
                      groupedTemplates.map((group) => (
                        <div key={group.id} style={{ display: 'grid', gap: 8 }}>
                          <div style={SECTION_HEADER_STYLE}>
                            <span>{group.title}</span>
                            <span style={SECTION_HEADER_RULE_STYLE} />
                          </div>
                          {group.items.map((template) => {
                            const selected =
                              creation.draft.source.kind === 'saved-template' &&
                              creation.draft.source.templateId === template.id;
                            return (
                              <button
                                key={template.id}
                                type="button"
                                onClick={() => creation.applyTemplate(template)}
                                style={selected ? CARD_SELECTED_STYLE : CARD_BASE_STYLE}
                              >
                                <div style={CARD_TITLE_STYLE}>
                                  <span
                                    style={{
                                      width: 28,
                                      height: 28,
                                      borderRadius: 8,
                                      display: 'grid',
                                      placeItems: 'center',
                                      background:
                                        'color-mix(in srgb, var(--accent) 14%, transparent)',
                                      color: 'var(--accent)',
                                    }}
                                  >
                                    {ICON_TEMPLATE}
                                  </span>
                                  <span style={{ flex: 1 }}>{template.name}</span>
                                  {selected ? <CheckIcon size={14} color="var(--accent)" /> : null}
                                </div>
                                {template.badges && template.badges.length > 0 ? (
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {template.badges.map((badge) => (
                                      <span
                                        key={`${template.id}-${badge.label}`}
                                        style={{
                                          ...BADGE_BASE_STYLE,
                                          ...badgeToneStyle(badge.tone),
                                        }}
                                      >
                                        {badge.label}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                <div style={CARD_DESC_STYLE}>
                                  {template.description ?? '已保存的团队模板'}
                                </div>
                                {template.metaLine ? (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: 'var(--fg-muted)',
                                      lineHeight: 1.5,
                                    }}
                                  >
                                    {template.metaLine}
                                  </div>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            ) : null}

            {/* ── Step: required-roles ───────────────────────────── */}
            {creation.step === 'required-roles' ? (
              <>
                <div style={FIELD_STYLE}>
                  <label
                    htmlFor="new-team-session-title"
                    style={{
                      ...LABEL_STYLE,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>会话标题</span>
                    <span
                      style={{
                        ...BADGE_BASE_STYLE,
                        ...badgeToneStyle(),
                        fontSize: 9,
                        padding: '0 6px',
                        minHeight: 16,
                      }}
                    >
                      可选
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="new-team-session-title"
                      value={creation.draft.title}
                      onChange={(e) => creation.setTitle(e.target.value)}
                      placeholder={generateDefaultSessionTitle()}
                      style={{ ...INPUT_STYLE, flex: 1 }}
                      autoFocus
                    />
                    {!creation.draft.title.trim() ? (
                      <button
                        type="button"
                        onClick={() => creation.setTitle(generateDefaultSessionTitle())}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
                          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                          color: 'var(--accent)',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                        title="使用默认标题"
                      >
                        使用默认
                      </button>
                    ) : null}
                  </div>
                  <span style={HINT_STYLE}>
                    留空将自动以
                    <strong style={{ color: 'var(--fg-default)' }}>
                      「团队会话 + 当前时间戳」
                    </strong>
                    作为标题，可随时在会话列表里重命名。
                  </span>
                </div>

                <div style={SECTION_HEADER_STYLE}>
                  <span>核心角色绑定</span>
                  <span style={SECTION_HEADER_RULE_STYLE} />
                  <span
                    style={{
                      ...BADGE_BASE_STYLE,
                      ...badgeToneStyle('warning'),
                      gap: 4,
                    }}
                  >
                    {ICON_LOCK}
                    系统固定
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {REQUIRED_CORE_ROLES.map((role) => {
                    const card = roleBindings.roleCards.find((r) => r.role === role) ?? null;
                    const agentId =
                      creation.draft.requiredRoleBindings[role] ?? card?.selectedAgentId ?? '';
                    const agent = agentById.get(agentId) ?? card?.selectedAgent ?? null;
                    const color = agent?.color ?? colorForRole(role);
                    return (
                      <div key={role} style={ROLE_CARD_STYLE}>
                        <div style={{ ...ROLE_AVATAR_STYLE, background: color }}>
                          {getInitial(card?.roleLabel ?? role)}
                        </div>
                        <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: 'var(--fg-strong)',
                              }}
                            >
                              {card?.roleLabel ?? role}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                fontFamily: 'ui-monospace, monospace',
                                color: 'var(--fg-muted)',
                              }}
                            >
                              {role}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--fg-default)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {agent?.label ?? agentId ?? '系统预置'}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--fg-muted)',
                              lineHeight: 1.4,
                            }}
                          >
                            {agent?.description?.trim() || describeRole(role)}
                          </span>
                        </div>
                        <span
                          style={{
                            ...BADGE_BASE_STYLE,
                            ...badgeToneStyle(),
                            gap: 3,
                          }}
                        >
                          {ICON_LOCK}
                          固定
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {/* ── Step: optional-members ───────────────────────────── */}
            {creation.step === 'optional-members' ? (
              <>
                {availableOptionalAgents.length === 0 ? (
                  <div
                    style={{
                      padding: '28px 24px',
                      textAlign: 'center',
                      borderRadius: 12,
                      border:
                        '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
                      color: 'var(--fg-muted)',
                      fontSize: 12,
                      display: 'grid',
                      gap: 8,
                      justifyItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 24 }}>🧑‍🤝‍🧑</span>
                    <span>暂无可选额外成员</span>
                    <span style={{ fontSize: 11 }}>
                      所有 agent 都已被核心角色占用。可直接进入下一步确认。
                    </span>
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={HINT_STYLE}>
                        额外成员按 <strong style={{ color: 'var(--fg-default)' }}>层级</strong>
                        分组展示。每个 agent 加入后，会以其声明的层级参与协作，与核心角色
                        <strong style={{ color: 'var(--fg-default)' }}>并行</strong>而非替代。
                      </span>
                      <span
                        style={{
                          ...BADGE_BASE_STYLE,
                          ...badgeToneStyle('accent'),
                          gap: 4,
                        }}
                      >
                        已选 {creation.draft.optionalAgentIds.length} /{' '}
                        {availableOptionalAgents.length}
                      </span>
                    </div>

                    {/* 已加入成员面板：按层级分组，每行清晰显示「agent → 层级」 */}
                    {creation.draft.optionalAgentIds.length > 0
                      ? (() => {
                          // 按 layer 分组已选成员
                          const selectedBuckets = new Map<
                            string,
                            Array<{
                              id: string;
                              agent: (typeof roleBindings.agents)[number] | null;
                            }>
                          >();
                          for (const id of creation.draft.optionalAgentIds) {
                            const agent = agentById.get(id) ?? null;
                            const key = agent ? getAgentGroupKey(agent) : 'unknown';
                            const list = selectedBuckets.get(key) ?? [];
                            list.push({ id, agent });
                            selectedBuckets.set(key, list);
                          }
                          const SELECTED_ORDER = [
                            'leader',
                            'general',
                            'planner',
                            'researcher',
                            'executor',
                            'reviewer',
                            'unknown',
                          ];
                          const orderedSelected = SELECTED_ORDER.map((key) => ({
                            meta: getAgentGroupMeta(key),
                            items: selectedBuckets.get(key) ?? [],
                          })).filter((g) => g.items.length > 0);

                          return (
                            <div
                              style={{
                                display: 'grid',
                                gap: 10,
                                padding: '12px 14px',
                                borderRadius: 12,
                                background:
                                  'color-mix(in srgb, var(--accent) 6%, var(--bg-overlay))',
                                border:
                                  '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: 'var(--accent)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                <svg
                                  aria-hidden="true"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>已加入成员（{creation.draft.optionalAgentIds.length}）</span>
                                <span
                                  style={{
                                    flex: 1,
                                    height: 1,
                                    background:
                                      'color-mix(in srgb, var(--accent) 30%, transparent)',
                                  }}
                                />
                              </div>
                              <div style={{ display: 'grid', gap: 8 }}>
                                {orderedSelected.map(({ meta, items }) => (
                                  <div
                                    key={`selected-${meta.key}`}
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: 'auto 1fr',
                                      gap: 10,
                                      alignItems: 'flex-start',
                                    }}
                                  >
                                    {/* 层级标签 */}
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                        padding: '4px 9px',
                                        borderRadius: 6,
                                        background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
                                        color: meta.color,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        flexShrink: 0,
                                        marginTop: 2,
                                      }}
                                      title={meta.hint}
                                    >
                                      <span
                                        aria-hidden="true"
                                        style={{
                                          width: 6,
                                          height: 6,
                                          borderRadius: '50%',
                                          background: meta.color,
                                        }}
                                      />
                                      {meta.label}
                                      <span
                                        style={{
                                          fontSize: 9,
                                          opacity: 0.7,
                                          fontFamily: 'ui-monospace, monospace',
                                        }}
                                      >
                                        {meta.key}
                                      </span>
                                    </span>
                                    {/* agent chips */}
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: 6,
                                      }}
                                    >
                                      {items.map(({ id, agent }) => {
                                        const color = agent?.color ?? meta.color;
                                        return (
                                          <span
                                            key={id}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 6,
                                              padding: '5px 6px 5px 10px',
                                              borderRadius: 999,
                                              background: 'var(--bg-overlay)',
                                              border:
                                                '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                                              fontSize: 11,
                                              color: 'var(--fg-strong)',
                                              fontWeight: 600,
                                            }}
                                          >
                                            <span
                                              aria-hidden="true"
                                              style={{
                                                width: 7,
                                                height: 7,
                                                borderRadius: '50%',
                                                background: color,
                                                flexShrink: 0,
                                              }}
                                            />
                                            <span>{agent?.label ?? id}</span>
                                            <button
                                              type="button"
                                              onClick={() => creation.toggleOptionalAgent(id)}
                                              className="team-icon-danger"
                                              style={{
                                                width: 18,
                                                height: 18,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                border: 'none',
                                                borderRadius: '50%',
                                                background: 'transparent',
                                                color: 'var(--fg-muted)',
                                                cursor: 'pointer',
                                                padding: 0,
                                              }}
                                              aria-label={`从「${meta.label}」层移除 ${agent?.label ?? id}`}
                                              title={`从「${meta.label}」层移除`}
                                            >
                                              <svg
                                                aria-hidden="true"
                                                width="9"
                                                height="9"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              >
                                                <line x1="18" y1="6" x2="6" y2="18" />
                                                <line x1="6" y1="6" x2="18" y2="18" />
                                              </svg>
                                            </button>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()
                      : null}

                    {/* 选取面板：按层级分组待选 agent */}
                    <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 11,
                          color: 'var(--fg-muted)',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        <span>可加入</span>
                        <span
                          style={{
                            flex: 1,
                            height: 1,
                            background:
                              'color-mix(in srgb, var(--border-default) 60%, transparent)',
                          }}
                        />
                        <span style={{ textTransform: 'none', fontSize: 10, fontWeight: 400 }}>
                          点击 agent 即加入对应层
                        </span>
                      </div>
                    </div>

                    {(() => {
                      // 按 canonicalRole.coreRole 分组
                      const buckets = new Map<string, typeof availableOptionalAgents>();
                      for (const agent of availableOptionalAgents) {
                        const key = getAgentGroupKey(agent);
                        const list = buckets.get(key) ?? [];
                        list.push(agent);
                        buckets.set(key, list);
                      }

                      // 层级显示顺序：leader → general → planner → researcher → executor → reviewer → unknown
                      const ORDER = [
                        'leader',
                        'general',
                        'planner',
                        'researcher',
                        'executor',
                        'reviewer',
                        'unknown',
                      ];
                      const groups = ORDER.map((key) => ({
                        meta: getAgentGroupMeta(key),
                        items: buckets.get(key) ?? [],
                      })).filter((g) => g.items.length > 0);

                      return (
                        <div style={{ display: 'grid', gap: 14 }}>
                          {groups.map(({ meta, items }) => (
                            <div key={meta.key} style={{ display: 'grid', gap: 8 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  padding: '8px 10px',
                                  borderRadius: 10,
                                  background: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
                                  border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`,
                                }}
                              >
                                <span
                                  aria-hidden="true"
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: '50%',
                                    background: meta.color,
                                    flexShrink: 0,
                                  }}
                                />
                                <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 700,
                                      color: 'var(--fg-strong)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                    }}
                                  >
                                    点击加入「{meta.label}」层
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontFamily: 'ui-monospace, monospace',
                                        color: 'var(--fg-muted)',
                                        fontWeight: 400,
                                      }}
                                    >
                                      {meta.key}
                                    </span>
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: 'var(--fg-muted)',
                                      lineHeight: 1.4,
                                    }}
                                  >
                                    {meta.hint}
                                  </span>
                                </div>
                                {(() => {
                                  const selectedInLayer = items.filter((a) =>
                                    creation.draft.optionalAgentIds.includes(a.id),
                                  ).length;
                                  return (
                                    <span
                                      style={{
                                        ...BADGE_BASE_STYLE,
                                        background:
                                          selectedInLayer > 0
                                            ? `color-mix(in srgb, ${meta.color} 22%, transparent)`
                                            : 'color-mix(in srgb, var(--fg-muted) 14%, transparent)',
                                        color: selectedInLayer > 0 ? meta.color : 'var(--fg-muted)',
                                        fontSize: 10,
                                        fontVariantNumeric: 'tabular-nums',
                                        flexShrink: 0,
                                      }}
                                    >
                                      {selectedInLayer} / {items.length}
                                    </span>
                                  );
                                })()}
                              </div>

                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {items.map((agent) => {
                                  const selected = creation.draft.optionalAgentIds.includes(
                                    agent.id,
                                  );
                                  const color = agent.color ?? meta.color;
                                  return (
                                    <button
                                      key={agent.id}
                                      type="button"
                                      onClick={() => creation.toggleOptionalAgent(agent.id)}
                                      style={
                                        selected ? AGENT_CHIP_SELECTED_STYLE : AGENT_CHIP_BASE_STYLE
                                      }
                                      title={
                                        agent.description ||
                                        `${agent.label}（加入后会出现在「${meta.label}」层级）`
                                      }
                                    >
                                      <span
                                        aria-hidden="true"
                                        style={{
                                          width: 8,
                                          height: 8,
                                          borderRadius: '50%',
                                          background: color,
                                          flexShrink: 0,
                                        }}
                                      />
                                      {selected ? (
                                        <CheckIcon size={11} color="var(--accent)" />
                                      ) : null}
                                      <span>{agent.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </>
                )}
              </>
            ) : null}

            {/* ── Step: review ───────────────────────────── */}
            {creation.step === 'review' ? (
              <div style={REVIEW_CARD_STYLE}>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>来源</span>
                  <span style={REVIEW_VALUE_STYLE}>
                    {creation.draft.source.kind === 'blank' ? (
                      <>
                        <span
                          style={{
                            ...BADGE_BASE_STYLE,
                            ...badgeToneStyle('accent'),
                          }}
                        >
                          空白会话
                        </span>
                      </>
                    ) : (
                      <>
                        <span
                          style={{
                            ...BADGE_BASE_STYLE,
                            ...badgeToneStyle('success'),
                          }}
                        >
                          已保存模板
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                          ID：{creation.draft.source.templateId}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>会话标题</span>
                  <span style={{ ...REVIEW_VALUE_STYLE, fontWeight: 600 }}>
                    {creation.draft.title.trim() || (
                      <span
                        style={{
                          color: 'var(--fg-muted)',
                          fontStyle: 'italic',
                          fontWeight: 400,
                        }}
                        title="提交后将以此默认值创建"
                      >
                        {generateDefaultSessionTitle()}（自动）
                      </span>
                    )}
                  </span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>工作区</span>
                  <span style={REVIEW_VALUE_STYLE}>{workspaceLabel}</span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>核心角色</span>
                  <span style={REVIEW_VALUE_STYLE}>
                    {REQUIRED_CORE_ROLES.map((role) => {
                      const agentId = creation.draft.requiredRoleBindings[role];
                      const agent = agentId ? agentById.get(agentId) : null;
                      const color = agent?.color ?? colorForRole(role);
                      return (
                        <span
                          key={role}
                          style={{
                            ...BADGE_BASE_STYLE,
                            background: `color-mix(in srgb, ${color} 18%, transparent)`,
                            color,
                            gap: 4,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: color,
                            }}
                          />
                          {role}
                        </span>
                      );
                    })}
                  </span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>额外成员</span>
                  <span style={REVIEW_VALUE_STYLE}>
                    {creation.draft.optionalAgentIds.length === 0 ? (
                      <span style={{ color: 'var(--fg-muted)' }}>未选择</span>
                    ) : (
                      creation.draft.optionalAgentIds.map((id) => {
                        const agent = agentById.get(id);
                        const groupKey = agent ? getAgentGroupKey(agent) : 'unknown';
                        const groupMeta = getAgentGroupMeta(groupKey);
                        const color = agent?.color ?? groupMeta.color;
                        return (
                          <span
                            key={id}
                            style={{
                              ...BADGE_BASE_STYLE,
                              background: 'var(--bg-overlay)',
                              color: 'var(--fg-default)',
                              border:
                                '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
                              gap: 5,
                            }}
                            title={`${agent?.label ?? id} · ${groupMeta.label} (${groupMeta.key})`}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: color,
                              }}
                            />
                            {agent?.label ?? id}
                            <span
                              style={{
                                fontSize: 9,
                                color: groupMeta.color,
                                fontFamily: 'ui-monospace, monospace',
                                opacity: 0.85,
                              }}
                            >
                              · {groupMeta.key}
                            </span>
                          </span>
                        );
                      })
                    )}
                  </span>
                </div>
              </div>
            ) : null}

            {roleBindings.error ? (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  color: 'var(--error)',
                  background: 'color-mix(in srgb, var(--error) 10%, transparent)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)',
                }}
              >
                {roleBindings.error}
              </div>
            ) : null}

            {submitError ? (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  color: 'var(--error)',
                  background: 'color-mix(in srgb, var(--error) 10%, transparent)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)',
                }}
              >
                {submitError}
              </div>
            ) : null}
          </div>

          {/* ─── 操作栏 ─── */}
          <div style={FORM_FOOTER_STYLE}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              步骤 {stepIndex + 1} / {STEPS.length}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={creation.prevStep}
                disabled={creation.currentStepIndex === 0}
                style={{
                  ...SECONDARY_BTN_STYLE,
                  opacity: creation.currentStepIndex === 0 ? 0.4 : 1,
                  cursor: creation.currentStepIndex === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                上一步
              </button>
              {creation.step !== 'review' ? (
                <button
                  type="button"
                  onClick={creation.nextStep}
                  disabled={!creation.canAdvance}
                  style={{
                    ...PRIMARY_BTN_STYLE,
                    opacity: creation.canAdvance ? 1 : 0.5,
                    cursor: creation.canAdvance ? 'pointer' : 'not-allowed',
                  }}
                >
                  下一步
                  <ChevronRightIcon size={11} color="var(--fg-on-accent)" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!creation.canSubmit || submitting}
                  style={{
                    ...PRIMARY_BTN_STYLE,
                    opacity: creation.canSubmit && !submitting ? 1 : 0.5,
                    cursor: creation.canSubmit && !submitting ? 'pointer' : 'not-allowed',
                  }}
                >
                  {submitting ? (
                    '创建中…'
                  ) : (
                    <>
                      <CheckIcon size={12} color="var(--fg-on-accent)" />
                      确认创建
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
