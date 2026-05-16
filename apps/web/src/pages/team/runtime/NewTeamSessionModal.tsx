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
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { useTeamRuntimeRoleBindings } from './use-team-runtime-role-bindings.js';
import { useTeamSessionCreation } from './use-team-session-creation.js';
import {
  REQUIRED_CORE_ROLES,
  type TeamSessionCreationDraft,
  type TeamSessionCreationStep,
} from './team-session-creation.types.js';
import { CheckIcon, ChevronRightIcon, XIcon } from './TeamIcons.js';
import { WorkflowSelector } from './WorkflowEditor.js';

interface NewTeamSessionModalProps {
  onClose: () => void;
  onSubmitDraft: (draft: TeamSessionCreationDraft) => void | Promise<void>;
  workspaceLabel: string;
  teamWorkspaceId: string;
}

interface StepDescriptor {
  key: TeamSessionCreationStep;
  index: number;
  title: string;
  hint: string;
  icon: ReactNode;
}

type SourceTab = 'blank' | 'workflow' | 'template';

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

const ICON_WORKFLOW = (
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
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="3" width="6" height="6" rx="1" />
    <rect x="3" y="15" width="6" height="6" rx="1" />
    <rect x="15" y="15" width="6" height="6" rx="1" />
    <path d="M9 6h6M6 9v6M18 9v6M9 18h6" />
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
  background: 'oklch(0 0 0 / 0.6)',
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
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  boxShadow: '0 24px 64px oklch(0 0 0 / 0.4)',
  display: 'grid',
  gridTemplateColumns: '240px 1fr',
};

const STEPPER_PANE_STYLE: CSSProperties = {
  background:
    'linear-gradient(170deg, color-mix(in srgb, var(--accent) 18%, var(--surface)) 0%, color-mix(in srgb, var(--accent) 6%, var(--bg-2)) 100%)',
  padding: '22px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  borderRight: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
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
  color: 'var(--text-3)',
  position: 'relative',
  transition: 'background 120ms ease, color 120ms ease',
  cursor: 'default',
};

const STEP_ITEM_ACTIVE_STYLE: CSSProperties = {
  ...STEP_ITEM_BASE_STYLE,
  background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
  color: 'var(--text)',
};

const STEP_ITEM_DONE_STYLE: CSSProperties = {
  ...STEP_ITEM_BASE_STYLE,
  color: 'var(--text-2)',
};

const STEP_INDEX_BASE_STYLE: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  fontSize: 11,
  fontWeight: 700,
  background: 'color-mix(in srgb, var(--text-3) 18%, transparent)',
  color: 'var(--text-3)',
  flexShrink: 0,
  border: '1.5px solid transparent',
};

const STEP_INDEX_ACTIVE_STYLE: CSSProperties = {
  ...STEP_INDEX_BASE_STYLE,
  background: 'var(--accent)',
  color: 'var(--accent-text, #fff)',
  boxShadow: '0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)',
};

const STEP_INDEX_DONE_STYLE: CSSProperties = {
  ...STEP_INDEX_BASE_STYLE,
  background: 'color-mix(in srgb, var(--success, #22c55e) 18%, transparent)',
  color: 'var(--success, #22c55e)',
  borderColor: 'color-mix(in srgb, var(--success, #22c55e) 50%, transparent)',
};

const FORM_PANE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '92vh',
  overflow: 'hidden',
};

const FORM_HEADER_STYLE: CSSProperties = {
  padding: '20px 24px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
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
  borderTop: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexShrink: 0,
  background: 'color-mix(in srgb, var(--bg-2) 30%, var(--surface))',
};

const FIELD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-2)',
};

const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-3)',
  lineHeight: 1.5,
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-2) 70%, var(--bg))',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
};

const INPUT_ERROR_STYLE: CSSProperties = {
  ...INPUT_STYLE,
  borderColor: 'var(--warning, #f59e0b)',
};

const SOURCE_TAB_BAR_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 8,
  padding: 4,
  borderRadius: 10,
  background: 'color-mix(in srgb, var(--bg-2) 60%, var(--bg))',
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
  color: 'var(--text-3)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 120ms ease, color 120ms ease',
};

const SOURCE_TAB_BTN_ACTIVE_STYLE: CSSProperties = {
  ...SOURCE_TAB_BTN_BASE_STYLE,
  background: 'var(--surface)',
  color: 'var(--text)',
  boxShadow: '0 1px 4px color-mix(in srgb, #000 10%, transparent)',
};

const CARD_BASE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'var(--surface)',
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'border-color 120ms ease, background 120ms ease, transform 120ms ease',
  width: '100%',
};

