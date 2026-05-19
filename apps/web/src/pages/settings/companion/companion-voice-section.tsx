import type { CompanionVoiceOutputMode, CompanionVoiceVariant } from '@openAwork/shared';
import type { useBuddyVoicePreferences } from '../../../components/chat/companion/use-buddy-voice-preferences.js';
import { BP, IS, SS, ST } from '../shared/settings-section-styles.js';
import {
  OUTPUT_MODE_OPTIONS,
  SUPPORTS_TTS,
  useBuddyVoicePreview,
  VOICE_VARIANT_OPTIONS,
} from './companion-voice-preview.js';

type BuddyState = ReturnType<typeof useBuddyVoicePreferences>;

interface CompanionVoiceSectionProps {
  buddy: BuddyState;
}

const RATE_LABEL_ID = 'buddy-voice-rate-label';
const RATE_OUTPUT_ID = 'buddy-voice-rate-output';

/**
 * Buddy 全局语音偏好 section。
 *
 * 控件：播报模式 / 语音变体 / 语速（slider + number 双绑定 + 试听）。
 * 这里只调 hook 暴露的 setter，hook 已包含 normalize、clamp、debounce 写
 * 远端的全部逻辑。试听完全在前端调用 speechSynthesis，不经过后端。
 */
export function CompanionVoiceSection({ buddy }: CompanionVoiceSectionProps) {
  const {
    setVoiceOutputMode,
    setVoiceRate,
    setVoiceVariant,
    voiceOutputEnabled,
    voiceOutputMode,
    voiceRate,
    voiceVariant,
  } = buddy;

  const { isPlaying, play } = useBuddyVoicePreview();

  const previewDisabled = !SUPPORTS_TTS || !voiceOutputEnabled;
  const previewHint = !SUPPORTS_TTS
    ? '当前环境不支持本地朗读（speechSynthesis 不可用）。'
    : !voiceOutputEnabled
      ? '先在「主控制」里开启「启用本地播报」再试听。'
      : `当前播放语速 ${voiceRate.toFixed(2)}x，点击下方按钮试听一段示例。`;

  return (
    <section style={SS} aria-labelledby="buddy-voice-section-title">
      <div id="buddy-voice-section-title" style={ST}>
        全局语音偏好
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--fg-muted)' }}>
        这里设置的是没有专属 Agent 绑定时 Buddy 的默认播报方式。Agent 绑定面板里的语音覆盖优先生效。
      </div>

      <div
        aria-disabled={!voiceOutputEnabled}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
          opacity: voiceOutputEnabled ? 1 : 0.6,
          transition: 'opacity 150ms ease',
        }}
      >
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>播报模式</span>
          <select
            aria-label="Buddy 播报模式"
            disabled={!voiceOutputEnabled}
            onChange={(event) => setVoiceOutputMode(event.target.value as CompanionVoiceOutputMode)}
            style={IS}
            value={voiceOutputMode}
          >
            {OUTPUT_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>语音变体</span>
          <select
            aria-label="Buddy 语音变体"
            disabled={!voiceOutputEnabled}
            onChange={(event) => setVoiceVariant(event.target.value as CompanionVoiceVariant)}
            style={IS}
            value={voiceVariant}
          >
            {VOICE_VARIANT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.hint}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'grid', gap: 6 }}>
          <span
            id={RATE_LABEL_ID}
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}
          >
            语速
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              aria-controls={RATE_OUTPUT_ID}
              aria-labelledby={RATE_LABEL_ID}
              disabled={!voiceOutputEnabled}
              max={2}
              min={0.5}
              onChange={(event) => setVoiceRate(Number(event.target.value))}
              step={0.05}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
              type="range"
              value={voiceRate}
            />
            <input
              aria-label="Buddy 语速数值"
              disabled={!voiceOutputEnabled}
              max={2}
              min={0.5}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) setVoiceRate(next);
              }}
              step={0.05}
              style={{ ...IS, width: 70, padding: '6px 8px' }}
              type="number"
              value={voiceRate.toFixed(2)}
            />
          </div>
          <output
            aria-live="polite"
            id={RATE_OUTPUT_ID}
            style={{ fontSize: 11, color: 'var(--fg-muted)' }}
          >
            当前 {voiceRate.toFixed(2)}x · 范围 0.50–2.00
          </output>
        </div>
      </div>

      <div
        style={{
          marginTop: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          padding: '10px 12px',
          background: 'var(--bg-overlay)',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 240px', fontSize: 11, color: 'var(--fg-default)' }}>
          {previewHint}
        </div>
        <button
          aria-disabled={previewDisabled}
          disabled={previewDisabled}
          onClick={() => play(voiceRate, voiceVariant)}
          style={{
            ...BP,
            opacity: previewDisabled ? 0.55 : 1,
            cursor: previewDisabled ? 'not-allowed' : 'pointer',
          }}
          type="button"
        >
          {isPlaying ? '停止试听' : '试听一段示例'}
        </button>
      </div>
    </section>
  );
}
