import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ModelSettingsPopover } from './model-picker-panels.js';

// 说明:这里**不 mock** `getSupportedReasoningEffortsForModel`,用于验证弹层会使用
// 模型自声明的 `reasoningOptions`(上游同步 / models.dev 迁移来的档位)而非仅按 id 推断。
afterEach(cleanup);

function renderPopover(
  reasoningOptions?: { type: string; values?: string[] }[],
): ReturnType<typeof render> {
  return render(
    <ModelSettingsPopover
      anchorRef={createRef<HTMLButtonElement>()}
      open
      onClose={vi.fn()}
      modelLabel="Relay 模型"
      // custom + 无法从 id 推断厂商的模型:只有显式声明的 reasoningOptions 才能定档位。
      providerType="custom"
      modelId="relay-only-model"
      supportsThinking
      canConfigureThinking
      {...(reasoningOptions ? { reasoningOptions } : {})}
      thinkingEnabled
      reasoningEffort="medium"
      onChangeThinkingEnabled={vi.fn()}
      onChangeReasoningEffort={vi.fn()}
    />,
  );
}

describe('ModelSettingsPopover 思考等级', () => {
  it('按模型声明的 reasoningOptions 展示档位', () => {
    renderPopover([{ type: 'effort', values: ['low', 'high'] }]);

    expect(screen.getByText('思考等级')).toBeTruthy();
    // 档位标签用中文短名渲染(与输入框工具条「思考 · 中」同一套文案)
    expect(screen.getByText('低')).toBeTruthy();
    expect(screen.getByText('高')).toBeTruthy();
    // 声明里没有 medium,就不应出现(证明用的是声明档位而非推断默认三档)
    expect(screen.queryByText('中')).toBeNull();
  });

  it('未声明 reasoningOptions 时回退到按 id 推断的默认档位', () => {
    renderPopover();

    expect(screen.getByText('低')).toBeTruthy();
    expect(screen.getByText('中')).toBeTruthy();
    expect(screen.getByText('高')).toBeTruthy();
  });
});
