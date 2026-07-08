import { useEffect, useRef, useState } from 'react';
import { HttpError } from '@openAwork/web-client';
import { useRecoverableConstitutionRead } from './use-team-phase-a-settings-read-model.js';
import {
  ERROR_STYLE,
  PANEL_INSET_STYLE,
  PRIMARY_BUTTON_STYLE,
  SECONDARY_BUTTON_STYLE,
  SUCCESS_STYLE,
  TEXTAREA_STYLE,
  TINY_LABEL_STYLE,
  type SaveFeedback,
  type TeamPhaseAClient,
} from './team-runtime-settings-panel-shared.js';

interface ConstitutionSectionProps {
  client: TeamPhaseAClient;
  teamWorkspaceId: string;
  token: string;
}

export function ConstitutionSection({ token, client, teamWorkspaceId }: ConstitutionSectionProps) {
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
