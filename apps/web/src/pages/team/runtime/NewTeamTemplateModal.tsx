import { useState, useCallback } from 'react';
import {
  agentTeamsNewTemplateRoles,
  agentTeamsNewTemplateProviders,
} from './team-runtime-reference-mock.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { XIcon, CheckIcon } from './TeamIcons.js';

export function NewTeamTemplateModal({ onClose }: { onClose: () => void }) {
  const { createTemplate, templateError, templateLoading } = useTeamRuntimeReferenceViewData();
  const [templateName, setTemplateName] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState('claude-code');
  const [created, setCreated] = useState(false);

  const toggleRole = (value: string) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const isValid = templateName.trim().length > 0 && selectedRoles.size > 0;

  const handleCreate = useCallback(() => {
    if (!isValid) return;
    void createTemplate({
      name: templateName.trim(),
      provider,
      roleValues: Array.from(selectedRoles),
    }).then((succeeded) => {
      if (!succeeded) {
        return;
      }
      setCreated(true);
      window.setTimeout(onClose, 1200);
    });
  }, [createTemplate, isValid, onClose, provider, selectedRoles, templateName]);

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
              {!templateName.trim() && (
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
                选择角色
              </span>
              <div id="team-template-roles" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {agentTeamsNewTemplateRoles.map((role) => {
                  const selected = selectedRoles.has(role.value);
                  return (
                    <button
                      key={role.value}
                      type="button"
                      onClick={() => toggleRole(role.value)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 999,
                        border: selected
                          ? `1px solid ${role.color}`
                          : '1px solid var(--border-subtle)',
                        background: selected ? `${role.color}18` : 'var(--surface-2)',
                        color: selected ? role.color : 'var(--text-3)',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {role.label}
                    </button>
                  );
                })}
              </div>
              {selectedRoles.size === 0 && (
                <span style={{ fontSize: 9, color: 'var(--warning)', paddingLeft: 4 }}>
                  请至少选择一个角色
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
                默认 Provider
              </span>
              <div id="team-template-provider" style={{ display: 'flex', gap: 6 }}>
                {agentTeamsNewTemplateProviders.map((p) => {
                  const active = provider === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setProvider(p.value)}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: active
                          ? '1px solid color-mix(in oklch, var(--success) 60%, transparent)'
                          : '1px solid var(--border-subtle)',
                        background: active
                          ? 'color-mix(in oklch, var(--success) 10%, var(--bg))'
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
