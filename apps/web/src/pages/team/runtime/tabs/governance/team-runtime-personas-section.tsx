import { useEffect, useRef, useState } from 'react';
import { HttpError, type SoulRoleLayer } from '@openAwork/web-client';
import { useRecoverablePersonaRead } from './use-team-phase-a-settings-read-model.js';
import {
  ERROR_STYLE,
  PANEL_INSET_STYLE,
  PRIMARY_BUTTON_STYLE,
  ROLE_LAYER_LABEL,
  ROLE_LAYER_ORDER,
  SECONDARY_BUTTON_STYLE,
  SUCCESS_STYLE,
  TEXTAREA_STYLE,
  type SaveFeedback,
  type TeamPhaseAClient,
} from './team-runtime-settings-panel-shared.js';

interface PersonasSectionProps {
  client: TeamPhaseAClient;
  token: string;
}

export function PersonasSection({ token, client }: PersonasSectionProps) {
  const [activeLayer, setActiveLayer] = useState<SoulRoleLayer>('reception');
  const {
    applyPersonaResponse,
    error: loadError,
    loading: loadLoading,
    personaResponse,
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

  const handleReset = async () => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        '确定要恢复为最新默认 SOUL 吗？你对该层的自定义内容会被覆盖，并跟随后续默认更新。',
      );
      if (!ok) return;
    }
    setFeedback({ kind: 'saving' });
    try {
      const result = await client.resetPersona(token, activeLayer);
      applyPersonaResponse(result);
      setIsDefault(result.effective.isDefault);
      setDraft(result.effective.soulMd);
      draftRef.current = result.effective.soulMd;
      lastHydratedSoulRef.current = result.effective.soulMd;
      lastHydratedLayerRef.current = activeLayer;
      setFeedback({ kind: 'success', message: '已恢复为最新默认' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : '恢复默认失败',
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
        <button
          type="button"
          style={SECONDARY_BUTTON_STYLE}
          disabled={feedback.kind === 'saving'}
          onClick={() => void handleReset()}
        >
          重置为默认
        </button>
      </div>
      {feedback.kind === 'success' ? <span style={SUCCESS_STYLE}>{feedback.message}</span> : null}
      {feedback.kind === 'error' ? <span style={ERROR_STYLE}>{feedback.message}</span> : null}
    </div>
  );
}
