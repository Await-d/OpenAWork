/** Floating bottom nav pill height (matches BottomNav container). */
export const BOTTOM_NAV_BAR_HEIGHT = 60;

/** Outer margin under the floating bottom nav pill. */
export const BOTTOM_NAV_OUTER_MARGIN = 16;

/**
 * Extra gap above the floating nav so list/footer content is not covered.
 * Pages with bottom nav should pad content by bottom-nav occupied height + this gap.
 */
export const BOTTOM_NAV_CONTENT_GAP = 12;

/** Minimum bottom inset when the device reports 0 (older Android / gesture-less). */
export const MIN_HOME_INDICATOR_INSET = 8;

/**
 * Total vertical space occupied by the floating bottom nav, including the
 * home-indicator / gesture bar safe area.
 */
export function bottomNavOccupiedHeight(bottomInset: number): number {
  const homeInset = Math.max(bottomInset, MIN_HOME_INDICATOR_INSET);
  return BOTTOM_NAV_BAR_HEIGHT + BOTTOM_NAV_OUTER_MARGIN + homeInset;
}

/** Content bottom padding so scrollable lists clear the floating bottom nav. */
export function bottomNavContentInset(bottomInset: number): number {
  return bottomNavOccupiedHeight(bottomInset) + BOTTOM_NAV_CONTENT_GAP;
}

/**
 * Routes where the floating bottom nav should be visible.
 * Chat detail has its own composer — keep the nav hidden there.
 */
export function shouldShowBottomNav(pathname: string): boolean {
  if (pathname === '/home' || pathname.startsWith('/home/')) return true;
  if (pathname === '/sessions') return true;
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return true;
  return false;
}
