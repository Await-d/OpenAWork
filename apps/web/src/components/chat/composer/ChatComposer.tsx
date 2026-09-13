import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AttachmentBar, VoiceRecorder } from '@openAwork/shared-ui';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type {
  ComposerMenuState,
  MentionItem,
  ReasoningEffort,
  SlashCommandItem,
} from '../../conversation-runtime/messages/support.js';
import type { PromptOptimizerResult } from '@openAwork/web-client';
import { detectThinkKeyword } from '../../conversation-runtime/reveal/think-keyword-detector.js';
import type { SavedChatImageDefaults } from '../../../utils/chat/chat-session-defaults.js';
import type { ChatImageGenerationReferenceArtifact } from '../image/ChatImageGenerationControls.js';
import { ChatComposerMenu } from './ChatComposerMenu.js';
import { ChatComposerOptimize } from './ChatComposerOptimize.js';
import { PasteSnippetCard } from './PasteSnippetCard.js';
import { ComposerDragOverlay } from './ComposerDragOverlay.js';
import { ComposerImagePreviews } from './ComposerImagePreviews.js';
import { ComposerThinkHint } from './ComposerThinkHint.js';
import { ComposerUndoToast } from './ComposerUndoToast.js';
import { useComposerUndoToast } from './use-composer-undo-toast.js';
import { ChatComposerImagePanel } from './ChatComposerFeatureToggles.js';
import { ChatComposerQueue } from './ChatComposerQueue.js';
import { ChatComposerToolbar } from './ChatComposerToolbar.js';
import { CompactComposerStatsSummary, ComposerStatsBar } from './ComposerStatsBar.js';
import type { ComposerStatsData } from './ComposerStatsBar.js';
import type { ComposerOptimizeError } from './composer-optimize-error.js';
import { getComposerCharacterCount } from './composer-character-count.js';
import { COMPOSER_FILE_ACCEPT } from './composer-file-accept.js';
import {
  useComposerPasteCollapse,
  PASTE_COLLAPSE_THRESHOLD,
} from './use-composer-paste-collapse.js';
import { useComposerPlaceholder } from './use-composer-placeholder.js';
import { useComposerTextareaAutosize } from './use-composer-textarea-autosize.js';
import { isImeComposingKeyboardEvent } from './ime-composition.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import { getUserVisibleErrorDescriptor } from '../../../utils/errors/user-visible-error.js';
import './ChatComposer.css';

/** 连按两次 Escape 才触发破坏性操作（清空输入 / 编辑上一条）的时间窗。 */
const DOUBLE_ESCAPE_WINDOW_MS = 700;
/** 把折叠的粘贴文本与当前输入合并成最终发送内容。 */
function combinePastedText(pastedText: string, input: string): string {
  return `${pastedText}\n\n${input}`;
}

