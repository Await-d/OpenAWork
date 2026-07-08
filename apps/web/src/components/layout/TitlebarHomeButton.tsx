import { HomeIcon } from './TitlebarIcons.js';

export interface TitlebarHomeButtonProps {
  readonly active: boolean;
  readonly onClick: () => void;
}

export function TitlebarHomeButton({ active, onClick }: TitlebarHomeButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title="首页"
      aria-label="首页"
      className="titlebar-tab-strip__home-button"
      data-active={active || undefined}
      onClick={onClick}
    >
      <HomeIcon />
    </button>
  );
}
