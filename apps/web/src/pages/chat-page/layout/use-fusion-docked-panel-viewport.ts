import { useEffect, useState } from 'react';

const DOCKED_SIDE_PANEL_QUERY = '(min-width: 1180px)';

function getCanDockSidePanel(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }

  return window.matchMedia(DOCKED_SIDE_PANEL_QUERY).matches;
}

export function useFusionDockedPanelViewport(): boolean {
  const [canDockSidePanel, setCanDockSidePanel] = useState(getCanDockSidePanel);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia(DOCKED_SIDE_PANEL_QUERY);
    const update = () => setCanDockSidePanel(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return canDockSidePanel;
}
