import { useState, useMemo } from 'react';
import type { WorkflowTemplateScale } from '@openAwork/web-client';
import { FIXED_TEAM_CORE_ROLE_BINDINGS, type TeamCoreRole } from '@openAwork/shared';
import { useTeamRuntimeRoleBindings } from '../../hooks/use-team-runtime-role-bindings.js';
import { agentTeamsNewTemplateProviders } from '../../data/team-runtime-ui-config.js';
import {
  ROLE_COLOR_MAP,
  BUILTIN_AGENT_LABELS,
  REQUIRED_TEMPLATE_ROLES,
  ROLE_LABELS,
  SCALE_OPTIONS,
  VARIANT_OPTIONS,
  fieldLabelStyle,
  inputStyle,
  pillButtonStyle,
  type EditorMode,
  type EditorState,
  type RoleBindingEdit,
} from './template-editor-shared.js';
import { CheckIcon, XIcon, TrashIcon, CodeIcon } from '../../shared/TeamIcons.js';

/* ── Template editor panel ─────────────────────────────────────────────── */

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
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(editorStateToTemplateData(initialState), null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

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

  const updateRoleBinding = (role: string, field: keyof RoleBindingEdit, value: string) => {
    setState((prev) => {
      const existing = prev.roleBindings[role] ?? { providerId: '', modelId: '', variant: '' };
      const updated: RoleBindingEdit = { ...existing, [field]: value };
      return {
        ...prev,
        roleBindings: { ...prev.roleBindings, [role]: updated },
      };
    });
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

  const handleJsonApply = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const restored = templateDataToEditorState(parsed);
      setState(restored);
      setJsonError(null);
      setJsonMode(false);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'JSON 格式错误');
    }
  };

  const handleSwitchToJson = () => {
    setJsonText(JSON.stringify(editorStateToTemplateData(state), null, 2));
    setJsonError(null);
    setJsonMode(true);
  };

  return (
    <div style={{ display: 'grid', gap: 14, padding: '16px 20px', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{title}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            onClick={jsonMode ? handleJsonApply : handleSwitchToJson}
            style={{
              appearance: 'none',
              border: jsonMode
                ? '1px solid color-mix(in oklch, var(--warning) 40%, transparent)'
                : '1px solid var(--border-subtle)',
              background: jsonMode
                ? 'color-mix(in oklch, var(--warning) 8%, transparent)'
                : 'var(--surface-2)',
              color: jsonMode ? 'var(--warning)' : 'var(--text-3)',
              borderRadius: 6,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <CodeIcon size={10} color="currentColor" />
            {jsonMode ? '应用 JSON' : 'JSON 编辑'}
          </button>
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
      </div>

      {jsonMode ? (
        /* JSON 编辑模式 */
        <div style={{ display: 'grid', gap: 6 }}>
          <textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            spellCheck={false}
            style={{
              ...inputStyle(),
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: 1.5,
              minHeight: 400,
              resize: 'vertical' as const,
            }}
          />
          {jsonError && <span style={{ fontSize: 9, color: 'var(--danger)' }}>{jsonError}</span>}
          <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
            直接编辑 JSON 数据，点击「应用 JSON」将修改应用到表单
          </span>
        </div>
      ) : (
        <>
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

          {/* Core roles with per-role provider/model/variant */}
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={fieldLabelStyle}>核心角色配置</label>
            {fixedRoleCards.map((roleCard) => {
              const roleLabel = ROLE_LABELS[roleCard.role] ?? roleCard.roleLabel;
              const color = ROLE_COLOR_MAP[roleLabel] ?? 'var(--accent)';
              const binding = state.roleBindings[roleCard.role] ?? {
                providerId: '',
                modelId: '',
                variant: '',
              };
              const isExpanded = binding.providerId || binding.modelId || binding.variant;
              return (
                <div
                  key={roleCard.role}
                  style={{
                    display: 'grid',
                    gap: 6,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid color-mix(in oklch, ${color} 25%, transparent)`,
                    background: `color-mix(in oklch, ${color} 4%, var(--bg))`,
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: 8,
                      alignItems: 'center',
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
                  {/* Per-role provider / model / variant */}
                  <div
                    style={{
                      display: isExpanded ? 'grid' : 'none',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 6,
                      paddingTop: 4,
                      borderTop: `1px solid color-mix(in oklch, ${color} 12%, transparent)`,
                    }}
                  >
                    <div style={{ display: 'grid', gap: 3 }}>
                      <label
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          color: 'var(--text-3)',
                          textTransform: 'uppercase' as const,
                        }}
                      >
                        Provider
                      </label>
                      <select
                        value={binding.providerId}
                        onChange={(e) =>
                          updateRoleBinding(roleCard.role, 'providerId', e.target.value)
                        }
                        style={{
                          ...inputStyle(),
                          padding: '4px 8px',
                          fontSize: 11,
                        }}
                      >
                        <option value="">默认</option>
                        {agentTeamsNewTemplateProviders.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'grid', gap: 3 }}>
                      <label
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          color: 'var(--text-3)',
                          textTransform: 'uppercase' as const,
                        }}
                      >
                        Model
                      </label>
                      <input
                        type="text"
                        placeholder="默认模型"
                        value={binding.modelId}
                        onChange={(e) =>
                          updateRoleBinding(roleCard.role, 'modelId', e.target.value)
                        }
                        style={{ ...inputStyle(), padding: '4px 8px', fontSize: 11 }}
                      />
                    </div>
                    <div style={{ display: 'grid', gap: 3 }}>
                      <label
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          color: 'var(--text-3)',
                          textTransform: 'uppercase' as const,
                        }}
                      >
                        Thinking
                      </label>
                      <select
                        value={binding.variant}
                        onChange={(e) =>
                          updateRoleBinding(roleCard.role, 'variant', e.target.value)
                        }
                        style={{
                          ...inputStyle(),
                          padding: '4px 8px',
                          fontSize: 11,
                        }}
                      >
                        <option value="">默认</option>
                        {VARIANT_OPTIONS.map((v) => (
                          <option key={v.value} value={v.value}>
                            {v.label} — {v.hint}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
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
                  style={pillButtonStyle(state.optionalAgentIds.has(agentId), 'var(--warning, var(--warning, #f0b429))')}
                >
                  {label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
              增援角色会在核心流水线之外提供额外能力
            </span>
          </div>
        </>
      )}

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

/* ── Helpers: EditorState ↔ template data ─────────────────────────────── */

function editorStateToTemplateData(state: EditorState) {
  const defaultBindings: Record<string, RoleBindingEdit> = {};
  for (const role of REQUIRED_TEMPLATE_ROLES) {
    const binding = state.roleBindings[role];
    if (binding && (binding.providerId || binding.modelId || binding.variant)) {
      defaultBindings[role] = binding;
    }
  }
  return {
    name: state.name,
    description: state.description || null,
    metadata: {
      teamTemplate: {
        defaultBindings: Object.keys(defaultBindings).length > 0 ? defaultBindings : undefined,
        defaultProvider: state.provider || null,
        optionalAgentIds: Array.from(state.optionalAgentIds),
        templateScale: state.scale,
        templateFocus: state.focus || null,
        recommendedFor: state.recommendedFor || null,
        recommendedDefault: state.isRecommendedDefault || null,
      },
    },
  };
}

function templateDataToEditorState(data: {
  name?: string;
  description?: string | null;
  metadata?: {
    teamTemplate?: {
      defaultBindings?: Record<string, RoleBindingEdit>;
      defaultProvider?: string | null;
      optionalAgentIds?: string[];
      templateScale?: WorkflowTemplateScale;
      templateFocus?: string | null;
      recommendedFor?: string | null;
      recommendedDefault?: boolean | null;
    };
  };
}): EditorState {
  const team = data.metadata?.teamTemplate;
  const roleBindings: Record<string, RoleBindingEdit> = {};
  if (team?.defaultBindings) {
    for (const role of REQUIRED_TEMPLATE_ROLES) {
      const b = team.defaultBindings[role];
      if (b) {
        roleBindings[role] = {
          providerId: b.providerId ?? '',
          modelId: b.modelId ?? '',
          variant: b.variant ?? '',
        };
      }
    }
  }
  return {
    name: data.name ?? '',
    description: data.description ?? '',
    provider: team?.defaultProvider ?? agentTeamsNewTemplateProviders[0]?.value ?? '',
    optionalAgentIds: new Set(team?.optionalAgentIds ?? []),
    scale: team?.templateScale ?? 'medium',
    focus: team?.templateFocus ?? '',
    recommendedFor: team?.recommendedFor ?? '',
    isRecommendedDefault: team?.recommendedDefault ?? false,
    roleBindings,
  };
}

export { TemplateEditor, editorStateToTemplateData, templateDataToEditorState };
