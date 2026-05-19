import type { useBuddyVoicePreferences } from '../../../components/chat/companion/use-buddy-voice-preferences.js';
import { SS, ST } from '../shared/settings-section-styles.js';

type BuddyState = ReturnType<typeof useBuddyVoicePreferences>;

interface CompanionMainControlsSectionProps {
  buddy: BuddyState;
}

interface ToggleRowProps {
  checked: boolean;
  description: string;
  label: string;
  onToggle: () => void;
}

/**
 * 单行 toggle，把 label/description/开关样式收敛在一处。仅 main-controls
 * section 内部使用，不导出；如果将来其他 section 需要相同布局可以考虑提升到
 * shared/。
 */
function ToggleRow({ checked, description, label, onToggle }: ToggleRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        padding: '10px 12px',
        background: 'color-mix(in oklch, var(--bg-overlay) 92%, transparent)',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>{label}</div>
        <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.5, color: 'var(--fg-muted)' }}>
          {description}
        </div>
      </div>
      <button
        type="button"
        aria-label={label}
        aria-pressed={checked}
        onClick={onToggle}
        style={{
          position: 'relative',
          width: 42,
          height: 24,
          borderRadius: 999,
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          background: checked ? 'var(--accent)' : 'var(--border-default)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 20 : 2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'var(--bg-overlay)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
            transition: 'left 180ms ease',
          }}
        />
      </button>
    </div>
  );
}

/**
 * Buddy 主控制 section：5 个全局开关 + 恢复默认按钮。
 *
 * 这一步骤主要从 companion-tab-content 抽出 JSX。批次 3.3 在底部追加
 * 「恢复默认偏好」按钮——它只重置 preferences（hook 暴露的
 * resetPreferencesToDefault 内部走相同的 dirty tracking + 防抖 PUT 链路），
 * 不影响任何 Agent 绑定。
 *
 * 外层在 feature off 时会套禁用 wrapper（见 companion-tab-content），所以
 * 这里不感知 feature mode。
 */
export function CompanionMainControlsSection({ buddy }: CompanionMainControlsSectionProps) {
  const {
    enabled,
    muted,
    quietMode,
    reducedMotion,
    resetPreferencesToDefault,
    setEnabled,
    setMuted,
    setQuietMode,
    setReducedMotion,
    setVoiceOutputEnabled,
    voiceOutputEnabled,
  } = buddy;

  const handleResetClick = () => {
    if (typeof globalThis.window === 'undefined') {
      resetPreferencesToDefault();
      return;
    }
    const confirmed = globalThis.window.confirm(
      '确认恢复 Buddy 偏好为默认值吗？已绑定 Agent 的专属配置不受影响。',
    );
    if (confirmed) {
      resetPreferencesToDefault();
    }
  };

  return (
    <section style={SS} aria-labelledby="buddy-main-controls-title">
      <div id="buddy-main-controls-title" style={ST}>
        主控制
      </div>
      <ToggleRow
        checked={enabled}
        label="启用 Buddy 伴侣"
        description="关闭后，聊天页隐藏 Buddy，request-scoped companion prompt 也会停用。"
        onToggle={() => setEnabled((value) => !value)}
      />
      <ToggleRow
        checked={voiceOutputEnabled}
        label="启用本地播报"
        description="允许 Buddy 在关键短句上用本地 TTS 出声；不影响主开关。"
        onToggle={() => setVoiceOutputEnabled((value) => !value)}
      />
      <ToggleRow
        checked={muted}
        label="静音 Buddy"
        description="保留面板与 companion prompt，但阻止当前设备的可听播报。"
        onToggle={() => setMuted((value) => !value)}
      />
      <ToggleRow
        checked={quietMode}
        label="安静模式"
        description="减少环境提示与主动表达，只保留更克制的陪跑反馈。"
        onToggle={() => setQuietMode((value) => !value)}
      />
      <ToggleRow
        checked={reducedMotion}
        label="减少动效"
        description="在 Chat 页 companion shell 中降低动画强度，适合长时间停留。"
        onToggle={() => setReducedMotion((value) => !value)}
      />
      <div
        style={{
          marginTop: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--fg-muted)', flex: '1 1 240px' }}>
          想清空一次性的实验性调整？把 Buddy 偏好恢复成出厂默认。Agent 绑定不会被动到。
        </div>
        <button
          onClick={handleResetClick}
          style={{
            height: 30,
            padding: '0 12px',
            borderRadius: 999,
            border: '1px solid var(--border-default)',
            background: 'transparent',
            color: 'var(--fg-default)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
          type="button"
        >
          恢复默认偏好
        </button>
      </div>
    </section>
  );
}
