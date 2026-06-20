import { useEffect, useState } from 'react';

const DEFAULT_THRESHOLD_PX = 1080;

function readIsNarrow(thresholdPx: number): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.innerWidth < thresholdPx;
}

export function useNarrowConversationLayout(thresholdPx = DEFAULT_THRESHOLD_PX): boolean {
  const [isNarrow, setIsNarrow] = useState(() => readIsNarrow(thresholdPx));

  useEffect(() => {
    const update = () => setIsNarrow(readIsNarrow(thresholdPx));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [thresholdPx]);

  return isNarrow;
}
