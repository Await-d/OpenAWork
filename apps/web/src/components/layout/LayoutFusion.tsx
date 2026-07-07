/**
 * LayoutFusion — 融合布局壳。
 *
 * 仅在 workbenchLayoutMode === 'fusion' 时渲染。
 * 顶部：TitlebarTabStrip（纯标签页标题栏）
 * 左侧：FusionSidebar（Rail 64px + Panel 244px）
 * 内容：CachedRouteOutlet
 */

import { FusionSidebar } from './FusionSidebar.js';
import { TitlebarTabStrip } from './TitlebarTabStrip.js';
import { CachedRouteOutlet } from '../common/routing/CachedRouteOutlet.js';
import type { LayoutSharedState } from './useLayoutShared.js';

export interface LayoutFusionProps {
  readonly shared: LayoutSharedState;
  readonly theme: 'dark' | 'light';
  readonly onToggleTheme?: () => void;
}

export function LayoutFusion({ shared, theme, onToggleTheme }: LayoutFusionProps) {
  const {
    accessToken,
    gatewayUrl,
    clearAuth,
    navigate,
    hideGlobalSidebar,
    pendingPermissionIndicator,
  } = shared;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflow: 'hidden',
        background: 'var(--bg-base)',
      }}
    >
      {/* 顶部标签页标题栏 */}
      <div key="fusion-titlebar" className="layout-titlebar-fusion">
        <TitlebarTabStrip theme={theme} onToggleTheme={onToggleTheme} />
      </div>

      <div
        key={shared.layoutModeKey}
        className="layout-switch-wrapper"
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {!hideGlobalSidebar ? (
          <FusionSidebar
            accessToken={accessToken}
            gatewayUrl={gatewayUrl}
            theme={theme}
            onToggleTheme={onToggleTheme}
            onLogout={() => {
              clearAuth();
              void navigate('/');
            }}
            pendingPermissionIndicator={pendingPermissionIndicator}
          />
        ) : null}

        <div
          style={{
            display: 'flex',
            flex: 1,
            minWidth: 0,
            flexDirection: 'column',
            overflow: 'hidden',
            padding: 0,
            gap: 0,
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', minWidth: 0 }}>
            <div
              className="outlet-content-wrap"
              style={{
                flex: 1,
                overflow: 'hidden',
                display: 'flex',
                minWidth: 0,
                position: 'relative',
              }}
            >
              <CachedRouteOutlet />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
