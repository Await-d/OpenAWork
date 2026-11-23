/**
 * LayoutClassic — 经典布局壳。
 *
 * 仅在 workbenchLayoutMode === 'classic' 时渲染。
 * 左侧：AppSidebar
 * 内容：CachedRouteOutlet
 */

import AppSidebar from './AppSidebar.js';
import { CachedRouteOutlet } from '../common/routing/CachedRouteOutlet.js';
import type { LayoutSharedState } from './shared/useLayoutShared.js';

export interface LayoutClassicProps {
  readonly shared: LayoutSharedState;
  readonly theme: 'dark' | 'light';
  readonly onToggleTheme?: () => void;
}

export function LayoutClassic({ shared, theme, onToggleTheme }: LayoutClassicProps) {
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
        height: '100dvh',
        overflow: 'hidden',
        background: 'var(--bg-base)',
      }}
    >
      {!hideGlobalSidebar ? (
        <AppSidebar
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
        }}
      >
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', minWidth: 0 }}>
          {/* 用 <main> 作为主内容 landmark：axe 的 region 规则要求页面内容都在
              landmark 内，外壳此前全是 div，导致每个页面都被判「内容不在 landmark 内」。
              样式仍走 .outlet-content-wrap 类（无标签选择器依赖）。 */}
          <main
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
          </main>
        </div>
      </div>
    </div>
  );
}
