import { useState } from 'react';
import type { useBuddyVoicePreferences } from '../../../components/chat/companion/use-buddy-voice-preferences.js';

type BuddyState = ReturnType<typeof useBuddyVoicePreferences>;

interface CompanionFeatureBannerProps {
  buddy: BuddyState;
}

const FEATURE_OFF_BG = 'color-mix(in oklch, var(--bg-hover) 80%, var(--bg-overlay))';
const SYNC_ERROR_BG = 'color-mix(in oklch, var(--danger) 14%, var(--bg-overlay))';

const BANNER_BASE = {
  borderRadius: 12,
  border: '1px solid var(--border-default)',
  padding: '10px 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap' as const,
};

/**
 * Buddy 设置页顶部的两类横幅。
 *
 * - companionFeatureMode === 'off'：管理员或环境配置关掉了 companion，
 *   设置页本身仍可保存（hook 会写到 user_settings），但 chat 页的 buddy
 *   shell 会停用。文案写明这是后端控制，不让用户去试图开启不存在的开关。
 * - syncStatus === 'error'：远端 GET 失败时显示红色提示并附「重试同步」
 *   按钮，调 hook.retrySync() 重新拉取。重试中 disabled 防抖。
 *
 * 两种横幅互不抢位：都满足时按 off → error 顺序竖排显示。
 */
export function CompanionFeatureBanner({ buddy }: CompanionFeatureBannerProps) {
  const { companionFeatureMode, retrySync, syncStatus } = buddy;
  const [retrying, setRetrying] = useState(false);

  const showFeatureOff = companionFeatureMode === 'off';
  const showSyncError = syncStatus === 'error';
  if (!showFeatureOff && !showSyncError) {
    return null;
  }

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retrySync();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {showFeatureOff ? (
        <div
          aria-live="polite"
          role="status"
          style={{ ...BANNER_BASE, background: FEATURE_OFF_BG, color: 'var(--fg-default)' }}
        >
          <span style={{ fontSize: 12, fontWeight: 700 }}>Buddy 伴侣已关闭</span>
          <span style={{ fontSize: 11, lineHeight: 1.6, flex: '1 1 240px', minWidth: 0 }}>
            后端 companion feature flag 当前为关闭。下方设置仍可保存，但 Chat 页的
            Buddy 入口与 prompt 注入会停用，直到管理员重新启用。
          </span>
        </div>
      ) : null}

      {showSyncError ? (
        <div
          aria-live="polite"
          role="status"
          style={{ ...BANNER_BASE, background: SYNC_ERROR_BG, color: 'var(--danger)' }}
        >
          <span style={{ fontSize: 12, fontWeight: 700 }}>同步失败</span>
          <span
            style={{
              fontSize: 11,
              lineHeight: 1.6,
              flex: '1 1 240px',
              minWidth: 0,
              color: 'var(--fg-default)',
            }}
          >
            刚才读取或保存 companion 配置时遇到问题。当前编辑仍在本地生效；点右侧重试会重新和远端同步。
          </span>
          <button
            aria-disabled={retrying}
            disabled={retrying}
            onClick={() => {
              void handleRetry();
            }}
            style={{
              height: 30,
              padding: '0 12px',
              borderRadius: 999,
              border: '1px solid var(--danger)',
              background: 'var(--bg-overlay)',
              color: 'var(--danger)',
              fontSize: 12,
              fontWeight: 700,
              cursor: retrying ? 'not-allowed' : 'pointer',
              opacity: retrying ? 0.6 : 1,
            }}
            type="button"
          >
            {retrying ? '重试中…' : '重试同步'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
