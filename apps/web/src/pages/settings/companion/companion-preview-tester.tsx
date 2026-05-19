import { useRef, useState } from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import type { useBuddyVoicePreferences } from '../../../components/chat/companion/use-buddy-voice-preferences.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { BP, IS, SS, ST } from '../shared/settings-section-styles.js';
import { pickVoiceForVariant, SUPPORTS_TTS } from './companion-voice-preview.js';

type BuddyState = ReturnType<typeof useBuddyVoicePreferences>;

interface CompanionPreviewTesterProps {
  buddy: BuddyState;
}

interface PreviewTurn {
  id: number;
  message: string;
  reply: string;
  profileName: string;
}

const HISTORY_LIMIT = 5;
const FAILURE_COOLDOWN_MS = 30_000;
const FAILURE_THRESHOLD = 3;

interface ChatResponse {
  text?: string;
  profileName?: string;
}

/**
 * Buddy 试聊预览。
 *
 * 用 POST /settings/companion/chat 让用户在保存设置前感受当前 Persona 的
 * 实际口吻。本组件不持久化历史，仅在内存里保留最近 N 条；连续失败累计到
 * 阈值时进入冷却，避免坏后端把用户拖进刷新循环。
 *
 * 启用本地播报（voiceOutputEnabled）时回复会被 speechSynthesis 朗读，
 * 复用 Buddy 自身的 voiceRate / voiceVariant 设置。
 */
export function CompanionPreviewTester({ buddy }: CompanionPreviewTesterProps) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const { voiceOutputEnabled, voiceRate, voiceVariant } = buddy;

  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<PreviewTurn[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const failuresRef = useRef(0);
  const turnIdRef = useRef(0);

  const cooldownActive = cooldownUntil > Date.now();
  const trimmed = draft.trim();
  const canSend =
    Boolean(accessToken) && trimmed.length > 0 && !submitting && !cooldownActive;
  const sendLabel = submitting
    ? '发送中…'
    : cooldownActive
      ? '稍后再试'
      : '发送';

  const speakReply = (text: string) => {
    if (!voiceOutputEnabled || !SUPPORTS_TTS || text.length === 0) return;
    const synth = globalThis.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = voiceRate;
    const voice = pickVoiceForVariant(synth.getVoices(), voiceVariant);
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  };

  const handleSend = async () => {
    if (!canSend || !accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = (await createSettingsClient(gatewayUrl).putCompanionChat(accessToken, {
        message: trimmed,
      })) as ChatResponse;
      const reply = (data.text ?? '').trim();
      const profileName = data.profileName ?? buddy.profile?.name ?? 'Buddy';
      const id = ++turnIdRef.current;
      setHistory((prev) => [{ id, message: trimmed, reply, profileName }, ...prev].slice(0, HISTORY_LIMIT));
      setDraft('');
      failuresRef.current = 0;
      speakReply(reply);
    } catch (err) {
      failuresRef.current += 1;
      if (failuresRef.current >= FAILURE_THRESHOLD) {
        setCooldownUntil(Date.now() + FAILURE_COOLDOWN_MS);
        setError('服务连续失败，已暂停 30 秒后再试。');
        failuresRef.current = 0;
      } else {
        setError(err instanceof Error ? err.message : '试聊失败，请稍后再试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section style={SS} aria-labelledby="buddy-preview-tester-title">
      <div id="buddy-preview-tester-title" style={ST}>
        试聊预览
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--fg-muted)' }}>
        发一句话，让当前 Persona 用它的口吻回你一条。这里走的是 companion chat
        路由，不会写到任何会话里；用于在保存设置前感受 Buddy 风格。
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <textarea
          aria-label="试聊输入"
          disabled={!accessToken || cooldownActive}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="例如：现在该不该提醒我休息？（Cmd/Ctrl+Enter 发送）"
          rows={2}
          style={{ ...IS, flex: '1 1 280px', minHeight: 56, padding: '8px 10px', resize: 'vertical' }}
          value={draft}
        />
        <button
          aria-disabled={!canSend}
          disabled={!canSend}
          onClick={() => {
            void handleSend();
          }}
          style={{
            ...BP,
            opacity: canSend ? 1 : 0.55,
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}
          type="button"
        >
          {sendLabel}
        </button>
      </div>

      {!accessToken ? (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>未登录无法试聊。先连接到一个 gateway。</div>
      ) : null}

      {error ? (
        <div role="alert" style={{ fontSize: 11, color: 'var(--danger)' }}>
          {error}
        </div>
      ) : null}

      {history.length > 0 ? (
        <div aria-live="polite" style={{ display: 'grid', gap: 8 }}>
          {history.map((turn) => (
            <div
              key={turn.id}
              style={{
                borderRadius: 12,
                border: '1px solid var(--border-subtle)',
                padding: '10px 12px',
                background: 'color-mix(in oklch, var(--bg-overlay) 92%, transparent)',
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>你：{turn.message}</div>
              <div style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
                <strong>{turn.profileName}：</strong>
                {turn.reply || '（无内容）'}
              </div>
            </div>
          ))}
          <button
            onClick={() => setHistory([])}
            style={{
              alignSelf: 'flex-end',
              height: 26,
              padding: '0 10px',
              borderRadius: 999,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--fg-muted)',
              fontSize: 11,
              cursor: 'pointer',
            }}
            type="button"
          >
            清空历史
          </button>
        </div>
      ) : null}
    </section>
  );
}
