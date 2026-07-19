import { useCallback, useMemo } from 'react';
import type { LayoutSharedState } from '../shared/useLayoutShared.js';
import type { FusionSidebarProps } from './FusionSidebar.js';
import type { TitlebarTabStripProps } from './TitlebarTabStrip.js';

export interface UseFusionLayoutOptions {
  readonly shared: LayoutSharedState;
  readonly theme: 'dark' | 'light';
  readonly onToggleTheme?: () => void;
}

export interface FusionLayoutState {
  readonly hideGlobalSidebar: boolean;
  readonly layoutModeKey: string;
  readonly sidebarProps: FusionSidebarProps;
  readonly titlebarProps: TitlebarTabStripProps;
}

export function useFusionLayout({
  shared,
  theme,
  onToggleTheme,
}: UseFusionLayoutOptions): FusionLayoutState {
  const { accessToken, clearAuth, gatewayUrl, hideGlobalSidebar, layoutModeKey, navigate } = shared;

  const handleLogout = useCallback(() => {
    clearAuth();
    void navigate('/');
  }, [clearAuth, navigate]);

  const titlebarProps = useMemo<TitlebarTabStripProps>(
    () => ({
      theme,
      onToggleTheme,
    }),
    [onToggleTheme, theme],
  );

  const sidebarProps = useMemo<FusionSidebarProps>(
    () => ({
      accessToken,
      gatewayUrl,
      theme,
      onToggleTheme,
      onLogout: handleLogout,
      pendingPermissionIndicator: shared.pendingPermissionIndicator,
    }),
    [
      accessToken,
      gatewayUrl,
      handleLogout,
      onToggleTheme,
      shared.pendingPermissionIndicator,
      theme,
    ],
  );

  return {
    hideGlobalSidebar,
    layoutModeKey,
    sidebarProps,
    titlebarProps,
  };
}
