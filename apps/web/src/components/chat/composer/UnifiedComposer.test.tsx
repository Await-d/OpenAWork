// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptOptimizerResult } from '@openAwork/web-client';
import { UnifiedComposer } from './UnifiedComposer.js';

const optimizePromptMock = vi.hoisted(() => vi.fn());
const useUnifiedComposerStateMock = vi.hoisted(() => vi.fn());

vi.mock('@openAwork/web-client', () => ({
  createWorkflowsClient: vi.fn(() => ({
    optimizePrompt: optimizePromptMock,
  })),
}));

vi.mock('./ChatComposer.js', () => ({
  ChatComposer: (props: {
    onOptimizePrompt?: (text: string) => Promise<PromptOptimizerResult>;
    permissionModeControl?: React.ReactNode;
  }) => (
    <div>
      <button type="button" onClick={() => void props.onOptimizePrompt?.('请优化当前输入')}>
        触发优化
      </button>
      {props.permissionModeControl}
    </div>
  ),
}));

vi.mock('./use-unified-composer-state.js', () => ({
  useUnifiedComposerState: useUnifiedComposerStateMock,
}));

vi.mock('../image/ChatImageGenerationResultStrip.js', () => ({
  ChatImageGenerationResultStrip: () => null,
}));

vi.mock('../session/ChatPageSections.js', () => ({
  ModelPicker: () => null,
  ModelSettingsPopover: () => null,
}));

function makeUnifiedComposerProps(): React.ComponentProps<typeof UnifiedComposer> {
  return {
    variant: 'session',
    sessionId: 'session-1',
    currentUserEmail: 'user@example.com',
    gatewayUrl: 'http://localhost:3000',
    token: 'token-1',
    streaming: false,
    stoppingStream: false,
    canStopSession: false,
    stopCapability: 'none',
    sessionBusyState: null,
    providers: [],
    activeProviderId: 'openai',
    activeModelId: 'gpt-5-mini',
    activeProvider: { name: 'OpenAI', type: 'openai' },
    activeModelOption: {
      id: 'gpt-5-mini',
      label: 'GPT-5 Mini',
      supportsThinking: true,
      supportsTools: true,
      supportsVision: false,
      contextWindow: 128000,
    },
    activeModelCanConfigureThinking: true,
    activeModelTooltip: '模型说明',
    dialogueMode: 'coding',
    manualAgentId: '',
    permissionMode: 'ask',
    webSearchEnabled: true,
    thinkingEnabled: true,
    reasoningEffort: 'high',
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    onToggleWebSearch: vi.fn(),
    onThinkingEnabledChange: vi.fn(),
    onReasoningEffortChange: vi.fn(),
    onManualAgentChange: vi.fn(),
    onClearManualAgentId: vi.fn(),
  };
}

beforeEach(() => {
  optimizePromptMock.mockReset();
  optimizePromptMock.mockResolvedValue({
    requestId: 'req-1',
    originalPrompt: '请优化当前输入',
    candidates: [
      {
        id: 'candidate-1',
        text: '优化后提示词',
        improvements: ['增加约束'],
      },
    ],
    recommended: 'candidate-1',
    rationale: '更适合当前输入场景。',
    completedAt: Date.now(),
  } satisfies PromptOptimizerResult);

  useUnifiedComposerStateMock.mockReturnValue({
    input: '原始输入',
    setInput: vi.fn(),
    attachmentItems: [
      { id: 'attachment-1', name: 'a.txt', type: 'file', sizeBytes: 10 },
      { id: 'attachment-2', name: 'b.txt', type: 'file', sizeBytes: 20 },
    ],
    composerMenu: null,
    setComposerMenu: vi.fn(),
    showVoice: false,
    setShowVoice: vi.fn(),
    showModelPicker: false,
    setShowModelPicker: vi.fn(),
    showModelSettings: false,
    setShowModelSettings: vi.fn(),
    textareaRef: { current: null },
    fileInputRef: { current: null },
    modelPickerBtnRef: { current: null },
    modelSettingsBtnRef: { current: null },
    isBrowsingInputHistory: false,
    agentOptions: [],
    defaultAgentLabel: '默认 Agent',
    queuedComposerPreviews: [],
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
    imagePluginEnabled: false,
    toggleImageGenerationMode: vi.fn(),
    updateImageGenerationDefaults: vi.fn(),
    appendFiles: vi.fn(),
    handleFileChange: vi.fn(),
    removeAttachment: vi.fn(),
    enqueueComposerMessage: vi.fn(),
    removeQueuedComposerMessage: vi.fn(),
    restoreQueuedComposerMessage: vi.fn(),
    handleKeyDown: vi.fn(),
    handleInputChange: vi.fn(),
    handleInputSelect: vi.fn(),
    handlePaste: vi.fn(),
    applyComposerSelection: vi.fn(),
    sendMessage: vi.fn(),
    restoreInputFromHistory: vi.fn(),
    slashCommandItems: [
      {
        id: 'slash-1',
        kind: 'slash',
        source: 'command',
        type: 'insert',
        label: '/help',
        description: '帮助',
        insertText: '/help',
        onSelect: vi.fn(),
      },
    ],
    mentionItems: [
      {
        id: 'mention-1',
        kind: 'mention',
        label: 'README',
        description: 'README.md',
        insertText: '@README.md ',
      },
    ],
    mentionSearchState: { result: null, loading: false, hasAnyEntries: false },
    attachedFiles: [],
  });
});