interface ChatComposerProps {
  variant: 'home' | 'session';
  editorMode?: boolean;
  showModelPickerButton?: boolean;
  showModelSettingsButton?: boolean;
  showWebSearchButton?: boolean;
  showImageGenerationButton?: boolean;
  showVoiceButton?: boolean;
  showAttachmentButton?: boolean;
  activeProviderId: string;
  activeProviderName?: string;
  activeProviderType?: string;
  activeModelTooltip?: string;
  /** 当前模型的显示名，用于工具条上的模型按钮。 */
  activeModelLabel?: string;
  /** 当前思考等级，用于工具条上的思考按钮。 */
  reasoningEffort?: ReasoningEffort;
  modelPickerRef: React.RefObject<HTMLButtonElement | null>;
  modelSettingsRef: React.RefObject<HTMLButtonElement | null>;
  showModelPicker: boolean;
  showModelSettings: boolean;
  activeModelSupportsThinking: boolean;
  hasConfiguredImageModel: boolean;
  imageGenerationBusy: boolean;
  imageGenerationDefaults: SavedChatImageDefaults;
  imageGenerationMode: boolean;
  imageModelLabel: string;
  imagePluginEnabled?: boolean;
  imageReferenceArtifacts?: readonly ChatImageGenerationReferenceArtifact[];
  selectedImageReferenceArtifactId?: string | null;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  input: string;
  streaming: boolean;
  canStopSession?: boolean;
  stopCapability?: 'none' | 'precise' | 'best_effort' | 'observe_only';
  sessionBusyState?: 'running' | 'paused' | null;
  stoppingStream?: boolean;
  attachedFiles: File[];
  /**
   * 附件条目 id 到源文件的映射，由 UnifiedComposer 统一构建。
   * 图片预览必须按 id 取文件：`attachedFiles` 与 `attachmentItems` 的索引
   * 对应是上游的内部契约，不应在这里被第二次假设。
   */
  attachmentFilesById?: ReadonlyMap<string, File>;
  attachmentItems: AttachmentItem[];
  queuedMessages?: Array<{
    id: string;
    label: string;
    requiresAttachmentRebind?: boolean;
    title?: string;
  }>;
  showVoice: boolean;
  composerMenu: ComposerMenuState;
  slashCommandItems: SlashCommandItem[];
  mentionItems: MentionItem[];
  /** 工作区是否已索引出文件；用于 @ 菜单区分「无文件」与「无匹配」。 */
  hasWorkspaceFiles?: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  agentOptions: Array<{ id: string; label: string }>;
  manualAgentId: string;
  defaultAgentLabel: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onInputSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  onInputPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemoveAttachment: (id: string) => void;
  onApplyComposerSelection: (item: SlashCommandItem | MentionItem) => void | Promise<void>;
  onComposerHover: (index: number) => void;
  onToggleVoice: () => void;
  onVoiceTranscript: (text: string) => void;
  /** 传入 overrideText 时以该文本入队，用于合并折叠的粘贴内容。 */
  onQueueMessage?: (overrideText?: string) => void | Promise<void>;
  onRemoveQueuedMessage: (id: string) => void;
  onRestoreQueuedMessage?: (id: string) => void;
  /** 传入 overrideText 时以该文本发送，用于合并折叠的粘贴内容。 */
  onSend: (overrideText?: string) => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onRequestFiles: () => void;
  onToggleModelPicker: () => void;
  onToggleModelSettings: () => void;
  onToggleImageGenerationMode: () => void;
  onSelectImageReferenceArtifactId?: (artifactId: string | null) => void;
  onToggleWebSearch: () => void;
  onUpdateImageGenerationDefaults: (updates: Partial<SavedChatImageDefaults>) => void;
  onChangeManualAgentId: (agentId: string) => void;
  onClearManualAgentId: () => void;
  onEditPreviousUserMessage?: () => void;
  isBrowsingInputHistory?: boolean;
  onRestoreInputFromHistory?: () => boolean;
  onDropFiles?: (files: File[]) => void;
  onOptimizePrompt?: (text: string) => Promise<PromptOptimizerResult>;
  onReplaceInput?: (nextValue: string) => void;
  /**
   * 自定义 textarea placeholder。team 接待会话用此覆盖默认的 chat 占位文案，
   * 与 D26（b 直答 vs 走 c 路由）的语义对齐——告诉用户"输入需求会被派发给团队"。
   * 不传时回落到 chat 默认占位。
   */
  placeholder?: string;
  /**
   * Optional slot rendered as a sibling of the visible input box (the
   * `composer-shell`), aligned to its right side. Used by ChatPage to
   * mount the Buddy companion chip outside the input field while keeping
   * it visually attached to the composer area.
   */
  composerRightSlot?: React.ReactNode;
  /** Gateway URL for prompt snippets API. */
  gatewayUrl?: string;
  /** Auth token for prompt snippets API. */
  snippetsToken?: string | null;
  /** Callback to insert text at cursor position in the textarea. */
  onInsertAtCursor?: (text: string) => void;
  /** 会话统计数据，渲染在输入框下方 */
  statsData?: ComposerStatsData | null;
}

