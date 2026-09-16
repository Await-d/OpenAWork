import type React from 'react';
import type { PromptOptimizerResult } from '@openAwork/web-client';
import type { ReasoningEffort } from '../../conversation-runtime/messages/support.js';
import type { SavedChatImageDefaults } from '../../../utils/chat/chat-session-defaults.js';
import type { ComposerOptimizeError } from './composer-optimize-error.js';
import { PromptSnippetsTrigger } from '../prompt-snippets/PromptSnippetsTrigger.js';
import { ComposerAgentChip, type ComposerAgentChipDescriptor } from './ComposerAgentChip.js';
import { ChatComposerFeatureToggles } from './ChatComposerFeatureToggles.js';
import { ChatComposerModelControls } from './ChatComposerModelControls.js';
import {
  ChatComposerPrimaryActions,
  type ComposerBusyState,
  type ComposerStopCapability,
} from './ChatComposerPrimaryActions.js';

export interface ChatComposerToolbarProps {
  readonly activeProviderId: string;
  readonly activeProviderName?: string;
  readonly activeProviderType?: string;
  readonly activeModelTooltip?: string;
  /** 当前模型显示名，用于模型按钮上的可读标签。 */
  readonly activeModelLabel?: string;
  /** 代理切换入口；仅当存在多个可选代理时由上层提供。 */
  readonly agentChip?: ComposerAgentChipDescriptor;
  readonly activeModelSupportsThinking: boolean;
  readonly thinkingEnabled: boolean;
  readonly reasoningEffort?: ReasoningEffort;
  readonly modelPickerRef: React.RefObject<HTMLButtonElement | null>;
  readonly modelSettingsRef: React.RefObject<HTMLButtonElement | null>;
  readonly showModelPicker: boolean;
  readonly showModelSettings: boolean;
  readonly showModelPickerButton: boolean;
  readonly showModelSettingsButton: boolean;
  readonly showWebSearchButton: boolean;
  readonly showImageGenerationButton: boolean;
  readonly showVoiceButton: boolean;
  readonly showAttachmentButton: boolean;
  /** 工具条左侧的「审批方式」档位选择器插槽；未提供时整个入口不渲染。 */
  readonly permissionModeControl?: React.ReactNode;
  readonly streaming: boolean;
  readonly imageGenerationBusy: boolean;
  readonly canSubmit: boolean;
  readonly webSearchEnabled: boolean;
  readonly showVoice: boolean;
  readonly imageGenerationMode: boolean;
  readonly hasConfiguredImageModel: boolean;
  readonly imageGenerationDefaults: SavedChatImageDefaults;
  readonly imageModelLabel: string;
  readonly imagePluginEnabled: boolean;
  readonly input: string;
  readonly stoppingStream: boolean;
  readonly sessionBusyState: ComposerBusyState;
  readonly effectiveStopCapability: ComposerStopCapability;
  readonly showStopAction: boolean;
  readonly showQueueAction: boolean;
  readonly queuedMessageCount: number;
  readonly optimizeError: ComposerOptimizeError | null;
  readonly optimizeLoading: boolean;
  readonly optimizeResult: PromptOptimizerResult | null;
  readonly gatewayUrl?: string;
  readonly snippetsToken?: string | null;
  readonly onInsertAtCursor?: (text: string) => void;
  readonly onRunOptimizePrompt?: () => void;
  readonly onClearOptimizeResult: () => void;
  readonly onClearOptimizeError: () => void;
  readonly onQueueMessage?: () => void | Promise<void>;
  readonly onSend: () => void | Promise<void>;
  readonly onStop: () => void | Promise<void>;
  readonly onToggleModelPicker: () => void;
  readonly onToggleModelSettings: () => void;
  readonly onToggleWebSearch: () => void;
  readonly onToggleVoice: () => void;
  readonly onRequestFiles: () => void;
  readonly onToggleImageGenerationMode: () => void;
  readonly onUpdateImageGenerationDefaults: (updates: Partial<SavedChatImageDefaults>) => void;
}