afterEach(() => {
  // 项目未开启 vitest globals，testing-library 的自动清理不会生效，这里显式清理。
  cleanup();
  vi.restoreAllMocks();
});

describe('UnifiedComposer', () => {
  it('把当前输入环境上下文传给 optimizePrompt 请求', async () => {
    render(<UnifiedComposer {...makeUnifiedComposerProps()} />);

    fireEvent.click(screen.getByText('触发优化'));

    await waitFor(() => {
      expect(optimizePromptMock).toHaveBeenCalledTimes(1);
    });

    const [token, payload] = optimizePromptMock.mock.calls[0] as [
      string,
      { context: string; originalPrompt: string },
    ];
    expect(token).toBe('token-1');
    expect(payload.originalPrompt).toBe('请优化当前输入');
    expect(payload.context).toContain('对话模式：代码协作');
    expect(payload.context).toContain('当前模型：openai / gpt-5-mini');
    expect(payload.context).toContain('联网搜索：开启');
    expect(payload.context).toContain('思考模式：开启（高）');
    expect(payload.context).toContain('附件数量：2');
    expect(payload.context).toContain('可用输入辅助：/ 命令、@ 文件');
  });

  it('features.permissionMode 为 false 时不渲染审批方式控件', () => {
    render(
      <UnifiedComposer
        {...makeUnifiedComposerProps()}
        onPermissionModeChange={vi.fn()}
        features={{ permissionMode: false }}
      />,
    );

    expect(screen.queryByRole('button', { name: '每次询问' })).toBeNull();
  });

  it('启用审批方式控件时按档位渲染并回调 onPermissionModeChange', () => {
    const onPermissionModeChange = vi.fn();
    const props = makeUnifiedComposerProps();
    const { rerender } = render(
      <UnifiedComposer {...props} onPermissionModeChange={onPermissionModeChange} />,
    );

    // permissionMode='ask' 应映射为「每次询问」档。
    const trigger = screen.getByRole('button', { name: '每次询问' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /编辑自动/ }));

    // 中档无需内联确认，直接按目标档位回调。
    expect(onPermissionModeChange).toHaveBeenCalledTimes(1);
    expect(onPermissionModeChange).toHaveBeenCalledWith('auto-edit');

    // 档位 prop 直通控件：受控值切到中间档后渲染对应标签。
    rerender(
      <UnifiedComposer
        {...props}
        permissionMode="auto-edit"
        onPermissionModeChange={onPermissionModeChange}
      />,
    );
    expect(screen.getByRole('button', { name: '编辑自动' })).toBeTruthy();
  });

  it('切换会话后重挂载控件：免审批确认会重新询问', () => {
    const onPermissionModeChange = vi.fn();
    const props = makeUnifiedComposerProps();
    const { rerender } = render(
      <UnifiedComposer {...props} onPermissionModeChange={onPermissionModeChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '每次询问' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /免审批/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认开启' }));

    rerender(
      <UnifiedComposer
        {...props}
        sessionId="session-2"
        onPermissionModeChange={onPermissionModeChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '每次询问' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /免审批/ }));

    expect(screen.getByRole('button', { name: '确认开启' })).toBeTruthy();
  });
});
