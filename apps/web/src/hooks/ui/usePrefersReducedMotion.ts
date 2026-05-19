import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }

  return window.matchMedia(REDUCED_MOTION_QUERY);
}

function getSnapshot(): boolean {
  return getMediaQueryList()?.matches ?? false;
}

export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => getSnapshot());

  useEffect(() => {
    const mediaQueryList = getMediaQueryList();
    if (!mediaQueryList) {
      setPrefersReducedMotion(false);
      return;
    }

    const handleChange = () => {
      setPrefersReducedMotion(mediaQueryList.matches);
    };

    setPrefersReducedMotion(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', handleChange);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}
