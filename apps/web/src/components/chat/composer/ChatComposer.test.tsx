// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from './ChatComposer.js';
import { getComposerCharacterCount } from './composer-character-count.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';

function makeComposerProps(
  overrides: Partial<React.ComponentProps<typeof ChatComposer>> = {},
): React.ComponentProps<typeof ChatComposer> {
  return {
    variant: 'session',
    activeProviderId: 'openai',
    activeProviderName: 'OpenAI',
    activeProviderType: 'openai',
    modelPickerRef: { current: null },
    modelSettingsRef: { current: null },
    showModelPicker: false,
    showModelSettings: false,
    activeModelSupportsThinking: false,
    hasConfiguredImageModel: false,
    imageGenerationBusy: false,
    imageGenerationDefaults: {
      providerId: '',
      modelId: '',
      size: '1024x1024',
      quality: 'medium',
      outputFormat: 'png',
      background: 'auto',
    },
    imageGenerationMode: false,
    imageModelLabel: '',
    webSearchEnabled: false,
    thinkingEnabled: false,
    input: '',
    streaming: false,
    attachedFiles: [],
    attachmentItems: [],
    showVoice: false,
    composerMenu: null,
    slashCommandItems: [],
    mentionItems: [],
    textareaRef: { current: null },
    fileInputRef: { current: null },
    agentOptions: [],
    manualAgentId: '',
    defaultAgentLabel: '',
    onFileChange: vi.fn(),
    onInputChange: vi.fn(),
    onInputSelect: vi.fn(),
    onInputPaste: vi.fn(),
    onKeyDown: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onApplyComposerSelection: vi.fn(),
    onComposerHover: vi.fn(),
    onToggleVoice: vi.fn(),
    onVoiceTranscript: vi.fn(),
    onRemoveQueuedMessage: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onRequestFiles: vi.fn(),
    onToggleModelPicker: vi.fn(),
    onToggleModelSettings: vi.fn(),
    onToggleImageGenerationMode: vi.fn(),
    onToggleWebSearch: vi.fn(),
    onUpdateImageGenerationDefaults: vi.fn(),
    onChangeManualAgentId: vi.fn(),
    onClearManualAgentId: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  useDisplayPreferencesStore.setState({ showComposerStatsBar: true });
  vi.restoreAllMocks();
});

