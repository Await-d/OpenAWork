import type { useBuddyVoicePreferences } from '../../../components/chat/companion/use-buddy-voice-preferences.js';
import {
  SettingsOptionCardRow,
  type SettingsOptionCard,
} from '../shared/settings-option-card-row.js';
import { SS, ST } from '../shared/settings-section-styles.js';

type BuddyState = ReturnType<typeof useBuddyVoicePreferences>;
type InjectionMode = BuddyState['injectionMode'];

interface CompanionInjectionSectionProps {
  buddy: BuddyState;
}

const INJECTION_MODE_OPTIONS: SettingsOptionCard<InjectionMode>[] = [
  { label: '关闭注入', value: 'off' },
  { label: '仅 /buddy 显式点名时注入', value: 'mention_only' },
  { label: '始终注入 companion 上下文', value: 'always' },
];

/**
 * 注入策略 section：控制 companion prompt 何时进入模型上下文。
 *
 * 这一步骤只是把 companion-tab-content 里的注入选择器搬出来，没有行为变化。
 * 批次 3 会把 feature off 时的整体禁用层放在外层编排，本组件不感知 feature
 * mode。这里把原生 select 换成卡片行：三个选项都是完整语义的句子，卡片比
 * 下拉更容易被读到。
 */
export function CompanionInjectionSection({ buddy }: CompanionInjectionSectionProps) {
  const { injectionMode, setInjectionMode } = buddy;

  return (
    <section style={SS} aria-labelledby="buddy-injection-section-title">
      {/* 只清 h3 默认的 marginTop；ST 自带的 marginBottom 必须保留，否则与改造前的盒模型不一致。 */}
      <h3 id="buddy-injection-section-title" style={{ ...ST, marginTop: 0 }}>
        注入策略
      </h3>
      <SettingsOptionCardRow
        title="模型提示注入模式"
        options={INJECTION_MODE_OPTIONS}
        value={injectionMode}
        onChange={setInjectionMode}
        minCardWidth={200}
      />
      <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--fg-muted)' }}>
        推荐保留为「仅 /buddy 显式点名时注入」。这样 Buddy
        在工作台里常驻可见，但只有你明确叫它时才会进入本轮模型上下文。
      </div>
    </section>
  );
}
