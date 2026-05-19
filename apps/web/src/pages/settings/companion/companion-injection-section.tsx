import type { useBuddyVoicePreferences } from '../../../components/chat/companion/use-buddy-voice-preferences.js';
import { IS, SS, ST } from '../shared/settings-section-styles.js';

type BuddyState = ReturnType<typeof useBuddyVoicePreferences>;

interface CompanionInjectionSectionProps {
  buddy: BuddyState;
}

/**
 * 注入策略 section：控制 companion prompt 何时进入模型上下文。
 *
 * 这一步骤只是把 companion-tab-content 里的注入选择器原样搬出来，没有
 * 行为变化。批次 3 会把 feature off 时的整体禁用层放在外层编排，本组件
 * 不感知 feature mode。
 */
export function CompanionInjectionSection({ buddy }: CompanionInjectionSectionProps) {
  const { injectionMode, setInjectionMode } = buddy;

  return (
    <section style={SS} aria-labelledby="buddy-injection-section-title">
      <div id="buddy-injection-section-title" style={ST}>
        注入策略
      </div>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
          模型提示注入模式
        </span>
        <select
          aria-label="Buddy 注入模式"
          value={injectionMode}
          onChange={(event) => {
            const value = event.target.value;
            // 这里既然 hook 内 setter 也会 normalize，本地白名单只是为了
            // 让 onChange 直接传 union 类型给 setter，避免 TS 收窄失败。
            setInjectionMode(
              value === 'off' || value === 'always' || value === 'mention_only'
                ? value
                : 'mention_only',
            );
          }}
          style={IS}
        >
          <option value="off">关闭注入</option>
          <option value="mention_only">仅 /buddy 显式点名时注入</option>
          <option value="always">始终注入 companion 上下文</option>
        </select>
      </label>
      <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--fg-muted)' }}>
        推荐保留为「仅 /buddy 显式点名时注入」。这样 Buddy
        在工作台里常驻可见，但只有你明确叫它时才会进入本轮模型上下文。
      </div>
    </section>
  );
}
