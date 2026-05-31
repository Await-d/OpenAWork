/**
 * 260515-team-phase-a · T-08 / T-09 / T-10 前端
 *
 * 团队右侧 Detail Rail 的"设置"面板，集中提供：
 *   - 团队宪法（Constitution）编辑器（textarea + 字符计数 + 模板预置 + 乐观锁）
 *   - 用户长期记忆（user_memory）编辑器
 *   - 5 层 SOUL 编辑器（按 role_layer 切换）
 *   - ForceApply 按钮 + 24h 限流状态
 *   - 7 层指令栈实时预览
 *
 * 与现有 team-runtime 系列组件一致，整套使用 inline style，避免引入
 * 新的设计系统抽象（Tailwind class 也可以但 team-runtime-shell-frame
 * 的所有同级组件都是 inline style，保持一致性）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  createTeamPhaseAClient,
  HttpError,
  type ForceApplyState,
  type SoulRoleLayer,
} from '@openAwork/web-client';
import { AdapterConfigPanel } from '../../shared/WorkflowEditor.js';
import { NewTeamTemplateModal } from '../../shell/modals/NewTeamTemplateModal.js';
import { TeamDefaultRosterSection } from './team-default-roster-section.js';
import {
  useRecoverableConstitutionRead,
  useRecoverableForceApplyStateRead,
  useInstructionStackPreviewRead,
  useRecoverablePersonaRead,
  useRecoverableUserMemoryRead,
} from './use-team-phase-a-settings-read-model.js';

const ROLE_LAYER_ORDER: readonly SoulRoleLayer[] = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
];

const ROLE_LAYER_LABEL: Record<SoulRoleLayer, string> = {
  reception: '接待',
  pm1: '任务规划 PM1',
  pm2: '开发管控 PM2',
  executor: '执行',
  reviewer: '评审',
};

const PANEL_INSET_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
};

const SECTION_HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  paddingBottom: 8,
  borderBottom: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
};

const TEXTAREA_STYLE: CSSProperties = {
  width: '100%',
  minHeight: 220,
  padding: 10,
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  color: 'var(--fg-strong)',
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 12,
  lineHeight: 1.5,
  resize: 'vertical',
};

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 30,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
};

const SECONDARY_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 30,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  color: 'var(--fg-default)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

const TINY_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const ERROR_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--danger)',
  paddingTop: 4,
};

const SUCCESS_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--success)',
  paddingTop: 4,
};

interface TeamRuntimeSettingsPanelProps {
  gatewayUrl: string;
  accessToken: string | null;
  onWorkspaceChanged?: () => void;
  teamWorkspaceId: string | null;
}

interface SaveFeedback {
  kind: 'idle' | 'saving' | 'success' | 'error';
  message?: string;
}

export function TeamRuntimeSettingsPanel({
  gatewayUrl,
  accessToken,
  onWorkspaceChanged,
  teamWorkspaceId,
}: TeamRuntimeSettingsPanelProps) {
  const client = useMemo(() => createTeamPhaseAClient(gatewayUrl), [gatewayUrl]);

  if (!accessToken) {
    return (
      <section style={{ display: 'grid', gap: 12 }}>
        <header style={SECTION_HEADER_STYLE}>
          <span style={TINY_LABEL_STYLE}>Team settings</span>
          <span style={{ fontSize: 14, fontWeight: 800 }}>团队设置</span>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            登录后才可编辑团队宪法 / 用户记忆 / 角色 SOUL。
          </span>
        </header>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <header style={SECTION_HEADER_STYLE}>
        <span style={TINY_LABEL_STYLE}>Team settings</span>
        <span style={{ fontSize: 14, fontWeight: 800 }}>团队设置</span>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          编辑保存后立即生效；如要让正在进行的会话也使用新内容，可以点
          <strong>「ForceApply 应用更新」</strong>触发缓存刷新。默认固定团队会作为新会话的基础
          roster。
        </span>
      </header>

      <ForceApplySection token={accessToken} client={client} />

      <TeamDefaultRosterSection
        gatewayUrl={gatewayUrl}
        token={accessToken}
        onSaved={onWorkspaceChanged}
        teamWorkspaceId={teamWorkspaceId}
      />

      {teamWorkspaceId ? (
        <ConstitutionSection
          token={accessToken}
          client={client}
          teamWorkspaceId={teamWorkspaceId}
        />
      ) : (
        <div style={PANEL_INSET_STYLE}>
          <strong style={{ fontSize: 12 }}>团队宪法</strong>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            选择一个具体的 team workspace 后才能编辑它的宪法。
          </span>
        </div>
      )}

      <UserMemorySection token={accessToken} client={client} />

      <PersonasSection token={accessToken} client={client} />

      <AdapterConfigPanel />

      <InstructionStackPreviewSection
        token={accessToken}
        client={client}
        teamWorkspaceId={teamWorkspaceId}
      />

      <TemplateManagementEntry />
    </section>
  );
}

// ─── ForceApply ─────────────────────────────────────────────────────────────

function ForceApplySection({
  token,
  client,
}: {
  token: string;
  client: ReturnType<typeof createTeamPhaseAClient>;
}) {
  const {
    applyState,
    error: loadError,
    loading: loadLoading,
    refresh,
    state,
  } = useRecoverableForceApplyStateRead({
    client,
    token,
  });
  const [feedback, setFeedback] = useState<SaveFeedback>({ kind: 'idle' });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = async () => {
    setConfirmOpen(false);
    setFeedback({ kind: 'saving' });
    try {
      const result = await client.forceApply(token);
      applyState(result.state);
      setFeedback({ kind: 'success', message: 'ForceApply 已记录，下一轮 LLM 调用会重新拼装。' });
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        const payload = err.data as { state?: ForceApplyState } | null;
        if (payload?.state) applyState(payload.state);
        setFeedback({
          kind: 'error',
          message: '24 小时内 ForceApply 已用满 5 次，请稍后再试。',
        });
        return;
      }
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : '触发 ForceApply 失败',
      });
    }
  };

  const used = state?.usedInWindow ?? 0;
  const max = state?.maxInWindow ?? 5;
  const exhausted = used >= max;

  return (
    <div style={PANEL_INSET_STYLE}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 13 }}>ForceApply 应用更新</strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {used}/{max}（24 小时窗口）
        </span>
      </header>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
        编辑宪法 / 记忆 / SOUL 后通常不需要 ForceApply——下一次新对话会自动读取。
        但如果当前正在进行的会话已经命中了旧 prompt 缓存，点这里可以让缓存破裂、强制重新拼装。
      </span>
      {loadLoading && !state ? (
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>ForceApply 状态加载中…</span>
      ) : null}
      {loadError ? <span style={ERROR_STYLE}>{loadError}</span> : null}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={{ ...PRIMARY_BUTTON_STYLE, opacity: exhausted ? 0.6 : 1 }}
          disabled={exhausted || feedback.kind === 'saving'}
          onClick={() => setConfirmOpen(true)}
        >
          触发 ForceApply
        </button>
        <button type="button" style={SECONDARY_BUTTON_STYLE} onClick={() => refresh()}>
          刷新状态
        </button>
        {state?.lastAppliedAt ? (
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            上次：{state.lastAppliedAt}
          </span>
        ) : null}
      </div>

      {confirmOpen ? (
        <div
          role="dialog"
          aria-label="ForceApply 确认对话框"
          style={{
            ...PANEL_INSET_STYLE,
            background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
          }}
        >
          <strong style={{ fontSize: 12 }}>确认触发 ForceApply？</strong>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            会让当前用户的所有进行中会话在下一轮调用时丢弃旧 prompt cache。 24 小时内最多 5 次。
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={PRIMARY_BUTTON_STYLE} onClick={() => void handleConfirm()}>
              确认
            </button>
            <button
              type="button"
              style={SECONDARY_BUTTON_STYLE}
              onClick={() => setConfirmOpen(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {feedback.kind === 'success' ? <span style={SUCCESS_STYLE}>{feedback.message}</span> : null}
      {feedback.kind === 'error' ? <span style={ERROR_STYLE}>{feedback.message}</span> : null}
    </div>
  );
}

// ─── Constitution ───────────────────────────────────────────────────────────

function ConstitutionSection({
  token,
  client,
  teamWorkspaceId,
}: {
  token: string;
  client: ReturnType<typeof createTeamPhaseAClient>;
  teamWorkspaceId: string;
}) {
  const {
    applyConstitution,
    constitution: record,
    error: loadError,
    loading: loadLoading,
    templates,
  } = useRecoverableConstitutionRead({
    client,
    teamWorkspaceId,
    token,
  });
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<SaveFeedback>({ kind: 'idle' });
  const [showPreview, setShowPreview] = useState(false);
  const draftRef = useRef('');
  const lastHydratedBodyRef = useRef('');
  const lastHydratedVersionRef = useRef<number | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    setFeedback({ kind: 'idle' });
  }, [teamWorkspaceId]);

  useEffect(() => {
    if (!record) {
      return;
    }
    const shouldHydrate =
      lastHydratedVersionRef.current === null || draftRef.current === lastHydratedBodyRef.current;
    if (shouldHydrate) {
      setDraft(record.body);
      draftRef.current = record.body;
    }
    lastHydratedBodyRef.current = record.body;
    lastHydratedVersionRef.current = record.version;
  }, [record]);

  const handleApplyTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setDraft(template.body);
  };

  const handleSave = async () => {
    if (!record) return;
    setFeedback({ kind: 'saving' });
    try {
      const next = await client.putConstitution(token, teamWorkspaceId, {
        body: draft,
        expectedVersion: record.version,
      });
      applyConstitution(next);
      setDraft(next.body);
      draftRef.current = next.body;
      lastHydratedBodyRef.current = next.body;
      lastHydratedVersionRef.current = next.version;
      setFeedback({ kind: 'success', message: `已保存 v${next.version}` });
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        setFeedback({
          kind: 'error',
          message: `版本冲突：服务端当前 v${
            (err.data as { currentVersion?: number } | null)?.currentVersion ?? '?'
          }，请刷新后再保存。`,
        });
        return;
      }
      if (err instanceof HttpError && err.status === 400) {
        const payload = err.data as { reason?: string; threat?: string } | null;
        setFeedback({
          kind: 'error',
          message: `安全扫描拒绝：${payload?.reason ?? payload?.threat ?? '未知威胁'}`,
        });
        return;
      }
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : '保存失败',
      });
    }
  };

  const charCount = draft.length;

  return (
    <div style={PANEL_INSET_STYLE}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 13 }}>团队宪法</strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          v{record?.version ?? 0} · {charCount.toLocaleString()} 字符
        </span>
      </header>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
        长期约束的明文锚点。会被注入到每个 session 的 system prompt（7 层栈第 3 层）。
      </span>
      {loadLoading && !record ? (
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>团队宪法加载中…</span>
      ) : null}
      {loadError ? <span style={ERROR_STYLE}>{loadError}</span> : null}

      {templates.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ ...TINY_LABEL_STYLE, alignSelf: 'center' }}>套用模板：</span>
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              style={SECONDARY_BUTTON_STYLE}
              title={template.description}
              onClick={() => handleApplyTemplate(template.id)}
            >
              {template.name}
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        aria-label="团队宪法编辑器"
        style={TEXTAREA_STYLE}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={PRIMARY_BUTTON_STYLE}
          disabled={feedback.kind === 'saving' || !record}
          onClick={() => void handleSave()}
        >
          保存（v{record?.version ?? 0} → v{(record?.version ?? 0) + 1}）
        </button>
        <button
          type="button"
          style={SECONDARY_BUTTON_STYLE}
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? '收起预览' : '展开预览'}
        </button>
      </div>

      {showPreview ? (
        <pre
          style={{
            ...PANEL_INSET_STYLE,
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--fg-default)',
          }}
        >
          {draft || '（空白）'}
        </pre>
      ) : null}

      {feedback.kind === 'success' ? <span style={SUCCESS_STYLE}>{feedback.message}</span> : null}
      {feedback.kind === 'error' ? <span style={ERROR_STYLE}>{feedback.message}</span> : null}
    </div>
  );
}

// ─── User Memory ────────────────────────────────────────────────────────────

function UserMemorySection({
  token,
  client,
}: {
  token: string;
  client: ReturnType<typeof createTeamPhaseAClient>;
}) {
  const {
    applyMemory,
    error: loadError,
    loading: loadLoading,
    memory,
  } = useRecoverableUserMemoryRead({
    client,
    token,
  });
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<SaveFeedback>({ kind: 'idle' });
  const draftRef = useRef('');
  const lastHydratedBodyRef = useRef('');

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    setFeedback({ kind: 'idle' });
  }, [token]);

  useEffect(() => {
    if (!memory) {
      return;
    }
    const shouldHydrate =
      lastHydratedBodyRef.current.length === 0 || draftRef.current === lastHydratedBodyRef.current;
    if (shouldHydrate) {
      setDraft(memory.body);
      draftRef.current = memory.body;
    }
    lastHydratedBodyRef.current = memory.body;
  }, [memory]);

  const handleSave = async () => {
    setFeedback({ kind: 'saving' });
    try {
      const next = await client.putUserMemory(token, draft);
      applyMemory(next);
      lastHydratedBodyRef.current = next.body;
      draftRef.current = next.body;
      setFeedback({ kind: 'success', message: '已保存' });
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) {
        const payload = err.data as { reason?: string } | null;
        setFeedback({
          kind: 'error',
          message: `安全扫描拒绝：${payload?.reason ?? '未知威胁'}`,
        });
        return;
      }
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : '保存失败',
      });
    }
  };

  return (
    <div style={PANEL_INSET_STYLE}>
      <strong style={{ fontSize: 13 }}>个人长期记忆</strong>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
        只属于当前用户，跨工作区一致。会被注入到每个 session 的 system prompt（7 层栈第 6 层）。
      </span>
      {loadLoading && !memory ? (
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>个人长期记忆加载中…</span>
      ) : null}
      {loadError ? <span style={ERROR_STYLE}>{loadError}</span> : null}
      <textarea
        aria-label="user_memory 编辑器"
        style={{ ...TEXTAREA_STYLE, minHeight: 140 }}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
      />
      <div>
        <button
          type="button"
          style={PRIMARY_BUTTON_STYLE}
          disabled={feedback.kind === 'saving'}
          onClick={() => void handleSave()}
        >
          保存
        </button>
      </div>
      {feedback.kind === 'success' ? <span style={SUCCESS_STYLE}>{feedback.message}</span> : null}
      {feedback.kind === 'error' ? <span style={ERROR_STYLE}>{feedback.message}</span> : null}
    </div>
  );
}

// ─── Personas (SOUL) ────────────────────────────────────────────────────────

function PersonasSection({
  token,
  client,
}: {
  token: string;
  client: ReturnType<typeof createTeamPhaseAClient>;
}) {
  const [activeLayer, setActiveLayer] = useState<SoulRoleLayer>('reception');
  const {
    applyPersonaResponse,
    error: loadError,
    loading: loadLoading,
    personaResponse,
    refresh,
  } = useRecoverablePersonaRead({
    client,
    roleLayer: activeLayer,
    token,
  });
  const [draft, setDraft] = useState('');
  const [isDefault, setIsDefault] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<SaveFeedback>({ kind: 'idle' });
  const draftRef = useRef('');
  const lastHydratedSoulRef = useRef('');
  const lastHydratedLayerRef = useRef<SoulRoleLayer | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    setFeedback({ kind: 'idle' });
  }, [activeLayer]);

  useEffect(() => {
    if (!personaResponse) {
      return;
    }
    const shouldHydrate =
      lastHydratedLayerRef.current !== activeLayer ||
      draftRef.current === lastHydratedSoulRef.current;
    if (shouldHydrate) {
      setDraft(personaResponse.effective.soulMd);
      draftRef.current = personaResponse.effective.soulMd;
    }
    setIsDefault(personaResponse.effective.isDefault);
    lastHydratedSoulRef.current = personaResponse.effective.soulMd;
    lastHydratedLayerRef.current = activeLayer;
  }, [activeLayer, personaResponse]);

  const handleSave = async () => {
    setFeedback({ kind: 'saving' });
    try {
      const persona = await client.putPersona(token, activeLayer, { soulMd: draft });
      applyPersonaResponse({
        effective: {
          isDefault: false,
          soulMd: persona.soulMd,
        },
        key: persona.key,
        persona,
        roleLayer: activeLayer,
      });
      setIsDefault(false);
      setDraft(persona.soulMd);
      draftRef.current = persona.soulMd;
      lastHydratedSoulRef.current = persona.soulMd;
      lastHydratedLayerRef.current = activeLayer;
      setFeedback({ kind: 'success', message: '已保存' });
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) {
        const payload = err.data as { reason?: string } | null;
        setFeedback({
          kind: 'error',
          message: `安全扫描拒绝：${payload?.reason ?? '未知威胁'}`,
        });
        return;
      }
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : '保存失败',
      });
    }
  };

  return (
    <div style={PANEL_INSET_STYLE}>
      <strong style={{ fontSize: 13 }}>角色 SOUL（5 层）</strong>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
        每层 SOUL 是该角色 agent 的人格定义（5 维度 frontmatter + Markdown 正文）。
        默认值由系统提供，自定义后会覆盖默认值。
      </span>
      {loadLoading && !personaResponse ? (
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>角色 SOUL 加载中…</span>
      ) : null}
      {loadError ? <span style={ERROR_STYLE}>{loadError}</span> : null}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ROLE_LAYER_ORDER.map((layer) => {
          const active = layer === activeLayer;
          return (
            <button
              key={layer}
              type="button"
              style={{
                ...SECONDARY_BUTTON_STYLE,
                background: active
                  ? 'color-mix(in srgb, var(--accent) 18%, var(--bg-overlay))'
                  : SECONDARY_BUTTON_STYLE.background,
                borderColor: active
                  ? 'color-mix(in srgb, var(--accent) 50%, transparent)'
                  : SECONDARY_BUTTON_STYLE.border?.toString().includes('1px')
                    ? 'color-mix(in srgb, var(--border-default) 72%, transparent)'
                    : undefined,
                color: active ? 'var(--fg-strong)' : 'var(--fg-default)',
              }}
              onClick={() => setActiveLayer(layer)}
            >
              {ROLE_LAYER_LABEL[layer]}
            </button>
          );
        })}
      </div>

      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
        {isDefault ? '当前使用默认 SOUL' : '当前使用自定义 SOUL'} · {ROLE_LAYER_LABEL[activeLayer]}
      </span>

      <textarea
        aria-label={`${ROLE_LAYER_LABEL[activeLayer]} SOUL 编辑器`}
        style={TEXTAREA_STYLE}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={PRIMARY_BUTTON_STYLE}
          disabled={feedback.kind === 'saving'}
          onClick={() => void handleSave()}
        >
          保存
        </button>
        <button type="button" style={SECONDARY_BUTTON_STYLE} onClick={() => refresh()}>
          重置为默认
        </button>
      </div>
      {feedback.kind === 'success' ? <span style={SUCCESS_STYLE}>{feedback.message}</span> : null}
      {feedback.kind === 'error' ? <span style={ERROR_STYLE}>{feedback.message}</span> : null}
    </div>
  );
}

// ─── Instruction Stack Preview ──────────────────────────────────────────────

function InstructionStackPreviewSection({
  token,
  client,
  teamWorkspaceId,
}: {
  token: string;
  client: ReturnType<typeof createTeamPhaseAClient>;
  teamWorkspaceId: string | null;
}) {
  const [previewLayer, setPreviewLayer] = useState<SoulRoleLayer>('executor');
  const { busy, error, preview, previewInstructionStack } = useInstructionStackPreviewRead({
    client,
    token,
  });

  return (
    <div style={PANEL_INSET_STYLE}>
      <strong style={{ fontSize: 13 }}>7 层指令栈预览</strong>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
        用于核对当前 user_memory / SOUL / 宪法 等会注入哪些内容到 system prompt。
      </span>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={TINY_LABEL_STYLE}>角色：</span>
        {ROLE_LAYER_ORDER.map((layer) => (
          <button
            key={layer}
            type="button"
            style={{
              ...SECONDARY_BUTTON_STYLE,
              background:
                layer === previewLayer
                  ? 'color-mix(in srgb, var(--accent) 18%, var(--bg-overlay))'
                  : SECONDARY_BUTTON_STYLE.background,
            }}
            onClick={() => setPreviewLayer(layer)}
          >
            {ROLE_LAYER_LABEL[layer]}
          </button>
        ))}
        <button
          type="button"
          style={PRIMARY_BUTTON_STYLE}
          disabled={busy}
          onClick={() =>
            previewInstructionStack({
              teamWorkspaceId: teamWorkspaceId ?? undefined,
              roleLayer: previewLayer,
            })
          }
        >
          {busy ? '生成中…' : '生成预览'}
        </button>
      </div>

      {error ? <span style={ERROR_STYLE}>{error}</span> : null}

      {preview ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 6,
            }}
          >
            {Object.entries(preview.layers).map(([layer, present]) => (
              <span
                key={layer}
                style={{
                  ...PANEL_INSET_STYLE,
                  padding: '6px 10px',
                  fontSize: 11,
                  color: present ? 'var(--fg-strong)' : 'var(--fg-muted)',
                  borderColor: present
                    ? 'color-mix(in srgb, var(--success) 35%, transparent)'
                    : 'color-mix(in srgb, var(--border-default) 60%, transparent)',
                }}
              >
                {layer}：{present ? '已注入' : '未提供'}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            估算 tokens：{preview.estimatedTokens.toLocaleString()}
            {preview.oversize ? ' · ⚠ 超过软上限 24K' : ''}
          </span>
          <pre
            style={{
              ...PANEL_INSET_STYLE,
              maxHeight: 320,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
              fontSize: 11,
              lineHeight: 1.4,
              color: 'var(--fg-default)',
            }}
          >
            {preview.stableBlock}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

// ─── Memory Write Badge (T-10) ──────────────────────────────────────────────

/**
 * 当一次记忆写入被安全扫描拒绝时，可以在对话流里渲染这条系统消息徽章。
 * 用法：在 chat-message 渲染器里，遇到 metadata.kind === 'memory-write-blocked'
 * 的系统消息，渲染 <MemoryWriteBadge ... /> 即可。
 */
