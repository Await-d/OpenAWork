import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { WorkflowTemplateRecord, WorkflowTemplateScale } from '@openAwork/web-client';
import { FIXED_TEAM_CORE_ROLE_BINDINGS, type TeamCoreRole } from '@openAwork/shared';
import { useTeamWorkflowTemplates } from './team/runtime/use-team-workflow-templates.js';
import { useTeamRuntimeRoleBindings } from './team/runtime/use-team-runtime-role-bindings.js';
import { PANEL_STYLE, SHELL_BACKGROUND } from './team/runtime/team-runtime-shared.js';
import { agentTeamsNewTemplateProviders } from './team/runtime/team-runtime-ui-config.js';
import {
  ChevronDownIcon,
  PlusIcon,
  TemplateIcon,
  SyncIcon,
  CollapseLeftIcon,
  CheckIcon,
  XIcon,
  TrashIcon,
} from './team/runtime/TeamIcons.js';

const ROLE_COLOR_MAP: Record<string, string> = {
  团队领导: '#b45309',
  领导: '#b45309',
  团队负责人: '#d59b11',
  规划: '#d59b11',
  研究员: '#5b5bd8',
  研究: '#5b5bd8',
  执行者: '#378dff',
  执行: '#378dff',
  批评者: '#d04e4e',
  审查: '#d04e4e',
};

const BUILTIN_AGENT_LABELS: Record<string, string> = {
  atlas: 'Atlas',
  metis: 'Metis',
  'sisyphus-junior': 'Sisyphus-Junior',
};

const REQUIRED_TEMPLATE_ROLES: Array<
  'leader' | 'planner' | 'researcher' | 'executor' | 'reviewer'
> = ['leader', 'planner', 'researcher', 'executor', 'reviewer'];

const ROLE_LABELS: Record<string, string> = {
  leader: '团队领导',
  planner: '团队负责人',
  researcher: '研究员',
  executor: '执行者',
  reviewer: '批评者',
};

const SCALE_OPTIONS: { value: WorkflowTemplateScale; label: string }[] = [
  { value: 'small', label: '小型' },
  { value: 'medium', label: '中型' },
  { value: 'large', label: '大型' },
  { value: 'full', label: '完整' },
];

type EditorMode = 'idle' | 'create' | 'edit';

/* ── Shared inline styles ─────────────────────────────────────────────── */

const fieldLabelStyle = {
  fontSize: 10,
  fontWeight: 700 as const,
  color: 'var(--text-3)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

const inputStyle = (valid?: boolean) => ({
  padding: '8px 12px',
  borderRadius: 8,
  border: valid
    ? '1px solid color-mix(in oklch, var(--success) 40%, transparent)'
    : '1px solid var(--border-subtle)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s',
  width: '100%',
  boxSizing: 'border-box' as const,
});

const pillButtonStyle = (active: boolean, color: string) => ({
  padding: '5px 12px',
  borderRadius: 999,
  border: active
    ? `1px solid color-mix(in oklch, ${color} 50%, transparent)`
    : '1px solid var(--border-subtle)',
  background: active ? `color-mix(in oklch, ${color} 8%, var(--bg))` : 'var(--surface-2)',
  color: active ? color : 'var(--text-3)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s',
});

/* ── Template list item ───────────────────────────────────────────────── */

function TemplateListItem({
  template,
  selected,
  onSelect,
}: {
  template: ReturnType<typeof useTeamWorkflowTemplates>['templateCards'][number];
  selected: boolean;
  onSelect: () => void;
}) {
  const subagentNodes = template.nodes.filter((n) => n.type === 'subagent');
  const roleTags = subagentNodes.map((n) => ({
    label: n.label.split(' · ')[0]?.trim() ?? n.label,
    color: ROLE_COLOR_MAP[n.label.split(' · ')[0]?.trim() ?? ''] ?? '#7c52ff',
  }));

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        appearance: 'none',
        display: 'grid',
        gap: 6,
        padding: '10px 12px',
        borderRadius: 8,
        border: selected ? '1px solid var(--accent)' : '1px solid transparent',
        background: selected ? 'color-mix(in oklch, var(--accent) 8%, transparent)' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.15s',
        width: '100%',
        boxSizing: 'border-box' as const,
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = 'var(--surface-hover)';
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {template.name}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-3)', flexShrink: 0 }}>
          {subagentNodes.length} 角色
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {roleTags.slice(0, 4).map((tag) => (
          <span
            key={tag.label}
            style={{
              padding: '1px 5px',
              borderRadius: 4,
              background: `color-mix(in oklch, ${tag.color} 10%, transparent)`,
              color: tag.color,
              fontSize: 8,
              fontWeight: 600,
            }}
          >
            {tag.label}
          </span>
        ))}
        {roleTags.length > 4 && (
          <span style={{ fontSize: 8, color: 'var(--text-3)' }}>+{roleTags.length - 4}</span>
        )}
      </div>
    </button>
  );
}

