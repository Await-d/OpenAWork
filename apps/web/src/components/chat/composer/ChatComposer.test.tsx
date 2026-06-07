// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from './ChatComposer.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatComposer', () => {
  it('提示词优化失败时会展示错误信息', async () => {
    render(
      <ChatComposer
        variant="session"
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
        input="优化这个提示词"
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
        onOptimizePrompt={async () => {
          throw new Error('网络异常，无法优化提示词。');
        }}
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
});