export interface MemoryWriteBadgeProps {
  field: string;
  threat: string;
  reason: string;
  sample?: string;
}

export function MemoryWriteBadge({ field, threat, reason, sample }: MemoryWriteBadgeProps) {
  return (
    <div
      role="alert"
      style={{
        ...PANEL_INSET_STYLE,
        borderColor: 'color-mix(in srgb, var(--danger) 60%, transparent)',
        background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay))',
      }}
    >
      <strong style={{ fontSize: 12 }}>记忆写入被安全扫描拒绝</strong>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
        字段：<code>{field}</code> · 威胁：<code>{threat}</code>
      </span>
      <span style={{ fontSize: 12 }}>{reason}</span>
      {sample ? (
        <code style={{ fontSize: 11, color: 'var(--fg-muted)' }}>触发片段：{sample}</code>
      ) : null}
    </div>
  );
}

// ─── Template Management Entry ──────────────────────────────────────────────

function TemplateManagementEntry() {
  const [showModal, setShowModal] = useState(false);

  return (
    <div style={PANEL_INSET_STYLE}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 13 }}>模板管理</strong>
      </header>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
        创建、编辑团队会话模板，方便快速复用已有配置。
      </span>
      <div>
        <button type="button" style={PRIMARY_BUTTON_STYLE} onClick={() => setShowModal(true)}>
          📋 模板管理
        </button>
      </div>
      {showModal ? <NewTeamTemplateModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}