export function ChatComposerToolbar(props: ChatComposerToolbarProps) {
  return (
    <div className="composer-toolbar">
      <div className="composer-toolbar-left">
        {props.permissionModeControl}
        <ChatComposerFeatureToggles
          showWebSearchButton={props.showWebSearchButton}
          showImageGenerationButton={props.showImageGenerationButton}
          showVoiceButton={props.showVoiceButton}
          showAttachmentButton={props.showAttachmentButton}
          streaming={props.streaming}
          imageGenerationBusy={props.imageGenerationBusy}
          webSearchEnabled={props.webSearchEnabled}
          showVoice={props.showVoice}
          imageGenerationMode={props.imageGenerationMode}
          hasConfiguredImageModel={props.hasConfiguredImageModel}
          imageGenerationDefaults={props.imageGenerationDefaults}
          imageModelLabel={props.imageModelLabel}
          imagePluginEnabled={props.imagePluginEnabled}
          onToggleWebSearch={props.onToggleWebSearch}
          onToggleVoice={props.onToggleVoice}
          onRequestFiles={props.onRequestFiles}
          onToggleImageGenerationMode={props.onToggleImageGenerationMode}
          onUpdateImageGenerationDefaults={props.onUpdateImageGenerationDefaults}
        />
        {props.gatewayUrl && props.onInsertAtCursor && (
          <PromptSnippetsTrigger
            gatewayUrl={props.gatewayUrl}
            token={props.snippetsToken ?? null}
            disabled={props.streaming || props.imageGenerationBusy}
            onInject={props.onInsertAtCursor}
          />
        )}
      </div>
      {props.agentChip && (
        <ComposerAgentChip
          label={props.agentChip.label}
          overridden={props.agentChip.overridden}
          onCycle={props.agentChip.onCycle}
        />
      )}
      {/* 模型与思考等级紧邻发送按钮，与主流桌面端输入框的布局一致。 */}
      <ChatComposerModelControls
        activeProviderId={props.activeProviderId}
        activeProviderName={props.activeProviderName}
        activeProviderType={props.activeProviderType}
        activeModelTooltip={props.activeModelTooltip}
        activeModelLabel={props.activeModelLabel}
        activeModelSupportsThinking={props.activeModelSupportsThinking}
        thinkingEnabled={props.thinkingEnabled}
        reasoningEffort={props.reasoningEffort}
        modelPickerRef={props.modelPickerRef}
        modelSettingsRef={props.modelSettingsRef}
        showModelPicker={props.showModelPicker}
        showModelSettings={props.showModelSettings}
        showModelPickerButton={props.showModelPickerButton}
        showModelSettingsButton={props.showModelSettingsButton}
        onToggleModelPicker={props.onToggleModelPicker}
        onToggleModelSettings={props.onToggleModelSettings}
      />
      <ChatComposerPrimaryActions
        input={props.input}
        streaming={props.streaming}
        imageGenerationMode={props.imageGenerationMode}
        imageGenerationBusy={props.imageGenerationBusy}
        canSubmit={props.canSubmit}
        stoppingStream={props.stoppingStream}
        sessionBusyState={props.sessionBusyState}
        effectiveStopCapability={props.effectiveStopCapability}
        showStopAction={props.showStopAction}
        showQueueAction={props.showQueueAction}
        queuedMessageCount={props.queuedMessageCount}
        optimizeError={props.optimizeError}
        optimizeLoading={props.optimizeLoading}
        optimizeResult={props.optimizeResult}
        onRunOptimizePrompt={props.onRunOptimizePrompt}
        onClearOptimizeResult={props.onClearOptimizeResult}
        onClearOptimizeError={props.onClearOptimizeError}
        onQueueMessage={props.onQueueMessage}
        onSend={props.onSend}
        onStop={props.onStop}
      />
    </div>
  );
}
