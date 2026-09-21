import { useEffect, useState } from 'react';
import {
  OPTIMIZED_COMPACT_BREAKPOINT,
  OPTIMIZED_COMPACT_BREAKPOINT_PX,
} from './optimized-settings-layout.js';

/**
 * 设置页是否处于紧凑布局（窄屏）。
 *
 * SettingsPage 用同一断点把「左侧 nav + 内容列」折成「顶部 nav + 内容列」；各 tab
 * 内部的固定左栏 / 固定双列布局也用它退化为单列，否则 240px 固定列会把内容挤到
 * 不可用的宽度。内联样式无法表达媒体查询，所以窄屏分支必须由本 hook 提供。
 */
export function useCompactSettingsLayout(): boolean {
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(OPTIMIZED_COMPACT_BREAKPOINT).matches;
    }
    return window.innerWidth <= OPTIMIZED_COMPACT_BREAKPOINT_PX;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (typeof window.matchMedia !== 'function') {
      const updateCompactLayout = () =>
        setIsCompact(window.innerWidth <= OPTIMIZED_COMPACT_BREAKPOINT_PX);
      updateCompactLayout();
      window.addEventListener('resize', updateCompactLayout);
      return () => window.removeEventListener('resize', updateCompactLayout);
    }

    const media = window.matchMedia(OPTIMIZED_COMPACT_BREAKPOINT);
    const updateCompactLayout = () => setIsCompact(media.matches);
    updateCompactLayout();
    media.addEventListener('change', updateCompactLayout);
    return () => media.removeEventListener('change', updateCompactLayout);
  }, []);

  return isCompact;
}
