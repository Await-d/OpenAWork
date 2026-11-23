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

describe('ModelManager 自动压缩设置', () => {
  it.each([
    { config: { contextWindow: 128_000 }, trigger: '108,000', budget: '13,000 tokens（默认）' },
    {
      config: {
        contextWindow: 128_000,
        contextWindowOverride: 272_000,
        maxOutputTokens: 8_000,
        autoCompactThresholdRatio: 0.8,
        autoCompactTargetRatio: 0.9,
      },
      trigger: '211,200',
      budget: '40,000 tokens',
    },
    {
      config: { contextWindow: 32_000, maxOutputTokens: 30_000, autoCompactTargetRatio: 0.1 },
      trigger: '12,000',
      budget: '10,000 tokens',
    },
    {
      config: {
        contextWindow: 50_003,
        autoCompactThresholdRatio: 0.5,
        autoCompactTargetRatio: 0.3,
      },
      trigger: '15,001',
      budget: '15,000 tokens',
    },
    { config: { contextWindow: 8_000 }, trigger: '0', budget: '13,000 tokens（默认）' },
  ])('按配置估算触发值与原文预算：$trigger / $budget', ({ config, trigger, budget }) => {
    renderManager([{ id: 'm1', label: 'M1', enabled: true, ...config }]);

    expect(screen.getByText(`估算触发阈值：${trigger} tokens`)).toBeTruthy();
    expect(screen.getByText(`近期原文保留预算：${budget}`)).toBeTruthy();
    expect(screen.queryByText(/95%|60%|压缩后回到|目标比例应低于/)).toBeNull();
    expect(screen.getByText(/服务端.*覆盖.*实际触发阈值/)).toBeTruthy();
  });

  it.each([
    { config: {}, budget: '13,000 tokens（默认）' },
    { config: { autoCompactTargetRatio: 0.6 }, budget: '模型窗口未知，无法估算' },
  ])('窗口未知时不编造估算：$budget', ({ config, budget }) => {
    renderManager([{ id: 'm1', label: 'M1', enabled: true, ...config }]);

    expect(screen.getByText('估算触发阈值：模型窗口未知，无法估算')).toBeTruthy();
    expect(screen.getByText(`近期原文保留预算：${budget}`)).toBeTruthy();
  });

  it('倍率输入只保存或清除触发倍率', () => {
    const onUpdateModel = vi.fn();
    renderManager(
      [
        {
          id: 'm1',
          label: 'M1',
          enabled: true,
          autoCompactThresholdRatio: 0.8,
          autoCompactTargetRatio: 0.3,
        },
      ],
      onUpdateModel,
    );

    const input = screen.getByRole('spinbutton', { name: 'M1 自动压缩阈值倍率' });
    fireEvent.change(input, { target: { value: '0.7' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onUpdateModel.mock.calls).toStrictEqual([
      ['custom-1', 'm1', { autoCompactThresholdRatio: 0.7 }],
      ['custom-1', 'm1', { autoCompactThresholdRatio: undefined }],
    ]);
  });
});

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
