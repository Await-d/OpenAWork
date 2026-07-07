import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

const MIN_HEADER_OPACITY = 0.18;

export function useStickyHeaderOpacity(
  scrollContainerRef: RefObject<HTMLElement | null>,
  groupKeys: readonly string[],
): Readonly<Record<string, number>> {
  const [opacityByKey, setOpacityByKey] = useState<Readonly<Record<string, number>>>({});

  const measure = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      setOpacityByKey({});
      return;
    }

    const headers = Array.from(container.querySelectorAll<HTMLElement>('[data-home-group-header]'));
    const nextOpacityByKey: Record<string, number> = {};

    headers.forEach((header, index) => {
      const key = header.dataset['homeGroupHeader'];
      if (!key) {
        return;
      }

      const nextHeader = headers[index + 1];
      if (!nextHeader) {
        nextOpacityByKey[key] = 1;
        return;
      }

      const distance = nextHeader.getBoundingClientRect().top - header.getBoundingClientRect().top;
      const fadeRange = Math.max(header.offsetHeight, 1);
      nextOpacityByKey[key] = Math.min(1, Math.max(MIN_HEADER_OPACITY, distance / fadeRange));
    });

    setOpacityByKey(nextOpacityByKey);
  }, [scrollContainerRef]);

  useEffect(() => {
    measure();

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    return () => {
      container.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [groupKeys, measure, scrollContainerRef]);

  return opacityByKey;
}
