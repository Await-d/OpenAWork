import { useEffect, useState } from 'react';

const COMPACT_ACTION_LABEL_QUERY = '(max-width: 520px)';
const STACKED_TEAM_TITLEBAR_QUERY = '(max-width: 640px)';

export interface TitlebarResponsiveState {
  readonly compactActionLabels: boolean;
  readonly stackedTeamTitlebar: boolean;
}

function getMediaQueryMatch(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

function useTitlebarMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => getMediaQueryMatch(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export function useTitlebarResponsiveState(): TitlebarResponsiveState {
  return {
    compactActionLabels: useTitlebarMediaQuery(COMPACT_ACTION_LABEL_QUERY),
    stackedTeamTitlebar: useTitlebarMediaQuery(STACKED_TEAM_TITLEBAR_QUERY),
  };
}
