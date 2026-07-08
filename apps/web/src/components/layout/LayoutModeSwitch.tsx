import { useUIStateStore } from '../../stores/ui/uiState.js';
import { LAYOUT_MODE_OPTIONS } from './layout-mode-options.js';
import './LayoutModeSwitch.css';

export interface LayoutModeSwitchProps {
  readonly variant?: 'inline' | 'floating';
}

export function LayoutModeSwitch({ variant = 'inline' }: LayoutModeSwitchProps) {
  const layoutMode = useUIStateStore((state) => state.workbenchLayoutMode);
  const setLayoutMode = useUIStateStore((state) => state.setWorkbenchLayoutMode);
  const floating = variant === 'floating';

  return (
    <div
      role="group"
      aria-label="布局版本切换"
      className="layout-mode-switch"
      data-floating={floating || undefined}
    >
      {LAYOUT_MODE_OPTIONS.map((option) => {
        const active = layoutMode === option.mode;

        return (
          <button
            key={option.mode}
            type="button"
            aria-pressed={active}
            title={option.title}
            className="layout-mode-switch__button"
            onClick={() => setLayoutMode(option.mode)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
