import type { WorkbenchLayoutMode } from '../../stores/ui/uiState.js';

export interface LayoutModeOption {
  readonly mode: WorkbenchLayoutMode;
  readonly label: string;
  readonly title: string;
  readonly description: string;
}

const CLASSIC_LAYOUT_MODE_OPTION: LayoutModeOption = {
  mode: 'classic',
  label: '经典',
  title: '切换到经典布局',
  description: '传统侧栏、会话标签与工作台展示',
};

const FUSION_LAYOUT_MODE_OPTION: LayoutModeOption = {
  mode: 'fusion',
  label: '融合',
  title: '切换到融合布局',
  description: 'Rail、Team 摘要与面板联动展示',
};

export const LAYOUT_MODE_OPTIONS = [CLASSIC_LAYOUT_MODE_OPTION, FUSION_LAYOUT_MODE_OPTION] as const;

export function getLayoutModeOption(mode: WorkbenchLayoutMode): LayoutModeOption {
  return mode === 'classic' ? CLASSIC_LAYOUT_MODE_OPTION : FUSION_LAYOUT_MODE_OPTION;
}
