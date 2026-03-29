import { useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

let cachedMediaQueryList: MediaQueryList | null | undefined;
let cachedMatchMedia: Window['matchMedia'] | null | undefined;

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    cachedMatchMedia = null;
    cachedMediaQueryList = null;
    return cachedMediaQueryList;
  }

  if (cachedMatchMedia === window.matchMedia && cachedMediaQueryList !== undefined) {
    return cachedMediaQueryList;
  }

  cachedMatchMedia = window.matchMedia;
  cachedMediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY);
  return cachedMediaQueryList;
}

function subscribe(onStoreChange: () => void): () => void {
  const mediaQueryList = getMediaQueryList();

  if (!mediaQueryList) {
    return () => undefined;
  }

  mediaQueryList.addEventListener('change', onStoreChange);
  return () => mediaQueryList.removeEventListener('change', onStoreChange);
}

function getSnapshot(): boolean {
  return getMediaQueryList()?.matches ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
