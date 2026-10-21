// @vitest-environment jsdom

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker } from './model-picker-panels.js';
import type { ModelPickerProvider } from './model-picker-search.js';

afterEach(() => {
  cleanup();
});

const PICKER_PROVIDERS: ModelPickerProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    enabled: true,
    defaultModels: [{ id: 'gpt-5.4', label: 'GPT-5.4', enabled: true, supportsThinking: true }],
  },
];

function renderModelPicker(
  overrides: { onRefresh?: () => void | Promise<void>; refreshing?: boolean } = {},
) {
  return render(
    <ModelPicker
      anchorRef={createRef<HTMLButtonElement>()}
      providers={PICKER_PROVIDERS}
      activeProviderId="openai"
      activeModelId="gpt-5.4"
      onSelect={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe('ModelPicker 刷新模型列表', () => {
  it('提供 onRefresh 时渲染刷新按钮并在点击后触发', async () => {
    const onRefresh = vi.fn();

    renderModelPicker({ onRefresh });

    fireEvent.click(screen.getByRole('button', { name: '刷新模型列表' }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it('未提供 onRefresh 时不渲染刷新按钮', () => {
    renderModelPicker();

    expect(screen.queryByRole('button', { name: '刷新模型列表' })).toBeNull();
    expect(screen.getByText('1 个可用')).toBeTruthy();
  });

  it('刷新中禁用按钮并提示刷新状态', () => {
    renderModelPicker({ onRefresh: vi.fn(), refreshing: true });

    const button = screen.getByRole('button', { name: '正在刷新模型列表' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('刷新中…')).toBeTruthy();
  });
});
