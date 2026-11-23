import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemorySettingsPanel } from './memory-settings-panel.js';
import type { MemorySettings } from './memory-types.js';

afterEach(cleanup);
const settings: MemorySettings = {
  enabled: true,
  autoExtract: true,
  maxTokenBudget: 2000,
  minConfidence: 0.3,
  autoWriteMinConfidence: 0.65,
  reviewLowConfidence: true,
};
describe('语义整理设置', () => {
  it('旧设置缺省关闭，并在开启前展示费用和确认边界', () => {
    const updateSettings = vi.fn(async () => undefined);
    render(
      <MemorySettingsPanel
        settings={settings}
        settingsStatus="loaded"
        updateSettings={updateSettings}
      />,
    );
    const toggle = screen.getByLabelText('切换模型语义整理');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/可能产生 API 费用/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith({ semanticMaintenance: true });
  });
  it('关闭只提交false，不改变已有确认门设置', () => {
    const updateSettings = vi.fn(async () => undefined);
    render(
      <MemorySettingsPanel
        settings={{ ...settings, semanticMaintenance: true }}
        settingsStatus="loaded"
        updateSettings={updateSettings}
      />,
    );
    fireEvent.click(screen.getByLabelText('切换模型语义整理'));
    expect(updateSettings).toHaveBeenCalledWith({ semanticMaintenance: false });
  });
});
