import { useMemo, useState } from 'react';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { useTeamRuntimeRoleBindings } from './use-team-runtime-role-bindings.js';
import { useTeamSessionCreation } from './use-team-session-creation.js';
import {
  REQUIRED_CORE_ROLES,
  type TeamSessionCreationDraft,
} from './team-session-creation.types.js';
import { CheckIcon, ChevronRightIcon, XIcon } from './TeamIcons.js';

interface NewTeamSessionModalProps {
  onClose: () => void;
  onSubmitDraft: (draft: TeamSessionCreationDraft) => void | Promise<void>;
  workspaceLabel: string;
  teamWorkspaceId: string;
}

const STEP_LABELS = {
  'optional-members': '额外成员',
  'required-roles': '核心角色',
  review: '确认',
  source: '来源',
} as const;

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

  const availableOptionalAgents = useMemo(() => {
    const requiredAgentIds = new Set(
      Object.values(creation.draft.requiredRoleBindings).filter((value): value is string =>
        Boolean(value),
      ),
    );

    return roleBindings.agents.filter((agent) => agent.enabled && !requiredAgentIds.has(agent.id));
  }, [creation.draft.requiredRoleBindings, roleBindings.agents]);

  const agentLabelById = useMemo(
    () => new Map(roleBindings.agents.map((agent) => [agent.id, agent.label])),
    [roleBindings.agents],
  );

  const handleSubmit = async () => {
    if (!creation.canSubmit || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmitDraft(creation.draft);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

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
        aria-label="关闭创建会话弹窗"
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, border: 'none', background: 'transparent' }}
      />
      <div
        style={{
          position: 'relative',
          width: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          borderRadius: 16,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 64px oklch(0 0 0 / 0.4)',
          padding: 22,
          display: 'grid',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
              新建团队会话
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              当前工作区：{workspaceLabel}
            </span>
          </div>
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

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {creation.steps.map((step, index) => {
            const active = creation.step === step;
            return (
              <span
                key={step}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: active ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                  background: active
                    ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                    : 'var(--surface-2)',
                  fontSize: 11,
                  fontWeight: 700,
                  color: active ? 'var(--accent)' : 'var(--text-3)',
                }}
              >
                <span>{index + 1}</span>
                <span>{STEP_LABELS[step]}</span>
              </span>
            );
          })}
        </div>

        {creation.step === 'source' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>来源</span>
            <button
              type="button"
              onClick={() => creation.setSource({ kind: 'blank' })}
              style={{
                display: 'grid',
                gap: 6,
                textAlign: 'left',
                padding: '14px 16px',
                borderRadius: 12,
                border: '1px solid var(--accent)',
                background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 800 }}>空白团队</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                使用系统预置的 4 个核心角色，再按需加入额外 agent 成员。
              </span>
            </button>
            <div style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 700 }}>
                已保存模板
              </span>
              {templateLoading ? (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>正在加载模板…</span>
              ) : templates.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  暂无可用模板，当前可直接使用空白团队流程。
                </span>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {templates.map((template) => {
                    const selected =
                      creation.draft.source.kind === 'saved-template' &&
                      creation.draft.source.templateId === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => creation.applyTemplate(template)}
                        style={{
                          display: 'grid',
                          gap: 6,
                          textAlign: 'left',
                          padding: '14px 16px',
                          borderRadius: 12,
                          border: selected
                            ? '1px solid var(--accent)'
                            : '1px solid var(--border-subtle)',
                          background: selected
                            ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                            : 'var(--surface-2)',
                          color: 'var(--text)',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 800 }}>{template.name}</span>
                        {template.badges && template.badges.length > 0 ? (
                          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {template.badges.map((badge) => (
                              <span
                                key={`${template.id}-${badge.label}`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  minHeight: 18,
                                  padding: '0 8px',
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
                                  fontSize: 10,
                                  fontWeight: 700,
                                }}
                              >
                                {badge.label}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                          {template.description ?? '已保存的团队模板'}
                        </span>
                        {template.metaLine ? (
                          <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                            {template.metaLine}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {creation.step === 'required-roles' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <label htmlFor="new-team-session-title" style={{ fontSize: 12, fontWeight: 700 }}>
                会话标题
              </label>
              <input
                id="new-team-session-title"
                value={creation.draft.title}
                onChange={(event) => creation.setTitle(event.target.value)}
                placeholder="例如：研究团队 2026-04-16"
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: creation.fieldErrors.title
                    ? '1px solid var(--warning)'
                    : '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                }}
              />
              {creation.fieldErrors.title ? (
                <span style={{ fontSize: 11, color: 'var(--warning)' }}>
                  {creation.fieldErrors.title}
                </span>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              {REQUIRED_CORE_ROLES.map((role) => {
                const card = roleBindings.roleCards.find((item) => item.role === role) ?? null;
                return (
                  <div
                    key={role}
                    style={{
                      display: 'grid',
                      gap: 6,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid color-mix(in oklch, var(--accent) 30%, transparent)',
                      background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{card?.roleLabel ?? role}</span>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>
                      {card?.selectedAgent?.label ??
                        creation.draft.requiredRoleBindings[role] ??
                        '系统预置'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      该核心角色使用系统固定 agent，用户不可修改。
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {creation.step === 'optional-members' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>额外成员</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {availableOptionalAgents.map((agent) => {
                const selected = creation.draft.optionalAgentIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => creation.toggleOptionalAgent(agent.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 12px',
                      borderRadius: 999,
                      border: selected
                        ? '1px solid var(--accent)'
                        : '1px solid var(--border-subtle)',
                      background: selected
                        ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                        : 'var(--surface-2)',
                      color: selected ? 'var(--accent)' : 'var(--text-2)',
                      cursor: 'pointer',
                    }}
                  >
                    {selected ? <CheckIcon size={12} color="var(--accent)" /> : null}
                    {agent.label}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              可为空。额外成员不会替代 4 个核心角色。
            </span>
          </div>
        ) : null}

        {creation.step === 'review' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>确认配置</span>
            <div
              style={{
                display: 'grid',
                gap: 8,
                padding: '12px 14px',
                borderRadius: 12,
                background: 'var(--surface-2)',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                标题：{creation.draft.title}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>工作区：{workspaceLabel}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                核心角色：
                {REQUIRED_CORE_ROLES.map((role) => {
                  const agentId = creation.draft.requiredRoleBindings[role] ?? '未绑定';
                  return ` ${role}:${agentId}`;
                }).join(' | ')}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                额外成员：
                {creation.draft.optionalAgentIds.length > 0
                  ? creation.draft.optionalAgentIds
                      .map((agentId) => agentLabelById.get(agentId) ?? agentId)
                      .join('、')
                  : '未选择'}
              </span>
            </div>
          </div>
        ) : null}

        {roleBindings.error ? (
          <div style={{ fontSize: 11, color: 'var(--danger)' }}>{roleBindings.error}</div>
        ) : null}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={creation.prevStep}
            disabled={creation.currentStepIndex === 0}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              cursor: creation.currentStepIndex === 0 ? 'not-allowed' : 'pointer',
              opacity: creation.currentStepIndex === 0 ? 0.5 : 1,
            }}
          >
            上一步
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {creation.step !== 'review' ? (
              <button
                type="button"
                onClick={creation.nextStep}
                disabled={!creation.canAdvance}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  cursor: creation.canAdvance ? 'pointer' : 'not-allowed',
                  opacity: creation.canAdvance ? 1 : 0.55,
                }}
              >
                下一步
                <ChevronRightIcon size={11} color="var(--accent-text)" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!creation.canSubmit || submitting}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  cursor: creation.canSubmit && !submitting ? 'pointer' : 'not-allowed',
                  opacity: creation.canSubmit && !submitting ? 1 : 0.55,
                }}
              >
                {submitting ? '提交中…' : '确认创建'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
