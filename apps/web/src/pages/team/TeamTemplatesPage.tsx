import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { UpdateWorkflowTemplateInput, WorkflowTemplateRecord } from '@openAwork/web-client';
import { useTeamWorkflowTemplates } from './runtime/hooks/use-team-workflow-templates.js';
import { SHELL_BACKGROUND } from './runtime/shared/team-runtime-shared.js';
import { agentTeamsNewTemplateProviders } from './runtime/data/team-runtime-ui-config.js';
import {
  ROLE_COLOR_MAP,
  type EditorMode,
  type EditorState,
  type RoleBindingEdit,
  REQUIRED_TEMPLATE_ROLES,
} from './runtime/tabs/governance/template-editor-shared.js';
import {
  TemplateEditor,
  editorStateToTemplateData,
} from './runtime/tabs/governance/TemplateEditorPanel.js';
import { TemplateDetailView } from './runtime/tabs/governance/TemplateDetailView.js';
import {
  PlusIcon,
  TemplateIcon,
  SyncIcon,
  CollapseLeftIcon,
} from './runtime/shared/TeamIcons.js';

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
    color: ROLE_COLOR_MAP[n.label.split(' · ')[0]?.trim() ?? ''] ?? 'var(--chart-5, var(--chart-5, #c4b5fd))',
  }));

  return (
    <button
      type="button"
      onClick={onSelect}
      className="ui-hover-surface"
      data-active={selected || undefined}
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
        width: '100%',
        boxSizing: 'border-box' as const,
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

/* ── Helper: extract editor state from template ───────────────────────── */

function templateToEditorState(t: WorkflowTemplateRecord): EditorState {
  const team = t.metadata?.teamTemplate;
  const roleBindings: Record<string, RoleBindingEdit> = {};
  if (team?.defaultBindings) {
    for (const role of REQUIRED_TEMPLATE_ROLES) {
      const raw = team.defaultBindings[role];
      if (typeof raw === 'object' && raw !== null) {
        roleBindings[role] = {
          providerId: raw.providerId ?? '',
          modelId: raw.modelId ?? '',
          variant: raw.variant ?? '',
        };
      }
    }
  }
  return {
    name: t.name,
    description: t.description ?? '',
    provider: team?.defaultProvider ?? agentTeamsNewTemplateProviders[0]?.value ?? '',
    optionalAgentIds: new Set(team?.optionalAgentIds ?? []),
    scale: team?.templateScale ?? 'medium',
    focus: team?.templateFocus ?? '',
    recommendedFor: team?.recommendedFor ?? '',
    isRecommendedDefault: team?.recommendedDefault ?? false,
    roleBindings,
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
  roleBindings: {},
};

/* ── Main page ────────────────────────────────────────────────────────── */

export default function TeamTemplatesPage() {
  const navigate = useNavigate();
  const {
    canCreateTemplate,
    createTemplate,
    duplicateTemplate,
    removeTemplate,
    updateTemplate,
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
      const data = editorStateToTemplateData(state);
      const ok = await createTemplate({
        name: data.name,
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
      const data = editorStateToTemplateData(state);
      const input: UpdateWorkflowTemplateInput = {
        name: data.name,
        description: data.description,
        metadata: data.metadata,
      };
      const ok = await updateTemplate(selectedRaw.id, input);
      if (ok) setEditorMode('idle');
      return ok;
    },
    [selectedRaw, updateTemplate],
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

    if (selectedCard && selectedRaw) {
      return (
        <TemplateDetailView
          template={selectedCard}
          rawTemplate={selectedRaw}
          onEdit={() => setEditorMode('edit')}
          onDuplicate={() => void handleDuplicate(selectedRaw)}
          onDelete={() => setConfirmDeleteId(selectedCard.id)}
          onUpdate={(input) => updateTemplate(selectedRaw.id, input)}
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
              className="ui-hover-text-bg"
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
                  className="ui-hover-accent-soft"
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
