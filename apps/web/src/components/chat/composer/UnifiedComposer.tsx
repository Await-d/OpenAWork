import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { AttachmentItem } from '@openAwork/shared-ui';
import { inferSupportsThinking } from '@openAwork/shared-ui';
import type { CommandDescriptor } from '@openAwork/shared';
import type { PromptOptimizerResult } from '@openAwork/web-client';
import { createWorkflowsClient } from '@openAwork/web-client';
import { ChatComposer } from './ChatComposer.js';
import { ChatImageGenerationResultStrip } from '../image/ChatImageGenerationResultStrip.js';
import { ModelPicker, ModelSettingsPopover } from '../session/ChatPageSections.js';
import type {
  ChatSettingsProvider,
  SavedChatImageDefaults,
} from '../../../utils/chat/chat-session-defaults.js';
import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import type {
  ComposerMenuState,
  ReasoningEffort,
  WorkspaceFileMentionItem,
} from '../../conversation-runtime/messages/support.js';
import type { ImageEditReferenceArtifact } from '../../../pages/chat-page/conversation/render/image-edit-reference-artifacts.js';
import type { ChatImageGenerationReferenceArtifact } from '../image/ChatImageGenerationControls.js';
import type { ComposerWorkspaceCatalog } from '../../../hooks/chat/useComposerWorkspaceCatalog.js';
import { useUnifiedComposerState } from './use-unified-composer-state.js';

export interface UnifiedComposerFeatures {
  attachments?: boolean;
  voice?: boolean;
  modelPicker?: boolean;
  modelSettings?: boolean;
  webSearch?: boolean;
  imageGen?: boolean;
  promptOptimize?: boolean;
  slashCommands?: boolean;
  mentions?: boolean;
  agentSwitch?: boolean;
  queuedMessages?: boolean;
}

export interface UnifiedComposerSubmitPayload {
  text: string;
  files: File[];
  attachmentItems: AttachmentItem[];
  imageGenerationMode: boolean;
  imageGenerationDefaults: SavedChatImageDefaults;
  hasConfiguredImageModel: boolean;
  selectedImageReferenceArtifactId: string | null;
  selectedImageReferenceArtifact: ImageEditReferenceArtifact | null;
  composerCommandDescriptors: CommandDescriptor[];
  effectiveAgentId: string;
  imageModelLabel: string;
  queuedMessageId?: string;
}

export interface UnifiedComposerProps {
  variant: 'home' | 'session';
  sessionId: string | null;
  currentUserEmail: string;
  gatewayUrl: string;
  token: string | null;
  streaming: boolean;
  stoppingStream: boolean;
  canStopSession: boolean;
  stopCapability: 'none' | 'precise' | 'best_effort' | 'observe_only';
  sessionBusyState: 'running' | 'paused' | null;
  editorMode?: boolean;
  providers: ChatSettingsProvider[];
  activeProviderId: string;
  activeModelId: string;
  activeProvider?: { name?: string; type?: string } | null;
  activeModelOption?: {
    id?: string;
    label?: string;
    supportsThinking?: boolean;
    supportsTools?: boolean;
    supportsVision?: boolean;
    contextWindow?: number;
  } | null;
  activeModelCanConfigureThinking?: boolean;
  activeModelTooltip?: string;
  dialogueMode: DialogueMode;
  manualAgentId: string;
  yoloMode: boolean;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  imageReferenceArtifacts?: ChatImageGenerationReferenceArtifact[];
  selectedImageReferenceArtifactId?: string | null;
  latestGeneratedImageResult?: {
    artifactId: string;
    artifactTitle: string;
    modelLabel: string;
  } | null;
  artifactsWorkspaceHref?: string | null;
  features?: UnifiedComposerFeatures;
  onSubmit: (payload: UnifiedComposerSubmitPayload) => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onModelSelect?: (providerId: string, modelId: string) => Promise<void>;
  onToggleWebSearch: () => void;
  onThinkingEnabledChange: (enabled: boolean) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  onManualAgentChange: (agentId: string) => void;
  onClearManualAgentId: () => void;
  onContinueEditingImage?: () => void;
  onNavigateToArtifacts?: () => void;
  onSelectImageReferenceArtifactId?: (id: string | null) => void;
  markSessionMetadataDirty?: () => void;
  /** Context window usage (tokens/maxTokens) to render next to the send button. */
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  contextIsEstimated?: boolean;
  /**
   * Optional slot rendered next to the composer input box on the right.
   * Forwarded to ChatComposer.composerRightSlot which renders it as a
   * sibling of the visible input box (outside, not inside).
   */
  composerRightSlot?: React.ReactNode;
  /**
   * 自定义 textarea placeholder。team 接待会话用此覆盖默认的 chat 占位文案。
   */
  placeholder?: string;

