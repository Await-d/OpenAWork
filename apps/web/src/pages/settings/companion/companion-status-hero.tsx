import { useMemo } from 'react';
import type { useBuddyVoicePreferences } from '../../../components/chat/companion/use-buddy-voice-preferences.js';
import { SS, ST } from '../shared/settings-section-styles.js';

type BuddyState = ReturnType<typeof useBuddyVoicePreferences>;

interface CompanionStatusHeroProps {
  buddy: BuddyState;
}

/**
 * Buddy 设置页顶部的 hero 区。
 *
 * 职责单一：把状态卡（feature mode + 同步状态 + 当前 profile 简介）从
 * companion-tab-content 抽出来，让主文件回归编排角色。所有数据来自
 * useBuddyVoicePreferences 返回值；本组件不发起请求、不修改状态。
 */
export function CompanionStatusHero({ buddy }: CompanionStatusHeroProps) {
  const {
    activeBinding,
    companionFeatureMode,
    isCompanionFeatureEnabled,
    profile,
    syncStatus,
    syncStatusLabel,
  } = buddy;

  const statusLabel = useMemo(() => {
    if (!isCompanionFeatureEnabled) {
      return '已关闭';
    }
    return companionFeatureMode === 'ga' ? '已启用' : 'Beta';
  }, [companionFeatureMode, isCompanionFeatureEnabled]);

  return (
    <section style={SS} aria-labelledby="buddy-status-hero-title">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 280px' }}>
          <div id="buddy-status-hero-title" style={ST}>
            Buddy 伴侣
          </div>
          <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>
            在聊天工作台里保留一个低打扰陪跑层
          </div>
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.7, color: 'var(--fg-default)' }}>
            这里控制 companion 的主开关、注入策略和交互强度。关闭后，Chat 页不再显示
            Buddy，模型侧也不会继续注入 companion 上下文。
          </div>
        </div>
        <div
          style={{
            minWidth: 180,
            borderRadius: 12,
            border: '1px solid var(--border-default)',
            padding: '12px 14px',
            background: 'var(--bg-overlay)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--fg-muted)',
            }}
          >
            当前状态
          </div>
          <div
            aria-live="polite"
            style={{
              marginTop: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-strong)' }}>
              {statusLabel}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 22,
                padding: '0 8px',
                borderRadius: 999,
                background:
                  syncStatus === 'error'
                    ? 'color-mix(in oklch, var(--danger) 14%, var(--bg-overlay))'
                    : syncStatus === 'saving'
                      ? 'color-mix(in oklch, var(--accent) 14%, var(--bg-overlay))'
                      : 'color-mix(in oklch, var(--bg-hover) 80%, var(--bg-overlay))',
                color: syncStatus === 'error' ? 'var(--danger)' : 'var(--fg-default)',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {syncStatusLabel}
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
            主控制会在你切换开关后的约 0.5 秒内自动同步；Agent 绑定需要在下方手动保存。
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--fg-muted)' }}>
            Companion prompt 与 Chat 页舞台都会跟随这里的状态变化。
          </div>
          {profile ? (
            <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6, color: 'var(--fg-default)' }}>
              {profile.name} · {profile.species}
            </div>
          ) : null}
          {activeBinding?.behaviorTone ? (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--fg-muted)' }}>
              当前绑定风格：{activeBinding.behaviorTone}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
