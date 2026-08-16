import { useCallback, useEffect, useRef, useState } from 'react';

interface UseToolCallExpandStateOptions {
  canExpand?: boolean;
  shouldAutoExpand: boolean;
  shouldExpandByDefault: boolean;
}

export function useToolCallExpandState({
  canExpand = true,
  shouldAutoExpand,
  shouldExpandByDefault,
}: UseToolCallExpandStateOptions): [boolean, () => void] {
  const [expanded, setExpanded] = useState(canExpand && shouldAutoExpand);
  const autoExpandedRef = useRef(canExpand && shouldAutoExpand && !shouldExpandByDefault);

  useEffect(() => {
    if (!canExpand) {
      autoExpandedRef.current = false;
      setExpanded(false);
      return;
    }

    if (shouldAutoExpand) {
      setExpanded(true);
      autoExpandedRef.current = !shouldExpandByDefault;
      return;
    }

    if (autoExpandedRef.current && !shouldExpandByDefault) {
      setExpanded(false);
    }
    autoExpandedRef.current = false;
  }, [canExpand, shouldAutoExpand, shouldExpandByDefault]);

  const toggle = useCallback(() => {
    autoExpandedRef.current = false;
    setExpanded((previous) => !previous);
  }, []);

  return [expanded, toggle];
}
