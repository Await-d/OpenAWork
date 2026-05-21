import { useState, useCallback } from 'react';
import type {
  UpdateWorkflowTemplateInput,
  WorkflowTemplateRecord,
  WorkflowNodeRecord,
  WorkflowEdgeRecord,
  WorkflowTemplateMetadata,
  WorkflowTemplateScale,
} from '@openAwork/web-client';
import { agentTeamsNewTemplateProviders } from '../../data/team-runtime-ui-config.js';
import {
  ROLE_COLOR_MAP,
  BUILTIN_AGENT_LABELS,
  SCALE_OPTIONS,
  fieldLabelStyle,
  pillButtonStyle,
} from './template-editor-shared.js';
import { TrashIcon, EditIcon, CopyIcon } from '../../shared/TeamIcons.js';

interface TemplateCard {
  id: string;
  name: string;
  description: string | null;
  category: string;
  metadata?: WorkflowTemplateMetadata;
  nodes: WorkflowNodeRecord[];
  edges: WorkflowEdgeRecord[];
  createdAt?: string;
  updatedAt?: string;
}

/* ── Inline editable field ─────────────────────────────────────────────── */

function InlineField({
  label,
  value,
  onSave,
  type = 'text',
  options,
}: {
  label: string;
  value: string;
  onSave: (val: string) => void;
  type?: 'text' | 'select';
  options?: Array<{ value: string; label: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleConfirm = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        <span style={fieldLabelStyle}>{label}</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {type === 'select' && options ? (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-base)',
                color: 'var(--fg-strong)',
                fontSize: 11,
                flex: 1,
              }}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') handleCancel();
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--accent)',
                background: 'var(--bg-base)',
                color: 'var(--fg-strong)',
                fontSize: 11,
                flex: 1,
                outline: 'none',
              }}
              autoFocus
            />
          )}
          <button
            type="button"
            onClick={handleConfirm}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'color-mix(in oklch, var(--success) 12%, transparent)',
              color: 'var(--success)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 9,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ✓
          </button>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'var(--bg-surface)',
              color: 'var(--fg-muted)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 9,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}
      onClick={() => setEditing(true)}
      title="点击编辑"
    >
      <span style={fieldLabelStyle}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--fg-default)' }}>{value || '—'}</span>
      <span style={{ fontSize: 8, color: 'var(--fg-muted)', opacity: 0.6 }}>✎</span>
    </div>
  );
}

/* ── Template detail view ──────────────────────────────────────────────── */

function TemplateDetailView({
  template,
  rawTemplate,
  onEdit,
  onDuplicate,
  onDelete,
  onUpdate,
}: {
  template: TemplateCard;
  rawTemplate: WorkflowTemplateRecord;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUpdate: (input: UpdateWorkflowTemplateInput) => Promise<boolean>;
}) {
  const subagentNodes = template.nodes.filter((n) => n.type === 'subagent');
  const teamTemplate = template.metadata?.teamTemplate;
  const optionalAgents = (teamTemplate?.optionalAgentIds ?? []).map(
    (id) => BUILTIN_AGENT_LABELS[id] ?? id,
  );

  const handleFieldUpdate = useCallback(
    async (field: string, value: string) => {
      if (field === 'name') {
        await onUpdate({ name: value });
      } else if (field === 'description') {
        await onUpdate({ description: value });
      } else if (field === 'provider') {
        await onUpdate({
          metadata: { teamTemplate: { defaultProvider: value || null } },
        });
      } else if (field === 'scale') {
        await onUpdate({
          metadata: { teamTemplate: { templateScale: value as WorkflowTemplateScale } },
        });
      } else if (field === 'focus') {
        await onUpdate({
          metadata: { teamTemplate: { templateFocus: value || null } },
        });
      } else if (field === 'recommendedFor') {
        await onUpdate({
          metadata: { teamTemplate: { recommendedFor: value || null } },
        });
      }
    },
    [onUpdate],
  );

  return (
    <div style={{ display: 'grid', gap: 14, padding: '16px 20px', overflow: 'auto' }}>
      {/* Header with actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
          {template.name}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={onDuplicate}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--fg-default)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <CopyIcon size={9} color="currentColor" />
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
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <EditIcon size={9} color="currentColor" />
            编辑
          </button>
        </div>
      </div>

      {/* Inline editable fields */}
      <InlineField
        label="名称"
        value={template.name}
        onSave={(v) => void handleFieldUpdate('name', v)}
      />
      <InlineField
        label="描述"
        value={template.description ?? ''}
        onSave={(v) => void handleFieldUpdate('description', v)}
      />
      <InlineField
        label="Provider"
        value={teamTemplate?.defaultProvider ?? ''}
        onSave={(v) => void handleFieldUpdate('provider', v)}
        type="select"
        options={[
          { value: '', label: '默认' },
          ...agentTeamsNewTemplateProviders.map((p) => ({
            value: p.value,
            label: p.label,
          })),
        ]}
      />
      <InlineField
        label="规模"
        value={teamTemplate?.templateScale ?? ''}
        onSave={(v) => void handleFieldUpdate('scale', v)}
        type="select"
        options={[
          { value: '', label: '默认' },
          ...SCALE_OPTIONS.map((s) => ({ value: s.value, label: s.label })),
        ]}
      />
      <InlineField
        label="重点"
        value={teamTemplate?.templateFocus ?? ''}
        onSave={(v) => void handleFieldUpdate('focus', v)}
      />
      <InlineField
        label="适用"
        value={teamTemplate?.recommendedFor ?? ''}
        onSave={(v) => void handleFieldUpdate('recommendedFor', v)}
      />

      {/* Metadata badges */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {teamTemplate?.recommendedDefault && (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
              color: 'var(--chart-5)',
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
                background: `color-mix(in oklch, ${color} 4%, var(--bg-base))`,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
                {roleLabel}
              </span>
              {providerLabel && (
                <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{providerLabel}</span>
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
              <span key={label} style={pillButtonStyle(true, 'var(--warning)')}>
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
                  color: 'var(--fg-muted)',
                }}
              >
                {i > 0 && <span style={{ margin: '0 2px' }}>→</span>}
                <span style={{ color: 'var(--fg-default)' }}>
                  {sourceNode?.label.split(' · ')[0] ?? edge.source}
                </span>
                <span>→</span>
                <span style={{ color: 'var(--fg-default)' }}>
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
          color: 'var(--fg-muted)',
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

export { TemplateDetailView };
