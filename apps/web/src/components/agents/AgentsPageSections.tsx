import React from 'react';
import { formatCanonicalRole } from '@openAwork/shared';
import type { CoreRole, ManagedAgentRecord, RolePreset } from '@openAwork/shared';

export type AgentStatusFilter = 'all' | 'enabled' | 'disabled';
export type EditorMode = 'create' | 'edit';

export interface AgentEditorState {
  label: string;
  description: string;
  aliasesText: string;
  coreRole: '' | CoreRole;
  preset: '' | RolePreset;
  model: string;
  variant: string;
  fallbackModelsText: string;
  systemPrompt: string;
  note: string;
  enabled: boolean;
}

export const CORE_ROLE_OPTIONS: CoreRole[] = [
  'general',
  'researcher',
  'planner',
  'executor',
  'reviewer',
];

export const PRESET_OPTIONS: RolePreset[] = [
  'default',
  'explore',
  'analyst',
  'librarian',
  'architect',
  'debugger',
  'critic',
  'code-review',
  'test',
  'verifier',
];

const CORE_ROLE_LABELS: Record<CoreRole, string> = {
  general: '通用',
  researcher: '研究',
  planner: '规划',
  executor: '执行',
  reviewer: '评审',
};

const PRESET_LABELS: Record<RolePreset, string> = {
  default: '默认',
  explore: '探索',
  analyst: '分析',
  librarian: '资料检索',
  architect: '架构',
  debugger: '调试',
  critic: '挑刺',
  'code-review': '代码审查',
  test: '测试',
  verifier: '验收',
};

const SOURCE_LABELS: Record<ManagedAgentRecord['source'], string> = {
  builtin: '内置',
  installed: '已安装',
  configured: '已配置',
  runtime: '运行时',
  reference: '内置',
  custom: '自定义',
};

const ORIGIN_LABELS: Record<ManagedAgentRecord['origin'], string> = {
  builtin: '内置',
  custom: '自定义',
};

const BUILTIN_AGENT_DESCRIPTION_ZH: Record<string, string> = {
  build: '默认主智能体，负责统筹执行与结果交付。',
  plan: '规划智能体，负责拆解任务与安排执行顺序。',
  general: '通用智能体，适合未细分场景下的基础处理。',
  explore: '代码探索智能体，用于检索仓库结构、模式与实现线索。',
  sisyphus: '插件层执行智能体，用于协调插件相关执行流程。',
  hephaestus: '深度工程智能体，负责高强度实现、修复与交付。',
  prometheus: '战略规划智能体，用于大型任务的策略与阶段设计。',
  oracle: '只读顾问智能体，用于架构评审、设计权衡与谨慎复核。',
  librarian: '资料检索智能体，用于搜索外部文档、示例与参考实现。',
  metis: '预规划分析智能体，用于澄清需求与界定范围。',
  momus: '计划/质量审阅智能体，用于挑战方案、找出风险与漏洞。',
  atlas: '验收协调智能体，用于确认完成度与证据闭环。',
  'multimodal-looker': '多模态查看智能体，用于提取图片、界面等视觉输入信息。',
  'sisyphus-junior': '轻量执行智能体，用于快速完成分类明确的任务。',
};

export function localizeAgentDescription(agent: ManagedAgentRecord): string {
  if (agent.origin === 'builtin') {
    return BUILTIN_AGENT_DESCRIPTION_ZH[agent.id] ?? agent.description;
  }
  return agent.description;
}

export function formatCanonicalRoleZh(agent: ManagedAgentRecord): string | undefined {
  if (!agent.canonicalRole) {
    return undefined;
  }
  const core = CORE_ROLE_LABELS[agent.canonicalRole.coreRole] ?? agent.canonicalRole.coreRole;
  const preset = agent.canonicalRole.preset
    ? (PRESET_LABELS[agent.canonicalRole.preset] ?? agent.canonicalRole.preset)
    : undefined;
  return preset ? `${core} / ${preset}` : core;
}