/* ── Template editor panel ─────────────────────────────────────────────── */

interface EditorState {
  name: string;
  description: string;
  provider: string;
  optionalAgentIds: Set<string>;
  scale: WorkflowTemplateScale;
  focus: string;
  recommendedFor: string;
  isRecommendedDefault: boolean;
}

function TemplateEditor({
  mode,
  initialState,
  busy,
  onSave,
  onDelete,
  onDuplicate,
  onCancel,
}: {
  mode: EditorMode;
  initialState: EditorState;
  busy: boolean;
  onSave: (state: EditorState) => Promise<boolean>;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onCancel: () => void;
}) {
  const roleBindings = useTeamRuntimeRoleBindings();
  const [state, setState] = useState<EditorState>(initialState);

  const fixedRoleCards = useMemo(
    () =>
      roleBindings.roleCards.filter((rc) =>
        REQUIRED_TEMPLATE_ROLES.includes(rc.role as (typeof REQUIRED_TEMPLATE_ROLES)[number]),
      ),
    [roleBindings.roleCards],
  );

  const hasValidName = state.name.trim().length > 0;
  const hasCompleteBindings = fixedRoleCards.length === REQUIRED_TEMPLATE_ROLES.length;
  const isValid = hasValidName && hasCompleteBindings;

  const update = <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const toggleAgent = (agentId: string) => {
    setState((prev) => {
      const next = new Set(prev.optionalAgentIds);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return { ...prev, optionalAgentIds: next };
    });
  };

  const isEditing = mode === 'edit';
  const title = isEditing ? '编辑模板' : '组建新模板';

  return (
    <div style={{ display: 'grid', gap: 14, padding: '16px 20px', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{title}</span>
        <button
          type="button"
          onClick={onCancel}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-3)',
            cursor: 'pointer',
            display: 'inline-flex',
          }}
        >
          <XIcon size={14} color="var(--text-3)" />
        </button>
      </div>

      {/* Name */}
      <div style={{ display: 'grid', gap: 5 }}>
        <label style={fieldLabelStyle}>模板名称</label>
        <input
          type="text"
          placeholder="例如：代码审查流水线"
          value={state.name}
          onChange={(e) => update('name', e.target.value)}
          style={inputStyle(hasValidName)}
        />
        {!hasValidName && (
          <span style={{ fontSize: 9, color: 'var(--warning)' }}>请输入模板名称</span>
        )}
      </div>

      {/* Description */}
      <div style={{ display: 'grid', gap: 5 }}>
        <label style={fieldLabelStyle}>模板描述</label>
        <textarea
          placeholder="描述模板的用途和适用场景…"
          value={state.description}
          onChange={(e) => update('description', e.target.value)}
          rows={3}
          style={{
            ...inputStyle(),
            resize: 'vertical' as const,
            minHeight: 60,
            fontFamily: 'inherit',
            lineHeight: 1.5,
          }}
        />
      </div>

      {/* Provider */}
      <div style={{ display: 'grid', gap: 5 }}>
        <label style={fieldLabelStyle}>默认 Provider</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {agentTeamsNewTemplateProviders.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => update('provider', p.value)}
              style={pillButtonStyle(state.provider === p.value, 'var(--success)')}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scale */}
      <div style={{ display: 'grid', gap: 5 }}>
        <label style={fieldLabelStyle}>模板规模</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SCALE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update('scale', opt.value)}
              style={pillButtonStyle(state.scale === opt.value, 'var(--accent)')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Focus & Recommended for */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ display: 'grid', gap: 5 }}>
          <label style={fieldLabelStyle}>重点方向</label>
          <input
            type="text"
            placeholder="例如：代码审查"
            value={state.focus}
            onChange={(e) => update('focus', e.target.value)}
            style={inputStyle()}
          />
        </div>
        <div style={{ display: 'grid', gap: 5 }}>
          <label style={fieldLabelStyle}>适用场景</label>
          <input
            type="text"
            placeholder="例如：中型团队"
            value={state.recommendedFor}
            onChange={(e) => update('recommendedFor', e.target.value)}
            style={inputStyle()}
          />
        </div>
      </div>

      {/* Recommended default toggle */}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={state.isRecommendedDefault}
          onChange={(e) => update('isRecommendedDefault', e.target.checked)}
          style={{ accentColor: 'var(--accent)' }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>标记为推荐起步模板</span>
      </label>

      {/* Core roles */}
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={fieldLabelStyle}>核心角色（系统固定）</label>
        <div style={{ display: 'grid', gap: 6 }}>
          {fixedRoleCards.map((roleCard) => {
            const roleLabel = ROLE_LABELS[roleCard.role] ?? roleCard.roleLabel;
            const color = ROLE_COLOR_MAP[roleLabel] ?? 'var(--accent)';
            return (
              <div
                key={roleCard.role}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: 8,
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid color-mix(in oklch, ${color} 25%, transparent)`,
                  background: `color-mix(in oklch, ${color} 4%, var(--bg))`,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                <div style={{ display: 'grid', gap: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                    {roleLabel}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-2)' }}>
                    {roleCard.selectedAgent?.label ??
                      FIXED_TEAM_CORE_ROLE_BINDINGS[roleCard.role as TeamCoreRole]}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--text-3)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'var(--surface-2)',
                  }}
                >
                  固定
                </span>
              </div>
            );
          })}
        </div>
        {!hasCompleteBindings && (
          <span style={{ fontSize: 9, color: 'var(--warning)' }}>正在加载核心角色绑定…</span>
        )}
      </div>

      {/* Optional agents */}
      <div style={{ display: 'grid', gap: 5 }}>
        <label style={fieldLabelStyle}>额外增援（可选）</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(BUILTIN_AGENT_LABELS).map(([agentId, label]) => (
            <button
              key={agentId}
              type="button"
              onClick={() => toggleAgent(agentId)}
              style={pillButtonStyle(state.optionalAgentIds.has(agentId), '#f59e0b')}
            >
              {label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
          增援角色会在核心流水线之外提供额外能力
        </span>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 6,
          borderTop: '1px solid var(--border-subtle)',
          marginTop: 4,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {isEditing && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid color-mix(in oklch, var(--danger) 40%, transparent)',
                background: 'color-mix(in oklch, var(--danger) 6%, transparent)',
                color: 'var(--danger)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <TrashIcon size={11} color="currentColor" />
              删除
            </button>
          )}
          {isEditing && onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              复制为新模板
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-3)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!isValid || busy}
            onClick={() => void onSave(state)}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              border: '1px solid color-mix(in oklch, var(--success) 48%, transparent)',
              background: 'color-mix(in oklch, var(--success) 12%, var(--bg))',
              color: 'var(--success)',
              fontSize: 12,
              fontWeight: 700,
              cursor: isValid && !busy ? 'pointer' : 'not-allowed',
              opacity: isValid && !busy ? 1 : 0.5,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <CheckIcon size={12} color="currentColor" />
            {busy ? '保存中…' : isEditing ? '保存修改' : '确认组建'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Template detail view (read-only) ──────────────────────────────────── */

function TemplateDetailView({
  template,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  template: ReturnType<typeof useTeamWorkflowTemplates>['templateCards'][number];
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const subagentNodes = template.nodes.filter((n) => n.type === 'subagent');
  const teamTemplate = template.metadata?.teamTemplate;
  const optionalAgents = (teamTemplate?.optionalAgentIds ?? []).map(
    (id) => BUILTIN_AGENT_LABELS[id] ?? id,
  );

  return (
    <div style={{ display: 'grid', gap: 14, padding: '16px 20px', overflow: 'auto' }}>
      {/* Header with actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{template.name}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={onDuplicate}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            复制
          </button>
          <button
            type="button"
            onClick={onDelete}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid color-mix(in oklch, var(--danger) 30%, transparent)',
              background: 'color-mix(in oklch, var(--danger) 4%, transparent)',
              color: 'var(--danger)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <TrashIcon size={9} color="currentColor" />
            删除
          </button>
          <button
            type="button"
            onClick={onEdit}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--accent)',
              background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
              color: 'var(--accent)',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            编辑
          </button>
        </div>
      </div>

      {/* Description */}
      {template.description && (
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={fieldLabelStyle}>描述</span>
          <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            {template.description}
          </span>
        </div>
      )}

      {/* Metadata row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {teamTemplate?.defaultProvider && (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
              color: 'var(--accent)',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            Provider:{' '}
            {agentTeamsNewTemplateProviders.find((p) => p.value === teamTemplate.defaultProvider)
              ?.label ?? teamTemplate.defaultProvider}
          </span>
        )}
        {teamTemplate?.templateScale && (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              background: 'color-mix(in oklch, var(--success) 10%, transparent)',
              color: 'var(--success)',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {SCALE_OPTIONS.find((s) => s.value === teamTemplate.templateScale)?.label ??
              teamTemplate.templateScale}
          </span>
        )}
        {teamTemplate?.templateFocus && (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              fontSize: 10,
            }}
          >
            重点：{teamTemplate.templateFocus}
          </span>
        )}
        {teamTemplate?.recommendedFor && (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              fontSize: 10,
            }}
          >
            适用：{teamTemplate.recommendedFor}
          </span>
        )}
        {teamTemplate?.recommendedDefault && (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
              color: '#a5b4fc',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            推荐起步
          </span>
        )}
      </div>

      {/* Role roster */}
      <div style={{ display: 'grid', gap: 5 }}>
        <span style={fieldLabelStyle}>角色配置</span>
        {subagentNodes.map((node) => {
          const parts = node.label.split(' · ');
          const roleLabel = parts[0]?.trim() ?? node.label;
          const providerLabel = parts[1]?.trim();
          const color = ROLE_COLOR_MAP[roleLabel] ?? 'var(--accent)';
          return (
            <div
              key={node.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: 8,
                alignItems: 'center',
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px solid color-mix(in oklch, ${color} 20%, transparent)`,
                background: `color-mix(in oklch, ${color} 4%, var(--bg))`,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                {roleLabel}
              </span>
              {providerLabel && (
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{providerLabel}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Optional agents */}
      {optionalAgents.length > 0 && (
        <div style={{ display: 'grid', gap: 5 }}>
          <span style={fieldLabelStyle}>额外增援</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {optionalAgents.map((label) => (
              <span key={label} style={pillButtonStyle(true, '#f59e0b')}>
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Workflow flow */}
      <div style={{ display: 'grid', gap: 5 }}>
        <span style={fieldLabelStyle}>工作流连接</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {template.edges.map((edge, i) => {
            const sourceNode = template.nodes.find((n) => n.id === edge.source);
            const targetNode = template.nodes.find((n) => n.id === edge.target);
            return (
              <span
                key={edge.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  fontSize: 9,
                  color: 'var(--text-3)',
                }}
              >
                {i > 0 && <span style={{ margin: '0 2px' }}>→</span>}
                <span style={{ color: 'var(--text-2)' }}>
                  {sourceNode?.label.split(' · ')[0] ?? edge.source}
                </span>
                <span>→</span>
                <span style={{ color: 'var(--text-2)' }}>
                  {targetNode?.label.split(' · ')[0] ?? edge.target}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Timestamps */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          fontSize: 9,
          color: 'var(--text-3)',
          paddingTop: 4,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {template.createdAt && (
          <span>创建：{new Date(template.createdAt).toLocaleString('zh-CN')}</span>
        )}
        {template.updatedAt && (
          <span>更新：{new Date(template.updatedAt).toLocaleString('zh-CN')}</span>
        )}
      </div>
    </div>
  );
}

/* ── Helper: extract editor state from template ───────────────────────── */

function templateToEditorState(t: WorkflowTemplateRecord): EditorState {
  const team = t.metadata?.teamTemplate;
  return {
    name: t.name,
    description: t.description ?? '',
    provider: team?.defaultProvider ?? agentTeamsNewTemplateProviders[0]?.value ?? '',
    optionalAgentIds: new Set(team?.optionalAgentIds ?? []),
    scale: team?.templateScale ?? 'medium',
    focus: team?.templateFocus ?? '',
    recommendedFor: team?.recommendedFor ?? '',
    isRecommendedDefault: team?.recommendedDefault ?? false,
  };
}

const EMPTY_EDITOR_STATE: EditorState = {
  name: '',
  description: '',
  provider: agentTeamsNewTemplateProviders[0]?.value ?? '',
  optionalAgentIds: new Set(),
  scale: 'medium',
  focus: '',
  recommendedFor: '',
  isRecommendedDefault: false,
};

/* ── Main page ────────────────────────────────────────────────────────── */

export default function TeamTemplatesPage() {
  const navigate = useNavigate();
  const {
    canCreateTemplate,
    createTemplate,
    duplicateTemplate,
    removeTemplate,
    templateCards: templates,
    templateCount,
    error: templateError,
    loading: templateLoading,
    busy: templateBusy,
    refresh,
    templates: rawTemplates,
  } = useTeamWorkflowTemplates();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('idle');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const selectedCard = templates.find((t) => t.id === selectedId) ?? null;
  const selectedRaw = rawTemplates.find((t) => t.id === selectedId) ?? null;

  const handleCreate = useCallback(
    async (state: EditorState) => {
      const ok = await createTemplate({
        name: state.name,
        provider: state.provider,
        optionalAgentIds: Array.from(state.optionalAgentIds),
      });
      if (ok) setEditorMode('idle');
      return ok;
    },
    [createTemplate],
  );

  const handleSaveEdit = useCallback(
    async (state: EditorState) => {
      if (!selectedRaw) return false;
      // Backend has no update endpoint, so delete + recreate
      const deleted = await removeTemplate(selectedRaw.id);
      if (!deleted) return false;
      const ok = await createTemplate({
        name: state.name,
        provider: state.provider,
        optionalAgentIds: Array.from(state.optionalAgentIds),
      });
      if (ok) setEditorMode('idle');
      return ok;
    },
    [selectedRaw, removeTemplate, createTemplate],
  );

  const handleDelete = useCallback(
    async (templateId: string) => {
      const ok = await removeTemplate(templateId);
      if (ok) {
        setConfirmDeleteId(null);
        if (selectedId === templateId) {
          setSelectedId(null);
          setEditorMode('idle');
        }
      }
    },
    [removeTemplate, selectedId],
  );

  const handleDuplicate = useCallback(
    async (source: WorkflowTemplateRecord) => {
      const ok = await duplicateTemplate(source);
      if (ok) setEditorMode('idle');
    },
    [duplicateTemplate],
  );

  // Right panel content
  const rightPanel = useMemo(() => {
    if (editorMode === 'create') {
      return (
        <TemplateEditor
          mode="create"
          initialState={EMPTY_EDITOR_STATE}
          busy={templateBusy}
          onSave={handleCreate}
          onCancel={() => setEditorMode('idle')}
        />
      );
    }

    if (editorMode === 'edit' && selectedRaw) {
      return (
        <TemplateEditor
          mode="edit"
          initialState={templateToEditorState(selectedRaw)}
          busy={templateBusy}
          onSave={handleSaveEdit}
          onDelete={() => setConfirmDeleteId(selectedRaw.id)}
          onDuplicate={() => void handleDuplicate(selectedRaw)}
          onCancel={() => setEditorMode('idle')}
        />
      );
    }

    if (selectedCard) {
      return (
        <TemplateDetailView
          template={selectedCard}
          onEdit={() => setEditorMode('edit')}
          onDuplicate={() => {
            if (selectedRaw) void handleDuplicate(selectedRaw);
          }}
          onDelete={() => setConfirmDeleteId(selectedCard.id)}
        />
      );
    }

    return (
      <div
        style={{
          display: 'grid',
          gap: 12,
          placeItems: 'center',
          textAlign: 'center',
          padding: '40px 20px',
        }}
      >
        <TemplateIcon size={48} color="var(--text-3)" />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-2)' }}>
          选择模板查看详情
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 280, lineHeight: 1.6 }}>
          从左侧列表选择一个模板，或点击下方按钮组建新模板
        </span>
        <button
          type="button"
          onClick={() => {
            setSelectedId(null);
            setEditorMode('create');
          }}
          disabled={!canCreateTemplate}
          style={{
            minHeight: 36,
            borderRadius: 10,
            border: '1px dashed var(--accent)',
            color: 'var(--accent)',
            background: 'color-mix(in oklch, var(--accent) 6%, transparent)',
            fontSize: 12,
            fontWeight: 700,
            cursor: canCreateTemplate ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 20px',
            opacity: canCreateTemplate ? 1 : 0.5,
          }}
        >
          <PlusIcon size={14} color="currentColor" />
          组建新模板
        </button>
      </div>
    );
  }, [
    editorMode,
    selectedCard,
    selectedRaw,
    templateBusy,
    handleCreate,
    handleSaveEdit,
    handleDuplicate,
    canCreateTemplate,
  ]);

  return (
    <div className="page-root" style={{ background: SHELL_BACKGROUND, minHeight: '100dvh' }}>
      <div
        style={{
          minHeight: '100dvh',
          fontFamily:
            'Inter, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif',
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
        }}
      >
        {/* Page header */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            padding: '12px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => navigate('/team')}
              style={{
                appearance: 'none',
                border: 'none',
                background: 'var(--surface-2)',
                borderRadius: 8,
                width: 32,
                height: 32,
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                color: 'var(--text-2)',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--surface-hover)';
                e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--surface-2)';
                e.currentTarget.style.color = 'var(--text-2)';
              }}
            >
              <CollapseLeftIcon size={14} color="currentColor" />
            </button>
            <TemplateIcon size={18} color="var(--accent)" />
            <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>模板管理</span>
            <span
              style={{
                minWidth: 22,
                height: 22,
                borderRadius: 6,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {templateCount}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {templateLoading && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-3)',
                  display: 'flex',
                  gap: 4,
                  alignItems: 'center',
                }}
              >
                <SyncIcon size={11} color="var(--text-3)" />
                同步中…
              </span>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={templateLoading}
              style={{
                appearance: 'none',
                border: '1px solid var(--border-subtle)',
                background: 'var(--surface)',
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-2)',
                cursor: templateLoading ? 'not-allowed' : 'pointer',
                opacity: templateLoading ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s',
              }}
            >
              <SyncIcon size={11} color="currentColor" />
              刷新
            </button>
            {canCreateTemplate && editorMode === 'idle' && (
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setEditorMode('create');
                }}
                style={{
                  appearance: 'none',
                  border: '1px solid var(--accent)',
                  background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                  borderRadius: 8,
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'all 0.15s',
                }}
              >
                <PlusIcon size={11} color="currentColor" />
                新建
              </button>
            )}
          </div>
        </header>

        {/* Dual-panel content */}
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', overflow: 'hidden' }}>
          {/* Left panel: template list */}
          <div
            style={{
              borderRight: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
              display: 'grid',
              gridTemplateRows: '1fr auto',
              overflow: 'hidden',
            }}
          >
            <div style={{ overflow: 'auto', padding: '8px' }}>
              {/* Error */}
              {templateError && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid color-mix(in oklch, var(--danger) 35%, transparent)',
                    background: 'color-mix(in oklch, var(--danger) 8%, transparent)',
                    color: 'var(--danger)',
                    fontSize: 10,
                    lineHeight: 1.5,
                    marginBottom: 8,
                  }}
                >
                  {templateError}
                </div>
              )}

              {/* Loading */}
              {templateLoading && (
                <div style={{ display: 'grid', gap: 6, padding: '8px 0' }}>
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        height: 48,
                        borderRadius: 8,
                        background: 'var(--surface-2)',
                        opacity: 0.5,
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Empty */}
              {!templateLoading && templateCount === 0 && !templateError && (
                <div
                  style={{
                    display: 'grid',
                    gap: 8,
                    placeItems: 'center',
                    textAlign: 'center',
                    padding: '24px 12px',
                  }}
                >
                  <TemplateIcon size={28} color="var(--text-3)" />
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>暂无模板</span>
                </div>
              )}

              {/* Template list */}
              {!templateLoading &&
                templates.map((template) => (
                  <TemplateListItem
                    key={template.id}
                    template={template}
                    selected={selectedId === template.id && editorMode !== 'create'}
                    onSelect={() => {
                      setSelectedId(template.id);
                      setEditorMode('idle');
                    }}
                  />
                ))}
            </div>

            {/* Bottom create button */}
            {canCreateTemplate && (
              <div style={{ padding: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setEditorMode('create');
                  }}
                  style={{
                    width: '100%',
                    minHeight: 36,
                    borderRadius: 8,
                    border: '1px dashed color-mix(in oklch, var(--accent) 40%, transparent)',
                    color: 'var(--accent)',
                    background: 'color-mix(in oklch, var(--accent) 4%, transparent)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      'color-mix(in oklch, var(--accent) 10%, transparent)';
                    e.currentTarget.style.borderColor = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      'color-mix(in oklch, var(--accent) 4%, transparent)';
                    e.currentTarget.style.borderColor =
                      'color-mix(in oklch, var(--accent) 40%, transparent)';
                  }}
                >
                  <PlusIcon size={13} color="currentColor" />
                  组建新模板
                </button>
              </div>
            )}
          </div>

          {/* Right panel: detail / editor */}
          <div style={{ overflow: 'auto', background: 'var(--bg)' }}>{rightPanel}</div>
        </div>
      </div>

      {/* Delete confirmation overlay */}
      {confirmDeleteId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
          }}
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 12,
              padding: '20px 24px',
              display: 'grid',
              gap: 12,
              maxWidth: 360,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>确认删除</span>
            <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
              删除后无法恢复，确定要删除此模板吗？
            </span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-3)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(confirmDeleteId)}
                disabled={templateBusy}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklch, var(--danger) 50%, transparent)',
                  background: 'color-mix(in oklch, var(--danger) 12%, transparent)',
                  color: 'var(--danger)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: templateBusy ? 'not-allowed' : 'pointer',
                  opacity: templateBusy ? 0.5 : 1,
                }}
              >
                {templateBusy ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
