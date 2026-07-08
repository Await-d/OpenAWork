import { useEffect, useRef, useState } from 'react';
import { HttpError } from '@openAwork/web-client';
import { useRecoverableUserMemoryRead } from './use-team-phase-a-settings-read-model.js';
import {
  ERROR_STYLE,
  PANEL_INSET_STYLE,
  PRIMARY_BUTTON_STYLE,
  SUCCESS_STYLE,
  TEXTAREA_STYLE,
  type SaveFeedback,
  type TeamPhaseAClient,
} from './team-runtime-settings-panel-shared.js';

interface UserMemorySectionProps {
  client: TeamPhaseAClient;
  token: string;
}

export function UserMemorySection({ token, client }: UserMemorySectionProps) {
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