export function emptyEditorState(): AgentEditorState {
  return {
    label: '',
    description: '',
    aliasesText: '',
    coreRole: '',
    preset: '',
    model: '',
    variant: '',
    fallbackModelsText: '',
    systemPrompt: '',
    note: '',
    enabled: true,
  };
}

export function toEditorState(agent: ManagedAgentRecord | null): AgentEditorState {
  if (!agent) {
    return emptyEditorState();
  }

  return {
    label: agent.label,
    description: agent.description,
    aliasesText: agent.aliases.join(', '),
    coreRole: agent.canonicalRole?.coreRole ?? '',
    preset: agent.canonicalRole?.preset ?? '',
    model: agent.model ?? '',
    variant: agent.variant ?? '',
    fallbackModelsText: (agent.fallbackModels ?? []).join(', '),
    systemPrompt: agent.systemPrompt ?? '',
    note: agent.note ?? '',
    enabled: agent.enabled,
  };
}

export function parseAliases(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

const PANEL: React.CSSProperties = {
  borderRadius: 22,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-md)',
};

const HEADER_PANEL: React.CSSProperties = {
  ...PANEL,
  background:
    'linear-gradient(180deg, color-mix(in oklab, var(--header-bg) 84%, var(--surface) 16%), var(--surface))',
};

const HERO_PANEL: React.CSSProperties = {
  ...HEADER_PANEL,
  overflow: 'hidden',
  position: 'relative',
};

function AgentAvatar({ label, origin }: { label: string; origin: ManagedAgentRecord['origin'] }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background:
          origin === 'custom'
            ? 'linear-gradient(180deg, var(--accent) 0%, var(--accent-hover) 100%)'
            : 'linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%)',
        color: origin === 'custom' ? 'var(--accent-text)' : 'var(--text)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

function Tag({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'accent' | 'warning' | 'success';
}) {
  const styles: Record<typeof tone, React.CSSProperties> = {
    default: {
      background: 'color-mix(in oklab, var(--surface) 80%, var(--bg-2) 20%)',
      color: 'var(--text-2)',
    },
    accent: {
      background: 'rgba(99, 102, 241, 0.16)',
      color: '#a5b4fc',
    },
    warning: {
      background: 'rgba(251, 191, 36, 0.14)',
      color: '#fcd34d',
    },
    success: {
      background: 'rgba(16, 185, 129, 0.16)',
      color: '#86efac',
    },
  };

  return (
    <span
      style={{
        borderRadius: 999,
        padding: '4px 8px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0,
        ...styles[tone],
      }}
    >
      {children}
    </span>
  );
}

function fieldStyle(): React.CSSProperties {
  return {
    width: '100%',
    borderRadius: 14,
    border: '1px solid var(--border-subtle)',
    background: 'color-mix(in oklab, var(--surface) 86%, var(--bg-2) 14%)',
    color: 'var(--text)',
    padding: '11px 12px',
    fontSize: 13,
    outline: 'none',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  };
}

function labelStyle(): React.CSSProperties {
  return {
    display: 'grid',
    gap: 8,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-2)',
  };
}

function stateStyle(): React.CSSProperties {
  return {
    minHeight: 240,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-3)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 1.7,
    padding: 24,
  };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    border: 'none',
    borderRadius: 14,
    background: disabled
      ? 'rgba(99, 102, 241, 0.35)'
      : 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
    color: '#fff',
    padding: '11px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: disabled ? 'none' : '0 10px 24px rgba(79, 70, 229, 0.22)',
  };
}

function secondaryButtonStyle(disabled = false): React.CSSProperties {
  return {
    border: '1px solid var(--border-subtle)',
    borderRadius: 14,
    background: 'color-mix(in oklab, var(--surface) 88%, var(--bg-2) 12%)',
    color: disabled ? 'var(--text-3)' : 'var(--text-2)',
    padding: '11px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.72 : 1,
  };
}

