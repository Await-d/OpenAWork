import { useState } from 'react';
import { HttpError, type ForceApplyState } from '@openAwork/web-client';
import { useRecoverableForceApplyStateRead } from './use-team-phase-a-settings-read-model.js';
import {
  CJK_DESCRIPTION_STACK_STYLE,
  CJK_DESCRIPTION_STYLE,
  ERROR_STYLE,
  INLINE_PHRASE_STYLE,
  PANEL_INSET_STYLE,
  PRIMARY_BUTTON_STYLE,
  SECONDARY_BUTTON_STYLE,
  SUCCESS_STYLE,
  type SaveFeedback,
  type TeamPhaseAClient,
} from './team-runtime-settings-panel-shared.js';

interface ForceApplySectionProps {
  client: TeamPhaseAClient;
  token: string;
}

export function ForceApplySection({ token, client }: ForceApplySectionProps) {
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
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>ForceApply 应用更新</strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {used}/{max}（24 小时窗口）
        </span>
      </header>
      <span style={CJK_DESCRIPTION_STACK_STYLE}>
        <span>编辑宪法 / 记忆 / SOUL 后，下一次新对话会自动读取。</span>
        <span>
          如果当前会话已命中旧 prompt 缓存，可让缓存破裂，并
          <strong style={INLINE_PHRASE_STYLE}>强制重新拼装</strong>。
        </span>
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
          <span style={CJK_DESCRIPTION_STYLE}>
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
