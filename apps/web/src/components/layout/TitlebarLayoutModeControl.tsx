import { useCallback } from 'react';
import type { WorkbenchLayoutMode } from '../../stores/ui/uiState.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { CheckIcon, ChevronRightIcon } from './TitlebarIcons.js';
import {
  getLayoutModeOption,
  LAYOUT_MODE_OPTIONS,
  type LayoutModeOption,
} from './layout-mode-options.js';
import './TitlebarLayoutModeControl.css';

export interface TitlebarLayoutModeControlProps {
  readonly density?: 'normal' | 'compact';
}

export interface LayoutModeMenuItemsProps {
  readonly onSelect?: () => void;
}

function LayoutModeMenuOption({
  active,
  option,
  onSelect,
}: {
  readonly active: boolean;
  readonly option: LayoutModeOption;
  readonly onSelect: (mode: WorkbenchLayoutMode) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className="titlebar-layout-mode-menu__option"
      onClick={() => onSelect(option.mode)}
    >
      <span
        className="titlebar-layout-mode-menu__preview"
        data-mode={option.mode}
        aria-hidden="true"
      />
      <span className="titlebar-layout-mode-menu__copy">
        <span className="titlebar-layout-mode-menu__title">{option.label}</span>
        <span className="titlebar-layout-mode-menu__description">{option.description}</span>
      </span>
      {active ? <CheckIcon className="titlebar-layout-mode-menu__check" /> : null}
    </button>
  );
}

export function LayoutModeMenuItems({ onSelect }: LayoutModeMenuItemsProps) {
  const layoutMode = useUIStateStore((state) => state.workbenchLayoutMode);
  const setLayoutMode = useUIStateStore((state) => state.setWorkbenchLayoutMode);

  const handleSelect = useCallback(
    (mode: WorkbenchLayoutMode) => {
      setLayoutMode(mode);
      onSelect?.();
    },
    [onSelect, setLayoutMode],
  );

  return (
    <div className="titlebar-layout-mode-menu">
      <div className="titlebar-layout-mode-menu__label">布局版本</div>
      {LAYOUT_MODE_OPTIONS.map((option) => (
        <LayoutModeMenuOption
          key={option.mode}
          active={layoutMode === option.mode}
          option={option}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}

export function TitlebarLayoutModeControl({ density = 'normal' }: TitlebarLayoutModeControlProps) {
  const layoutMode = useUIStateStore((state) => state.workbenchLayoutMode);
  const setLayoutMode = useUIStateStore((state) => state.setWorkbenchLayoutMode);
  const activeOption = getLayoutModeOption(layoutMode);
  const nextLayoutMode = layoutMode === 'fusion' ? 'classic' : 'fusion';
  const nextOption = getLayoutModeOption(nextLayoutMode);
  const handleToggle = useCallback(() => {
    setLayoutMode(nextLayoutMode);
  }, [nextLayoutMode, setLayoutMode]);

  return (
    <div className="titlebar-layout-mode-control" data-density={density}>
      <button
        type="button"
        className="titlebar-layout-mode-control__trigger"
        aria-label={`当前布局：${activeOption.label}，点击切换到${nextOption.label}布局`}
        title={`切换到${nextOption.label}布局`}
        onClick={handleToggle}
      >
        <span className="titlebar-layout-mode-control__eyebrow">布局</span>
        <span className="titlebar-layout-mode-control__mode">{activeOption.label}</span>
        <ChevronRightIcon className="titlebar-layout-mode-control__arrow" />
        <span className="titlebar-layout-mode-control__next">{nextOption.label}</span>
      </button>
    </div>
  );
}