function dangerButtonStyle(disabled = false): React.CSSProperties {
  return {
    border: '1px solid rgba(248, 113, 113, 0.35)',
    borderRadius: 14,
    background: disabled ? 'rgba(127, 29, 29, 0.06)' : 'rgba(127, 29, 29, 0.12)',
    color: disabled ? 'rgba(252, 165, 165, 0.65)' : '#fca5a5',
    padding: '11px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.72 : 1,
  };
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        ...PANEL,
        padding: '14px 16px',
        background:
          'linear-gradient(180deg, color-mix(in oklab, var(--surface) 88%, var(--bg-2) 12%), var(--surface))',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

export function AgentsHero({
  summary,
  saving,
  onCreate,
  onResetAll,
}: {
  summary: { total: number; enabled: number; disabled: number; custom: number };
  saving: boolean;
  onCreate: () => void;
  onResetAll: () => void;
}) {
  return (
    <section style={{ ...HERO_PANEL, padding: 18, display: 'grid', gap: 16 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at top right, color-mix(in oklab, var(--accent) 24%, transparent 76%), transparent 42%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: 8, maxWidth: 680 }}>
          <span className="page-title">Agent 管理</span>
          <div style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.7 }}>
            统一查看全部 Agent
            的定义、状态与能力来源，并执行新增、编辑、禁用、移除与恢复默认等实体管理操作。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <button
            type="button"
            onClick={onCreate}
            disabled={saving}
            style={primaryButtonStyle(saving)}
          >
            新增自定义 Agent
          </button>
          <button
            type="button"
            onClick={onResetAll}
            disabled={saving}
            style={secondaryButtonStyle(saving)}
          >
            全部恢复默认
          </button>
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        <StatCard label="全部 Agent" value={String(summary.total)} />
        <StatCard label="已启用" value={String(summary.enabled)} />
        <StatCard label="已禁用" value={String(summary.disabled)} />
        <StatCard label="自定义" value={String(summary.custom)} />
      </div>
    </section>
  );
}

export function AgentsFilters({
  isNarrow,
  query,
  sourceFilter,
  roleFilter,
  statusFilter,
  roleOptions,
  onQueryChange,
  onSourceFilterChange,
  onRoleFilterChange,
  onStatusFilterChange,
}: {
  isNarrow: boolean;
  query: string;
  sourceFilter: 'all' | ManagedAgentRecord['source'];
  roleFilter: 'all' | CoreRole;
  statusFilter: AgentStatusFilter;
  roleOptions: CoreRole[];
  onQueryChange: (value: string) => void;
  onSourceFilterChange: (value: 'all' | ManagedAgentRecord['source']) => void;
  onRoleFilterChange: (value: 'all' | CoreRole) => void;
  onStatusFilterChange: (value: AgentStatusFilter) => void;
}) {
  return (
    <section style={{ ...PANEL, padding: 16, display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>智能体目录</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            按类型、角色和启用状态筛选当前可管理实体。
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isNarrow ? '1fr' : 'minmax(220px, 1.6fr) repeat(3, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索 Agent 名称、别名、角色、说明或 system prompt…"
          style={fieldStyle()}
        />
        <select
          value={sourceFilter}
          onChange={(event) => onSourceFilterChange(event.target.value as typeof sourceFilter)}
          style={fieldStyle()}
        >
          <option value="all">全部来源</option>
          <option value="builtin">内置</option>
          <option value="custom">自定义</option>
        </select>
        <select
          value={roleFilter}
          onChange={(event) => onRoleFilterChange(event.target.value as typeof roleFilter)}
          style={fieldStyle()}
        >
          <option value="all">全部角色</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {CORE_ROLE_LABELS[role] ?? role}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value as AgentStatusFilter)}
          style={fieldStyle()}
        >
          <option value="all">全部状态</option>
          <option value="enabled">仅启用</option>
          <option value="disabled">仅禁用</option>
        </select>
      </div>
    </section>
  );
}