  imageGenerationMode?: boolean;
  hasConfiguredImageModel?: boolean;
  imageGenerationBusy?: boolean;
  imageGenerationDefaults?: SavedChatImageDefaults;
  imageModelLabel?: string;
  imagePluginEnabled?: boolean;
  toggleImageGenerationMode?: () => void;
  updateImageGenerationDefaults?: (defaults: Partial<SavedChatImageDefaults>) => void;

  composerWorkspaceCatalog?: ComposerWorkspaceCatalog;
  composerCommandDescriptors?: CommandDescriptor[];

  agentOptions?: Array<{ id: string; label: string }>;
  effectiveAgentId?: string;
  defaultAgentLabel?: string;

  input?: string;
  setInput?: React.Dispatch<React.SetStateAction<string>>;
  attachmentItems?: AttachmentItem[];
  setAttachmentItems?: React.Dispatch<React.SetStateAction<AttachmentItem[]>>;
  workspaceFileItems?: WorkspaceFileMentionItem[];
  setWorkspaceFileItems?: React.Dispatch<React.SetStateAction<WorkspaceFileMentionItem[]>>;
  composerMenu?: ComposerMenuState;
  setComposerMenu?: React.Dispatch<React.SetStateAction<ComposerMenuState>>;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

const DEFAULT_FEATURES: Required<UnifiedComposerFeatures> = {
  attachments: true,
  voice: true,
  modelPicker: true,
  modelSettings: true,
  webSearch: true,
  imageGen: true,
  promptOptimize: true,
  slashCommands: true,
  mentions: true,
  agentSwitch: true,
  queuedMessages: true,
};

export function UnifiedComposer(props: UnifiedComposerProps) {
  const {
    sessionId,
    currentUserEmail,
    gatewayUrl,
    token,
    streaming,
    stoppingStream,
    canStopSession,
    stopCapability,
    sessionBusyState,
    editorMode = false,
    providers,
    activeProviderId,
    activeModelId,
    activeProvider,
    activeModelOption,
    activeModelCanConfigureThinking,
    activeModelTooltip,
    dialogueMode,
    manualAgentId,
    webSearchEnabled,
    thinkingEnabled,
    reasoningEffort,
    imageReferenceArtifacts: imageReferenceArtifactsProp,
    selectedImageReferenceArtifactId: selectedImageRefIdProp,
    latestGeneratedImageResult,
    artifactsWorkspaceHref,
    features: featuresProp,
    onSubmit,
    onStop,
    onModelSelect,
    onToggleWebSearch,
    onThinkingEnabledChange,
    onReasoningEffortChange,
    onManualAgentChange,
    onClearManualAgentId,
    onContinueEditingImage,
    onNavigateToArtifacts,
    onSelectImageReferenceArtifactId,

    imageGenerationMode: imageGenerationModeProp,
    hasConfiguredImageModel: hasConfiguredImageModelProp,
    imageGenerationBusy: imageGenerationBusyProp,
    imageGenerationDefaults: imageGenerationDefaultsProp,
    imageModelLabel: imageModelLabelProp,
    imagePluginEnabled: imagePluginEnabledProp,
    toggleImageGenerationMode: toggleImageGenerationModeProp,
    updateImageGenerationDefaults: updateImageGenerationDefaultsProp,

    composerWorkspaceCatalog: composerWorkspaceCatalogProp,
    composerCommandDescriptors: composerCommandDescriptorsProp,

    agentOptions: agentOptionsProp,
    effectiveAgentId: effectiveAgentIdProp,
    defaultAgentLabel: defaultAgentLabelProp,

    input: inputProp,
    setInput: setInputProp,
    attachmentItems: attachmentItemsProp,
    setAttachmentItems: setAttachmentItemsProp,
    workspaceFileItems: workspaceFileItemsProp,
    setWorkspaceFileItems: setWorkspaceFileItemsProp,
    composerMenu: composerMenuProp,
    setComposerMenu: setComposerMenuProp,
    textareaRef: textareaRefProp,
  } = props;

  const features = useMemo<Required<UnifiedComposerFeatures>>(
    () => ({ ...DEFAULT_FEATURES, ...featuresProp }),
    [featuresProp],
  );

  const availableImageRefs = useMemo<ImageEditReferenceArtifact[]>(() => {
    return (imageReferenceArtifactsProp ?? []) as ImageEditReferenceArtifact[];
  }, [imageReferenceArtifactsProp]);

  const [internalInput, setInternalInput] = useState('');
  const [internalAttachmentItems, setInternalAttachmentItems] = useState<AttachmentItem[]>([]);
  const [internalWorkspaceFileItems, setInternalWorkspaceFileItems] = useState<
    WorkspaceFileMentionItem[]
  >([]);
  const [internalComposerMenu, setInternalComposerMenu] = useState<ComposerMenuState>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);