const CARD_SELECTED_STYLE: CSSProperties = {
  ...CARD_BASE_STYLE,
  borderColor: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent)',
};

const CARD_TITLE_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--text)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const CARD_DESC_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-3)',
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
  background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))',
};

const ROLE_AVATAR_STYLE: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  fontSize: 14,
  fontWeight: 800,
  color: '#fff',
  flexShrink: 0,
};

const AGENT_CHIP_BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'var(--surface)',
  color: 'var(--text-2)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'border-color 120ms ease, background 120ms ease',
};

const AGENT_CHIP_SELECTED_STYLE: CSSProperties = {
  ...AGENT_CHIP_BASE_STYLE,
  borderColor: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
  color: 'var(--accent)',
};

const REVIEW_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '16px 18px',
  borderRadius: 14,
  background: 'color-mix(in srgb, var(--bg-2) 30%, var(--surface))',
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
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
  color: 'var(--text-3)',
  fontWeight: 600,
};

const REVIEW_VALUE_STYLE: CSSProperties = {
  color: 'var(--text)',
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
  color: 'var(--text-2)',
  fontWeight: 700,
  marginTop: 4,
};

const SECTION_HEADER_RULE_STYLE: CSSProperties = {
  flex: 1,
  height: 1,
  background: 'color-mix(in srgb, var(--border) 60%, transparent)',
};

const PRIMARY_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--accent-text, #fff)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const SECONDARY_BTN_STYLE: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  background: 'transparent',
  color: 'var(--text-2)',
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
      return '#6366f1'; // indigo
    case 'researcher':
      return '#0ea5e9'; // sky
    case 'executor':
      return '#22c55e'; // green
    case 'reviewer':
      return '#f59e0b'; // amber
    default:
      return '#71717a'; // gray
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

function badgeToneStyle(tone?: string): CSSProperties {
  switch (tone) {
    case 'accent':
      return {
        background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
        color: 'var(--accent)',
      };
    case 'success':
      return {
        background: 'color-mix(in srgb, var(--success, #22c55e) 18%, transparent)',
        color: 'var(--success, #22c55e)',
      };
    case 'warning':
      return {
        background: 'color-mix(in srgb, var(--warning, #f59e0b) 22%, transparent)',
        color: 'var(--warning, #f59e0b)',
      };
    default:
      return {
        background: 'color-mix(in srgb, var(--text-3) 14%, transparent)',
        color: 'var(--text-2)',
      };
  }
}

// ─── 主组件 ─────────────────────────────────────────

