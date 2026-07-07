import { useState, useCallback, useMemo } from 'react';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { PANEL_STYLE } from '../../shared/team-runtime-shared.js';
import { ChevronDownIcon, PlusIcon, TemplateIcon, SyncIcon } from '../../shared/TeamIcons.js';
import { TabContainer } from '../TabContainer.js';
import { NewTeamTemplateModal } from '../../shell/modals/NewTeamTemplateModal.js';
import { TemplateDetailView } from './TemplateDetailView.js';
import {
  TemplateEditor,
  templateDataToEditorState,
  editorStateToTemplateData,
} from './TemplateEditorPanel.js';
import { TeamGovernanceWorkbenchHeader } from './TeamGovernanceWorkbenchHeader.js';
import type { WorkflowTemplateRecord, UpdateWorkflowTemplateInput } from '@openAwork/web-client';

function getBadgeToneStyle(tone: string | undefined): { background: string; color: string } {
  switch (tone) {
    case 'accent':
      return {
        background: 'color-mix(in srgb, var(--accent) 14%, var(--bg-overlay))',
        color: 'var(--accent)',
      };
    case 'success':
      return {
        background: 'color-mix(in srgb, var(--success) 14%, var(--bg-overlay))',
        color: 'var(--success)',
      };
    case 'warning':
      return {
        background: 'color-mix(in srgb, var(--warning) 16%, var(--bg-overlay))',
        color: 'var(--warning)',
      };
    default:
      return {
        background: 'var(--bg-surface)',
        color: 'var(--fg-default)',
      };
  }
}

function TemplateCard({
  template,
  onUse,
  canUse,
  onSelect,
  selected,
}: {
  template: ReturnType<typeof useTeamRuntimeReferenceViewData>['templates'][number];
  onUse: (templateId: string) => void;
  canUse: boolean;
  onSelect: (templateId: string) => void;
  selected: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const badges = template.badges ?? [];
  const roleTags = template.nodes
    .filter((node) => node.type === 'subagent')
    .map((node) => ({
      label: node.label.split(' · ')[0]?.trim() ?? node.label,
      color: node.label.includes('负责人')
        ? 'var(--warning)'
        : node.label.includes('研究员')
          ? 'var(--accent)'
          : node.label.includes('执行者')
            ? 'var(--aux)'
            : node.label.includes('批评者')
              ? 'var(--danger)'
              : 'var(--chart-5)',
    }));

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
        borderColor: selected ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : undefined,
        boxShadow: selected
          ? '0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent)'
          : undefined,
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => {
          onSelect(template.id);
          setExpanded((prev) => !prev);
        }}
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
          <ChevronDownIcon size={11} color="var(--fg-muted)" />
        </span>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-strong)' }}>
            {template.name}
          </span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {badges.map((badge) => {
              const toneStyle = getBadgeToneStyle(badge.tone);
              return (
                <span
                  key={badge.label}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    minHeight: 16,
                    padding: '0 6px',
                    borderRadius: 999,
                    background: toneStyle.background,
                    color: toneStyle.color,
                    fontSize: 9,
                    fontWeight: 700,
                  }}
                >
                  {badge.label}
                </span>
              );
            })}
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
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
          {template.nodes.length} 节点 · {template.edges.length} 边
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
            <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.6 }}>
              {template.description}
            </span>
          )}
          {template.metaLine && (
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              {template.metaLine}
            </span>
          )}

          {/* Node list */}
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-default)' }}>
              工作流节点
            </span>
            {template.nodes.map((node) => (
              <div
                key={node.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-overlay)',
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background:
                      node.type === 'start'
                        ? 'var(--success)'
                        : node.type === 'end'
                          ? 'var(--fg-muted)'
                          : 'var(--accent)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: 'var(--fg-strong)', fontWeight: 600 }}>{node.label}</span>
                <span style={{ color: 'var(--fg-muted)', fontSize: 9 }}>{node.type}</span>
              </div>
            ))}
          </div>

          {/* Action */}
          <button
            type="button"
            disabled={!canUse}
            onClick={canUse ? () => onUse(template.id) : undefined}
            style={{
              minHeight: 32,
              borderRadius: 8,
              border: 'none',
              background: canUse ? 'var(--accent)' : 'var(--bg-surface)',
              color: canUse ? 'var(--fg-on-accent)' : 'var(--fg-muted)',
              fontSize: 12,
              fontWeight: 600,
              cursor: canUse ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              opacity: canUse ? 1 : 0.6,
              transition: 'opacity 0.15s, filter 0.15s',
            }}
          >
            <PlusIcon size={12} color="currentColor" />
            使用此模板创建会话
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Main TemplatesTab ────────────────────────────────────────────────── */

