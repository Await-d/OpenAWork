import type { CompanionThemeVariant } from '@openAwork/shared';
import { CompanionVisualShowcase } from '../../../components/chat/companion/companion-visual-showcase.js';
import type { useBuddyVoicePreferences } from '../../../components/chat/companion/use-buddy-voice-preferences.js';
import { BP, IS, SS, ST } from '../shared/settings-section-styles.js';

type BuddyState = ReturnType<typeof useBuddyVoicePreferences>;

interface CompanionDefaultPersonaSectionProps {
  buddy: BuddyState;
  email: string;
}

const THEME_OPTIONS: Array<{ label: string; value: CompanionThemeVariant }> = [
  { label: '默认主题', value: 'default' },
  { label: '活泼主题', value: 'playful' },
];

/**
 * 默认 Persona section：全局可改的主题 + 当前 profile 预览。
 *
 * 后端 companionPreferencesSchema 里 preferences 仅含 themeVariant；物种 /
 * 名称仅在 CompanionAgentBinding 里存在，且全局 profile 由后端基于
 * email + sub 派生。所以这一 section 不暴露物种/名称编辑——通过引导
 * 文案告诉用户去 Agent 绑定面板配置。
 */
export function CompanionDefaultPersonaSection({
  buddy,
  email,
}: CompanionDefaultPersonaSectionProps) {
  const { enabled, profile, reducedMotion, setEnabled, setThemeVariant, syncStatus, themeVariant } =
    buddy;

  return (
    <section style={SS} aria-labelledby="buddy-default-persona-title">
      <div id="buddy-default-persona-title" style={ST}>
        默认 Persona
      </div>

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>默认主题</span>
        <select
          aria-label="Buddy 默认主题"
          value={themeVariant}
          onChange={(event) => setThemeVariant(event.target.value as CompanionThemeVariant)}
          style={IS}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--fg-muted)' }}>
        全局物种与名称由账号自动派生，不在这里手动编辑。如果想为某个 Agent
        指定专属物种或自定义名称，请在下方「Agent 绑定」面板里设置。
      </div>

      {profile ? (
        <>
          <CompanionVisualShowcase
            profile={profile}
            reducedMotion={reducedMotion}
            seedBase={email}
          />
          <button type="button" style={BP} onClick={() => setEnabled(true)}>
            保持这个 Persona 在线
          </button>
        </>
      ) : (
        <div
          aria-live="polite"
          style={{
            borderRadius: 14,
            border: '1px solid var(--border-subtle)',
            padding: '14px 16px',
            background: 'var(--bg-overlay)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-strong)' }}>
            {syncStatus === 'loading'
              ? '正在读取 Persona 预览…'
              : syncStatus === 'error'
                ? '暂时拿不到 Persona 预览'
                : '当前还没有可展示的 Persona'}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--fg-default)' }}>
            {syncStatus === 'loading'
              ? '正在同步远端 companion 设置，预览会在读取完成后自动出现。'
              : syncStatus === 'error'
                ? '这不影响你继续调整主控制和 Agent 绑定；切换 Agent 或稍后重新进入页面后会再次读取。'
                : 'Buddy 当前仍可按默认配置工作；当远端返回 companion profile 后，这里会自动补齐预览。'}
          </div>
          {!enabled ? (
            <button type="button" style={BP} onClick={() => setEnabled(true)}>
              先启用 Buddy 伴侣
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
