import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelSettingsPopover } from './model-picker-panels.js';

vi.mock('@openAwork/shared-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/shared-ui')>();
  return {
    ...actual,
    getSupportedReasoningEffortsForModel: () => [],
  };
});

afterEach(() => {
  cleanup();
});

function renderPopover(fastEnabled: boolean, onFastToggle = vi.fn()) {
  return render(
    <ModelSettingsPopover
      anchorRef={createRef<HTMLButtonElement>()}
      open
      onClose={vi.fn()}
      modelLabel="GPT-5.6"
      providerType="openai"
      modelId="gpt-5.6"
      supportsThinking={false}
      canConfigureThinking={false}
      thinkingEnabled={false}
      reasoningEffort="medium"
      onChangeThinkingEnabled={vi.fn()}
      onChangeReasoningEffort={vi.fn()}
      fastEnabled={fastEnabled}
      onFastToggle={onFastToggle}
    />,
  );
}

describe('ModelSettingsPopover', () => {
  it.each([
    [false, '未开启'],
    [true, '已开启'],
  ])('展示并同步 settings/connection 的 Fast 状态：%s', (fastEnabled, status) => {
    renderPopover(fastEnabled);

    expect(screen.getByText('Fast 快速模型')).toBeTruthy();
    expect(screen.getByText('OpenAI Fast 模式（service_tier=priority）')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(status);
    expect(screen.getByRole('switch', { name: '切换 OpenAI Fast 模式' })).toBeTruthy();
    expect(
      screen.getByText('当前开关会同步保存到设置 / 连接中的 OpenAI Provider，并立即影响后续请求。'),
    ).toBeTruthy();
  });

  it('Fast 状态重渲染时始终使用独立边框属性', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderPopover(true);
    let toggle = screen.getByRole('switch', { name: '切换 OpenAI Fast 模式' });

    expect(toggle.style.border).toBe('');
    expect(toggle.style.borderWidth).toBe('1px');
    expect(toggle.style.borderStyle).toBe('solid');
    expect(toggle.style.borderColor).toBe('var(--accent-border)');

    view.rerender(
      <ModelSettingsPopover
        anchorRef={createRef<HTMLButtonElement>()}
        open
        onClose={vi.fn()}
        modelLabel="GPT-5.6"
        providerType="openai"
        modelId="gpt-5.6"
        supportsThinking={false}
        canConfigureThinking={false}
        thinkingEnabled={false}
        reasoningEffort="medium"
        onChangeThinkingEnabled={vi.fn()}
        onChangeReasoningEffort={vi.fn()}
        fastEnabled={false}
        onFastToggle={vi.fn()}
      />,
    );
    toggle = screen.getByRole('switch', { name: '切换 OpenAI Fast 模式' });

    expect(toggle.style.border).toBe('');
    expect(toggle.style.borderColor).toBe('var(--border-default)');
    expect(
      consoleError.mock.calls.some((call) =>
        call.some(
          (value) =>
            typeof value === 'string' &&
            value.includes('Removing a style property during rerender (borderColor)'),
        ),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it('支持在聊天弹层直接切换上下文挡位', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(
      <ModelSettingsPopover
        anchorRef={createRef<HTMLButtonElement>()}
        open
        onClose={vi.fn()}
        modelLabel="GPT-5.6"
        providerType="openai"
        modelId="gpt-5.6"
        contextWindow={1_000_000}
        supportsThinking={false}
        canConfigureThinking={false}
        thinkingEnabled={false}
        reasoningEffort="medium"
        onChangeThinkingEnabled={vi.fn()}
        onChangeReasoningEffort={vi.fn()}
        onChangeContextWindowOverride={onChange}
      />,
    );

    expect(screen.getByText('自动压缩上下文')).toBeTruthy();
    expect(screen.getByRole('button', { name: '自动' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '400K' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(400_000));
  });

  it('点击 Fast 开关时调用持久化回调', async () => {
    const onFastToggle = vi.fn().mockResolvedValue(undefined);
    renderPopover(false, onFastToggle);

    fireEvent.click(screen.getByRole('switch', { name: '切换 OpenAI Fast 模式' }));

    await waitFor(() => {
      expect(onFastToggle).toHaveBeenCalledWith(true);
    });
  });

  it('持久化失败时显示错误反馈', async () => {
    const onFastToggle = vi.fn().mockRejectedValue(new Error('保存失败'));
    renderPopover(false, onFastToggle);

    fireEvent.click(screen.getByRole('switch', { name: '切换 OpenAI Fast 模式' }));

    expect((await screen.findByRole('alert')).textContent).toContain('保存失败');
  });
});
