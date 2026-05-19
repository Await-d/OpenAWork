import type { CSSProperties } from 'react';
import { useAuthStore } from '../../../stores/auth.js';
import { useBuddyVoicePreferences } from '../../../components/chat/companion/use-buddy-voice-preferences.js';
import { BuddyAgentBindingPanel } from './buddy-agent-binding-panel.js';
import { CompanionDefaultPersonaSection } from './companion-default-persona-section.js';
import { CompanionFeatureBanner } from './companion-feature-banner.js';
import { CompanionInjectionSection } from './companion-injection-section.js';
import { CompanionMainControlsSection } from './companion-main-controls-section.js';
import { CompanionPreviewTester } from './companion-preview-tester.js';
import { CompanionStatusHero } from './companion-status-hero.js';
import { CompanionVoiceSection } from './companion-voice-section.js';
import { useBuddyAgentBindingManager } from './use-buddy-agent-binding-manager.js';

/**
 * feature off 时整体禁用样式：屏蔽点击与 hover，淡化视觉。
 *
 * 故意不直接走 disabled 属性级联——很多内部控件（select / button）才
 * 接受 disabled，文本与卡片不接受。这里在外层 div 用 CSS 一次性盖住，
 * 让 banner 解释「为什么动不了」，避免每个 section 重复写禁用判断。
 */
const FEATURE_OFF_WRAPPER_STYLE: CSSProperties = {
  pointerEvents: 'none',
  opacity: 0.55,
  filter: 'saturate(0.7)',
};

/**
 * Buddy 设置 tab 编排：把 buddy hook 注入各 section，统一布局间距。
 *
 * 单职责：本文件只负责装配，不持有任何 UI 状态、不直接渲染表单控件。
 * 任何新的 section 都应：
 *   1. 在 settings/companion/ 下新建独立组件
 *   2. props 收敛为 `{ buddy: ReturnType<typeof useBuddyVoicePreferences> }`
 *      或在此基础上加最小附加参数（参考 CompanionDefaultPersonaSection 的 email）
 *   3. 在这里按用户阅读顺序插入到 grid 中
 *
 * 编排还做一件事：companionFeatureMode === 'off' 时，把除 banner 外的所有
 * section 套一层禁用 wrapper，配合 banner 提示形成完整的"已关闭"语义。
 */
export function CompanionTabContent() {
  const email = useAuthStore((state) => state.email) ?? 'guest';
  const { agentError, agentLoading, agentOptions, selectedAgentId, setSelectedAgentId } =
    useBuddyAgentBindingManager();
  const buddy = useBuddyVoicePreferences(email, selectedAgentId || undefined);

  const featureOff = buddy.companionFeatureMode === 'off';

  const sections = (
    <>
      <CompanionStatusHero buddy={buddy} />
      <CompanionMainControlsSection buddy={buddy} />
      <CompanionInjectionSection buddy={buddy} />
      <CompanionVoiceSection buddy={buddy} />
      <BuddyAgentBindingPanel
        agentError={agentError}
        agentLoading={agentLoading}
        agentOptions={agentOptions}
        bindings={buddy.bindings}
        previewProfile={buddy.profile}
        selectedAgentId={selectedAgentId}
        syncStatusLabel={buddy.syncStatusLabel}
        onRemoveBinding={buddy.removeAgentBinding}
        onSaveBinding={buddy.saveAgentBinding}
        onSelectAgentId={setSelectedAgentId}
      />
      <CompanionDefaultPersonaSection buddy={buddy} email={email} />
      <CompanionPreviewTester buddy={buddy} />
    </>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <CompanionFeatureBanner buddy={buddy} />
      {featureOff ? (
        <div
          aria-disabled="true"
          style={{ ...FEATURE_OFF_WRAPPER_STYLE, display: 'grid', gap: 16 }}
        >
          {sections}
        </div>
      ) : (
        sections
      )}
    </div>
  );
}