describe('ChatComposer', () => {
  it('按 Esc 清空输入后可以恢复', () => {
    const onReplaceInput = vi.fn();

    render(<ChatComposer {...makeComposerProps({ input: '需要暂存的草稿', onReplaceInput })} />);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    expect(onReplaceInput).toHaveBeenCalledWith('');
    fireEvent.click(screen.getByText('恢复'));
    expect(onReplaceInput).toHaveBeenLastCalledWith('需要暂存的草稿');
  });

  it('忙碌态按 Tab 会把 follow-up 加入队列', () => {
    const onQueueMessage = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <ChatComposer
        {...makeComposerProps({
          input: '继续跟进这个问题',
          sessionBusyState: 'running',
          onQueueMessage,
          onKeyDown,
        })}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });

    expect(onQueueMessage).toHaveBeenCalledTimes(1);
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(screen.getByText(/Tab \/ Enter 可排队/u)).not.toBeNull();
  });

  it('空输入连续按两次 Esc 会进入上一条用户消息的编辑态', () => {
    const onEditPreviousUserMessage = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <ChatComposer
        {...makeComposerProps({
          input: '',
          onEditPreviousUserMessage,
          onKeyDown,
        })}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onEditPreviousUserMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onEditPreviousUserMessage).toHaveBeenCalledTimes(1);
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('Esc 清空草稿后会重置上一条消息编辑计时，不会误触双 Esc', () => {
    const onEditPreviousUserMessage = vi.fn();
    const onReplaceInput = vi.fn();
    const onKeyDown = vi.fn();

    const { rerender } = render(
      <ChatComposer
        {...makeComposerProps({
          input: '',
          onEditPreviousUserMessage,
          onReplaceInput,
          onKeyDown,
        })}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    rerender(
      <ChatComposer
        {...makeComposerProps({
          input: '待清空草稿',
          onEditPreviousUserMessage,
          onReplaceInput,
          onKeyDown,
        })}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onReplaceInput).toHaveBeenCalledWith('');

    rerender(
      <ChatComposer
        {...makeComposerProps({
          input: '',
          onEditPreviousUserMessage,
          onReplaceInput,
          onKeyDown,
        })}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onEditPreviousUserMessage).not.toHaveBeenCalled();
  });

  it('历史浏览态按 Esc 会优先恢复实时草稿，而不是清空或进入上一条消息编辑', () => {
    const onRestoreInputFromHistory = vi.fn(() => true);
    const onEditPreviousUserMessage = vi.fn();
    const onReplaceInput = vi.fn();

    render(
      <ChatComposer
        {...makeComposerProps({
          input: '历史中的一条输入',
          isBrowsingInputHistory: true,
          onRestoreInputFromHistory,
          onEditPreviousUserMessage,
          onReplaceInput,
        })}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    expect(onRestoreInputFromHistory).toHaveBeenCalledTimes(1);
    expect(onEditPreviousUserMessage).not.toHaveBeenCalled();
    expect(onReplaceInput).not.toHaveBeenCalled();
  });

  it('点击代理胶囊会循环切换，并可回到默认代理', () => {
    const onChangeManualAgentId = vi.fn();
    const onClearManualAgentId = vi.fn();
    const agentOptions = [
      { id: 'agent-1', label: '代理一' },
      { id: 'agent-2', label: '代理二' },
    ];
    const defaultAgentLabel = '自动分配';
    const getAgentSwitchLabel = (label: string) => `当前代理：${label}，点击切换代理`;

    const { rerender } = render(
      <ChatComposer
        {...makeComposerProps({
          agentOptions,
          manualAgentId: '',
          defaultAgentLabel,
          onChangeManualAgentId,
          onClearManualAgentId,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: getAgentSwitchLabel(defaultAgentLabel) }));
    expect(onChangeManualAgentId).toHaveBeenCalledWith('agent-1');

    rerender(
      <ChatComposer
        {...makeComposerProps({
          agentOptions,
          manualAgentId: 'agent-2',
          defaultAgentLabel,
          onChangeManualAgentId,
          onClearManualAgentId,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: getAgentSwitchLabel('代理二') }));
    expect(onClearManualAgentId).toHaveBeenCalledTimes(1);
  });

  it('粘贴大文本时折叠为可编辑面板再插入', () => {
    const onInputPaste = vi.fn();
    const onReplaceInput = vi.fn();
    const largeText = `${'第一行内容\n'.repeat(120)}最后一行`;

    render(
      <ChatComposer {...makeComposerProps({ input: '前缀：', onInputPaste, onReplaceInput })} />,
    );

    const textarea = screen.getByRole('textbox');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError('Expected ChatComposer textbox to be a textarea.');
    }
    textarea.setSelectionRange('前缀：'.length, '前缀：'.length);

    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => largeText,
      },
    });

    expect(onInputPaste).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('粘贴的文本'));
    const editor = screen.getByLabelText('编辑粘贴文本');
    fireEvent.change(editor, { target: { value: '编辑后的长文本' } });
    fireEvent.click(screen.getByText('插入编辑后文本'));
    expect(onReplaceInput).toHaveBeenCalledWith('前缀：编辑后的长文本');
  });

  it('字符计数按上下文窗口的四分之一 token 预算提示', () => {
    const input = 'a'.repeat(850);

    render(
      <ChatComposer
        {...makeComposerProps({
          input,
          statsData: {
            totalCostUsd: 0,
            currentRoundCostUsd: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            contextUsedTokens: 0,
            contextMaxTokens: 4000,
            contextIsEstimated: false,
            messageTurns: 0,
            hiddenMessageCount: 0,
            serverTotalTurnCount: null,
            compactionCount: 0,
            childSessionCount: 0,
            sessionTaskCount: 0,
            totalDurationMs: 0,
            streaming: false,
          },
        })}
      />,
    );

    const counter = screen.getByText('850 / 1,000 字符');
    expect(counter.className).toContain('composer-char-warning');
  });

  it('字符计数 util 在超过阈值时返回 danger', () => {
    expect(getComposerCharacterCount('a'.repeat(1001), 1000).tone).toBe('danger');
  });

  it('提示词优化失败时会展示错误信息', async () => {
    render(
      <ChatComposer
        {...makeComposerProps({
          input: '优化这个提示词',
          onOptimizePrompt: async () => {
            throw new Error('网络异常，无法优化提示词。');
          },
        })}
      />,
    );

    fireEvent.click(screen.getByTitle('提示词优化'));

    await waitFor(() => {
      const alerts = screen.getAllByText((content) =>
        content.includes('网络异常，无法优化提示词。'),
      );
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  it('提示词优化失败时会对可疑错误做脱敏回退', async () => {
    render(
      <ChatComposer
        {...makeComposerProps({
          input: '优化这个提示词',
          onOptimizePrompt: async () => {
            throw new Error('AI_APICallError: 401 https://secret.example.com/token');
          },
        })}
      />,
    );

    fireEvent.click(screen.getByTitle('提示词优化'));

    expect(await screen.findByText('提示词优化失败，请稍后重试。')).toBeTruthy();
    expect(screen.queryByText(/secret\.example\.com/u)).toBeNull();
  });

  it('feature flag 关闭时不渲染 team 未接线的工具按钮', () => {
    render(
      <ChatComposer
        variant="session"
        showModelSettingsButton={false}
        showWebSearchButton={false}
        showImageGenerationButton={false}
        showVoiceButton={false}
        activeProviderId="openai"
        activeProviderName="OpenAI"
        activeProviderType="openai"
        modelPickerRef={{ current: null }}
        modelSettingsRef={{ current: null }}
        showModelPicker={false}
        showModelSettings={false}
        activeModelSupportsThinking={false}
        hasConfiguredImageModel={false}
        imageGenerationBusy={false}
        imageGenerationDefaults={{
          providerId: '',
          modelId: '',
          size: '1024x1024',
          quality: 'medium',
          outputFormat: 'png',
          background: 'auto',
        }}
        imageGenerationMode={false}
        imageModelLabel=""
        webSearchEnabled={false}
        thinkingEnabled={false}
        input=""
        streaming={false}
        attachedFiles={[]}
        attachmentItems={[]}
        showVoice={false}
        composerMenu={null}
        slashCommandItems={[]}
        mentionItems={[]}
        textareaRef={{ current: null }}
        fileInputRef={{ current: null }}
        agentOptions={[]}
        manualAgentId=""
        defaultAgentLabel=""
        onFileChange={vi.fn()}
        onInputChange={vi.fn()}
        onInputSelect={vi.fn()}
        onInputPaste={vi.fn()}
        onKeyDown={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onApplyComposerSelection={vi.fn()}
        onComposerHover={vi.fn()}
        onToggleVoice={vi.fn()}
        onVoiceTranscript={vi.fn()}
        onRemoveQueuedMessage={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onRequestFiles={vi.fn()}
        onToggleModelPicker={vi.fn()}
        onToggleModelSettings={vi.fn()}
        onToggleImageGenerationMode={vi.fn()}
        onToggleWebSearch={vi.fn()}
        onUpdateImageGenerationDefaults={vi.fn()}
        onChangeManualAgentId={vi.fn()}
        onClearManualAgentId={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('打开模型能力设置')).toBeNull();
    expect(screen.queryByTitle('开启联网搜索')).toBeNull();
    expect(screen.queryByTitle('语音输入')).toBeNull();
    expect(screen.queryByTitle('请先在设置中配置图片模型')).toBeNull();
  });

  it('关闭统计栏后退化为紧凑摘要而不是完全不展示', () => {
    useDisplayPreferencesStore.setState({ showComposerStatsBar: false });

    render(
      <ChatComposer
        {...makeComposerProps({
          input: '继续处理这个需求',
          statsData: {
            totalCostUsd: 1.25,
            currentRoundCostUsd: 0.25,
            totalInputTokens: 1200,
            totalOutputTokens: 800,
            contextUsedTokens: 500,
            contextMaxTokens: 2000,
            contextIsEstimated: false,
            messageTurns: 2,
            hiddenMessageCount: 0,
            serverTotalTurnCount: null,
            compactionCount: 0,
            childSessionCount: 0,
            sessionTaskCount: 0,
            currentRoundDurationMs: 1500,
            totalDurationMs: 3200,
            streaming: false,
          },
        })}
      />,
    );

    expect(screen.getByText('上下文')).not.toBeNull();
    expect(screen.getByText('25%')).not.toBeNull();
    expect(screen.getByText('耗时')).not.toBeNull();
    expect(screen.getByText('1.5s')).not.toBeNull();
    expect(screen.getByText('$0.250')).not.toBeNull();
    expect(screen.queryByText(/^Token$/)).toBeNull();
    expect(screen.queryByText(/^输入$/)).toBeNull();
    expect(screen.queryByText(/^输出$/)).toBeNull();
  });
});