export function TemplatesTab({ onUseTemplate }: { onUseTemplate: (templateId: string) => void }) {
  const {
    canCreateSession,
    canCreateTemplate,
    duplicateTemplate,
    busy,
    removeTemplate,
    templateCount,
    templateError,
    templateLoading,
    templates,
    updateTemplate,
  } = useTeamRuntimeReferenceViewData();

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showCreateTemplateModal, setShowCreateTemplateModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<'idle' | 'edit'>('idle');

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Group templates by category
  const sections = new Map<string, typeof templates>();
  for (const t of templates) {
    const key = t.category || 'team-playbook';
    const list = sections.get(key) ?? [];
    list.push(t);
    sections.set(key, list);
  }

  const categoryLabel = (id: string) =>
    id === 'team-playbook' ? '团队模板' : id.replace(/[-_]/g, ' ');

  const roleBindingCount = templates.reduce(
    (count, template) =>
      count +
      template.nodes.filter((node) => node.type === 'subagent' || node.type === 'tool').length,
    0,
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  const selectedTemplateEditorState = useMemo(() => {
    if (!selectedTemplate) {
      return null;
    }
    const teamTemplate = selectedTemplate.metadata?.teamTemplate;
    const defaultBindings = teamTemplate?.defaultBindings ?? {};
    const normalizedBindings = Object.fromEntries(
      Object.entries(defaultBindings).map(([role, binding]) => [
        role,
        typeof binding === 'string'
          ? { agentId: binding, providerId: '', modelId: '', variant: '' }
          : {
              agentId: binding.agentId ?? '',
              providerId: binding.providerId ?? '',
              modelId: binding.modelId ?? '',
              variant: binding.variant ?? '',
            },
      ]),
    );
    return templateDataToEditorState({
      name: selectedTemplate.name,
      description: selectedTemplate.description,
      metadata: {
        teamTemplate: {
          defaultBindings: normalizedBindings,
          defaultProvider: teamTemplate?.defaultProvider ?? null,
          optionalAgentIds: teamTemplate?.optionalAgentIds ?? [],
          ...(teamTemplate?.templateScale ? { templateScale: teamTemplate.templateScale } : {}),
          templateFocus: teamTemplate?.templateFocus ?? null,
          recommendedFor: teamTemplate?.recommendedFor ?? null,
          recommendedDefault: teamTemplate?.recommendedDefault ?? null,
        },
      },
    });
  }, [selectedTemplate]);

  const handleSaveTemplate = useCallback(
    async (state: ReturnType<typeof templateDataToEditorState>) => {
      if (!selectedTemplate) {
        return false;
      }
      const templateData = editorStateToTemplateData(state);
      const input: UpdateWorkflowTemplateInput = {
        name: templateData.name,
        description: templateData.description,
        metadata: templateData.metadata,
      };
      const ok = await updateTemplate(selectedTemplate.id, input);
      if (ok) {
        setEditorMode('idle');
      }
      return ok;
    },
    [selectedTemplate, updateTemplate],
  );

  return (
    <TabContainer
      title="模板管理"
      subtitle="持久化团队模板，团队成员可复用同一工作流配置快速启动新会话。"
      actions={
        <>
          <span
            style={{
              minWidth: 22,
              height: 22,
              padding: '0 6px',
              borderRadius: 6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-surface)',
              color: 'var(--fg-default)',
              fontSize: 11,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {templateCount}
          </span>
          {templateLoading ? (
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-muted)',
                display: 'inline-flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              <SyncIcon size={11} color="var(--fg-muted)" />
              同步中…
            </span>
          ) : null}
        </>
      }
    >
      <div
        style={{
          display: 'grid',
          gap: 10,
          alignContent: 'start',
          gridTemplateColumns: selectedTemplate ? 'minmax(320px, 1fr) minmax(360px, 440px)' : '1fr',
        }}
      >
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <TeamGovernanceWorkbenchHeader
            area="templates"
            eyebrow="Governance · Templates"
            title="治理工作台摘要"
            description="把团队模板、默认角色和启动权限放在同一首屏，先判断能不能复用，再进入模板细节。"
            metrics={[
              {
                label: '模板总数',
                value: templateCount,
                detail: `${sections.size} 个分类`,
                tone: 'accent',
              },
              {
                label: '角色节点',
                value: roleBindingCount,
                detail: '模板内可绑定执行位',
                tone: roleBindingCount > 0 ? 'aux' : 'muted',
              },
              {
                label: '创建会话',
                value: canCreateSession ? '可用' : '受限',
                detail: canCreateSession ? '可直接用模板启动' : '只能查看模板配置',
                tone: canCreateSession ? 'success' : 'warning',
              },
              {
                label: '模板维护',
                value: canCreateTemplate ? '可写' : '只读',
                detail: canCreateTemplate ? '允许编辑和新建' : '保留只读查看',
                tone: canCreateTemplate ? 'success' : 'warning',
              },
            ]}
            signals={[
              {
                label: '同步状态',
                value: templateLoading ? '同步中' : '已就绪',
                tone: templateLoading ? 'warning' : 'success',
              },
              {
                label: '当前选择',
                value: selectedTemplate?.name ?? '未选择',
                tone: selectedTemplate ? 'accent' : 'muted',
              },
            ]}
          />

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
                padding: '24px 20px',
                borderRadius: 10,
                display: 'grid',
                gap: 10,
                placeItems: 'center',
                textAlign: 'center',
              }}
            >
              <TemplateIcon size={28} color="var(--fg-muted)" />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-default)' }}>
                暂无团队模板
              </span>
              <span
                style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.6, maxWidth: 360 }}
              >
                创建一个持久化团队模板后，所有团队成员可复用同一工作流配置，快速启动新的协作会话。
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
                  color: 'var(--fg-muted)',
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
                  <ChevronDownIcon size={11} color="var(--fg-muted)" />
                </span>
                <span style={{ color: 'var(--fg-default)' }}>{categoryLabel(sectionId)}</span>
                <span
                  style={{
                    minWidth: 18,
                    height: 18,
                    borderRadius: 6,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--bg-surface)',
                    color: 'var(--fg-default)',
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
                    <TemplateCard
                      key={template.id}
                      template={template}
                      canUse={canCreateSession}
                      onUse={onUseTemplate}
                      onSelect={(templateId) => {
                        setSelectedTemplateId((current) =>
                          current === templateId && editorMode === 'idle' ? null : templateId,
                        );
                        setEditorMode('idle');
                      }}
                      selected={selectedTemplateId === template.id}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}

          {canCreateTemplate ? (
            <button
              type="button"
              onClick={() => setShowCreateTemplateModal(true)}
              className="team-dashed-add"
              style={{
                minHeight: 36,
                borderRadius: 10,
                border: '1px dashed color-mix(in oklch, var(--border-default) 40%, transparent)',
                color: 'var(--fg-muted)',
                background: 'var(--bg-overlay)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              新建团队模板
            </button>
          ) : null}
        </div>

        {selectedTemplate ? (
          <div
            style={{
              ...PANEL_STYLE,
              padding: 0,
              borderRadius: 12,
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            {editorMode === 'edit' ? (
              <TemplateEditor
                mode="edit"
                initialState={selectedTemplateEditorState!}
                busy={busy}
                onSave={handleSaveTemplate}
                onDelete={async () => {
                  const ok = await removeTemplate(selectedTemplate.id);
                  if (ok) {
                    setSelectedTemplateId(null);
                    setEditorMode('idle');
                  }
                }}
                onDuplicate={async () => {
                  const ok = await duplicateTemplate(selectedTemplate);
                  if (ok) {
                    setEditorMode('idle');
                  }
                }}
                onCancel={() => setEditorMode('idle')}
              />
            ) : (
              <TemplateDetailView
                editable={canCreateTemplate}
                template={selectedTemplate}
                rawTemplate={selectedTemplate as WorkflowTemplateRecord}
                onEdit={() => setEditorMode('edit')}
                onDuplicate={async () => {
                  await duplicateTemplate(selectedTemplate);
                }}
                onDelete={async () => {
                  const ok = await removeTemplate(selectedTemplate.id);
                  if (ok) {
                    setSelectedTemplateId(null);
                  }
                }}
                onUpdate={async (input) => updateTemplate(selectedTemplate.id, input)}
              />
            )}
          </div>
        ) : null}
      </div>

      {showCreateTemplateModal ? (
        <NewTeamTemplateModal onClose={() => setShowCreateTemplateModal(false)} />
      ) : null}
    </TabContainer>
  );
}