export function NewTeamSessionModal({
  onClose,
  onSubmitDraft,
  workspaceLabel,
  teamWorkspaceId,
}: NewTeamSessionModalProps) {
  const { templateLoading, templates } = useTeamRuntimeReferenceViewData();
  const roleBindings = useTeamRuntimeRoleBindings();
  const creation = useTeamSessionCreation({ teamWorkspaceId });
  const [submitting, setSubmitting] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  // 来源 tab：根据当前 source 推断
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
    setSubmitting(true);
    try {
      await onSubmitDraft(creation.draft);
      onClose();
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
                color: 'var(--text)',
                lineHeight: 1.3,
              }}
            >
              新建团队会话
            </strong>
            <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
              工作区：<strong style={{ color: 'var(--text-2)' }}>{workspaceLabel}</strong>
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
                        color={active ? 'var(--accent-text, #fff)' : 'var(--success, #22c55e)'}
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
                        color: active ? 'var(--text)' : 'inherit',
                      }}
                    >
                      {s.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--text-3)',
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
                  color: 'var(--text)',
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
                  color: 'var(--text-3)',
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {creation.step === 'source' &&
                  '选择新会话从何处启动：从空白开始、套用工作流，或复用已保存的模板配置。'}
                {creation.step === 'required-roles' &&
                  '4 个核心角色由系统固定 agent 预绑定。可在此填写会话标题以便后续识别。'}
                {creation.step === 'optional-members' &&
                  '在核心角色之外可加入更多 agent（如 leader / 通用助手）协助完成任务。'}
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
                color: 'var(--text-3)',
                padding: 4,
                cursor: 'pointer',
                display: 'inline-flex',
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              <XIcon size={14} color="var(--text-3)" />
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
                    aria-selected={sourceTab === 'workflow'}
                    onClick={() => setSourceTab('workflow')}
                    style={
                      sourceTab === 'workflow'
                        ? SOURCE_TAB_BTN_ACTIVE_STYLE
                        : SOURCE_TAB_BTN_BASE_STYLE
                    }
                  >
                    <span style={{ color: sourceTab === 'workflow' ? 'var(--accent)' : undefined }}>
                      {ICON_WORKFLOW}
                    </span>
                    工作流模板
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
                      reviewer），随后可按需追加额外 agent 成员。
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

                {sourceTab === 'workflow' ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <span style={HINT_STYLE}>
                      工作流模板内置了一组步骤序列，新会话将按此模板派生。
                    </span>
                    <WorkflowSelector
                      selectedId={selectedWorkflowId}
                      onSelect={(id) => setSelectedWorkflowId(id)}
                    />
                  </div>
                ) : null}

                {sourceTab === 'template' ? (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {templateLoading ? (
                      <div
                        style={{
                          padding: 24,
                          textAlign: 'center',
                          color: 'var(--text-3)',
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
                          border: '1px dashed color-mix(in srgb, var(--border) 60%, transparent)',
                          color: 'var(--text-3)',
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
                                      color: 'var(--text-3)',
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
                  <label htmlFor="new-team-session-title" style={LABEL_STYLE}>
                    会话标题 <span style={{ color: 'var(--error, #ef4444)' }}>*</span>
                  </label>
                  <input
                    id="new-team-session-title"
                    value={creation.draft.title}
                    onChange={(e) => creation.setTitle(e.target.value)}
                    placeholder={`例如：研究团队 ${new Date().toISOString().slice(0, 10)}`}
                    style={creation.fieldErrors.title ? INPUT_ERROR_STYLE : INPUT_STYLE}
                    autoFocus
                  />
                  {creation.fieldErrors.title ? (
                    <span style={{ fontSize: 11, color: 'var(--warning, #f59e0b)' }}>
                      {creation.fieldErrors.title}
                    </span>
                  ) : (
                    <span style={HINT_STYLE}>会话列表与对话头部都会显示此标题。</span>
                  )}
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
                                color: 'var(--text)',
                              }}
                            >
                              {card?.roleLabel ?? role}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                fontFamily: 'ui-monospace, monospace',
                                color: 'var(--text-3)',
                              }}
                            >
                              {role}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--text-2)',
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
                              color: 'var(--text-3)',
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
                      border: '1px dashed color-mix(in srgb, var(--border) 60%, transparent)',
                      color: 'var(--text-3)',
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
                    <span style={HINT_STYLE}>
                      可为空。已选 {creation.draft.optionalAgentIds.length} 个，剩余{' '}
                      {availableOptionalAgents.length} 个可选。
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {availableOptionalAgents.map((agent) => {
                        const selected = creation.draft.optionalAgentIds.includes(agent.id);
                        const color = agent.color ?? '#71717a';
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => creation.toggleOptionalAgent(agent.id)}
                            style={selected ? AGENT_CHIP_SELECTED_STYLE : AGENT_CHIP_BASE_STYLE}
                            title={agent.description || agent.label}
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
                            {selected ? <CheckIcon size={11} color="var(--accent)" /> : null}
                            <span>{agent.label}</span>
                          </button>
                        );
                      })}
                    </div>
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
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          ID：{creation.draft.source.templateId}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>会话标题</span>
                  <span style={{ ...REVIEW_VALUE_STYLE, fontWeight: 600 }}>
                    {creation.draft.title || (
                      <span style={{ color: 'var(--warning, #f59e0b)' }}>未填写</span>
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
                      <span style={{ color: 'var(--text-3)' }}>未选择</span>
                    ) : (
                      creation.draft.optionalAgentIds.map((id) => {
                        const agent = agentById.get(id);
                        const color = agent?.color ?? '#71717a';
                        return (
                          <span
                            key={id}
                            style={{
                              ...BADGE_BASE_STYLE,
                              background: 'color-mix(in srgb, var(--bg-2) 60%, var(--surface))',
                              color: 'var(--text-2)',
                              border:
                                '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
                              gap: 5,
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
                            {agent?.label ?? id}
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
                  color: 'var(--error, #ef4444)',
                  background: 'color-mix(in srgb, var(--error, #ef4444) 10%, transparent)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid color-mix(in srgb, var(--error, #ef4444) 30%, transparent)',
                }}
              >
                {roleBindings.error}
              </div>
            ) : null}
          </div>

          {/* ─── 操作栏 ─── */}
          <div style={FORM_FOOTER_STYLE}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
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
                  <ChevronRightIcon size={11} color="var(--accent-text, #fff)" />
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
                      <CheckIcon size={12} color="var(--accent-text, #fff)" />
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