export function AgentsListPanel({
  loading,
  filteredAgents,
  editorMode,
  selectedAgentId,
  saving,
  onSelect,
}: {
  loading: boolean;
  filteredAgents: ManagedAgentRecord[];
  editorMode: EditorMode;
  selectedAgentId: string | null;
  saving: boolean;
  onSelect: (agentId: string) => void;
}) {
  return (
    <section style={{ ...HEADER_PANEL, padding: 12, minHeight: 560 }}>
      {loading ? (
        <div style={stateStyle()}>正在加载 Agent 列表…</div>
      ) : filteredAgents.length === 0 ? (
        <div style={stateStyle()}>没有匹配的 Agent。试试调整筛选条件或新增自定义 Agent。</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filteredAgents.map((agent) => {
            const active = editorMode === 'edit' && agent.id === selectedAgentId;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => onSelect(agent.id)}
                disabled={saving}
                style={{
                  textAlign: 'left',
                  borderRadius: 18,
                  border: active
                    ? '1px solid color-mix(in oklch, var(--accent) 56%, white 18%)'
                    : '1px solid var(--border-subtle)',
                  background: active
                    ? 'color-mix(in oklab, var(--accent-muted) 70%, var(--surface) 30%)'
                    : 'var(--surface)',
                  padding: '14px 16px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  display: 'grid',
                  gap: 10,
                  opacity: saving ? 0.72 : 1,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px minmax(0, 1fr)',
                    gap: 10,
                    alignItems: 'start',
                  }}
                >
                  <AgentAvatar label={agent.label} origin={agent.origin} />
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                        {agent.label}
                      </span>
                      <Tag>{agent.id}</Tag>
                      <Tag>{ORIGIN_LABELS[agent.origin]}</Tag>
                      <Tag>{SOURCE_LABELS[agent.source]}</Tag>
                      {agent.enabled ? (
                        <Tag tone="success">已启用</Tag>
                      ) : (
                        <Tag tone="warning">已禁用</Tag>
                      )}
                      {agent.hasOverrides && <Tag tone="accent">已修改</Tag>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                      {localizeAgentDescription(agent) || '暂无描述'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {agent.canonicalRole && (
                        <Tag tone="accent">
                          {formatCanonicalRoleZh(agent) ?? formatCanonicalRole(agent.canonicalRole)}
                        </Tag>
                      )}
                      {agent.model && <Tag tone="accent">默认模型 {agent.model}</Tag>}
                      {agent.variant && <Tag>variant {agent.variant}</Tag>}
                      {agent.aliases.slice(0, 4).map((alias) => (
                        <Tag key={alias}>{alias}</Tag>
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <h2 style={{ margin: 0, fontSize: 22, color: 'var(--text)' }}>{title}</h2>
      <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.7 }}>{subtitle}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '96px minmax(0, 1fr)',
        gap: 12,
        alignItems: 'start',
        padding: '10px 12px',
        borderRadius: 14,
        background: 'color-mix(in oklab, var(--surface) 88%, var(--bg-2) 12%)',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{value}</span>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 14,
        background: checked
          ? 'rgba(99, 102, 241, 0.08)'
          : 'color-mix(in oklab, var(--surface) 88%, var(--bg-2) 12%)',
        color: 'var(--text)',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'grid', gap: 4, textAlign: 'left' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{hint}</span>
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 44,
          height: 24,
          borderRadius: 999,
          background: checked ? '#6366f1' : 'rgba(148, 163, 184, 0.25)',
          display: 'inline-flex',
          alignItems: 'center',
          padding: 3,
          justifyContent: checked ? 'flex-end' : 'flex-start',
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 2px 6px rgba(15, 23, 42, 0.28)',
          }}
        />
      </span>
    </button>
  );
}

function AgentForm({
  state,
  setState,
}: {
  state: AgentEditorState;
  setState: React.Dispatch<React.SetStateAction<AgentEditorState>>;
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label style={labelStyle()}>
        名称
        <input
          value={state.label}
          onChange={(event) => setState((current) => ({ ...current, label: event.target.value }))}
          placeholder="例如：架构顾问"
          style={fieldStyle()}
        />
      </label>

      <label style={labelStyle()}>
        描述
        <textarea
          value={state.description}
          onChange={(event) =>
            setState((current) => ({ ...current, description: event.target.value }))
          }
          placeholder="描述这个 Agent 的用途与职责…"
          style={{ ...fieldStyle(), minHeight: 96, resize: 'vertical' }}
        />
      </label>

      <label style={labelStyle()}>
        别名（逗号分隔）
        <input
          value={state.aliasesText}
          onChange={(event) =>
            setState((current) => ({ ...current, aliasesText: event.target.value }))
          }
          placeholder="architect, reviewer, debugger"
          style={fieldStyle()}
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={labelStyle()}>
          核心角色
          <select
            value={state.coreRole}
            onChange={(event) =>
              setState((current) => ({ ...current, coreRole: event.target.value as '' | CoreRole }))
            }
            style={fieldStyle()}
          >
            <option value="">未设置</option>
            {CORE_ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {CORE_ROLE_LABELS[role] ?? role}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle()}>
          预设模式
          <select
            value={state.preset}
            onChange={(event) =>
              setState((current) => ({ ...current, preset: event.target.value as '' | RolePreset }))
            }
            style={fieldStyle()}
          >
            <option value="">未设置</option>
            {PRESET_OPTIONS.map((preset) => (
              <option key={preset} value={preset}>
                {PRESET_LABELS[preset] ?? preset}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        style={{
          borderRadius: 18,
          border: '1px solid color-mix(in oklab, var(--accent) 24%, var(--border-subtle) 76%)',
          background:
            'linear-gradient(180deg, color-mix(in oklab, var(--accent-muted) 32%, var(--surface) 68%), var(--surface))',
          padding: 14,
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>默认模型路由</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7 }}>
            为这个角色指定默认模型、variant 与 fallback 链。留空时，系统会回退到参考默认值。
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr', gap: 12 }}>
          <label style={labelStyle()}>
            默认模型
            <input
              value={state.model}
              onChange={(event) =>
                setState((current) => ({ ...current, model: event.target.value }))
              }
              placeholder="例如：openai/gpt-5.4 或 gpt-5.4"
              style={fieldStyle()}
            />
          </label>
          <label style={labelStyle()}>
            Variant
            <input
              value={state.variant}
              onChange={(event) =>
                setState((current) => ({ ...current, variant: event.target.value }))
              }
              placeholder="例如：high / medium / max"
              style={fieldStyle()}
            />
          </label>
        </div>
        <label style={labelStyle()}>
          Fallback 模型链（逗号分隔）
          <textarea
            value={state.fallbackModelsText}
            onChange={(event) =>
              setState((current) => ({ ...current, fallbackModelsText: event.target.value }))
            }
            placeholder="例如：claude-opus-4-6, gpt-5.4, kimi-k2.5"
            style={{ ...fieldStyle(), minHeight: 92, resize: 'vertical' }}
          />
        </label>
        {(state.model || state.variant || state.fallbackModelsText) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {state.model && <Tag tone="accent">默认 {state.model}</Tag>}
            {state.variant && <Tag>variant {state.variant}</Tag>}
            {parseAliases(state.fallbackModelsText).map((fallback) => (
              <Tag key={fallback}>fallback {fallback}</Tag>
            ))}
          </div>
        )}
      </div>

      <label style={labelStyle()}>
        系统提示词
        {!state.systemPrompt && (
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-3)' }}>
            当前内置智能体未提供独立提示词时，这里会保持为空。
          </span>
        )}
        <textarea
          value={state.systemPrompt}
          onChange={(event) =>
            setState((current) => ({ ...current, systemPrompt: event.target.value }))
          }
          placeholder="可选：记录该 Agent 的系统提示词或执行说明…"
          style={{ ...fieldStyle(), minHeight: 120, resize: 'vertical' }}
        />
      </label>

      <label style={labelStyle()}>
        备注
        <textarea
          value={state.note}
          onChange={(event) => setState((current) => ({ ...current, note: event.target.value }))}
          placeholder="记录这个 Agent 的使用注意事项…"
          style={{ ...fieldStyle(), minHeight: 96, resize: 'vertical' }}
        />
      </label>

      <ToggleRow
        label="启用智能体"
        hint="禁用后将从 /capabilities 能力目录中移除。"
        checked={state.enabled}
        onChange={() => setState((current) => ({ ...current, enabled: !current.enabled }))}
      />
    </div>
  );
}

export function AgentsEditorPanel({
  editorMode,
  selectedAgent,
  editorState,
  setEditorState,
  canSave,
  saving,
  saveMessage,
  onCreate,
  onCancelCreate,
  onSave,
  onToggleEnabled,
  onResetOne,
  onRemove,
}: {
  editorMode: EditorMode;
  selectedAgent: ManagedAgentRecord | null;
  editorState: AgentEditorState;
  setEditorState: React.Dispatch<React.SetStateAction<AgentEditorState>>;
  canSave: boolean;
  saving: boolean;
  saveMessage: string | null;
  onCreate: () => void;
  onCancelCreate: () => void;
  onSave: () => void;
  onToggleEnabled: () => void;
  onResetOne: () => void;
  onRemove: () => void;
}) {
  return (
    <section style={{ ...HEADER_PANEL, padding: 18, minHeight: 560, position: 'sticky', top: 16 }}>
      {editorMode === 'create' ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <PanelTitle
            title="新增自定义智能体"
            subtitle="创建一个新的自定义智能体，它会进入智能体目录并可被后续能力目录消费。"
          />
          <AgentForm state={editorState} setState={setEditorState} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onCreate}
              disabled={!canSave || saving}
              style={primaryButtonStyle(!canSave || saving)}
            >
              {saving ? '创建中…' : '创建 Agent'}
            </button>
            <button
              type="button"
              onClick={onCancelCreate}
              disabled={saving}
              style={secondaryButtonStyle(saving)}
            >
              取消
            </button>
          </div>
        </div>
      ) : !selectedAgent ? (
        <div style={stateStyle()}>从左侧选择智能体，或创建一个新的自定义智能体。</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <PanelTitle
            title={selectedAgent.label}
            subtitle={`编辑${selectedAgent.origin === 'builtin' ? '内置智能体覆盖项' : '自定义智能体'}实体。`}
          />
          <div style={{ display: 'grid', gap: 10 }}>
            <InfoRow label="智能体 ID" value={selectedAgent.id} />
            <InfoRow
              label="来源"
              value={`${ORIGIN_LABELS[selectedAgent.origin]} / ${SOURCE_LABELS[selectedAgent.source]}`}
            />
            <InfoRow label="状态" value={selectedAgent.enabled ? '已启用' : '已禁用'} />
            <InfoRow label="默认模型" value={selectedAgent.model ?? '未设置'} />
            <InfoRow label="Variant" value={selectedAgent.variant ?? '未设置'} />
            <InfoRow
              label="Fallback"
              value={
                selectedAgent.fallbackModels?.length
                  ? selectedAgent.fallbackModels.join(', ')
                  : '未设置'
              }
            />
            <InfoRow label="创建时间" value={selectedAgent.createdAt} />
          </div>
          <AgentForm state={editorState} setState={setEditorState} />
          {saveMessage && <div style={{ color: '#86efac', fontSize: 13 }}>{saveMessage}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave || saving}
              style={primaryButtonStyle(!canSave || saving)}
            >
              {saving ? '保存中…' : '保存 Agent 实体'}
            </button>
            <button
              type="button"
              onClick={onToggleEnabled}
              disabled={saving}
              style={secondaryButtonStyle(saving)}
            >
              {selectedAgent.enabled ? '禁用 Agent' : '启用 Agent'}
            </button>
            <button
              type="button"
              onClick={onResetOne}
              disabled={saving}
              style={secondaryButtonStyle(saving)}
            >
              恢复默认
            </button>
            {selectedAgent.removable && (
              <button
                type="button"
                onClick={onRemove}
                disabled={saving}
                style={dangerButtonStyle(saving)}
              >
                移除 Agent
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
