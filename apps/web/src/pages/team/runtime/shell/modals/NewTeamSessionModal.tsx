/**
 * NewTeamSessionModal · 创建团队会话弹窗（双栏 + 步骤指示版）
 *
 * 布局：
 *   ┌──────────────┬─────────────────────────────┐
 *   │ 左侧 (220)   │ 右侧 (1fr)                   │
 *   │ 步骤指示：    │ 步骤内容：                    │
 *   │  ① 来源       │  - source: 三个来源 tab     │
 *   │  ② 核心角色   │  - required-roles: 角色卡片  │
 *   │  ③ 额外成员   │  - optional-members: agents  │
 *   │  ④ 确认       │  - review: 总结卡片          │
 *   └──────────────┴─────────────────────────────┘
 *
 * 设计原则：
 * - 步骤可视化：左侧 vertical stepper，hover/active 高亮
 * - 内容卡片化：每个步骤的内容用 card 区域承载
 * - 模板/agent 信息丰富：name + description + badges + role chips + color
 * - 与 NewTeamWorkspaceModal 风格统一（都是 hero/aside 结构）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { useTeamRuntimeRoleBindings } from '../../hooks/use-team-runtime-role-bindings.js';
import {
  generateDefaultSessionTitle,
  useTeamSessionCreation,
} from '../../hooks/use-team-session-creation.js';
import {
  REQUIRED_CORE_ROLES,
  type TeamSessionCreationDraft,
} from '../../data/team-session-creation.types.js';
import { CheckIcon, ChevronRightIcon, XIcon } from '../../shared/TeamIcons.js';
import { recordTemplateUsage } from '../../../views/templates/template-preferences.js';
import {
  AGENT_CHIP_BASE_STYLE,
  AGENT_CHIP_SELECTED_STYLE,
  BADGE_BASE_STYLE,
  CARD_BASE_STYLE,
  CARD_DESC_STYLE,
  CARD_SELECTED_STYLE,
  CARD_TITLE_STYLE,
  FIELD_STYLE,
  FORM_BODY_STYLE,
  FORM_FOOTER_STYLE,
  FORM_HEADER_STYLE,
  FORM_PANE_STYLE,
  HINT_STYLE,
  ICON_BLANK,
  ICON_LOCK,
  ICON_TEMPLATE,
  INPUT_STYLE,
  LABEL_STYLE,
  MODAL_STYLE,
  OVERLAY_STYLE,
  PRIMARY_BTN_STYLE,
  REVIEW_CARD_STYLE,
  REVIEW_LABEL_STYLE,
  REVIEW_ROW_STYLE,
  REVIEW_VALUE_STYLE,
  ROLE_AVATAR_STYLE,
  ROLE_CARD_STYLE,
  SECONDARY_BTN_STYLE,
  SECTION_HEADER_RULE_STYLE,
  SECTION_HEADER_STYLE,
  SOURCE_TAB_BAR_STYLE,
  SOURCE_TAB_BTN_ACTIVE_STYLE,
  SOURCE_TAB_BTN_BASE_STYLE,
  STEPPER_BADGE_STYLE,
  STEPPER_HEADER_STYLE,
  STEPPER_PANE_STYLE,
  STEPS,
  STEP_INDEX_ACTIVE_STYLE,
  STEP_INDEX_BASE_STYLE,
  STEP_INDEX_DONE_STYLE,
  STEP_ITEM_ACTIVE_STYLE,
  STEP_ITEM_BASE_STYLE,
  STEP_ITEM_DONE_STYLE,
  badgeToneStyle,
  colorForRole,
  describeRole,
  getAgentGroupKey,
  getAgentGroupMeta,
  getInitial,
  type SourceTab,
} from './new-team-session-modal-config.js';

interface NewTeamSessionModalProps {
  onClose: () => void;
  onSubmitDraft: (draft: TeamSessionCreationDraft) => boolean | void | Promise<boolean | void>;
  workspaceLabel: string;
  teamWorkspaceId: string;
  defaultMemberSlots?: TeamSessionCreationDraft['memberSlots'];
  initialTemplateId?: string | null;
  initialWorkingDirectory?: string | null;
}

export function NewTeamSessionModal({
  onClose,
  onSubmitDraft,
  workspaceLabel,
  teamWorkspaceId,
  defaultMemberSlots,
  initialTemplateId = null,
  initialWorkingDirectory = null,
}: NewTeamSessionModalProps) {
  const { refreshTemplates, templateLoading, templates } = useTeamRuntimeReferenceViewData();
  const roleBindings = useTeamRuntimeRoleBindings();
  const creation = useTeamSessionCreation({
    defaultMemberSlots,
    initialWorkingDirectory,
    teamWorkspaceId,
  });
  const applyTemplate = creation.applyTemplate;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [templateRefreshPending, setTemplateRefreshPending] = useState(true);

  // 来源 tab：根据当前 source 推断（workflow 已移除，仅保留 blank / template）
  const [sourceTab, setSourceTab] = useState<SourceTab>(
    creation.draft.source.kind === 'saved-template' ? 'template' : 'blank',
  );
  const appliedInitialTemplateRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTemplateRefreshPending(true);
    void refreshTemplates()
      .then((latestTemplates) => {
        if (
          cancelled ||
          !initialTemplateId ||
          appliedInitialTemplateRef.current === initialTemplateId
        ) {
          return;
        }
        const template = latestTemplates.find((item) => item.id === initialTemplateId);
        if (!template) {
          return;
        }
        applyTemplate(template);
        setSourceTab('template');
        appliedInitialTemplateRef.current = initialTemplateId;
      })
      .finally(() => {
        if (!cancelled) {
          setTemplateRefreshPending(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyTemplate, initialTemplateId, refreshTemplates]);

  const templatesRefreshing = templateLoading || templateRefreshPending;

  useEffect(() => {
    if (!initialTemplateId || templatesRefreshing || templates.length === 0) {
      return;
    }
    if (appliedInitialTemplateRef.current === initialTemplateId) {
      return;
    }
    const template = templates.find((item) => item.id === initialTemplateId);
    if (!template) {
      return;
    }
    applyTemplate(template);
    setSourceTab('template');
    appliedInitialTemplateRef.current = initialTemplateId;
  }, [applyTemplate, initialTemplateId, templatesRefreshing, templates]);

  const groupedTemplates = useMemo(() => {
    const groups = new Map<string, { items: typeof templates; title: string; priority: number }>();
    for (const template of templates) {
      const groupId = template.groupId ?? 'ungrouped';
      const current = groups.get(groupId) ?? {
        items: [] as typeof templates,
        title: template.groupTitle ?? '模板',
        priority: template.groupPriority ?? Number.MAX_SAFE_INTEGER,
      };
      current.items.push(template);
      groups.set(groupId, current);
    }
    return Array.from(groups.entries())
      .sort(([, left], [, right]) => left.priority - right.priority)
      .map(([id, group]) => ({ id, ...group }));
  }, [templates]);

  const availableOptionalAgents = useMemo(() => {
    const requiredAgentIds = new Set(
      Object.values(creation.draft.requiredRoleBindings).filter((value): value is string =>
        Boolean(value),
      ),
    );
    return roleBindings.agents.filter((agent) => agent.enabled && !requiredAgentIds.has(agent.id));
  }, [creation.draft.requiredRoleBindings, roleBindings.agents]);

  const agentById = useMemo(
    () => new Map(roleBindings.agents.map((agent) => [agent.id, agent])),
    [roleBindings.agents],
  );

  const handleSubmit = async () => {
    if (!creation.canSubmit || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      // 提交前若标题为空，自动填入默认标题（不阻塞用户）
      if (!creation.draft.title.trim()) {
        creation.fillDefaultTitle();
      }
      const finalDraft = {
        ...creation.draft,
        title: creation.draft.title.trim() || generateDefaultSessionTitle(),
      };
      const result = await onSubmitDraft(finalDraft);
      if (result === false) {
        setSubmitError('创建团队会话失败，请检查工作区配置或稍后重试。');
        return;
      }
      // 据模板新建会话成功后，记录一次模板使用（最近 + 次数），供模板页统计展示。
      if (finalDraft.source.kind === 'saved-template' && finalDraft.source.templateId) {
        recordTemplateUsage(finalDraft.source.templateId);
      }
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '创建团队会话失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === creation.step);

  const modal = (
    <div style={OVERLAY_STYLE}>
      <button
        type="button"
        aria-label="关闭创建会话弹窗"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
      <div style={MODAL_STYLE} role="dialog" aria-modal="true" aria-labelledby="new-session-title">
        {/* ─── 左侧步骤指示器 ─── */}
        <aside style={STEPPER_PANE_STYLE} aria-label="创建步骤">
          <div style={STEPPER_HEADER_STYLE}>
            <div style={STEPPER_BADGE_STYLE}>
              <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="6" />
              </svg>
              Session
            </div>
            <strong
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: 'var(--fg-strong)',
                lineHeight: 1.3,
              }}
            >
              新建团队会话
            </strong>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              工作区：<strong style={{ color: 'var(--fg-default)' }}>{workspaceLabel}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {STEPS.map((s, i) => {
              const active = i === stepIndex;
              const done = i < stepIndex;
              const itemStyle = active
                ? STEP_ITEM_ACTIVE_STYLE
                : done
                  ? STEP_ITEM_DONE_STYLE
                  : STEP_ITEM_BASE_STYLE;
              const indexStyle = active
                ? STEP_INDEX_ACTIVE_STYLE
                : done
                  ? STEP_INDEX_DONE_STYLE
                  : STEP_INDEX_BASE_STYLE;
              return (
                <div key={s.key} style={itemStyle}>
                  <span style={indexStyle} aria-hidden="true">
                    {done ? (
                      <CheckIcon
                        size={14}
                        color={active ? 'var(--fg-on-accent)' : 'var(--success)'}
                      />
                    ) : (
                      s.index
                    )}
                  </span>
                  <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: active ? 'var(--fg-strong)' : 'inherit',
                      }}
                    >
                      {s.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--fg-muted)',
                        lineHeight: 1.4,
                      }}
                    >
                      {s.hint}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ─── 右侧表单 ─── */}
        <div style={FORM_PANE_STYLE}>
          <div style={FORM_HEADER_STYLE}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                id="new-session-title"
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: 'var(--fg-strong)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ color: 'var(--accent)' }}>{STEPS[stepIndex]?.icon}</span>
                {STEPS[stepIndex]?.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--fg-muted)',
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {creation.step === 'source' &&
                  '选择新会话从何处启动：从空白开始、套用工作流，或复用已保存的模板配置。'}
                {creation.step === 'required-roles' &&
                  '4 个核心角色由系统固定 agent 预绑定。可在此填写会话标题（留空则自动生成）。'}
                {creation.step === 'optional-members' &&
                  '在核心角色之外可加入更多 agent，按其声明的层级（leader / general / planner …）参与对应阶段。'}
                {creation.step === 'review' && '请确认会话配置，提交后即立即创建并进入。'}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--fg-muted)',
                padding: 4,
                cursor: 'pointer',
                display: 'inline-flex',
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              <XIcon size={14} color="var(--fg-muted)" />
            </button>
          </div>

          <div style={FORM_BODY_STYLE}>
            {/* ── Step: source ───────────────────────────── */}
            {creation.step === 'source' ? (
              <>
                <div style={SOURCE_TAB_BAR_STYLE} role="tablist" aria-label="来源类别">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sourceTab === 'blank'}
                    onClick={() => {
                      setSourceTab('blank');
                      creation.setSource({ kind: 'blank' });
                    }}
                    style={
                      sourceTab === 'blank'
                        ? SOURCE_TAB_BTN_ACTIVE_STYLE
                        : SOURCE_TAB_BTN_BASE_STYLE
                    }
                  >
                    <span style={{ color: sourceTab === 'blank' ? 'var(--accent)' : undefined }}>
                      {ICON_BLANK}
                    </span>
                    空白会话
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sourceTab === 'template'}
                    onClick={() => setSourceTab('template')}
                    style={
                      sourceTab === 'template'
                        ? SOURCE_TAB_BTN_ACTIVE_STYLE
                        : SOURCE_TAB_BTN_BASE_STYLE
                    }
                  >
                    <span style={{ color: sourceTab === 'template' ? 'var(--accent)' : undefined }}>
                      {ICON_TEMPLATE}
                    </span>
                    已保存模板
                  </button>
                </div>

                {sourceTab === 'blank' ? (
                  <button
                    type="button"
                    onClick={() => creation.setSource({ kind: 'blank' })}
                    style={
                      creation.draft.source.kind === 'blank' ? CARD_SELECTED_STYLE : CARD_BASE_STYLE
                    }
                  >
                    <div style={CARD_TITLE_STYLE}>
                      <span
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          display: 'grid',
                          placeItems: 'center',
                          background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                          color: 'var(--accent)',
                        }}
                      >
                        {ICON_BLANK}
                      </span>
                      空白团队
                      {creation.draft.source.kind === 'blank' ? (
                        <span style={{ marginLeft: 'auto' }}>
                          <CheckIcon size={14} color="var(--accent)" />
                        </span>
                      ) : null}
                    </div>
                    <div style={CARD_DESC_STYLE}>
                      使用系统预置的 4 个核心角色（planner / researcher / executor /
                      reviewer），随后可按需追加额外 agent 成员。会话标题可留空，提交时会自动以
                      <strong style={{ color: 'var(--fg-default)' }}>「团队会话 + 时间戳」</strong>
                      命名。
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {REQUIRED_CORE_ROLES.map((role) => (
                        <span
                          key={role}
                          style={{
                            ...BADGE_BASE_STYLE,
                            background: `color-mix(in srgb, ${colorForRole(role)} 16%, transparent)`,
                            color: colorForRole(role),
                          }}
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </button>
                ) : null}

                {sourceTab === 'template' ? (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {templatesRefreshing ? (
                      <div
                        style={{
                          padding: 24,
                          textAlign: 'center',
                          color: 'var(--fg-muted)',
                          fontSize: 12,
                        }}
                      >
                        正在加载模板…
                      </div>
                    ) : templates.length === 0 ? (
                      <div
                        style={{
                          padding: '32px 24px',
                          textAlign: 'center',
                          borderRadius: 12,
                          border:
                            '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
                          color: 'var(--fg-muted)',
                          fontSize: 12,
                          display: 'grid',
                          gap: 8,
                          justifyItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 24 }}>📋</span>
                        <span>暂无可用模板</span>
                        <span style={{ fontSize: 11 }}>切换到「空白会话」即可继续创建。</span>
                      </div>
                    ) : (
                      groupedTemplates.map((group) => (
                        <div key={group.id} style={{ display: 'grid', gap: 8 }}>
                          <div style={SECTION_HEADER_STYLE}>
                            <span>{group.title}</span>
                            <span style={SECTION_HEADER_RULE_STYLE} />
                          </div>
                          {group.items.map((template) => {
                            const selected =
                              creation.draft.source.kind === 'saved-template' &&
                              creation.draft.source.templateId === template.id;
                            return (
                              <button
                                key={template.id}
                                type="button"
                                onClick={() => creation.applyTemplate(template)}
                                style={selected ? CARD_SELECTED_STYLE : CARD_BASE_STYLE}
                              >
                                <div style={CARD_TITLE_STYLE}>
                                  <span
                                    style={{
                                      width: 28,
                                      height: 28,
                                      borderRadius: 8,
                                      display: 'grid',
                                      placeItems: 'center',
                                      background:
                                        'color-mix(in srgb, var(--accent) 14%, transparent)',
                                      color: 'var(--accent)',
                                    }}
                                  >
                                    {ICON_TEMPLATE}
                                  </span>
                                  <span style={{ flex: 1 }}>{template.name}</span>
                                  {selected ? <CheckIcon size={14} color="var(--accent)" /> : null}
                                </div>
                                {template.badges && template.badges.length > 0 ? (
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {template.badges.map((badge) => (
                                      <span
                                        key={`${template.id}-${badge.label}`}
                                        style={{
                                          ...BADGE_BASE_STYLE,
                                          ...badgeToneStyle(badge.tone),
                                        }}
                                      >
                                        {badge.label}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                <div style={CARD_DESC_STYLE}>
                                  {template.description ?? '已保存的团队模板'}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: 'var(--fg-muted)',
                                    lineHeight: 1.5,
                                  }}
                                >
                                  采用后会自动带入模板的默认花名册、额外增援成员与默认模型策略。
                                </div>
                                {template.metaLine ? (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: 'var(--fg-muted)',
                                      lineHeight: 1.5,
                                    }}
                                  >
                                    {template.metaLine}
                                  </div>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            ) : null}

            {/* ── Step: required-roles ───────────────────────────── */}
            {creation.step === 'required-roles' ? (
              <>
                <div style={FIELD_STYLE}>
                  <label
                    htmlFor="new-team-session-title"
                    style={{
                      ...LABEL_STYLE,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>会话标题</span>
                    <span
                      style={{
                        ...BADGE_BASE_STYLE,
                        ...badgeToneStyle(),
                        fontSize: 9,
                        padding: '0 6px',
                        minHeight: 16,
                      }}
                    >
                      可选
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="new-team-session-title"
                      value={creation.draft.title}
                      onChange={(e) => creation.setTitle(e.target.value)}
                      placeholder={generateDefaultSessionTitle()}
                      style={{ ...INPUT_STYLE, flex: 1 }}
                      autoFocus
                    />
                    {!creation.draft.title.trim() ? (
                      <button
                        type="button"
                        onClick={() => creation.setTitle(generateDefaultSessionTitle())}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
                          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                          color: 'var(--accent)',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                        title="使用默认标题"
                      >
                        使用默认
                      </button>
                    ) : null}
                  </div>
                  <span style={HINT_STYLE}>
                    留空将自动以
                    <strong style={{ color: 'var(--fg-default)' }}>
                      「团队会话 + 当前时间戳」
                    </strong>
                    作为标题，可随时在会话列表里重命名。
                  </span>
                </div>

                <div style={SECTION_HEADER_STYLE}>
                  <span>核心角色绑定</span>
                  <span style={SECTION_HEADER_RULE_STYLE} />
                  <span
                    style={{
                      ...BADGE_BASE_STYLE,
                      ...badgeToneStyle('warning'),
                      gap: 4,
                    }}
                  >
                    {ICON_LOCK}
                    系统固定
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {REQUIRED_CORE_ROLES.map((role) => {
                    const card = roleBindings.roleCards.find((r) => r.role === role) ?? null;
                    const agentId =
                      creation.draft.requiredRoleBindings[role] ?? card?.selectedAgentId ?? '';
                    const agent = agentById.get(agentId) ?? card?.selectedAgent ?? null;
                    const color = agent?.color ?? colorForRole(role);
                    return (
                      <div key={role} style={ROLE_CARD_STYLE}>
                        <div style={{ ...ROLE_AVATAR_STYLE, background: color }}>
                          {getInitial(card?.roleLabel ?? role)}
                        </div>
                        <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: 'var(--fg-strong)',
                              }}
                            >
                              {card?.roleLabel ?? role}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                fontFamily: 'ui-monospace, monospace',
                                color: 'var(--fg-muted)',
                              }}
                            >
                              {role}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--fg-default)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {agent?.label ?? agentId ?? '系统预置'}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--fg-muted)',
                              lineHeight: 1.4,
                            }}
                          >
                            {agent?.description?.trim() || describeRole(role)}
                          </span>
                        </div>
                        <span
                          style={{
                            ...BADGE_BASE_STYLE,
                            ...badgeToneStyle(),
                            gap: 3,
                          }}
                        >
                          {ICON_LOCK}
                          固定
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {/* ── Step: optional-members ───────────────────────────── */}
            {creation.step === 'optional-members' ? (
              <>
                {availableOptionalAgents.length === 0 ? (
                  <div
                    style={{
                      padding: '28px 24px',
                      textAlign: 'center',
                      borderRadius: 12,
                      border:
                        '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
                      color: 'var(--fg-muted)',
                      fontSize: 12,
                      display: 'grid',
                      gap: 8,
                      justifyItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 24 }}>🧑‍🤝‍🧑</span>
                    <span>暂无可选额外成员</span>
                    <span style={{ fontSize: 11 }}>
                      所有 agent 都已被核心角色占用。可直接进入下一步确认。
                    </span>
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={HINT_STYLE}>
                        额外成员按 <strong style={{ color: 'var(--fg-default)' }}>层级</strong>
                        分组展示。每个 agent 加入后，会以其声明的层级参与协作，与核心角色
                        <strong style={{ color: 'var(--fg-default)' }}>并行</strong>而非替代。
                      </span>
                      <span
                        style={{
                          ...BADGE_BASE_STYLE,
                          ...badgeToneStyle('accent'),
                          gap: 4,
                        }}
                      >
                        已选 {creation.draft.optionalAgentIds.length} /{' '}
                        {availableOptionalAgents.length}
                      </span>
                    </div>

                    {/* 已加入成员面板：按层级分组，每行清晰显示「agent → 层级」 */}
                    {creation.draft.optionalAgentIds.length > 0
                      ? (() => {
                          // 按 layer 分组已选成员
                          const selectedBuckets = new Map<
                            string,
                            Array<{
                              id: string;
                              agent: (typeof roleBindings.agents)[number] | null;
                            }>
                          >();
                          for (const id of creation.draft.optionalAgentIds) {
                            const agent = agentById.get(id) ?? null;
                            const key = agent ? getAgentGroupKey(agent) : 'unknown';
                            const list = selectedBuckets.get(key) ?? [];
                            list.push({ id, agent });
                            selectedBuckets.set(key, list);
                          }
                          const SELECTED_ORDER = [
                            'leader',
                            'general',
                            'planner',
                            'researcher',
                            'executor',
                            'reviewer',
                            'unknown',
                          ];
                          const orderedSelected = SELECTED_ORDER.map((key) => ({
                            meta: getAgentGroupMeta(key),
                            items: selectedBuckets.get(key) ?? [],
                          })).filter((g) => g.items.length > 0);

                          return (
                            <div
                              style={{
                                display: 'grid',
                                gap: 10,
                                padding: '12px 14px',
                                borderRadius: 12,
                                background:
                                  'color-mix(in srgb, var(--accent) 6%, var(--bg-overlay))',
                                border:
                                  '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: 'var(--accent)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                <svg
                                  aria-hidden="true"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>已加入成员（{creation.draft.optionalAgentIds.length}）</span>
                                <span
                                  style={{
                                    flex: 1,
                                    height: 1,
                                    background:
                                      'color-mix(in srgb, var(--accent) 30%, transparent)',
                                  }}
                                />
                              </div>
                              <div style={{ display: 'grid', gap: 8 }}>
                                {orderedSelected.map(({ meta, items }) => (
                                  <div
                                    key={`selected-${meta.key}`}
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: 'auto 1fr',
                                      gap: 10,
                                      alignItems: 'flex-start',
                                    }}
                                  >
                                    {/* 层级标签 */}
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                        padding: '4px 9px',
                                        borderRadius: 6,
                                        background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
                                        color: meta.color,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        flexShrink: 0,
                                        marginTop: 2,
                                      }}
                                      title={meta.hint}
                                    >
                                      <span
                                        aria-hidden="true"
                                        style={{
                                          width: 6,
                                          height: 6,
                                          borderRadius: '50%',
                                          background: meta.color,
                                        }}
                                      />
                                      {meta.label}
                                      <span
                                        style={{
                                          fontSize: 9,
                                          opacity: 0.7,
                                          fontFamily: 'ui-monospace, monospace',
                                        }}
                                      >
                                        {meta.key}
                                      </span>
                                    </span>
                                    {/* agent chips */}
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: 6,
                                      }}
                                    >
                                      {items.map(({ id, agent }) => {
                                        const color = agent?.color ?? meta.color;
                                        return (
                                          <span
                                            key={id}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 6,
                                              padding: '5px 6px 5px 10px',
                                              borderRadius: 999,
                                              background: 'var(--bg-overlay)',
                                              border:
                                                '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                                              fontSize: 11,
                                              color: 'var(--fg-strong)',
                                              fontWeight: 600,
                                            }}
                                          >
                                            <span
                                              aria-hidden="true"
                                              style={{
                                                width: 7,
                                                height: 7,
                                                borderRadius: '50%',
                                                background: color,
                                                flexShrink: 0,
                                              }}
                                            />
                                            <span>{agent?.label ?? id}</span>
                                            <button
                                              type="button"
                                              onClick={() => creation.toggleOptionalAgent(id)}
                                              className="team-icon-danger"
                                              style={{
                                                width: 18,
                                                height: 18,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                border: 'none',
                                                borderRadius: '50%',
                                                background: 'transparent',
                                                color: 'var(--fg-muted)',
                                                cursor: 'pointer',
                                                padding: 0,
                                              }}
                                              aria-label={`从「${meta.label}」层移除 ${agent?.label ?? id}`}
                                              title={`从「${meta.label}」层移除`}
                                            >
                                              <svg
                                                aria-hidden="true"
                                                width="9"
                                                height="9"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              >
                                                <line x1="18" y1="6" x2="6" y2="18" />
                                                <line x1="6" y1="6" x2="18" y2="18" />
                                              </svg>
                                            </button>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()
                      : null}

                    {/* 选取面板：按层级分组待选 agent */}
                    <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 11,
                          color: 'var(--fg-muted)',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        <span>可加入</span>
                        <span
                          style={{
                            flex: 1,
                            height: 1,
                            background:
                              'color-mix(in srgb, var(--border-default) 60%, transparent)',
                          }}
                        />
                        <span style={{ textTransform: 'none', fontSize: 10, fontWeight: 400 }}>
                          点击 agent 即加入对应层
                        </span>
                      </div>
                    </div>

                    {(() => {
                      // 按 canonicalRole.coreRole 分组
                      const buckets = new Map<string, typeof availableOptionalAgents>();
                      for (const agent of availableOptionalAgents) {
                        const key = getAgentGroupKey(agent);
                        const list = buckets.get(key) ?? [];
                        list.push(agent);
                        buckets.set(key, list);
                      }

                      // 层级显示顺序：leader → general → planner → researcher → executor → reviewer → unknown
                      const ORDER = [
                        'leader',
                        'general',
                        'planner',
                        'researcher',
                        'executor',
                        'reviewer',
                        'unknown',
                      ];
                      const groups = ORDER.map((key) => ({
                        meta: getAgentGroupMeta(key),
                        items: buckets.get(key) ?? [],
                      })).filter((g) => g.items.length > 0);

                      return (
                        <div style={{ display: 'grid', gap: 14 }}>
                          {groups.map(({ meta, items }) => (
                            <div key={meta.key} style={{ display: 'grid', gap: 8 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  padding: '8px 10px',
                                  borderRadius: 10,
                                  background: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
                                  border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`,
                                }}
                              >
                                <span
                                  aria-hidden="true"
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: '50%',
                                    background: meta.color,
                                    flexShrink: 0,
                                  }}
                                />
                                <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 700,
                                      color: 'var(--fg-strong)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                    }}
                                  >
                                    点击加入「{meta.label}」层
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontFamily: 'ui-monospace, monospace',
                                        color: 'var(--fg-muted)',
                                        fontWeight: 400,
                                      }}
                                    >
                                      {meta.key}
                                    </span>
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: 'var(--fg-muted)',
                                      lineHeight: 1.4,
                                    }}
                                  >
                                    {meta.hint}
                                  </span>
                                </div>
                                {(() => {
                                  const selectedInLayer = items.filter((a) =>
                                    creation.draft.optionalAgentIds.includes(a.id),
                                  ).length;
                                  return (
                                    <span
                                      style={{
                                        ...BADGE_BASE_STYLE,
                                        background:
                                          selectedInLayer > 0
                                            ? `color-mix(in srgb, ${meta.color} 22%, transparent)`
                                            : 'color-mix(in srgb, var(--fg-muted) 14%, transparent)',
                                        color: selectedInLayer > 0 ? meta.color : 'var(--fg-muted)',
                                        fontSize: 10,
                                        fontVariantNumeric: 'tabular-nums',
                                        flexShrink: 0,
                                      }}
                                    >
                                      {selectedInLayer} / {items.length}
                                    </span>
                                  );
                                })()}
                              </div>

                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {items.map((agent) => {
                                  const selected = creation.draft.optionalAgentIds.includes(
                                    agent.id,
                                  );
                                  const color = agent.color ?? meta.color;
                                  return (
                                    <button
                                      key={agent.id}
                                      type="button"
                                      onClick={() => creation.toggleOptionalAgent(agent.id)}
                                      style={
                                        selected ? AGENT_CHIP_SELECTED_STYLE : AGENT_CHIP_BASE_STYLE
                                      }
                                      title={
                                        agent.description ||
                                        `${agent.label}（加入后会出现在「${meta.label}」层级）`
                                      }
                                    >
                                      <span
                                        aria-hidden="true"
                                        style={{
                                          width: 8,
                                          height: 8,
                                          borderRadius: '50%',
                                          background: color,
                                          flexShrink: 0,
                                        }}
                                      />
                                      {selected ? (
                                        <CheckIcon size={11} color="var(--accent)" />
                                      ) : null}
                                      <span>{agent.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </>
                )}
              </>
            ) : null}

            {/* ── Step: review ───────────────────────────── */}
            {creation.step === 'review' ? (
              <div style={REVIEW_CARD_STYLE}>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>来源</span>
                  <span style={REVIEW_VALUE_STYLE}>
                    {creation.draft.source.kind === 'blank' ? (
                      <>
                        <span
                          style={{
                            ...BADGE_BASE_STYLE,
                            ...badgeToneStyle('accent'),
                          }}
                        >
                          空白会话
                        </span>
                      </>
                    ) : (
                      <>
                        <span
                          style={{
                            ...BADGE_BASE_STYLE,
                            ...badgeToneStyle('success'),
                          }}
                        >
                          已保存模板
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                          ID：{creation.draft.source.templateId}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>会话标题</span>
                  <span style={{ ...REVIEW_VALUE_STYLE, fontWeight: 600 }}>
                    {creation.draft.title.trim() || (
                      <span
                        style={{
                          color: 'var(--fg-muted)',
                          fontStyle: 'italic',
                          fontWeight: 400,
                        }}
                        title="提交后将以此默认值创建"
                      >
                        {generateDefaultSessionTitle()}（自动）
                      </span>
                    )}
                  </span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>工作区</span>
                  <span style={REVIEW_VALUE_STYLE}>{workspaceLabel}</span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>工作目录</span>
                  <span style={REVIEW_VALUE_STYLE}>
                    {creation.draft.workingDirectory ? (
                      <code
                        style={{
                          fontSize: 11,
                          color: 'var(--fg-default)',
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        {creation.draft.workingDirectory}
                      </code>
                    ) : (
                      <span style={{ color: 'var(--fg-muted)' }}>使用工作区默认目录</span>
                    )}
                  </span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>核心角色</span>
                  <span style={REVIEW_VALUE_STYLE}>
                    {REQUIRED_CORE_ROLES.map((role) => {
                      const agentId = creation.draft.requiredRoleBindings[role];
                      const agent = agentId ? agentById.get(agentId) : null;
                      const color = agent?.color ?? colorForRole(role);
                      return (
                        <span
                          key={role}
                          style={{
                            ...BADGE_BASE_STYLE,
                            background: `color-mix(in srgb, ${color} 18%, transparent)`,
                            color,
                            gap: 4,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: color,
                            }}
                          />
                          {role}
                        </span>
                      );
                    })}
                  </span>
                </div>
                <div style={REVIEW_ROW_STYLE}>
                  <span style={REVIEW_LABEL_STYLE}>额外成员</span>
                  <span style={REVIEW_VALUE_STYLE}>
                    {creation.draft.optionalAgentIds.length === 0 ? (
                      <span style={{ color: 'var(--fg-muted)' }}>未选择</span>
                    ) : (
                      creation.draft.optionalAgentIds.map((id) => {
                        const agent = agentById.get(id);
                        const groupKey = agent ? getAgentGroupKey(agent) : 'unknown';
                        const groupMeta = getAgentGroupMeta(groupKey);
                        const color = agent?.color ?? groupMeta.color;
                        return (
                          <span
                            key={id}
                            style={{
                              ...BADGE_BASE_STYLE,
                              background: 'var(--bg-overlay)',
                              color: 'var(--fg-default)',
                              border:
                                '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
                              gap: 5,
                            }}
                            title={`${agent?.label ?? id} · ${groupMeta.label} (${groupMeta.key})`}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: color,
                              }}
                            />
                            {agent?.label ?? id}
                            <span
                              style={{
                                fontSize: 9,
                                color: groupMeta.color,
                                fontFamily: 'ui-monospace, monospace',
                                opacity: 0.85,
                              }}
                            >
                              · {groupMeta.key}
                            </span>
                          </span>
                        );
                      })
                    )}
                  </span>
                </div>
              </div>
            ) : null}

            {roleBindings.error ? (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  color: 'var(--error)',
                  background: 'color-mix(in srgb, var(--error) 10%, transparent)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)',
                }}
              >
                {roleBindings.error}
              </div>
            ) : null}

            {submitError ? (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  color: 'var(--error)',
                  background: 'color-mix(in srgb, var(--error) 10%, transparent)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)',
                }}
              >
                {submitError}
              </div>
            ) : null}
          </div>

          {/* ─── 操作栏 ─── */}
          <div style={FORM_FOOTER_STYLE}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              步骤 {stepIndex + 1} / {STEPS.length}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={creation.prevStep}
                disabled={creation.currentStepIndex === 0}
                style={{
                  ...SECONDARY_BTN_STYLE,
                  opacity: creation.currentStepIndex === 0 ? 0.4 : 1,
                  cursor: creation.currentStepIndex === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                上一步
              </button>
              {creation.step !== 'review' ? (
                <button
                  type="button"
                  onClick={creation.nextStep}
                  disabled={!creation.canAdvance}
                  style={{
                    ...PRIMARY_BTN_STYLE,
                    opacity: creation.canAdvance ? 1 : 0.5,
                    cursor: creation.canAdvance ? 'pointer' : 'not-allowed',
                  }}
                >
                  下一步
                  <ChevronRightIcon size={11} color="var(--fg-on-accent)" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!creation.canSubmit || submitting}
                  style={{
                    ...PRIMARY_BTN_STYLE,
                    opacity: creation.canSubmit && !submitting ? 1 : 0.5,
                    cursor: creation.canSubmit && !submitting ? 'pointer' : 'not-allowed',
                  }}
                >
                  {submitting ? (
                    '创建中…'
                  ) : (
                    <>
                      <CheckIcon size={12} color="var(--fg-on-accent)" />
                      确认创建
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
