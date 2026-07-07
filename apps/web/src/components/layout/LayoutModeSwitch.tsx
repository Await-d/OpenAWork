import type { WorkbenchLayoutMode } from '../../stores/ui/uiState.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import './LayoutModeSwitch.css';

const LAYOUT_MODE_OPTIONS = [
  { mode: 'classic', label: '经典', title: '切换到旧版经典布局' },
  { mode: 'fusion', label: '融合', title: '切换到新版融合布局' },
] as const satisfies readonly {
  readonly mode: WorkbenchLayoutMode;
  readonly label: string;
  readonly title: string;
}[];

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
