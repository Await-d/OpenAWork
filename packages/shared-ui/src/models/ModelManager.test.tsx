// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelManager } from './ModelManager.js';
import type { AIModelConfigItem } from './ModelManager.js';

// vitest 未启用 globals，testing-library 不会自动注册 afterEach 清理。
afterEach(cleanup);

function renderManager(
  defaultModels: AIModelConfigItem[],
  onUpdateModel?: (
    providerId: string,
    modelId: string,
    updates: Partial<AIModelConfigItem>,
  ) => void,
) {
  return render(
    <ModelManager
      provider={{ id: 'custom-1', name: '自定义渠道', defaultModels }}
      {...(onUpdateModel ? { onUpdateModel } : {})}
    />,
  );
}

describe('ModelManager 生图能力开关', () => {
  it('勾选「生图」后写入 supportsImageGeneration', () => {
    const onUpdateModel = vi.fn();

    renderManager([{ id: 'm1', label: 'M1', enabled: true }], onUpdateModel);

    fireEvent.click(screen.getByLabelText('生图'));

    expect(onUpdateModel).toHaveBeenCalledWith('custom-1', 'm1', {
      supportsImageGeneration: true,
    });
  });

  it('取消「生图」时同时清掉 4K 子能力', () => {
    const onUpdateModel = vi.fn();

    renderManager(
      [
        {
          id: 'm1',
          label: 'M1',
          enabled: true,
          supportsImageGeneration: true,
          supportsImageGeneration4K: true,
        },
      ],
      onUpdateModel,
    );

    fireEvent.click(screen.getByLabelText('生图'));

    expect(onUpdateModel).toHaveBeenCalledWith('custom-1', 'm1', {
      supportsImageGeneration: false,
      supportsImageGeneration4K: false,
    });
  });

  it('未提供 onUpdateModel 时以只读徽标展示生图能力', () => {
    renderManager([{ id: 'm1', label: 'M1', enabled: true, supportsImageGeneration: true }]);

    expect(screen.queryByLabelText('生图')).toBeNull();
    expect(screen.getByText('生图')).toBeTruthy();
  });
});
