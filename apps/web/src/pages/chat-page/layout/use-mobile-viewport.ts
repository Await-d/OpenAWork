import { useEffect, useState } from 'react';

const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)';

function getIsMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
}

/**
 * 移动端视口检测：宽度 < 768px 时返回 true。
 * 用于在 Fusion 布局下切换底部 Tab 模式（T-F4-07）。
 */
export function useMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(getIsMobileViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const update = () => {
      setIsMobile(media.matches);
    };
    update();
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
    };
  }, []);

  return isMobile;
}