  const resolvedInput = inputProp ?? internalInput;
  const resolvedSetInput = setInputProp ?? setInternalInput;
  const resolvedAttachmentItems = attachmentItemsProp ?? internalAttachmentItems;
  const resolvedSetAttachmentItems = setAttachmentItemsProp ?? setInternalAttachmentItems;
  const resolvedWorkspaceFileItems = workspaceFileItemsProp ?? internalWorkspaceFileItems;
  const resolvedSetWorkspaceFileItems = setWorkspaceFileItemsProp ?? setInternalWorkspaceFileItems;
  const resolvedComposerMenu = composerMenuProp ?? internalComposerMenu;
  const resolvedSetComposerMenu = setComposerMenuProp ?? setInternalComposerMenu;
  const resolvedTextareaRef = textareaRefProp ?? internalTextareaRef;

  const composerState = useUnifiedComposerState({
    sessionId,
    gatewayUrl,
    token,
    currentUserEmail,
    streaming,
    stoppingStream,
    canStopSession,
    stopCapability,
    sessionBusyState,
    providers,
    activeProviderId,
    activeModelId,
    dialogueMode,
    manualAgentId,
    webSearchEnabled,
    thinkingEnabled,
    features,
    imageReferenceArtifacts: availableImageRefs,
    selectedImageReferenceArtifactId: selectedImageRefIdProp ?? null,
    onSubmit,
    onStop,
    stopActiveMessage: () => void onStop(),

    imageGenerationMode: imageGenerationModeProp,
    hasConfiguredImageModel: hasConfiguredImageModelProp,
    imageGenerationBusy: imageGenerationBusyProp,
    imageGenerationDefaults: imageGenerationDefaultsProp,
    imageModelLabel: imageModelLabelProp,
    imagePluginEnabled: imagePluginEnabledProp,
    toggleImageGenerationMode: toggleImageGenerationModeProp,
    updateImageGenerationDefaults: updateImageGenerationDefaultsProp,

    composerWorkspaceCatalog: composerWorkspaceCatalogProp,
    composerCommandDescriptors: composerCommandDescriptorsProp,

    agentOptions: agentOptionsProp,
    effectiveAgentId: effectiveAgentIdProp,
    defaultAgentLabel: defaultAgentLabelProp,

    input: resolvedInput,
    setInput: resolvedSetInput,
    attachmentItems: resolvedAttachmentItems,
    setAttachmentItems: resolvedSetAttachmentItems,
    workspaceFileItems: resolvedWorkspaceFileItems,
    setWorkspaceFileItems: resolvedSetWorkspaceFileItems,
    composerMenu: resolvedComposerMenu,
    setComposerMenu: resolvedSetComposerMenu,
    textareaRef: resolvedTextareaRef,
  });

