// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionTabContent } from './connection-tab-content.js';

type ConnectionTabContentProps = Parameters<typeof ConnectionTabContent>[0];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
});

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function getRenderedText(): string {
  return container?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function getInputByAriaLabel(label: string): HTMLInputElement {
  const input = container?.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  return input!;
}

async function openProviderEditor(): Promise<void> {
  const editButton = Array.from(container?.querySelectorAll('button') ?? []).find(
    (button) => button.textContent?.trim() === '编辑',
  ) as HTMLButtonElement | undefined;

  act(() => {
    editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flushEffects();
}

function buildProps(
  defaultModels: ConnectionTabContentProps['providers'][number]['defaultModels'],
  handleUpdateModel = vi.fn(),
): ConnectionTabContentProps {
  return {
    providers: [
      {
        id: 'openai',
        type: 'openai',
        name: 'OpenAI',
        enabled: true,
        defaultModels,
      },
    ],
    activeSelection: {
      chat: { providerId: 'openai', modelId: 'gpt-5' },
      fast: { providerId: 'openai', modelId: 'gpt-5' },
    },
    defaultThinking: {
      chat: { enabled: false, effort: 'medium' },
      fast: { enabled: false, effort: 'medium' },
    },
    agentProfiles: [],
    hasUnsavedDefaultChanges: false,
    isSavingDefaultChanges: false,
    setActiveSelection: vi.fn(),
    setDefaultThinking: vi.fn(),
    saveDefaultModelSettings: vi.fn(),
    deleteAgentProfile: vi.fn(),
    handleAddModel: vi.fn(),
    handleRemoveModel: vi.fn(),
    handleUpdateModel,
    handleToggleModel: vi.fn(),
    handleToggleProvider: vi.fn(),
    handleEditProvider: vi.fn(),
    handleAddProvider: vi.fn(),
    mcpServers: [],
    setMcpServers: vi.fn(),
    mcpStatuses: [],
    urlInput: 'http://localhost:3000',
    setUrlInput: vi.fn(),
    saveGatewayUrl: vi.fn(),
    urlSaved: true,
    webAccessEnabled: false,
    webPort: 3000,
    portInput: '3000',
    setPortInput: vi.fn(),
    saveWebPort: vi.fn(),
    toggleWebAccess: vi.fn(),
    copied: false,
    copyAddress: vi.fn(),
    isTauri: false,
    savingUpstreamRetrySettings: false,
    setUpstreamRetryMaxRetries: vi.fn(),
    upstreamRetryMaxRetries: 3,
    saveUpstreamRetrySettings: vi.fn(),
    savedUpstreamRetryMaxRetries: 3,
  };
}

async function renderConnectionTabContent(
  defaultModels: ConnectionTabContentProps['providers'][number]['defaultModels'],
  handleUpdateModel = vi.fn(),
): Promise<void> {
  const props = buildProps(defaultModels, handleUpdateModel);

  await act(async () => {
    root?.render(<ConnectionTabContent {...props} />);
    await Promise.resolve();
  });
}

describe('ConnectionTabContent', () => {
  it('allows editing model auto-compaction ratios from the provider settings panel', async () => {
    const handleUpdateModel = vi.fn();

    await renderConnectionTabContent(
      [
        {
          id: 'gpt-5',
          label: 'GPT-5',
          enabled: true,
          contextWindow: 400_000,
          maxOutputTokens: 128_000,
          autoCompactThresholdRatio: 0.95,
          autoCompactTargetRatio: 0.6,
          supportsThinking: true,
          supportsTools: true,
        },
      ],
      handleUpdateModel,
    );
    await openProviderEditor();

    const thresholdInput = container?.querySelector(
      'input[aria-label="GPT-5 自动压缩阈值"]',
    ) as HTMLInputElement | null;
    const targetInput = container?.querySelector(
      'input[aria-label="GPT-5 压缩目标比例"]',
    ) as HTMLInputElement | null;

    expect(thresholdInput).not.toBeNull();
    expect(targetInput).not.toBeNull();
    expect(getRenderedText()).toContain(
      '自动压缩会按模型上下文预算判断，而不是按固定消息条数触发。',
    );
    expect(getRenderedText()).toContain('留空会跟随后端默认值（阈值 95%，目标 60%）。');
    expect(getRenderedText()).toContain(
      '按当前 400K 上下文，约在 380K 时触发，压缩后回到约 240K。',
    );

    act(() => {
      thresholdInput?.focus();
      setInputValue(thresholdInput!, '0.9');
    });
    await flushEffects();
    act(() => {
      thresholdInput?.blur();
    });
    await flushEffects();

    act(() => {
      targetInput?.focus();
      setInputValue(targetInput!, '0.45');
    });
    await flushEffects();
    act(() => {
      targetInput?.blur();
    });
    await flushEffects();

    expect(handleUpdateModel).toHaveBeenNthCalledWith(1, 'openai', 'gpt-5', {
      autoCompactThresholdRatio: 0.9,
    });
    expect(handleUpdateModel).toHaveBeenNthCalledWith(2, 'openai', 'gpt-5', {
      autoCompactTargetRatio: 0.45,
    });
  });

  it('shows a non-blocking warning when the target ratio is not lower than the threshold', async () => {
    await renderConnectionTabContent([
      {
        id: 'gpt-5',
        label: 'GPT-5',
        enabled: true,
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        autoCompactThresholdRatio: 0.7,
        autoCompactTargetRatio: 0.7,
      },
    ]);
    await openProviderEditor();

    expect(getRenderedText()).toContain(
      '提醒：目标比例应低于阈值，否则触发压缩后几乎没有回收空间。',
    );
  });

  it('shows a warning when threshold and target are too close', async () => {
    await renderConnectionTabContent([
      {
        id: 'gpt-5',
        label: 'GPT-5',
        enabled: true,
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        autoCompactThresholdRatio: 0.65,
        autoCompactTargetRatio: 0.6,
      },
    ]);
    await openProviderEditor();

    expect(getRenderedText()).toContain('提醒：阈值与目标过近，压缩后释放的上下文空间可能偏少。');
  });

  it('falls back to percentage-only summary when context window is unavailable', async () => {
    await renderConnectionTabContent([
      {
        id: 'gpt-5',
        label: 'GPT-5',
        enabled: true,
        autoCompactThresholdRatio: 0.95,
        autoCompactTargetRatio: 0.6,
      },
    ]);
    await openProviderEditor();

    expect(getRenderedText()).toContain('预计使用达到 95% 时触发，压缩后回到约 60%。');
  });

  it('commits undefined when a ratio input is cleared to restore backend defaults', async () => {
    const handleUpdateModel = vi.fn();

    await renderConnectionTabContent(
      [
        {
          id: 'gpt-5',
          label: 'GPT-5',
          enabled: true,
          contextWindow: 400_000,
          autoCompactThresholdRatio: 0.95,
          autoCompactTargetRatio: 0.6,
        },
      ],
      handleUpdateModel,
    );
    await openProviderEditor();

    const thresholdInput = getInputByAriaLabel('GPT-5 自动压缩阈值');

    act(() => {
      thresholdInput.focus();
      setInputValue(thresholdInput, '');
    });
    await flushEffects();
    act(() => {
      thresholdInput.blur();
    });
    await flushEffects();

    expect(handleUpdateModel).toHaveBeenCalledWith('openai', 'gpt-5', {
      autoCompactThresholdRatio: undefined,
    });
    expect(thresholdInput.value).toBe('');
  });

  it('restores the previous value and skips updates for invalid ratio input', async () => {
    const handleUpdateModel = vi.fn();

    await renderConnectionTabContent(
      [
        {
          id: 'gpt-5',
          label: 'GPT-5',
          enabled: true,
          contextWindow: 400_000,
          autoCompactThresholdRatio: 0.95,
          autoCompactTargetRatio: 0.6,
        },
      ],
      handleUpdateModel,
    );
    await openProviderEditor();

    const targetInput = getInputByAriaLabel('GPT-5 压缩目标比例');

    act(() => {
      targetInput.focus();
      setInputValue(targetInput, '1.5');
    });
    await flushEffects();
    act(() => {
      targetInput.blur();
    });
    await flushEffects();

    expect(handleUpdateModel).not.toHaveBeenCalled();
    expect(targetInput.value).toBe('0.6');
  });
});
