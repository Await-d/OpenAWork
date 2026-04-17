import { useCallback, useMemo, useState } from 'react';
import { FIXED_TEAM_CORE_ROLE_BINDINGS, type TeamCoreRole } from '@openAwork/shared';
import { useTeamRuntimeRoleBindings } from './use-team-runtime-role-bindings.js';
import { agentTeamsNewTemplateProviders } from './team-runtime-ui-config.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { XIcon, CheckIcon } from './TeamIcons.js';

const REQUIRED_TEMPLATE_ROLES = [
  'leader',
  'planner',
  'researcher',
  'executor',
  'reviewer',
] as const;

const VARIANT_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'minimal', label: '极低', hint: '几乎不推理' },
  { value: 'low', label: '低', hint: '轻度推理' },
  { value: 'medium', label: '中', hint: '标准推理' },
  { value: 'high', label: '高', hint: '深度推理' },
  { value: 'xhigh', label: '极高', hint: '最大推理' },
];

export function NewTeamTemplateModal({ onClose }: { onClose: () => void }) {
  const { createTemplate, templateError, templateLoading } = useTeamRuntimeReferenceViewData();
  const roleBindings = useTeamRuntimeRoleBindings();
  const [templateName, setTemplateName] = useState('');
  const [selectedOptionalAgents, setSelectedOptionalAgents] = useState<Set<string>>(new Set());
  const [roleProviders, setRoleProviders] = useState<Record<string, string>>({});
  const [roleVariants, setRoleVariants] = useState<Record<string, string>>({});
  const [roleModelIds, setRoleModelIds] = useState<Record<string, string>>({});
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
      roleBindings.roleCards.filter((roleCard) =>
        REQUIRED_TEMPLATE_ROLES.includes(roleCard.role as (typeof REQUIRED_TEMPLATE_ROLES)[number]),
      ),
    [roleBindings.roleCards],
  );

  const hasValidTemplateName = templateName.trim().length > 0;
  const hasCompleteDefaultBindings = fixedRoleCards.length === REQUIRED_TEMPLATE_ROLES.length;
  const isValid = hasValidTemplateName && hasCompleteDefaultBindings;

  const handleCreate = useCallback(() => {
    if (!isValid) return;
    const defaultBindings: Record<
      string,
      { agentId: string; providerId?: string; modelId?: string; variant?: string }
    > = {};
    for (const roleCard of fixedRoleCards) {
      const providerId = roleProviders[roleCard.role];
      const providerOption = agentTeamsNewTemplateProviders.find((p) => p.value === providerId);
      const customModelId = roleModelIds[roleCard.role]?.trim();
      const customVariant = roleVariants[roleCard.role];
      defaultBindings[roleCard.role] = {
        agentId:
          roleCard.selectedAgent?.id ??
          FIXED_TEAM_CORE_ROLE_BINDINGS[roleCard.role as TeamCoreRole],
        ...(providerId ? { providerId } : {}),
        modelId: customModelId || providerOption?.modelId,
        variant: customVariant || providerOption?.variant || undefined,
      };
    }
    void createTemplate({
      name: templateName.trim(),
      optionalAgentIds: Array.from(selectedOptionalAgents),
      provider: Object.values(roleProviders)[0] ?? 'anthropic',
      defaultBindings,
    }).then((succeeded) => {
      if (!succeeded) {
        return;
      }
      setCreated(true);
      window.setTimeout(onClose, 1200);
    });
  }, [
    createTemplate,
    fixedRoleCards,
    isValid,
    onClose,
    roleModelIds,
    roleProviders,
    roleVariants,
    selectedOptionalAgents,
    templateName,
  ]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'grid',
        placeItems: 'center',
        background: 'oklch(0 0 0 / 0.6)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <button
        type="button"
        aria-label="关闭模板弹窗"
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, border: 'none', background: 'transparent' }}
      />
      <div
        style={{
          position: 'relative',
          width: 440,
          maxHeight: '90vh',
          overflow: 'auto',
          borderRadius: 12,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 64px oklch(0 0 0 / 0.4)',
          padding: 20,
          display: 'grid',
          gap: 14,
          transition: 'opacity 0.3s',
          opacity: created ? 0.7 : 1,
        }}
      >
        {created ? (
          <div style={{ display: 'grid', gap: 10, placeItems: 'center', padding: '16px 0' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'color-mix(in oklch, var(--success) 14%, transparent)',
              }}
            >
              <CheckIcon size={22} color="var(--success)" />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
              模板创建成功
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              「{templateName}」已加入模板库
            </span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
                新建团队模板
              </span>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-3)',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'inline-flex',
                }}
              >
                <XIcon size={14} color="var(--text-3)" />
              </button>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <label
                htmlFor="team-template-name-input"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                模板名称
              </label>
              <input
                id="team-template-name-input"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="例如：研究团队"
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: templateName.trim()
                    ? '1px solid color-mix(in oklch, var(--success) 40%, transparent)'
                    : '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 13,
                  outline: 'none',
                  transition: 'border-color 0.15s',
                }}
              />
              {!hasValidTemplateName && (
                <span style={{ fontSize: 9, color: 'var(--warning)', paddingLeft: 4 }}>
                  请输入模板名称
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                核心角色 · 供应商 / 模型 / 思考等级
              </span>
              <div id="team-template-roles" style={{ display: 'grid', gap: 10 }}>
                {fixedRoleCards.map((roleCard) => {
                  const currentProvider = roleProviders[roleCard.role] ?? '';
                  return (
                    <div
                      key={roleCard.role}
                      style={{
                        display: 'grid',
                        gap: 6,
                        fontSize: 12,
                        color: 'var(--text-2)',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid color-mix(in oklch, var(--success) 40%, transparent)',
                        background: 'color-mix(in oklch, var(--success) 8%, var(--bg))',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>{roleCard.roleLabel}</span>
                        <span style={{ color: 'var(--text)', fontSize: 11 }}>
                          {roleCard.selectedAgent?.label ??
                            FIXED_TEAM_CORE_ROLE_BINDINGS[roleCard.role as TeamCoreRole]}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {agentTeamsNewTemplateProviders.map((p) => {
                          const active = currentProvider === p.value;
                          return (
                            <button
                              key={p.value}
                              type="button"
                              onClick={() =>
                                setRoleProviders((prev) => ({
                                  ...prev,
                                  [roleCard.role]: active ? '' : p.value,
                                }))
                              }
                              style={{
                                padding: '3px 8px',
                                borderRadius: 6,
                                border: active
                                  ? '1px solid color-mix(in oklch, var(--success) 60%, transparent)'
                                  : '1px solid var(--border-subtle)',
                                background: active
                                  ? 'color-mix(in oklch, var(--success) 10%, var(--bg))'
                                  : 'var(--surface-2)',
                                color: active ? 'var(--success)' : 'var(--text-3)',
                                fontSize: 10,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                              }}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                      {currentProvider && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 9, color: 'var(--text-3)', minWidth: 32 }}>
                              模型
                            </span>
                            <input
                              value={
                                roleModelIds[roleCard.role] ??
                                agentTeamsNewTemplateProviders.find(
                                  (p) => p.value === currentProvider,
                                )?.modelId ??
                                ''
                              }
                              onChange={(e) =>
                                setRoleModelIds((prev) => ({
                                  ...prev,
                                  [roleCard.role]: e.target.value,
                                }))
                              }
                              placeholder="默认模型"
                              style={{
                                flex: 1,
                                padding: '3px 8px',
                                borderRadius: 6,
                                border: '1px solid var(--border-subtle)',
                                background: 'var(--bg)',
                                color: 'var(--text)',
                                fontSize: 10,
                                outline: 'none',
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 9, color: 'var(--text-3)', minWidth: 32 }}>
                              思考
                            </span>
                            <div style={{ display: 'flex', gap: 3 }}>
                              {VARIANT_OPTIONS.map((opt) => {
                                const currentVariant =
                                  roleVariants[roleCard.role] ??
                                  agentTeamsNewTemplateProviders.find(
                                    (p) => p.value === currentProvider,
                                  )?.variant ??
                                  '';
                                const active = currentVariant === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    title={opt.hint}
                                    onClick={() =>
                                      setRoleVariants((prev) => ({
                                        ...prev,
                                        [roleCard.role]: active ? '' : opt.value,
                                      }))
                                    }
                                    style={{
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      border: active
                                        ? '1px solid color-mix(in oklch, var(--accent) 60%, transparent)'
                                        : '1px solid var(--border-subtle)',
                                      background: active
                                        ? 'color-mix(in oklch, var(--accent) 10%, var(--bg))'
                                        : 'var(--surface-2)',
                                      color: active ? 'var(--accent)' : 'var(--text-3)',
                                      fontSize: 9,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      transition: 'all 0.15s',
                                    }}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {!hasCompleteDefaultBindings && (
                <span style={{ fontSize: 9, color: 'var(--warning)', paddingLeft: 4 }}>
                  正在加载系统默认核心角色绑定…
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                额外成员（可选）
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['atlas'].map((agentId) => {
                  const active = selectedOptionalAgents.has(agentId);
                  return (
                    <button
                      key={agentId}
                      type="button"
                      onClick={() => toggleOptionalAgent(agentId)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 999,
                        border: active
                          ? '1px solid color-mix(in oklch, var(--success) 60%, transparent)'
                          : '1px solid var(--border-subtle)',
                        background: active
                          ? 'color-mix(in oklch, var(--success) 10%, var(--bg))'
                          : 'var(--surface-2)',
                        color: active ? 'var(--success)' : 'var(--text-3)',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {agentId}
                    </button>
                  );
                })}
              </div>
            </div>

            {templateError ? (
              <div
                style={{
                  padding: '8px 10px',
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
            ) : null}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 6 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-3)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.color = 'var(--text-2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.color = 'var(--text-3)';
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={templateLoading || !isValid}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklch, var(--success) 48%, transparent)',
                  background: 'color-mix(in oklch, var(--success) 12%, var(--bg))',
                  color: 'var(--success)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: templateLoading || !isValid ? 'not-allowed' : 'pointer',
                  opacity: templateLoading || !isValid ? 1 : 0.5,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (isValid && !templateLoading) {
                    e.currentTarget.style.background =
                      'color-mix(in oklch, var(--success) 18%, var(--bg))';
                  }
                }}
                onMouseLeave={(e) => {
                  if (isValid && !templateLoading) {
                    e.currentTarget.style.background =
                      'color-mix(in oklch, var(--success) 12%, var(--bg))';
                  }
                }}
              >
                <CheckIcon size={12} color="currentColor" />{' '}
                {templateLoading ? '创建中…' : '创建模板'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
