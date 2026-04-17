import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
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

/* ── Template detail card (inspect-only) ──────────────────────────────── */

function TemplateCard({
  template,
}: {
  template: ReturnType<typeof useTeamWorkflowTemplates>['templateCards'][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const badges = template.badges ?? [];
  const subagentNodes = template.nodes.filter((node) => node.type === 'subagent');
  const roleTags = subagentNodes.map((node) => ({
    label: node.label.split(' · ')[0]?.trim() ?? node.label,
    color: ROLE_COLOR_MAP[node.label.split(' · ')[0]?.trim() ?? ''] ?? '#7c52ff',
  }));
  const teamTemplate = template.metadata?.teamTemplate;
  const optionalAgents = (teamTemplate?.optionalAgentIds ?? []).map(
    (id) => BUILTIN_AGENT_LABELS[id] ?? id,
  );

  return (
    <div
      style={{
        ...PANEL_STYLE,
        padding: 0,
        borderRadius: 10,
        display: 'grid',
        gap: 0,
        overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          appearance: 'none',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          gap: 10,
          padding: '12px 14px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          alignItems: 'start',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            transition: 'transform 0.15s',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            marginTop: 2,
          }}
        >
          <ChevronDownIcon size={11} color="var(--text-3)" />
        </span>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {template.name}
          </span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {badges.map((badge) => (
              <span
                key={badge.label}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: 16,
                  padding: '0 6px',
                  borderRadius: 999,
                  background:
                    badge.tone === 'accent'
                      ? 'rgba(99, 102, 241, 0.14)'
                      : badge.tone === 'success'
                        ? 'rgba(16, 185, 129, 0.14)'
                        : badge.tone === 'warning'
                          ? 'rgba(245, 158, 11, 0.16)'
                          : 'var(--surface-3)',
                  color:
                    badge.tone === 'accent'
                      ? '#a5b4fc'
                      : badge.tone === 'success'
                        ? '#86efac'
                        : badge.tone === 'warning'
                          ? '#fcd34d'
                          : 'var(--text-2)',
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {badge.label}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {roleTags.map((tag) => (
              <span
                key={tag.label}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: 16,
                  padding: '0 6px',
                  borderRadius: 999,
                  background: `color-mix(in oklch, ${tag.color} 12%, transparent)`,
                  color: tag.color,
                  fontSize: 9,
                  fontWeight: 600,
                }}
              >
                {tag.label}
              </span>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
          {subagentNodes.length} 角色 · {template.edges.length} 连接
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            padding: '0 14px 14px',
            display: 'grid',
            gap: 10,
            borderTop: '1px solid var(--border-subtle)',
            marginTop: 0,
            paddingTop: 10,
          }}
        >
          {template.description && (
            <span style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
              {template.description}
            </span>
          )}
          {template.metaLine && (
            <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
              {template.metaLine}
            </span>
          )}

          {/* Provider */}
          {teamTemplate?.defaultProvider && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)' }}>
                默认 Provider
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                  color: 'var(--accent)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {agentTeamsNewTemplateProviders.find(
                  (p) => p.value === teamTemplate.defaultProvider,
                )?.label ?? teamTemplate.defaultProvider}
              </span>
            </div>
          )}

          {/* Role roster */}
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)' }}>角色配置</span>
            {subagentNodes.map((node) => {
              const parts = node.label.split(' · ');
              const roleLabel = parts[0]?.trim() ?? node.label;
              const providerLabel = parts[1]?.trim();
              return (
                <div
                  key={node.id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'var(--surface)',
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: ROLE_COLOR_MAP[roleLabel] ?? 'var(--accent)',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{roleLabel}</span>
                  {providerLabel && (
                    <span style={{ color: 'var(--text-3)', fontSize: 9 }}>{providerLabel}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Optional agents */}
          {optionalAgents.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)' }}>
                额外增援
              </span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {optionalAgents.map((label) => (
                  <span
                    key={label}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'color-mix(in oklch, var(--warning) 10%, transparent)',
                      color: '#f59e0b',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Edge flow */}
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)' }}>
              工作流连接
            </span>
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
        </div>
      )}
    </div>
  );
}

/* ── Template builder form ────────────────────────────────────────────── */

function TemplateBuilderForm({
  onCreate,
  busy,
}: {
  onCreate: (input: {
    name: string;
    provider: string;
    optionalAgentIds: string[];
  }) => Promise<boolean>;
  busy: boolean;
}) {
  const roleBindings = useTeamRuntimeRoleBindings();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState(agentTeamsNewTemplateProviders[0]?.value ?? '');
  const [selectedOptionalAgents, setSelectedOptionalAgents] = useState<Set<string>>(new Set());
  const [show, setShow] = useState(false);
  const [created, setCreated] = useState(false);

  const toggleOptionalAgent = (value: string) => {
    setSelectedOptionalAgents((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const fixedRoleCards = useMemo(
    () =>
      roleBindings.roleCards.filter((rc) =>
        REQUIRED_TEMPLATE_ROLES.includes(rc.role as (typeof REQUIRED_TEMPLATE_ROLES)[number]),
      ),
    [roleBindings.roleCards],
  );

  const hasValidName = name.trim().length > 0;
  const hasCompleteBindings = fixedRoleCards.length === REQUIRED_TEMPLATE_ROLES.length;
  const isValid = hasValidName && hasCompleteBindings;

  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        style={{
          minHeight: 40,
          borderRadius: 10,
          border: '1px dashed color-mix(in oklch, var(--accent) 40%, transparent)',
          color: 'var(--accent)',
          background: 'color-mix(in oklch, var(--accent) 6%, transparent)',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'color-mix(in oklch, var(--accent) 12%, transparent)';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'color-mix(in oklch, var(--accent) 6%, transparent)';
          e.currentTarget.style.borderColor = 'color-mix(in oklch, var(--accent) 40%, transparent)';
        }}
      >
        <PlusIcon size={14} color="currentColor" />
        组建新模板
      </button>
    );
  }

  if (created) {
    return (
      <div
        style={{
          ...PANEL_STYLE,
          padding: '20px 16px',
          borderRadius: 10,
          display: 'grid',
          gap: 8,
          placeItems: 'center',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'color-mix(in oklch, var(--success) 14%, transparent)',
          }}
        >
          <CheckIcon size={18} color="var(--success)" />
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>模板创建成功</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>「{name}」已加入模板库</span>
      </div>
    );
  }

  return (
    <div
      style={{
        ...PANEL_STYLE,
        padding: 0,
        borderRadius: 10,
        display: 'grid',
        gap: 0,
        overflow: 'hidden',
      }}
    >
      {/* Builder header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>组建新模板</span>
        <button
          type="button"
          onClick={() => setShow(false)}
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

      <div style={{ padding: '14px 16px', display: 'grid', gap: 14 }}>
        {/* Name */}
        <div style={{ display: 'grid', gap: 6 }}>
          <label
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            模板名称
          </label>
          <input
            type="text"
            placeholder="例如：代码审查流水线"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: hasValidName
                ? '1px solid color-mix(in oklch, var(--success) 40%, transparent)'
                : '1px solid var(--border-subtle)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 13,
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
          {!hasValidName && (
            <span style={{ fontSize: 9, color: 'var(--warning)', paddingLeft: 4 }}>
              请输入模板名称
            </span>
          )}
        </div>

        {/* Core roles (fixed) */}
        <div style={{ display: 'grid', gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            核心角色（系统固定）
          </span>
          <div style={{ display: 'grid', gap: 6 }}>
            {fixedRoleCards.map((roleCard) => {
              const roleLabel = ROLE_LABELS[roleCard.role] ?? roleCard.roleLabel;
              const color = ROLE_COLOR_MAP[roleLabel] ?? 'var(--accent)';
              return (
                <div
                  key={roleCard.role}
                  style={{
                    display: 'grid',
                    gap: 4,
                    fontSize: 12,
                    color: 'var(--text-2)',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid color-mix(in oklch, ${color} 30%, transparent)`,
                    background: `color-mix(in oklch, ${color} 6%, var(--bg))`,
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>{roleLabel}</span>
                  </div>
                  <span style={{ color: 'var(--text)', fontSize: 11 }}>
                    {roleCard.selectedAgent?.label ??
                      FIXED_TEAM_CORE_ROLE_BINDINGS[roleCard.role as TeamCoreRole]}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                    核心角色由系统固定绑定
                  </span>
                </div>
              );
            })}
          </div>
          {!hasCompleteBindings && (
            <span style={{ fontSize: 9, color: 'var(--warning)', paddingLeft: 4 }}>
              正在加载核心角色绑定…
            </span>
          )}
        </div>

        {/* Provider */}
        <div style={{ display: 'grid', gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            默认 Provider
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {agentTeamsNewTemplateProviders.map((p) => {
              const active = provider === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProvider(p.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: active
                      ? '1px solid color-mix(in oklch, var(--success) 50%, transparent)'
                      : '1px solid var(--border-subtle)',
                    background: active
                      ? 'color-mix(in oklch, var(--success) 8%, var(--bg))'
                      : 'var(--surface-2)',
                    color: active ? 'var(--success)' : 'var(--text-3)',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Optional agents */}
        <div style={{ display: 'grid', gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            额外增援（可选）
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(BUILTIN_AGENT_LABELS).map(([agentId, label]) => {
              const active = selectedOptionalAgents.has(agentId);
              return (
                <button
                  key={agentId}
                  type="button"
                  onClick={() => toggleOptionalAgent(agentId)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    border: active
                      ? '1px solid color-mix(in oklch, var(--warning) 50%, transparent)'
                      : '1px solid var(--border-subtle)',
                    background: active
                      ? 'color-mix(in oklch, var(--warning) 8%, var(--bg))'
                      : 'var(--surface-2)',
                    color: active ? '#f59e0b' : 'var(--text-3)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
            增援角色会在核心流水线之外提供额外能力
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button
            type="button"
            onClick={() => setShow(false)}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-3)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!isValid || busy}
            onClick={() => {
              void onCreate({
                name: name.trim(),
                provider,
                optionalAgentIds: Array.from(selectedOptionalAgents),
              }).then((succeeded) => {
                if (succeeded) setCreated(true);
              });
            }}
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
              transition: 'all 0.15s',
            }}
          >
            <CheckIcon size={12} color="currentColor" />
            {busy ? '创建中…' : '确认组建'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */

export default function TeamTemplatesPage() {
  const navigate = useNavigate();
  const {
    canCreateTemplate,
    createTemplate,
    templateCards: templates,
    templateCount,
    error: templateError,
    loading: templateLoading,
    busy: templateBusy,
    refresh,
  } = useTeamWorkflowTemplates();

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Group templates by display grouping
  const sections = useMemo(() => {
    const map = new Map<string, typeof templates>();
    for (const t of templates) {
      const key = t.groupId ?? 'ungrouped';
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [templates]);

  const categoryLabel = (id: string) =>
    templates.find((template) => template.groupId === id)?.groupTitle ?? '模板';

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
            padding: '14px 20px',
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
              onMouseEnter={(e) => {
                if (!templateLoading) {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.color = 'var(--accent)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.color = 'var(--text-2)';
              }}
            >
              <SyncIcon size={11} color="currentColor" />
              刷新
            </button>
          </div>
        </header>

        {/* Content */}
        <div
          style={{
            overflow: 'auto',
            padding: '20px 24px',
            background:
              'linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 96%, var(--bg)) 100%)',
          }}
        >
          <div
            style={{
              maxWidth: 960,
              margin: '0 auto',
              display: 'grid',
              gap: 14,
              alignContent: 'start',
            }}
          >
            {/* Error */}
            {templateError && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid color-mix(in oklch, var(--danger) 35%, transparent)',
                  background: 'color-mix(in oklch, var(--danger) 8%, transparent)',
                  color: 'var(--danger)',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {templateError}
              </div>
            )}

            {/* Empty state */}
            {!templateLoading && templateCount === 0 && !templateError && (
              <div
                style={{
                  ...PANEL_STYLE,
                  padding: '40px 24px',
                  borderRadius: 10,
                  display: 'grid',
                  gap: 12,
                  placeItems: 'center',
                  textAlign: 'center',
                }}
              >
                <TemplateIcon size={36} color="var(--text-3)" />
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-2)' }}>
                  暂无团队模板
                </span>
                <span
                  style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, maxWidth: 400 }}
                >
                  组建团队模板来定义角色配置和工作流结构，团队成员可复用同一配置快速启动协作。
                </span>
              </div>
            )}

            {/* Template sections grouped by category */}
            {Array.from(sections.entries()).map(([sectionId, items]) => (
              <section
                key={sectionId}
                style={{
                  ...PANEL_STYLE,
                  padding: 0,
                  borderRadius: 10,
                  display: 'grid',
                  gap: 0,
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleSection(sectionId)}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    color: 'var(--text-3)',
                    fontSize: 12,
                    fontWeight: 800,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '10px 14px',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      transition: 'transform 0.15s',
                      transform: collapsedSections.has(sectionId) ? 'rotate(-90deg)' : 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    <ChevronDownIcon size={11} color="var(--text-3)" />
                  </span>
                  <span style={{ color: 'var(--text-2)' }}>{categoryLabel(sectionId)}</span>
                  <span
                    style={{
                      minWidth: 18,
                      height: 18,
                      borderRadius: 6,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--surface-2)',
                      color: 'var(--text-2)',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {items.length}
                  </span>
                </button>

                {!collapsedSections.has(sectionId) && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                      gap: 8,
                      padding: '0 14px 14px',
                    }}
                  >
                    {items.map((template) => (
                      <TemplateCard key={template.id} template={template} />
                    ))}
                  </div>
                )}
              </section>
            ))}

            {/* Template builder */}
            {canCreateTemplate && (
              <TemplateBuilderForm
                onCreate={async (input) => {
                  return createTemplate(input);
                }}
                busy={templateBusy}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
