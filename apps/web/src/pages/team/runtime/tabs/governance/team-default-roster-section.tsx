import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createTeamClient, type TeamMemberSlotInput } from '@openAwork/web-client';
import {
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
  TEAM_RUNTIME_LAYER_LABELS,
  TEAM_RUNTIME_LAYER_ORDER,
} from '@openAwork/shared';
import type { TeamMemberSpecialty, TeamRuntimeLayer } from '@openAwork/shared';
import { useTeamDefaultRosterState } from './use-team-default-roster-state.js';
import { useTeamWorkflowTemplates } from '../../hooks/use-team-workflow-templates.js';

interface TeamDefaultRosterSectionProps {
  gatewayUrl: string;
  onSaved?: () => void;
  token: string;
  teamWorkspaceId: string | null;
}

interface SaveFeedback {
  kind: 'idle' | 'saving' | 'success' | 'error';
  message?: string;
}

const SPECIALTY_LABELS: Record<TeamMemberSpecialty, string> = {
  intake: '需求澄清',
  'product-planning': '产品规划',
  'task-planning': '任务拆解',
  'tech-lead': '技术负责人',
  dispatch: '调度派发',
  release: '发布管理',
  frontend: '前端',
  backend: '后端',
  data: '数据',
  workflow: '工作流',
  integration: '集成',
  qa: '测试验证',
  docs: '文档',
  devops: 'DevOps / 部署',
  platform: '平台工程',
  'code-review': '代码评审',
  security: '安全',
  sre: 'SRE / 运维',
  observability: '可观测性',
  quality: '质量',
  custom: '自定义角色',
};

const DEFAULT_SPECIALTY_BY_LAYER: Record<TeamRuntimeLayer, TeamMemberSpecialty> = {
  reception: 'intake',
  pm1: 'task-planning',
  pm2: 'dispatch',
  executor: 'frontend',
  reviewer: 'code-review',
};

const PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 8,
  flexWrap: 'wrap',
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-base) 58%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: '2px solid transparent',
};

const SECONDARY_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 28,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  color: 'var(--fg-default)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 700,
};

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  ...SECONDARY_BUTTON_STYLE,
  border: '1px solid color-mix(in srgb, var(--accent) 44%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
};

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 20,
  padding: '0 7px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent) 11%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 700,
};

function cloneRoster(roster: TeamMemberSlotInput[]): TeamMemberSlotInput[] {
  return roster.map((slot) => ({ ...slot, toolsets: [...slot.toolsets] }));
}

function cloneDefaultRoster(): TeamMemberSlotInput[] {
  return cloneRoster(DEFAULT_FIXED_TEAM_MEMBER_SLOTS);
}

function serializeRoster(roster: TeamMemberSlotInput[]): string {
  return JSON.stringify(
    roster.map((slot) => ({
      id: slot.id,
      layer: slot.layer,
      specialty: slot.specialty,
      displayName: slot.displayName,
      personaKey: slot.personaKey,
      toolsets: [...slot.toolsets],
      required: slot.required,
    })),
  );
}

