import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useTeamWorkflowTemplates } from './team/runtime/use-team-workflow-templates.js';
import { PANEL_STYLE, SHELL_BACKGROUND } from './team/runtime/team-runtime-shared.js';
import { agentTeamsNewTemplateProviders } from './team/runtime/team-runtime-ui-config.js';
import {
  ChevronDownIcon,
  PlusIcon,
  TemplateIcon,
  SyncIcon,
  CollapseLeftIcon,
} from './team/runtime/TeamIcons.js';

/* ── Template detail card ────────────────────────────────────────────── */

function TemplateCard({
  template,
  onUse,
  canUse,
}: {
  template: ReturnType<typeof useTeamWorkflowTemplates>['templateCards'][number];
  onUse: () => void;
  canUse: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const badges = template.badges ?? [];
  const roleTags = template.nodes
    .filter((node) => node.type === 'subagent')
    .map((node) => ({
      label: node.label.split(' · ')[0]?.trim() ?? node.label,
      color: node.label.includes('负责人')
        ? '#d59b11'
        : node.label.includes('研究员')
          ? '#5b5bd8'
          : node.label.includes('执行者')
            ? '#378dff'
            : node.label.includes('批评者')
              ? '#d04e4e'
              : '#7c52ff',
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
            <span style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
              {template.description}
            </span>
          )}
          {template.metaLine && (
            <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
              {template.metaLine}
            </span>
          )}

          {/* Node list */}
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)' }}>
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
                  background: 'var(--surface)',
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
                          ? 'var(--text-3)'
                          : 'var(--accent)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{node.label}</span>
                <span style={{ color: 'var(--text-3)', fontSize: 9 }}>{node.type}</span>
              </div>
            ))}
          </div>

          {/* Action */}
          <button
            type="button"
            disabled={!canUse}
            onClick={canUse ? onUse : undefined}
            style={{
              minHeight: 32,
              borderRadius: 8,
              border: 'none',
              background: canUse ? 'var(--accent)' : 'var(--surface-2)',
              color: canUse ? 'var(--accent-text)' : 'var(--text-3)',
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

/* ── Create template form ─────────────────────────────────────────────── */

function CreateTemplateForm({
  onCreate,
  busy,
}: {
  onCreate: (input: { name: string; provider: string }) => Promise<boolean>;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [provider, setProvider] = useState(agentTeamsNewTemplateProviders[0]?.value ?? '');
  const [show, setShow] = useState(false);

  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        style={{
          minHeight: 36,
          borderRadius: 10,
          border: '1px dashed color-mix(in oklch, var(--border) 40%, transparent)',
          color: 'var(--text-3)',
          background: 'var(--surface)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--surface-hover)';
          e.currentTarget.style.color = 'var(--text-2)';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--surface)';
          e.currentTarget.style.color = 'var(--text-3)';
          e.currentTarget.style.borderColor = 'color-mix(in oklch, var(--border) 40%, transparent)';
        }}
      >
        <PlusIcon size={12} color="currentColor" />
        新建团队模板
      </button>
    );
  }

  return (
    <div
      style={{
        ...PANEL_STYLE,
        padding: '14px 16px',
        borderRadius: 10,
        display: 'grid',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>新建团队模板</span>

      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)' }}>模板名称</label>
        <input
          type="text"
          placeholder="例如：代码审查流水线"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 12,
            outline: 'none',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShow(false);
          }}
        />
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)' }}>
          默认 Provider
        </label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {agentTeamsNewTemplateProviders.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setProvider(opt.value)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border:
                  provider === opt.value
                    ? '1px solid var(--accent)'
                    : '1px solid var(--border-subtle)',
                background:
                  provider === opt.value
                    ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                    : 'var(--surface)',
                color: provider === opt.value ? 'var(--accent)' : 'var(--text-2)',
                fontSize: 11,
                fontWeight: provider === opt.value ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => setShow(false)}
          style={{
            padding: '5px 14px',
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            background: 'var(--surface)',
            color: 'var(--text-3)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          取消
        </button>
        <button
          type="button"
          disabled={!name.trim() || busy}
          onClick={async () => {
            const ok = await onCreate({ name: name.trim(), provider });
            if (ok) {
              setName('');
              setShow(false);
            }
          }}
          style={{
            padding: '5px 14px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--accent-text)',
            fontSize: 11,
            fontWeight: 600,
            cursor: name.trim() && !busy ? 'pointer' : 'not-allowed',
            opacity: name.trim() && !busy ? 1 : 0.5,
          }}
        >
          {busy ? '创建中…' : '创建模板'}
        </button>
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
                      <TemplateCard
                        key={template.id}
                        template={template}
                        canUse={canCreateTemplate}
                        onUse={() => navigate('/team')}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}

            {/* Create template form */}
            {canCreateTemplate && (
              <CreateTemplateForm
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