export function ChatComposer({
  variant,
  editorMode = false,
  showModelPickerButton = true,
  showModelSettingsButton = true,
  showWebSearchButton = true,
  showImageGenerationButton = true,
  showVoiceButton = true,
  showAttachmentButton = true,
  activeProviderId,
  activeProviderName,
  activeProviderType,
  activeModelTooltip,
  activeModelLabel,
  reasoningEffort,
  modelPickerRef,
  modelSettingsRef,
  showModelPicker,
  showModelSettings,
  activeModelSupportsThinking,
  hasConfiguredImageModel,
  imageGenerationBusy,
  imageGenerationDefaults,
  imageGenerationMode,
  imageModelLabel,
  imagePluginEnabled = true,
  imageReferenceArtifacts = [],
  selectedImageReferenceArtifactId = null,
  webSearchEnabled,
  thinkingEnabled,
  input,
  streaming,
  canStopSession = false,
  stopCapability = 'none',
  sessionBusyState = null,
  stoppingStream = false,
  attachedFiles,
  attachmentFilesById,
  attachmentItems,
  queuedMessages = [],
  showVoice,
  composerMenu,
  slashCommandItems,
  mentionItems,
  hasWorkspaceFiles = false,
  textareaRef,
  fileInputRef,
  agentOptions,
  manualAgentId,
  defaultAgentLabel,
  onFileChange,
  onInputChange,
  onInputSelect,
  onInputPaste,
  onKeyDown,
  onRemoveAttachment,
  onApplyComposerSelection,
  onComposerHover,
  onToggleVoice,
  onVoiceTranscript,
  onQueueMessage,
  onRemoveQueuedMessage,
  onRestoreQueuedMessage,
  onSend,
  onStop,
  onRequestFiles,
  onToggleModelPicker,
  onToggleModelSettings,
  onToggleImageGenerationMode,
  onSelectImageReferenceArtifactId,
  onToggleWebSearch,
  onUpdateImageGenerationDefaults,
  onChangeManualAgentId,
  onClearManualAgentId,
  onEditPreviousUserMessage,
  isBrowsingInputHistory = false,
  onRestoreInputFromHistory,
  onDropFiles,
  onOptimizePrompt,
  onReplaceInput,
  placeholder,
  composerRightSlot,
  gatewayUrl,
  snippetsToken,
  onInsertAtCursor,
  statsData,
}: ChatComposerProps) {
  const showComposerStatsBar = useDisplayPreferencesStore((s) => s.showComposerStatsBar);
  const [composerDragging, setComposerDragging] = useState(false);
  const composerDragCounterRef = useRef(0);
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<PromptOptimizerResult | null>(null);
  const [optimizeError, setOptimizeError] = useState<ComposerOptimizeError | null>(null);
  const optimizePopoverRef = useRef<HTMLDivElement | null>(null);
  const isHomeVariant = variant === 'home';
  const {
    collapsed: pasteCollapsed,
    previewExpanded: pastePreviewExpanded,
    collapse: collapsePaste,
    clear: clearPaste,
    togglePreview: togglePastePreview,
    updateText: updatePasteText,
  } = useComposerPasteCollapse();
  const { undoText, escapeHint, showUndo, showEscapeHint, hideEscapeHint, dismiss } =
    useComposerUndoToast();
  const composerPlaceholder = useComposerPlaceholder(input, placeholder);
  const characterCount = useMemo(
    () => getComposerCharacterCount(input, statsData?.contextMaxTokens),
    [input, statsData?.contextMaxTokens],
  );

  useComposerTextareaAutosize(textareaRef, input);

  const composerListRef = useRef<HTMLDivElement | null>(null);
  const composerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const currentItems = composerMenu?.type === 'slash' ? slashCommandItems : mentionItems;
  const lastEscapeKeyAtRef = useRef(0);

  const agentCycleList = useMemo(
    () => ['__default__', ...agentOptions.map((a) => a.id)],
    [agentOptions],
  );
  const effectiveAgentId = manualAgentId.trim() || '__default__';
  const currentAgentLabel = manualAgentId.trim()
    ? (agentOptions.find((a) => a.id === manualAgentId.trim())?.label ?? manualAgentId.trim())
    : defaultAgentLabel;
  const hasAgentOverride = manualAgentId.trim().length > 0;

  const slashIncludesWorkspaceCatalog = slashCommandItems.some((item) => item.source !== 'command');
  const canSubmit = imageGenerationMode
    ? input.trim().length > 0 || pasteCollapsed !== null
    : input.trim().length > 0 || attachedFiles.length > 0 || pasteCollapsed !== null;
  const effectiveStopCapability =
    stopCapability !== 'none' ? stopCapability : canStopSession ? 'precise' : 'none';
  const showStopAction =
    streaming ||
    effectiveStopCapability === 'precise' ||
    effectiveStopCapability === 'best_effort' ||
    effectiveStopCapability === 'observe_only';
  const hasRemoteSessionBusyState = !showStopAction && sessionBusyState !== null;
  const showQueueAction =
    !imageGenerationMode &&
    Boolean(onQueueMessage) &&
    (showStopAction || hasRemoteSessionBusyState) &&
    canSubmit;
  const composerKeyboardShortcuts =
    [
      ...(showQueueAction ? ['Control+Enter', 'Meta+Enter'] : []),
      ...(showStopAction ? ['Escape'] : []),
    ].join(' ') || undefined;

  const advanceAgentSelection = useCallback(
    (direction: 'next' | 'previous' = 'next') => {
      if (agentCycleList.length <= 1) return;
      const currentIdx = agentCycleList.indexOf(effectiveAgentId);
      const nextIdx =
        direction === 'previous'
          ? (currentIdx - 1 + agentCycleList.length) % agentCycleList.length
          : (currentIdx + 1) % agentCycleList.length;
      const nextId = agentCycleList[nextIdx] ?? '__default__';
      if (nextId === '__default__') {
        onClearManualAgentId();
      } else {
        onChangeManualAgentId(nextId);
      }
    },
    [agentCycleList, effectiveAgentId, onChangeManualAgentId, onClearManualAgentId],
  );

  // 粘贴大文本时自动折叠成内联卡片，文本不进入 textarea，用户可直接继续输入
  const wrappedOnPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedText = e.clipboardData.getData('text/plain');
      if (pastedText.length > PASTE_COLLAPSE_THRESHOLD) {
        e.preventDefault();
        collapsePaste(pastedText);
        // 同时处理可能存在的图片
        const imageFiles = Array.from(e.clipboardData.items)
          .filter((item) => item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file));
        if (imageFiles.length > 0) onDropFiles?.(imageFiles);
        // 保持焦点在 textarea，用户可继续输入
        requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }
      onInputPaste(e);
    },
    [collapsePaste, onDropFiles, onInputPaste, textareaRef],
  );

  const wrappedOnSend = useCallback(() => {
    if (pasteCollapsed) {
      const combined = combinePastedText(pasteCollapsed.text, input);
      clearPaste();
      // 写回受控 input 是为了发送失败时内容仍留在输入框；真正发送的文本则直接
      // 作为参数交给发送链路，不再依赖「input 变化后再补发」的两阶段往返。
      onReplaceInput?.(combined);
      void onSend(combined);
      return;
    }
    void onSend();
  }, [clearPaste, input, onSend, onReplaceInput, pasteCollapsed]);

  const wrappedOnQueueMessage = useCallback(() => {
    if (pasteCollapsed) {
      const combined = combinePastedText(pasteCollapsed.text, input);
      clearPaste();
      onReplaceInput?.(combined);
      void onQueueMessage?.(combined);
      return;
    }
    void onQueueMessage?.();
  }, [clearPaste, input, onQueueMessage, onReplaceInput, pasteCollapsed]);

  const wrappedOnKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 输入法组合态下不做任何拦截：此时 Enter 是「确认候选词」、
      // Escape 是「取消候选词」，都应原样交还浏览器/输入法处理。
      if (isImeComposingKeyboardEvent(e)) {
        return;
      }
      if (e.key !== 'Escape') {
        lastEscapeKeyAtRef.current = 0;
      }
      // 追加排队用 Cmd/Ctrl+Enter，刻意不占用 Tab——Tab 必须留给键盘用户
      // 跳出输入框，否则在生成期间会构成键盘陷阱（WCAG 2.1.2）。
      // 需排在粘贴卡片分支之前：wrappedOnQueueMessage 自身会合并粘贴内容。
      if (
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        !composerMenu &&
        showQueueAction
      ) {
        e.preventDefault();
        void wrappedOnQueueMessage();
        return;
      }
      // 粘贴卡片存在时，Enter 发送或排队前先合并文本
      if (pasteCollapsed && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (showStopAction || hasRemoteSessionBusyState) {
          void wrappedOnQueueMessage();
        } else {
          void wrappedOnSend();
        }
        return;
      }
      if (e.key === 'Escape' && isBrowsingInputHistory && onRestoreInputFromHistory) {
        e.preventDefault();
        lastEscapeKeyAtRef.current = 0;
        hideEscapeHint();
        onRestoreInputFromHistory();
        return;
      }
      if (
        e.key === 'Escape' &&
        !showStopAction &&
        !composerMenu &&
        input.length === 0 &&
        onEditPreviousUserMessage
      ) {
        e.preventDefault();
        const now = Date.now();
        if (now - lastEscapeKeyAtRef.current <= DOUBLE_ESCAPE_WINDOW_MS) {
          lastEscapeKeyAtRef.current = 0;
          onEditPreviousUserMessage();
          return;
        }
        lastEscapeKeyAtRef.current = now;
        return;
      }
      if (
        e.key === 'Escape' &&
        !showStopAction &&
        !composerMenu &&
        input.trim().length > 0 &&
        !streaming
      ) {
        e.preventDefault();
        const now = Date.now();
        // 单击 Escape 只给提示，连按两次才真正清空，避免误触丢掉草稿。
        if (now - lastEscapeKeyAtRef.current <= DOUBLE_ESCAPE_WINDOW_MS) {
          lastEscapeKeyAtRef.current = 0;
          showUndo(input);
          onReplaceInput?.('');
          return;
        }
        lastEscapeKeyAtRef.current = now;
        showEscapeHint();
        return;
      }
      // Escape 清空粘贴卡片（无输入文本时）
      if (
        e.key === 'Escape' &&
        !showStopAction &&
        !composerMenu &&
        pasteCollapsed &&
        input.trim().length === 0
      ) {
        e.preventDefault();
        clearPaste();
        return;
      }
      onKeyDown(e);
    },
    [
      clearPaste,
      composerMenu,
      hasRemoteSessionBusyState,
      hideEscapeHint,
      input,
      isBrowsingInputHistory,
      onEditPreviousUserMessage,
      onKeyDown,
      onReplaceInput,
      onRestoreInputFromHistory,
      pasteCollapsed,
      showEscapeHint,
      showQueueAction,
      showStopAction,
      showUndo,
      streaming,
      wrappedOnQueueMessage,
      wrappedOnSend,
    ],
  );

  const runOptimizePrompt = useCallback(() => {
    if (!onOptimizePrompt || optimizeLoading || streaming || input.trim().length === 0) {
      return;
    }
    setOptimizeLoading(true);
    setOptimizeError(null);
    void onOptimizePrompt(input.trim())
      .then((result) => {
        setOptimizeResult(result);
      })
      .catch((error: unknown) => {
        setOptimizeError(getUserVisibleErrorDescriptor(error, '提示词优化失败，请稍后重试。'));
      })
      .finally(() => {
        setOptimizeLoading(false);
      });
  }, [input, onOptimizePrompt, optimizeLoading, streaming]);

  useEffect(() => {
    composerItemRefs.current.length = currentItems.length;
  }, [currentItems.length]);

  useEffect(() => {
    if (!composerMenu || currentItems.length === 0) {
      return;
    }

    const selectedItem = composerItemRefs.current[composerMenu.selectedIndex];
    if (
      !selectedItem ||
      !composerListRef.current ||
      typeof selectedItem.scrollIntoView !== 'function'
    ) {
      return;
    }

    selectedItem.scrollIntoView({ block: 'nearest' });
  }, [composerMenu, currentItems.length]);

  return (
    <div className="chat-composer">
      <div className={`chat-composer__inner${editorMode ? ' chat-composer__inner--editor' : ''}`}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onFileChange}
          style={{ display: 'none' }}
          accept={COMPOSER_FILE_ACCEPT}
        />
        {composerMenu && (currentItems.length > 0 || composerMenu.type === 'mention') && (
          <ChatComposerMenu
            composerMenu={composerMenu}
            currentItems={currentItems}
            slashIncludesWorkspaceCatalog={slashIncludesWorkspaceCatalog}
            composerListRef={composerListRef}
            composerItemRefs={composerItemRefs}
            onComposerHover={onComposerHover}
            onApplyComposerSelection={onApplyComposerSelection}
            hasWorkspaceFiles={hasWorkspaceFiles}
          />
        )}

        {/* 输入框与 buddy chip 同行；chip 不参与 textarea / 工具条布局，仅视觉上紧贴右侧。 */}
        <div className="chat-composer__body">
          <div
            className={`composer-shell${hasAgentOverride ? ' agent-override' : ''}${streaming ? ' composer-streaming' : ''}${isHomeVariant ? ' composer-home-variant' : ''}${composerDragging ? ' composer-shell--drop' : ''}`}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              composerDragCounterRef.current += 1;
              if (composerDragCounterRef.current === 1) setComposerDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              composerDragCounterRef.current -= 1;
              if (composerDragCounterRef.current <= 0) {
                composerDragCounterRef.current = 0;
                setComposerDragging(false);
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              composerDragCounterRef.current = 0;
              setComposerDragging(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length > 0 && onDropFiles) onDropFiles(files);
            }}
          >
            <ComposerDragOverlay visible={composerDragging} />
            <ComposerImagePreviews
              attachmentItems={attachmentItems}
              attachmentFilesById={attachmentFilesById}
              onRemoveAttachment={onRemoveAttachment}
            />

            {showVoice && (
              <div className="composer-voice-panel">
                <VoiceRecorder
                  onTranscript={onVoiceTranscript}
                  autoConfirm
                  style={{ marginBottom: 0 }}
                />
              </div>
            )}

            <ChatComposerImagePanel
              imageGenerationBusy={imageGenerationBusy}
              streaming={streaming}
              hasConfiguredImageModel={hasConfiguredImageModel}
              imageGenerationDefaults={imageGenerationDefaults}
              imageGenerationMode={imageGenerationMode}
              imageModelLabel={imageModelLabel}
              imagePluginEnabled={imagePluginEnabled}
              imageReferenceArtifacts={imageReferenceArtifacts}
              selectedImageReferenceArtifactId={selectedImageReferenceArtifactId}
              onToggleImageGenerationMode={onToggleImageGenerationMode}
              onSelectImageReferenceArtifactId={onSelectImageReferenceArtifactId}
              onUpdateImageGenerationDefaults={onUpdateImageGenerationDefaults}
            />

            {attachmentItems.length > 0 && (
              <div className="composer-attachment-row">
                <AttachmentBar
                  attachments={attachmentItems}
                  onRemove={onRemoveAttachment}
                  onAdd={onRequestFiles}
                />
              </div>
            )}

            <ChatComposerQueue
              queuedMessages={queuedMessages}
              onRemoveQueuedMessage={onRemoveQueuedMessage}
              onRestoreQueuedMessage={onRestoreQueuedMessage}
            />

            <div
              className={`composer-input-area${isHomeVariant ? ' composer-input-area--home' : ''}`}
            >
              <div style={{ position: 'relative' }}>
                {pasteCollapsed && (
                  <PasteSnippetCard
                    text={pasteCollapsed.text}
                    lineCount={pasteCollapsed.lineCount}
                    expanded={pastePreviewExpanded}
                    onToggleExpand={togglePastePreview}
                    onUpdateText={updatePasteText}
                    onDiscard={clearPaste}
                  />
                )}
                <textarea
                  className="chat-composer__textarea"
                  ref={textareaRef}
                  value={input}
                  onChange={onInputChange}
                  onSelect={onInputSelect}
                  onPaste={wrappedOnPaste}
                  onKeyDown={wrappedOnKeyDown}
                  onFocus={composerPlaceholder.onFocus}
                  onBlur={composerPlaceholder.onBlur}
                  placeholder={composerPlaceholder.placeholder}
                  aria-label="消息输入框"
                  aria-keyshortcuts={composerKeyboardShortcuts}
                  rows={3}
                />
                {/* 仅在接近上下文上限时提示，避免常驻噪音。 */}
                {input.length > 0 && characterCount.tone !== 'normal' && (
                  <span className={`composer-char-counter composer-char-${characterCount.tone}`}>
                    {characterCount.label}
                  </span>
                )}
              </div>

              <ComposerThinkHint
                visible={
                  thinkingEnabled &&
                  activeModelSupportsThinking &&
                  input.trim().length > 0 &&
                  detectThinkKeyword(input)
                }
              />

              <ChatComposerOptimize
                optimizeError={optimizeError}
                optimizeResult={optimizeResult}
                optimizePopoverRef={optimizePopoverRef}
                onClearError={() => setOptimizeError(null)}
                onRetryOptimize={optimizeError?.retryable ? runOptimizePrompt : undefined}
                onClose={() => {
                  setOptimizeResult(null);
                  setOptimizeError(null);
                }}
                onSelectCandidate={(candidate) => {
                  onReplaceInput?.(candidate.text);
                  setOptimizeResult(null);
                  setOptimizeError(null);
                  requestAnimationFrame(() => {
                    if (!textareaRef.current) return;
                    textareaRef.current.focus();
                    textareaRef.current.setSelectionRange(
                      candidate.text.length,
                      candidate.text.length,
                    );
                  });
                }}
              />

              <ChatComposerToolbar
                agentChip={
                  agentOptions.length > 1
                    ? {
                        label: currentAgentLabel,
                        overridden: hasAgentOverride,
                        onCycle: () => advanceAgentSelection(),
                      }
                    : undefined
                }
                activeProviderId={activeProviderId}
                activeProviderName={activeProviderName}
                activeProviderType={activeProviderType}
                activeModelTooltip={activeModelTooltip}
                activeModelLabel={activeModelLabel}
                activeModelSupportsThinking={activeModelSupportsThinking}
                thinkingEnabled={thinkingEnabled}
                reasoningEffort={reasoningEffort}
                modelPickerRef={modelPickerRef}
                modelSettingsRef={modelSettingsRef}
                showModelPicker={showModelPicker}
                showModelSettings={showModelSettings}
                showModelPickerButton={showModelPickerButton}
                showModelSettingsButton={showModelSettingsButton}
                showWebSearchButton={showWebSearchButton}
                showImageGenerationButton={showImageGenerationButton}
                showVoiceButton={showVoiceButton}
                showAttachmentButton={showAttachmentButton}
                streaming={streaming}
                imageGenerationBusy={imageGenerationBusy}
                canSubmit={canSubmit}
                webSearchEnabled={webSearchEnabled}
                showVoice={showVoice}
                imageGenerationMode={imageGenerationMode}
                hasConfiguredImageModel={hasConfiguredImageModel}
                imageGenerationDefaults={imageGenerationDefaults}
                imageModelLabel={imageModelLabel}
                imagePluginEnabled={imagePluginEnabled}
                input={input}
                stoppingStream={stoppingStream}
                sessionBusyState={sessionBusyState}
                effectiveStopCapability={effectiveStopCapability}
                showStopAction={showStopAction}
                showQueueAction={showQueueAction}
                queuedMessageCount={queuedMessages.length}
                optimizeError={optimizeError}
                optimizeLoading={optimizeLoading}
                optimizeResult={optimizeResult}
                gatewayUrl={gatewayUrl}
                snippetsToken={snippetsToken}
                onInsertAtCursor={onInsertAtCursor}
                onRunOptimizePrompt={runOptimizePrompt}
                onClearOptimizeResult={() => setOptimizeResult(null)}
                onClearOptimizeError={() => setOptimizeError(null)}
                onQueueMessage={wrappedOnQueueMessage}
                onSend={wrappedOnSend}
                onStop={onStop}
                onToggleModelPicker={onToggleModelPicker}
                onToggleModelSettings={onToggleModelSettings}
                onToggleWebSearch={onToggleWebSearch}
                onToggleVoice={onToggleVoice}
                onRequestFiles={onRequestFiles}
                onToggleImageGenerationMode={onToggleImageGenerationMode}
                onUpdateImageGenerationDefaults={onUpdateImageGenerationDefaults}
              />
            </div>
          </div>
          {composerRightSlot && (
            <div className="chat-composer__right-slot">{composerRightSlot}</div>
          )}
        </div>
        <ComposerUndoToast
          undoText={undoText}
          escapeHint={escapeHint}
          onRestore={(text) => {
            onReplaceInput?.(text);
            dismiss();
          }}
          onDismiss={dismiss}
        />
        {statsData &&
          (showComposerStatsBar ? (
            <ComposerStatsBar data={statsData} variant={variant} />
          ) : (
            <CompactComposerStatsSummary data={statsData} variant={variant} />
          ))}
      </div>
    </div>
  );
}