function randomSuffix(): string {
  const cryptoId = globalThis.crypto?.randomUUID?.();
  return (cryptoId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`).slice(
    0,
    8,
  );
}

function specialtyOptionsForLayer(layer: TeamRuntimeLayer): TeamMemberSpecialty[] {
  const fromDefaults = DEFAULT_FIXED_TEAM_MEMBER_SLOTS.filter((slot) => slot.layer === layer).map(
    (slot) => slot.specialty,
  );
  return Array.from(new Set(fromDefaults));
}

function presetForLayerSpecialty(layer: TeamRuntimeLayer, specialty: TeamMemberSpecialty) {
  return (
    DEFAULT_FIXED_TEAM_MEMBER_SLOTS.find(
      (slot) => slot.layer === layer && slot.specialty === specialty,
    ) ?? DEFAULT_FIXED_TEAM_MEMBER_SLOTS.find((slot) => slot.layer === layer)
  );
}

function buildLayerSlot(layer: TeamRuntimeLayer): TeamMemberSlotInput {
  const specialty = DEFAULT_SPECIALTY_BY_LAYER[layer];
  const preset =
    DEFAULT_FIXED_TEAM_MEMBER_SLOTS.find(
      (slot) => slot.layer === layer && slot.specialty === specialty,
    ) ?? DEFAULT_FIXED_TEAM_MEMBER_SLOTS.find((slot) => slot.layer === layer);
  const suffix = randomSuffix();
  return {
    id: `custom-${layer}-${specialty}-${suffix}`,
    layer,
    specialty,
    displayName: preset ? `${preset.displayName} · 自定义` : '自定义成员',
    personaKey: `${layer}:${specialty}:custom-${suffix}`,
    toolsets: preset ? [...preset.toolsets] : ['read'],
    required: false,
  };
}

function duplicateSlot(slot: TeamMemberSlotInput): TeamMemberSlotInput {
  const suffix = randomSuffix();
  return {
    ...slot,
    id: `${slot.id}-copy-${suffix}`,
    displayName: `${slot.displayName} · 副本`,
    personaKey: `${slot.personaKey}:copy-${suffix}`,
    required: false,
    toolsets: [...slot.toolsets],
  };
}

export function TeamDefaultRosterSection({
  gatewayUrl,
  onSaved,
  token,
  teamWorkspaceId,
}: TeamDefaultRosterSectionProps) {
  const {
    applyWorkspace,
    error: loadError,
    loading,
    refresh,
    workspace,
  } = useTeamDefaultRosterState({
    gatewayUrl,
    teamWorkspaceId,
    token,
  });
  const client = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);
  const { createTemplate } = useTeamWorkflowTemplates();
  /** 「存为模板」进行中标记。 */
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [draftRoster, setDraftRoster] = useState<TeamMemberSlotInput[]>(() => cloneDefaultRoster());
  const [baseline, setBaseline] = useState(serializeRoster(cloneDefaultRoster()));
  const [feedback, setFeedback] = useState<SaveFeedback>({ kind: 'idle' });
  const lastHydratedWorkspaceKeyRef = useRef<string | null>(null);

  const dirty = serializeRoster(draftRoster) !== baseline;

  useEffect(() => {
    if (!workspace) {
      return;
    }
    const nextRoster = workspace.defaultTeamRoster.length
      ? workspace.defaultTeamRoster
      : cloneDefaultRoster();
    const nextBaseline = serializeRoster(nextRoster);
    const nextWorkspaceKey = `${workspace.id}:${workspace.updatedAt}`;
    const previousWorkspaceKey = lastHydratedWorkspaceKeyRef.current;
    const workspaceChanged =
      previousWorkspaceKey === null || !previousWorkspaceKey.startsWith(`${workspace.id}:`);
    if (workspaceChanged || !dirty) {
      setWorkspaceName(workspace.name);
      setDraftRoster(cloneRoster(nextRoster));
      setBaseline(nextBaseline);
      lastHydratedWorkspaceKeyRef.current = nextWorkspaceKey;
      setFeedback({ kind: 'idle' });
      return;
    }
    setWorkspaceName(workspace.name);
    setBaseline(nextBaseline);
    lastHydratedWorkspaceKeyRef.current = nextWorkspaceKey;
  }, [dirty, workspace]);

  const groupedRoster = useMemo(() => {
    const map = new Map<TeamRuntimeLayer, TeamMemberSlotInput[]>();
    for (const layer of TEAM_RUNTIME_LAYER_ORDER) {
      map.set(
        layer,
        draftRoster.filter((slot) => slot.layer === layer),
      );
    }
    return map;
  }, [draftRoster]);

  const updateSlot = (slotId: string, patch: Partial<TeamMemberSlotInput>) => {
    setDraftRoster((current) =>
      current.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              ...patch,
              toolsets: patch.toolsets ? [...patch.toolsets] : [...slot.toolsets],
            }
          : slot,
      ),
    );
  };

  const removeSlot = (slotId: string) => {
    setDraftRoster((current) => current.filter((slot) => slot.id !== slotId));
  };

  const handleSave = async () => {
    if (!teamWorkspaceId) return;
    const rosterToSave = draftRoster.length > 0 ? draftRoster : cloneDefaultRoster();
    setFeedback({ kind: 'saving', message: '正在保存默认固定团队…' });
    try {
      const next = await client.updateWorkspace(token, teamWorkspaceId, {
        defaultTeamRoster: rosterToSave,
      });
      const nextRoster = next.defaultTeamRoster.length
        ? next.defaultTeamRoster
        : cloneDefaultRoster();
      applyWorkspace(next);
      setWorkspaceName(next.name);
      setDraftRoster(cloneRoster(nextRoster));
      setBaseline(serializeRoster(nextRoster));
      lastHydratedWorkspaceKeyRef.current = `${next.id}:${next.updatedAt}`;
      setFeedback({ kind: 'success', message: `已保存 ${nextRoster.length} 个默认成员` });
      onSaved?.();
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : '保存默认固定团队失败',
      });
    }
  };

  const handleSaveAsTemplate = async () => {
    const rosterToSave = draftRoster.length > 0 ? draftRoster : cloneDefaultRoster();
    const defaultName = `${workspaceName || '团队'} 模板`;
    const name =
      typeof window !== 'undefined'
        ? window.prompt('把当前固定团队 roster 存为可复用模板，请输入模板名称：', defaultName)
        : defaultName;
    if (name === null) return; // 用户取消
    const trimmed = name.trim() || defaultName;
    setSavingTemplate(true);
    setFeedback({ kind: 'saving', message: '正在存为模板…' });
    try {
      const ok = await createTemplate({
        name: trimmed,
        provider: '',
        optionalAgentIds: [],
        memberSlots: rosterToSave,
      });
      setFeedback(
        ok
          ? { kind: 'success', message: `已存为模板「${trimmed}」，可在团队模板页编辑复用` }
          : { kind: 'error', message: '存为模板失败' },
      );
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : '存为模板失败',
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  if (!teamWorkspaceId) {
    return (
      <div style={PANEL_STYLE}>
        <strong style={{ fontSize: 13 }}>默认固定团队</strong>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          选择一个具体的 team workspace 后才能编辑默认成员 roster。
        </span>
      </div>
    );
  }

  return (
    <div style={PANEL_STYLE}>
      <header style={HEADER_STYLE}>
        <div style={{ display: 'grid', gap: 3 }}>
          <strong style={{ fontSize: 13 }}>默认固定团队</strong>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            {workspaceName || '当前工作区'} · {draftRoster.length} 个可见人物
            {dirty ? ' · 有未保存修改' : ' · 已同步'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={SECONDARY_BUTTON_STYLE} onClick={() => refresh()}>
            刷新
          </button>
          <button
            type="button"
            style={SECONDARY_BUTTON_STYLE}
            onClick={() => {
              const defaults = cloneDefaultRoster();
              setDraftRoster(defaults);
              setFeedback({ kind: 'idle' });
            }}
          >
            恢复系统默认
          </button>
          <button
            type="button"
            style={SECONDARY_BUTTON_STYLE}
            onClick={() => void handleSaveAsTemplate()}
            disabled={savingTemplate}
            title="把当前固定团队 roster 沉淀为可复用的团队模板"
          >
            {savingTemplate ? '存为模板…' : '⤴ 存为模板'}
          </button>
          <button
            type="button"
            style={{ ...PRIMARY_BUTTON_STYLE, opacity: dirty && !loading ? 1 : 0.55 }}
            disabled={!dirty || loading || feedback.kind === 'saving'}
            onClick={() => void handleSave()}
          >
            保存 roster
          </button>
        </div>
      </header>

      <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>
        这份成员表会作为新 Team Session 的默认人物快照。执行层可放前端 / 后端 / DevOps /
        平台，评审层可放安全 / SRE / 可观测性。
      </span>

      {loading ? (
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>正在加载默认固定团队…</span>
      ) : null}
      {loadError ? <span style={{ fontSize: 12, color: 'var(--danger)' }}>{loadError}</span> : null}

      <div style={{ display: 'grid', gap: 10 }}>
        {TEAM_RUNTIME_LAYER_ORDER.map((layer) => {
          const slots = groupedRoster.get(layer) ?? [];
          return (
            <section key={layer} style={{ display: 'grid', gap: 8 }}>
              <header style={{ ...HEADER_STYLE, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 12 }}>{TEAM_RUNTIME_LAYER_LABELS[layer]}</strong>
                  <span style={BADGE_STYLE}>{slots.length} 人</span>
                </div>
                <button
                  type="button"
                  style={SECONDARY_BUTTON_STYLE}
                  onClick={() => setDraftRoster((current) => [...current, buildLayerSlot(layer)])}
                >
                  + 新增该层成员
                </button>
              </header>

              {slots.length === 0 ? (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px dashed color-mix(in srgb, var(--border-default) 62%, transparent)',
                    color: 'var(--fg-muted)',
                    fontSize: 12,
                  }}
                >
                  这一层还没有成员。点击「新增该层成员」创建一个默认人物。
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {slots.map((slot) => {
                    const specialtyOptions = specialtyOptionsForLayer(slot.layer);
                    const options = specialtyOptions.includes(slot.specialty)
                      ? specialtyOptions
                      : [...specialtyOptions, slot.specialty];
                    return (
                      <article
                        key={slot.id}
                        style={{
                          display: 'grid',
                          gap: 8,
                          padding: 10,
                          borderRadius: 12,
                          border:
                            '1px solid color-mix(in srgb, var(--border-default) 64%, transparent)',
                          background: 'color-mix(in srgb, var(--bg-base) 42%, transparent)',
                        }}
                      >
                        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1.4fr 1fr' }}>
                          <label style={{ display: 'grid', gap: 4, fontSize: 11 }}>
                            <span style={{ color: 'var(--fg-muted)' }}>人物名称</span>
                            <input
                              value={slot.displayName}
                              onChange={(event) =>
                                updateSlot(slot.id, { displayName: event.target.value })
                              }
                              style={INPUT_STYLE}
                              aria-label={`${slot.displayName} 名称`}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 4, fontSize: 11 }}>
                            <span style={{ color: 'var(--fg-muted)' }}>专长</span>
                            <select
                              value={slot.specialty}
                              onChange={(event) =>
                                (() => {
                                  const nextSpecialty = event.target.value as TeamMemberSpecialty;
                                  const preset = presetForLayerSpecialty(slot.layer, nextSpecialty);
                                  updateSlot(slot.id, {
                                    specialty: nextSpecialty,
                                    personaKey:
                                      preset?.personaKey ??
                                      `${slot.layer}:${nextSpecialty}:${slot.id}`,
                                    toolsets: preset ? [...preset.toolsets] : [...slot.toolsets],
                                  });
                                })()
                              }
                              style={INPUT_STYLE}
                              aria-label={`${slot.displayName} 专长`}
                            >
                              {options.map((specialty) => (
                                <option key={specialty} value={specialty}>
                                  {SPECIALTY_LABELS[specialty]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span style={BADGE_STYLE}>{slot.personaKey}</span>
                          {slot.toolsets.map((tool) => (
                            <span key={`${slot.id}-${tool}`} style={BADGE_STYLE}>
                              {tool}
                            </span>
                          ))}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <label
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              color: 'var(--fg-default)',
                              fontSize: 12,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={slot.required}
                              onChange={(event) =>
                                updateSlot(slot.id, { required: event.target.checked })
                              }
                            />
                            固定必选
                          </label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              style={SECONDARY_BUTTON_STYLE}
                              onClick={() =>
                                setDraftRoster((current) => [...current, duplicateSlot(slot)])
                              }
                            >
                              复制
                            </button>
                            <button
                              type="button"
                              style={{
                                ...SECONDARY_BUTTON_STYLE,
                                color: 'var(--danger)',
                                borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
                              }}
                              onClick={() => removeSlot(slot.id)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {feedback.kind === 'success' ? (
        <span style={{ fontSize: 12, color: 'var(--success)' }}>{feedback.message}</span>
      ) : null}
      {feedback.kind === 'error' ? (
        <span style={{ fontSize: 12, color: 'var(--danger)' }}>{feedback.message}</span>
      ) : null}
      {feedback.kind === 'saving' ? (
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{feedback.message}</span>
      ) : null}
    </div>
  );
}