  const {
    input,
    setInput,
    attachmentItems,
    composerMenu,
    setComposerMenu,
    showVoice,
    setShowVoice,
    showModelPicker,
    setShowModelPicker,
    showModelSettings,
    setShowModelSettings,
    textareaRef,
    fileInputRef,
    modelPickerBtnRef,
    modelSettingsBtnRef,
    agentOptions,
    defaultAgentLabel,
    queuedComposerPreviews,
    hasConfiguredImageModel,
    imageGenerationBusy,
    imageGenerationDefaults,
    imageGenerationMode,
    imageModelLabel,
    imagePluginEnabled,
    toggleImageGenerationMode,
    updateImageGenerationDefaults,
    appendFiles,
    handleFileChange,
    removeAttachment,
    enqueueComposerMessage,
    removeQueuedComposerMessage,
    restoreQueuedComposerMessage,
    handleKeyDown,
    handleInputChange,
    handleInputSelect,
    handlePaste,
    applyComposerSelection,
    sendMessage,
    slashCommandItems,
    mentionItems,
    attachedFiles,
  } = composerState;

  const handleOptimizePrompt = useCallback(
    async (text: string): Promise<PromptOptimizerResult> => {
      if (!token) throw new Error('未登录，无法优化提示词。');
      const client = createWorkflowsClient(gatewayUrl);
      return client.optimizePrompt(token, {
        originalPrompt: text,
        context: 'AI对话提示词优化：提取关键内容、转换为专业术语、增强指令明确性',
        targetAudience: 'AI助手',
        candidateCount: 3,
      });
    },
    [gatewayUrl, token],
  );

  const composerVariant = props.variant;

