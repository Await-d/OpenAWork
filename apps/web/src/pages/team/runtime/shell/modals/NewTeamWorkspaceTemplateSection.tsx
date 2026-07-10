import type { CSSProperties } from 'react';
import type { ResourceTextCatalogEntry } from '@openAwork/web-client';
import { describeWorkspaceTemplateSource } from './new-team-workspace-agent-templates.js';
import { ERROR_STYLE, HINT_STYLE, LABEL_STYLE } from './new-team-workspace-modal-config.js';

const TEMPLATE_SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-2)',
  padding: 'var(--spacing-3)',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-raised) 78%, transparent)',
};

const TEMPLATE_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 'var(--spacing-2)',
};

const TEMPLATE_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-1)',
  minHeight: 88,
  padding: 'var(--spacing-3)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-base))',
  color: 'var(--fg-default)',
  cursor: 'pointer',
};

const TEMPLATE_CARD_SELECTED_STYLE: CSSProperties = {
  ...TEMPLATE_CARD_STYLE,
  borderColor: 'var(--accent-border)',
  background: 'var(--accent-subtle)',
  color: 'var(--fg-strong)',
};

const TEMPLATE_TITLE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-2)',
};

const TEMPLATE_CHECKBOX_STYLE: CSSProperties = {
  width: 14,
  height: 14,
  accentColor: 'var(--accent)',
  flexShrink: 0,
};

const TEMPLATE_META_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
};

interface NewTeamWorkspaceTemplateSectionProps {
  readonly error: string | null;
  readonly loading: boolean;
  readonly selectedTemplateIds: readonly string[];
  readonly templates: readonly ResourceTextCatalogEntry[];
  readonly onToggleTemplate: (templateId: string) => void;
}

export function NewTeamWorkspaceTemplateSection({
  error,
  loading,
  selectedTemplateIds,
  templates,
  onToggleTemplate,
}: NewTeamWorkspaceTemplateSectionProps) {
  return (
    <section style={TEMPLATE_SECTION_STYLE} aria-labelledby="new-ws-templates-title">
      <div>
        <div id="new-ws-templates-title" style={LABEL_STYLE}>
          工作区模板
        </div>
        <div style={HINT_STYLE}>
          仅将 Team 专用 agentTemplates 写入新工作区知识库，不会混入普通 Agent、Skill 或通道人设。
        </div>
      </div>
      {loading ? <span style={HINT_STYLE}>正在读取模板资源…</span> : null}
      {error ? (
        <div role="alert" style={ERROR_STYLE}>
          {error}
        </div>
      ) : null}
      {!loading && !error && templates.length === 0 ? (
        <span style={HINT_STYLE}>暂无可用于 Team 工作区初始化的模板。</span>
      ) : null}
      {templates.length > 0 ? (
        <div style={TEMPLATE_GRID_STYLE}>
          {templates.map((template) => {
            const selected = selectedTemplateIds.includes(template.id);
            return (
              <label
                key={template.id}
                style={selected ? TEMPLATE_CARD_SELECTED_STYLE : TEMPLATE_CARD_STYLE}
                className="new-team-workspace-modal__template-card"
              >
                <span style={TEMPLATE_TITLE_ROW_STYLE}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleTemplate(template.id)}
                    aria-label={`选择 ${template.title} 工作区模板`}
                    style={TEMPLATE_CHECKBOX_STYLE}
                  />
                  <strong style={{ fontSize: 12 }}>{template.title}</strong>
                </span>
                <span style={HINT_STYLE}>{template.description}</span>
                <span style={TEMPLATE_META_STYLE}>{describeWorkspaceTemplateSource(template)}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