  return (
    <>
      {latestGeneratedImageResult && artifactsWorkspaceHref && (
        <ChatImageGenerationResultStrip
          artifactTitle={latestGeneratedImageResult.artifactTitle}
          modelLabel={latestGeneratedImageResult.modelLabel}
          onContinueEditing={onContinueEditingImage ?? (() => undefined)}
          onOpenArtifactsWorkspace={onNavigateToArtifacts ?? (() => undefined)}
        />
      )}

      <ChatComposer
        variant={composerVariant}
        editorMode={editorMode}
        activeProviderId={activeProviderId}
        activeProviderName={activeProvider?.name}
        activeProviderType={activeProvider?.type}
        showModelPickerButton={features.modelPicker}
        showModelSettingsButton={features.modelSettings}
        showWebSearchButton={features.webSearch}
        showImageGenerationButton={features.imageGen}
        showVoiceButton={features.voice}
        showAttachmentButton={features.attachments}
        activeModelTooltip={activeModelTooltip}
        modelPickerRef={modelPickerBtnRef}
        modelSettingsRef={modelSettingsBtnRef}
        showModelPicker={showModelPicker}
        showModelSettings={showModelSettings}
        activeModelSupportsThinking={inferSupportsThinking(
          activeProvider?.type,
          activeModelOption?.id ?? activeModelId,
          activeModelOption?.supportsThinking === true,
        )}
        hasConfiguredImageModel={hasConfiguredImageModel}
        imageGenerationBusy={imageGenerationBusy}
        imageGenerationDefaults={imageGenerationDefaults}
        imageGenerationMode={imageGenerationMode}
        imageModelLabel={imageModelLabel}
        imagePluginEnabled={imagePluginEnabled}
        imageReferenceArtifacts={imageReferenceArtifactsProp}
        webSearchEnabled={webSearchEnabled}
        thinkingEnabled={thinkingEnabled}
        input={input}
        canStopSession={canStopSession}
        stopCapability={stopCapability}
        sessionBusyState={sessionBusyState}
        streaming={streaming}
        stoppingStream={stoppingStream}
        attachedFiles={attachedFiles}
        attachmentItems={attachmentItems}
        queuedMessages={features.queuedMessages ? queuedComposerPreviews : undefined}
        showVoice={showVoice}
        composerMenu={composerMenu}
        slashCommandItems={features.slashCommands ? slashCommandItems : []}
        mentionItems={features.mentions ? mentionItems : []}
        textareaRef={textareaRef}
        fileInputRef={fileInputRef}
        onFileChange={handleFileChange}
        onInputChange={handleInputChange}
        onInputSelect={handleInputSelect}
        onInputPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onRemoveAttachment={removeAttachment}
        onApplyComposerSelection={applyComposerSelection}
        onComposerHover={(index) =>
          setComposerMenu((prev) => (prev ? { ...prev, selectedIndex: index } : prev))
        }
        onToggleVoice={() => setShowVoice((v) => !v)}
        onVoiceTranscript={(text) => {
          setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text));
          setShowVoice(false);
        }}
        onQueueMessage={features.queuedMessages ? () => void enqueueComposerMessage() : undefined}
        onRemoveQueuedMessage={removeQueuedComposerMessage}
        onRestoreQueuedMessage={restoreQueuedComposerMessage}
        onSend={() => void sendMessage()}
        onStop={() => void onStop()}
        onRequestFiles={() => fileInputRef.current?.click()}
        onToggleModelPicker={() => setShowModelPicker((v) => !v)}
        onToggleModelSettings={() => setShowModelSettings((v) => !v)}
        onToggleImageGenerationMode={toggleImageGenerationMode}
        onSelectImageReferenceArtifactId={onSelectImageReferenceArtifactId}
        onToggleWebSearch={onToggleWebSearch}
        onUpdateImageGenerationDefaults={updateImageGenerationDefaults}
        selectedImageReferenceArtifactId={selectedImageRefIdProp}
        agentOptions={features.agentSwitch ? agentOptions : []}
        manualAgentId={manualAgentId}
        defaultAgentLabel={defaultAgentLabel}
        onChangeManualAgentId={onManualAgentChange}
        onClearManualAgentId={onClearManualAgentId}
        onOptimizePrompt={features.promptOptimize && token ? handleOptimizePrompt : undefined}
        onDropFiles={appendFiles}
        onReplaceInput={(nextValue: string) => setInput(nextValue)}
        contextUsedTokens={props.contextUsedTokens}
        contextMaxTokens={props.contextMaxTokens}
        contextIsEstimated={props.contextIsEstimated}
        placeholder={props.placeholder}
        composerRightSlot={props.composerRightSlot}
        gatewayUrl={gatewayUrl}
        snippetsToken={token}
        onInsertAtCursor={(text: string) => {
          const textarea = textareaRef.current;
          if (!textarea) {
            setInput((prev) => prev + text);
            return;
          }
          const start = textarea.selectionStart ?? 0;
          const end = textarea.selectionEnd ?? 0;
          setInput((prev) => {
            const before = prev.slice(0, start);
            const after = prev.slice(end);
            return before + text + after;
          });
          // Restore cursor position after the inserted text
          requestAnimationFrame(() => {
            textarea.selectionStart = start + text.length;
            textarea.selectionEnd = start + text.length;
            textarea.focus();
          });
        }}
      />

      {features.modelPicker && showModelPicker && (
        <ModelPicker
          providers={providers}
          activeProviderId={activeProviderId}
          activeModelId={activeModelId}
          anchorRef={modelPickerBtnRef}
          onSelect={async (pid: string, mid: string) => {
            setShowModelPicker(false);
            if (onModelSelect) {
              await onModelSelect(pid, mid);
            }
          }}
          onClose={() => setShowModelPicker(false)}
        />
      )}

      {features.modelSettings && (
        <ModelSettingsPopover
          anchorRef={modelSettingsBtnRef}
          open={showModelSettings}
          onClose={() => setShowModelSettings(false)}
          modelLabel={(activeModelOption?.label ?? activeModelId) || '当前模型'}
          providerType={activeProvider?.type}
          modelId={activeModelOption?.id ?? activeModelId}
          supportsThinking={inferSupportsThinking(
            activeProvider?.type,
            activeModelOption?.id ?? activeModelId,
            activeModelOption?.supportsThinking === true,
          )}
          canConfigureThinking={activeModelCanConfigureThinking ?? false}
          contextWindow={activeModelOption?.contextWindow}
          supportsTools={activeModelOption?.supportsTools}
          supportsVision={activeModelOption?.supportsVision}
          thinkingEnabled={thinkingEnabled}
          reasoningEffort={reasoningEffort}
          onChangeThinkingEnabled={onThinkingEnabledChange}
          onChangeReasoningEffort={onReasoningEffortChange}
        />
      )}
    </>
  );
}
