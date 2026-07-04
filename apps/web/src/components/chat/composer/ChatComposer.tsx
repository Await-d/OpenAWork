import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AttachmentBar, ImagePreview, VoiceRecorder } from '@openAwork/shared-ui';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type {
  ComposerMenuState,
  MentionItem,
  SlashCommandItem,
} from '../../conversation-runtime/messages/support.js';
import type { PromptOptimizerResult } from '@openAwork/web-client';
import { ProviderMark } from '../model-picker/chat-provider-display.js';
import { ChatImageGenerationControls } from '../image/ChatImageGenerationControls.js';
import { ComposerHintChip } from './chat-composer-primitives.js';
import { detectThinkKeyword } from '../../conversation-runtime/reveal/think-keyword-detector.js';
import type { SavedChatImageDefaults } from '../../../utils/chat/chat-session-defaults.js';
import type { ChatImageGenerationReferenceArtifact } from '../image/ChatImageGenerationControls.js';
import { PromptSnippetsTrigger } from '../prompt-snippets/PromptSnippetsTrigger.js';
import { ChatComposerMenu } from './ChatComposerMenu.js';
import { ChatComposerOptimize } from './ChatComposerOptimize.js';
import { ChatComposerPasteCollapse } from './ChatComposerPasteCollapse.js';
import { ComposerStatsBar } from './ComposerStatsBar.js';
import type { ComposerStatsData } from './ComposerStatsBar.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';

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
  imageReferenceArtifacts?: ChatImageGenerationReferenceArtifact[];
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
  onQueueMessage?: () => void | Promise<void>;
  onRemoveQueuedMessage: (id: string) => void;
  onRestoreQueuedMessage?: (id: string) => void;
  onSend: () => void | Promise<void>;
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
  attachmentItems,
  queuedMessages = [],
  showVoice,
  composerMenu,
  slashCommandItems,
  mentionItems,
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
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const optimizePopoverRef = useRef<HTMLDivElement | null>(null);
  const isHomeVariant = variant === 'home';
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);
  const [sendPulse, setSendPulse] = useState(false);
  const [undoText, setUndoText] = useState<string | null>(null);
  const [pasteCollapsed, setPasteCollapsed] = useState<{ text: string; lineCount: number } | null>(
    null,
  );
  const [pastePreviewExpanded, setPastePreviewExpanded] = useState(false);

  // T-07: placeholder 动态轮换
  const PLACEHOLDER_POOL = useMemo(
    () => [
      '发送消息…（Enter 发送，Shift+Enter 换行，Tab 切换代理）',
      '问点什么…',
      '描述你的需求，我来实现…',
      '输入 / 查看快捷命令，@ 引用文件…',
      '试试描述一个功能或粘贴一段代码…',
    ],
    [],
  );
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  useEffect(() => {
    if (input.length > 0) return;
    const id = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDER_POOL.length);
    }, 4500);
    return () => clearInterval(id);
  }, [input.length, PLACEHOLDER_POOL]);

  const composerListRef = useRef<HTMLDivElement | null>(null);
  const composerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const imagePreviews = useMemo(() => {
    return attachmentItems
      .map((item, index) => ({ item, file: attachedFiles[index] ?? null }))
      .filter(
        (entry): entry is { item: AttachmentItem; file: File } =>
          entry.item.type === 'image' && entry.file !== null,
      )
      .map((entry) => ({
        id: entry.item.id,
        name: entry.item.name,
        url: URL.createObjectURL(entry.file),
      }));
  }, [attachmentItems, attachedFiles]);

  useEffect(() => {
    return () => {
      imagePreviews.forEach((item) => {
        URL.revokeObjectURL(item.url);
      });
    };
  }, [imagePreviews]);

  const currentItems = composerMenu?.type === 'slash' ? slashCommandItems : mentionItems;

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
    ? input.trim().length > 0
    : input.trim().length > 0 || attachedFiles.length > 0;
  const effectiveStopCapability =
    stopCapability !== 'none' ? stopCapability : canStopSession ? 'precise' : 'none';
  const showStopAction =
    streaming || effectiveStopCapability === 'precise' || effectiveStopCapability === 'best_effort';

  const handleAgentTabCycle = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (agentCycleList.length <= 1) return;
      e.preventDefault();
      const currentIdx = agentCycleList.indexOf(effectiveAgentId);
      const nextIdx = e.shiftKey
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

  const wrappedOnKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab' && !composerMenu) {
        handleAgentTabCycle(e);
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
        setUndoText(input);
        onReplaceInput?.('');
        return;
      }
      onKeyDown(e);
    },
    [
      composerMenu,
      handleAgentTabCycle,
      onKeyDown,
      showStopAction,
      input,
      streaming,
      onReplaceInput,
    ],
  );

  // T-09: 粘贴大文本折叠
  const wrappedOnPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedText = e.clipboardData.getData('text/plain');
      if (pastedText.length > 500 && !e.shiftKey) {
        e.preventDefault();
        const lineCount = pastedText.split('\n').length;
        setPasteCollapsed({ text: pastedText, lineCount });
        setPastePreviewExpanded(false);
        return;
      }
      onInputPaste(e);
    },
    [onInputPaste],
  );

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

  const hasRemoteSessionBusyState = !showStopAction && sessionBusyState !== null;
  const showQueueAction =
    !imageGenerationMode &&
    Boolean(onQueueMessage) &&
    (showStopAction || hasRemoteSessionBusyState) &&
    canSubmit;
  const primaryButtonDisabled = showStopAction
    ? stoppingStream
    : hasRemoteSessionBusyState
      ? true
      : imageGenerationBusy || !canSubmit;

  return (
    <div
      style={{
        padding: '0 16px 12px',
        background: 'var(--bg-base)',
        borderTop: '1px solid var(--border-default)',
        transition: 'padding 220ms ease',
      }}
    >
      <div
        style={{
          maxWidth: editorMode ? 720 : 1024,
          margin: '0 auto',
          width: '100%',
          position: 'relative',
          paddingTop: 12,
          transform: 'translateY(0)',
          transition: 'max-width 240ms ease, transform 240ms ease',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onFileChange}
          style={{ display: 'none' }}
          accept="image/*,text/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cpp,.c,.h,.yaml,.yml,.toml,.csv"
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
          />
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 8,
            // 输入框（composer-shell）与 buddy chip 在同一行；chip 不参与
            // textarea / 工具条布局,只是视觉上紧贴输入框右边。
            position: 'relative',
          }}
        >
          <div
            className={`composer-shell${hasAgentOverride ? ' agent-override' : ''}${streaming ? ' composer-streaming' : ''}${isHomeVariant ? ' composer-home-variant' : ''}`}
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
            style={{
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              borderRadius: 12,
              flex: 1,
              minWidth: 0,
              transition:
                'padding 220ms ease, border-radius 220ms ease, gap 220ms ease, border-color 150ms ease, background 150ms ease',
              position: 'relative',
              ...(composerDragging
                ? {
                    borderColor: 'var(--accent-border)',
                    borderStyle: 'dashed',
                    background: 'var(--accent-subtle)',
                  }
                : {}),
            }}
          >
            {composerDragging && (
              <div
                className="composer-drag-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'color-mix(in oklch, var(--accent) 6%, transparent)',
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--accent)',
                  }}
                >
                  释放以添加附件
                </span>
              </div>
            )}
            {imagePreviews.length > 0 && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '1px 1px 0' }}>
                {imagePreviews.map((item) => (
                  <ImagePreview
                    key={item.id}
                    src={item.url}
                    alt={item.name}
                    onRemove={() => onRemoveAttachment(item.id)}
                    style={{ marginBottom: 0 }}
                  />
                ))}
              </div>
            )}

            {showVoice && (
              <div
                style={{
                  padding: '6px 8px',
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-overlay)',
                }}
              >
                <VoiceRecorder
                  onTranscript={onVoiceTranscript}
                  autoConfirm
                  style={{ marginBottom: 0 }}
                />
              </div>
            )}

            {imageGenerationMode && (
              <ChatImageGenerationControls
                busy={imageGenerationBusy}
                disabled={streaming || imageGenerationBusy}
                hasConfiguredModel={hasConfiguredImageModel}
                imageDefaults={imageGenerationDefaults}
                imageMode={imageGenerationMode}
                imageModelLabel={imageModelLabel}
                imagePluginEnabled={imagePluginEnabled}
                referenceArtifacts={imageReferenceArtifacts}
                selectedReferenceArtifactId={selectedImageReferenceArtifactId}
                onToggleImageMode={onToggleImageGenerationMode}
                onSelectReferenceArtifactId={onSelectImageReferenceArtifactId}
                onUpdateImageDefaults={onUpdateImageGenerationDefaults}
                variant="panel"
              />
            )}

            {attachmentItems.length > 0 && (
              <div style={{ padding: '0 1px' }}>
                <AttachmentBar
                  attachments={attachmentItems}
                  onRemove={onRemoveAttachment}
                  onAdd={onRequestFiles}
                />
              </div>
            )}

            {queuedMessages.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  flexWrap: 'wrap',
                  padding: '0 2px',
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    color: 'rgb(96, 165, 250)',
                    whiteSpace: 'nowrap',
                    paddingTop: 4,
                  }}
                >
                  待发队列
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {queuedMessages.slice(0, 3).map((item, index) => (
                    <span
                      key={item.id}
                      className="composer-queue-pill"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        maxWidth: '100%',
                        gap: 6,
                        padding: '3px 8px',
                        borderRadius: 999,
                        border: item.requiresAttachmentRebind
                          ? '1px solid color-mix(in srgb, var(--warning) 28%, var(--border-default))'
                          : '1px solid color-mix(in oklch, var(--accent) 18%, var(--border-default))',
                        background: item.requiresAttachmentRebind
                          ? 'color-mix(in srgb, var(--warning) 12%, transparent)'
                          : index === 0
                            ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                            : 'var(--bg-overlay)',
                        color: item.requiresAttachmentRebind
                          ? 'var(--warning)'
                          : index === 0
                            ? 'var(--accent)'
                            : 'var(--fg-default)',
                        minWidth: 0,
                      }}
                      title={item.title ?? item.label}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 280,
                        }}
                      >
                        {index === 0 ? `下一条：${item.label}` : item.label}
                      </span>
                      {onRestoreQueuedMessage && (
                        <button
                          type="button"
                          onClick={() => onRestoreQueuedMessage(item.id)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'inherit',
                            cursor: 'pointer',
                            padding: 0,
                            fontSize: 10,
                            lineHeight: 1,
                            flexShrink: 0,
                            fontWeight: 700,
                          }}
                          title={
                            item.requiresAttachmentRebind
                              ? '恢复到输入框，并重新选择附件后发送'
                              : '恢复到输入框继续编辑'
                          }
                        >
                          恢复
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveQueuedMessage?.(item.id)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 11,
                          lineHeight: 1,
                          flexShrink: 0,
                        }}
                        title="移出队列"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {queuedMessages.length > 3 && (
                    <ComposerHintChip
                      label={`+${queuedMessages.length - 3} 条待发`}
                      tone="accent"
                    />
                  )}
                </div>
              </div>
            )}

            <div
              style={{
                border: 'none',
                background: isHomeVariant
                  ? 'linear-gradient(180deg, var(--bg-raised), var(--bg-overlay)'
                  : 'transparent',
                borderRadius: 10,
                padding: '6px 8px 6px',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                boxShadow: 'none',
                transition:
                  'border-color 220ms ease, border-radius 220ms ease, padding 220ms ease, background 220ms ease, gap 220ms ease',
              }}
            >
              <div style={{ position: 'relative' }}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={onInputChange}
                  onSelect={onInputSelect}
                  onPaste={wrappedOnPaste}
                  onKeyDown={wrappedOnKeyDown}
                  placeholder={
                    placeholder ??
                    (input.length === 0
                      ? (PLACEHOLDER_POOL[placeholderIndex] ?? PLACEHOLDER_POOL[0]!)
                      : '')
                  }
                  rows={3}
                  style={{
                    width: '100%',
                    minHeight: 96,
                    background: 'transparent',
                    border: 'none',
                    padding: agentOptions.length > 1 ? '0 64px 0 0' : 0,
                    color: 'var(--fg-strong)',
                    fontSize: 11.5,
                    resize: 'none',
                    outline: 'none',
                    fontFamily: 'inherit',
                    lineHeight: 1.6,
                    maxHeight: 280,
                    overflowY: 'auto',
                    transition:
                      'min-height 220ms ease, font-size 220ms ease, max-height 220ms ease',
                  }}
                />
                {input.length > 0 && (
                  <span
                    className={`composer-char-counter${
                      input.length > 8000
                        ? ' composer-char-danger'
                        : input.length > 6000
                          ? ' composer-char-warning'
                          : ' composer-char-visible'
                    }`}
                  >
                    {input.length.toLocaleString()} 字符
                  </span>
                )}
                {agentOptions.length > 1 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 2,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      height: 20,
                      padding: '0 7px',
                      borderRadius: 999,
                      border: hasAgentOverride
                        ? '1px solid color-mix(in oklch, var(--accent) 40%, var(--border-subtle))'
                        : '1px solid var(--border-subtle)',
                      background: hasAgentOverride
                        ? 'color-mix(in oklch, var(--accent) 10%, var(--bg-overlay))'
                        : 'var(--bg-overlay)',
                      color: hasAgentOverride ? 'var(--accent)' : 'var(--fg-muted)',
                      fontSize: 10,
                      fontWeight: hasAgentOverride ? 600 : 500,
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      flexShrink: 0,
                      userSelect: 'none',
                      transition:
                        'color 150ms ease, background 150ms ease, border-color 150ms ease',
                    }}
                    title="Tab 切换代理"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20h6v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8Z" />
                      <path d="M9 22h6" />
                    </svg>
                    {currentAgentLabel}
                  </span>
                )}
              </div>

              {thinkingEnabled &&
                activeModelSupportsThinking &&
                input.trim().length > 0 &&
                detectThinkKeyword(input) && (
                  <div
                    title="仅作提示，不会覆盖当前思考等级设置"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                      color: 'color-mix(in oklch, var(--accent) 70%, var(--fg-on-accent) 30%)',
                      fontSize: 10,
                      letterSpacing: 0.3,
                      lineHeight: 1.5,
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20h6v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8Z" />
                      <path d="M10 22h4" />
                    </svg>
                    检测到思考提示词
                  </div>
                )}

              {pasteCollapsed && (
                <ChatComposerPasteCollapse
                  pasteCollapsed={pasteCollapsed}
                  pastePreviewExpanded={pastePreviewExpanded}
                  onToggleExpand={() => setPastePreviewExpanded((v) => !v)}
                  onInsert={() => {
                    const textarea = textareaRef.current;
                    if (!textarea) {
                      onReplaceInput?.(input + pasteCollapsed.text);
                    } else {
                      const start = textarea.selectionStart ?? input.length;
                      const end = textarea.selectionEnd ?? input.length;
                      onReplaceInput?.(
                        input.slice(0, start) + pasteCollapsed.text + input.slice(end),
                      );
                      requestAnimationFrame(() => {
                        textarea.focus();
                        const pos = start + pasteCollapsed.text.length;
                        textarea.setSelectionRange(pos, pos);
                      });
                    }
                    setPasteCollapsed(null);
                    setPastePreviewExpanded(false);
                  }}
                  onDiscard={() => {
                    setPasteCollapsed(null);
                    setPastePreviewExpanded(false);
                  }}
                />
              )}

              <ChatComposerOptimize
                optimizeError={optimizeError}
                optimizeResult={optimizeResult}
                optimizePopoverRef={optimizePopoverRef}
                onClearError={() => setOptimizeError(null)}
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

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    minWidth: 0,
                    overflowX: 'auto',
                    paddingBottom: 2,
                    scrollbarWidth: 'none',
                  }}
                >
                  {(showModelPickerButton || showModelSettingsButton) && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'stretch',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        background: 'var(--bg-overlay)',
                        overflow: 'hidden',
                        flexShrink: 0,
                        maxWidth: showModelPickerButton && showModelSettingsButton ? 56 : 28,
                      }}
                    >
                      {showModelPickerButton && (
                        <button
                          ref={modelPickerRef}
                          type="button"
                          onClick={onToggleModelPicker}
                          title={activeModelTooltip ?? '当前使用模型'}
                          aria-label="打开模型选择"
                          aria-haspopup="dialog"
                          aria-expanded={showModelPicker}
                          aria-controls="chat-model-picker-dialog"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: 26,
                            width: 28,
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--fg-default)',
                            cursor: 'pointer',
                            flexShrink: 0,
                            transition:
                              'height 220ms ease, color 150ms ease, background 150ms ease',
                          }}
                        >
                          {activeProviderId || activeProviderType ? (
                            <ProviderMark
                              providerId={activeProviderId}
                              providerName={activeProviderName}
                              providerType={activeProviderType}
                              size={12}
                            />
                          ) : (
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M12 3v18" />
                              <path d="M3 12h18" />
                            </svg>
                          )}
                        </button>
                      )}
                      {showModelSettingsButton && (
                        <button
                          ref={modelSettingsRef}
                          type="button"
                          onClick={onToggleModelSettings}
                          title={
                            activeModelSupportsThinking ? '思考等级与模型设置' : '模型能力设置'
                          }
                          aria-label={
                            activeModelSupportsThinking
                              ? '打开模型设置与思考等级'
                              : '打开模型能力设置'
                          }
                          aria-haspopup="dialog"
                          aria-expanded={showModelSettings}
                          aria-controls="chat-model-settings-dialog"
                          style={{
                            width: 26,
                            height: 26,
                            border: 'none',
                            borderLeft: showModelPickerButton
                              ? '1px solid var(--border-subtle)'
                              : 'none',
                            background: thinkingEnabled
                              ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                              : 'transparent',
                            color: thinkingEnabled
                              ? 'color-mix(in oklch, var(--accent) 80%, var(--fg-on-accent) 20%)'
                              : 'var(--fg-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {activeModelSupportsThinking ? (
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M9.5 9a2.5 2.5 0 1 1 5 0c0 1.6-1.5 2.2-2.2 2.8-.4.3-.6.7-.6 1.2" />
                              <circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
                              <path d="M12 2a8.5 8.5 0 0 0-5.7 14.8c.4.4.7.9.8 1.5l.2 1.1a1.4 1.4 0 0 0 1.4 1.1h6.6a1.4 1.4 0 0 0 1.4-1.1l.2-1.1c.1-.6.4-1.1.8-1.5A8.5 8.5 0 0 0 12 2Z" />
                            </svg>
                          ) : (
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <circle cx="12" cy="12" r="3" />
                              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.3.3.5.7.6 1 .1.4.1.7.1 1s0 .6-.1 1c-.1.4-.3.8-.6 1Z" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                  {showWebSearchButton && (
                    <button
                      type="button"
                      onClick={onToggleWebSearch}
                      disabled={streaming || imageGenerationBusy}
                      title={webSearchEnabled ? '关闭联网搜索' : '开启联网搜索'}
                      className={`icon-btn${webSearchEnabled ? ' active' : ''}`}
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        width: 26,
                        height: 26,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: streaming || imageGenerationBusy ? 0.45 : 1,
                        background: webSearchEnabled
                          ? 'color-mix(in oklch, var(--info) 10%, transparent)'
                          : 'var(--bg-overlay)',
                        color: webSearchEnabled
                          ? 'color-mix(in oklch, var(--info) 82%, var(--fg-on-accent) 18%)'
                          : 'var(--fg-muted)',
                        transition:
                          'width 220ms ease, height 220ms ease, opacity 150ms ease, background 150ms ease, color 150ms ease',
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M3 12h18" />
                        <path d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9Z" />
                      </svg>
                    </button>
                  )}
                  {showImageGenerationButton && (
                    <ChatImageGenerationControls
                      busy={imageGenerationBusy}
                      disabled={streaming || imageGenerationBusy}
                      hasConfiguredModel={hasConfiguredImageModel}
                      imageDefaults={imageGenerationDefaults}
                      imageMode={imageGenerationMode}
                      imageModelLabel={imageModelLabel}
                      imagePluginEnabled={imagePluginEnabled}
                      onToggleImageMode={onToggleImageGenerationMode}
                      onUpdateImageDefaults={onUpdateImageGenerationDefaults}
                      variant="toggle"
                    />
                  )}
                  {showVoiceButton && (
                    <button
                      type="button"
                      onClick={onToggleVoice}
                      disabled={streaming || imageGenerationBusy}
                      title={showVoice ? '关闭语音输入' : '语音输入'}
                      className={`icon-btn${showVoice ? ' active' : ''}`}
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        width: 26,
                        height: 26,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: streaming || imageGenerationBusy ? 0.45 : 1,
                        background: showVoice
                          ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                          : 'var(--bg-overlay)',
                        color: showVoice
                          ? 'color-mix(in oklch, var(--accent) 82%, var(--fg-on-accent) 18%)'
                          : 'var(--fg-muted)',
                        transition:
                          'width 220ms ease, height 220ms ease, opacity 150ms ease, background 150ms ease, color 150ms ease',
                      }}
                    >
                      <svg
                        aria-hidden="true"
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                        <line x1="8" y1="22" x2="16" y2="22" />
                      </svg>
                    </button>
                  )}
                  {showAttachmentButton && (
                    <button
                      type="button"
                      onClick={onRequestFiles}
                      disabled={streaming || imageGenerationBusy}
                      title={imageGenerationMode ? '上传参考图' : '上传文件'}
                      className="icon-btn"
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        width: 26,
                        height: 26,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: streaming || imageGenerationBusy ? 0.45 : 1,
                        background: 'var(--bg-overlay)',
                        transition: 'width 220ms ease, height 220ms ease, opacity 150ms ease',
                      }}
                    >
                      <svg
                        aria-hidden="true"
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                    </button>
                  )}
                  {gatewayUrl && onInsertAtCursor && (
                    <PromptSnippetsTrigger
                      gatewayUrl={gatewayUrl}
                      token={snippetsToken ?? null}
                      disabled={streaming || imageGenerationBusy}
                      onInject={onInsertAtCursor}
                    />
                  )}
                  <span className="composer-toolbar-divider" />
                  <ComposerHintChip label="/ 命令" />
                  <ComposerHintChip label="@ 文件" />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {onOptimizePrompt && input.trim().length > 0 && !streaming && (
                    <button
                      type="button"
                      onClick={() => {
                        if (optimizeResult) {
                          setOptimizeResult(null);
                          setOptimizeError(null);
                          return;
                        }
                        setOptimizeLoading(true);
                        setOptimizeError(null);
                        onOptimizePrompt(input.trim())
                          .then((result) => {
                            setOptimizeResult(result);
                          })
                          .catch((err: unknown) => {
                            setOptimizeError(
                              err instanceof Error ? err.message : '提示词优化失败。',
                            );
                          })
                          .finally(() => {
                            setOptimizeLoading(false);
                          });
                      }}
                      disabled={optimizeLoading}
                      title={optimizeLoading ? '正在优化提示词…' : '提示词优化'}
                      aria-busy={optimizeLoading}
                      className={`icon-btn${optimizeResult ? ' active' : ''}`}
                      style={{
                        border: optimizeLoading
                          ? '1px solid color-mix(in oklch, var(--accent) 45%, var(--border-subtle))'
                          : optimizeResult
                            ? '1px solid color-mix(in oklch, var(--success) 40%, var(--border-subtle))'
                            : '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        width: 26,
                        height: 26,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: optimizeLoading
                          ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                          : optimizeResult
                            ? 'color-mix(in oklch, var(--success) 10%, transparent)'
                            : 'var(--bg-overlay)',
                        color: optimizeLoading
                          ? 'color-mix(in oklch, var(--accent) 82%, var(--fg-on-accent) 18%)'
                          : optimizeResult
                            ? 'color-mix(in oklch, var(--success) 82%, var(--fg-on-accent) 18%)'
                            : 'color-mix(in oklch, var(--accent) 72%, var(--fg-on-accent) 28%)',
                        cursor: optimizeLoading ? 'wait' : 'pointer',
                        transition:
                          'background 150ms ease, color 150ms ease, border-color 150ms ease',
                      }}
                    >
                      {optimizeLoading ? (
                        // Inline spinner — uses the global `@keyframes spin`
                        // defined in `apps/web/src/index.css` so no extra
                        // <style> tag is needed here.
                        <span
                          aria-hidden="true"
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            border: '1.6px solid currentColor',
                            borderTopColor: 'transparent',
                            animation: 'spin 0.7s linear infinite',
                            display: 'inline-block',
                          }}
                        />
                      ) : (
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
                        </svg>
                      )}
                    </button>
                  )}
                  {showQueueAction && (
                    <button
                      type="button"
                      onClick={() => {
                        void onQueueMessage?.();
                      }}
                      className="btn-accent"
                      style={{
                        borderRadius: 8,
                        height: 28,
                        padding: '0 10px',
                        gap: 6,
                        fontSize: 11,
                        background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
                        color: 'var(--accent)',
                      }}
                    >
                      <span>追加</span>
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                    </button>
                  )}
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      whiteSpace: 'nowrap',
                      letterSpacing: '0.01em',
                    }}
                  >
                    {showStopAction
                      ? stoppingStream
                        ? '正在停止…'
                        : streaming
                          ? '正在生成… · Esc 停止'
                          : effectiveStopCapability === 'best_effort'
                            ? '当前页未接管原始请求 · 将尝试停止本会话的当前运行'
                            : '当前运行流仍受此页控制 · 可直接停止'
                      : showQueueAction
                        ? `可先追加到队列${queuedMessages.length > 0 ? ` · 已排队 ${queuedMessages.length} 条` : ''}`
                        : imageGenerationBusy
                          ? '图片生成中 · 请等待结果返回'
                          : sessionBusyState === 'running'
                            ? '会话持续运行中 · 正在同步最新结果'
                            : sessionBusyState === 'paused'
                              ? '会话等待处理 · 处理后继续同步'
                              : imageGenerationMode
                                ? 'Enter 生成 · Shift+Enter 换行'
                                : isHomeVariant
                                  ? 'Enter 发送 · Shift+Enter 换行'
                                  : 'Enter 发送'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (showStopAction) {
                        void onStop();
                        return;
                      }
                      setSendPulse(true);
                      setTimeout(() => setSendPulse(false), 450);
                      void onSend();
                    }}
                    disabled={primaryButtonDisabled}
                    className={`btn-accent${sendPulse ? ' composer-pulse' : ''}`}
                    style={{
                      borderRadius: 8,
                      height: 28,
                      padding: '0 10px',
                      gap: 6,
                      fontSize: 11,
                      opacity: primaryButtonDisabled ? 0.5 : 1,
                      transition: 'height 220ms ease, padding 220ms ease, opacity 150ms ease',
                      background: showStopAction
                        ? effectiveStopCapability === 'best_effort'
                          ? 'color-mix(in srgb, var(--warning) 14%, transparent)'
                          : 'rgba(239, 68, 68, 0.14)'
                        : sessionBusyState === 'running'
                          ? 'color-mix(in oklch, var(--accent) 14%, transparent)'
                          : sessionBusyState === 'paused'
                            ? 'rgba(245, 158, 11, 0.14)'
                            : undefined,
                      color: showStopAction
                        ? effectiveStopCapability === 'best_effort'
                          ? 'var(--warning)'
                          : 'rgb(252, 165, 165)'
                        : sessionBusyState === 'running'
                          ? 'var(--accent)'
                          : sessionBusyState === 'paused'
                            ? 'var(--warning)'
                            : undefined,
                    }}
                  >
                    <span>
                      {showStopAction
                        ? stoppingStream
                          ? '停止中'
                          : effectiveStopCapability === 'best_effort'
                            ? '尝试停止'
                            : '停止'
                        : sessionBusyState === 'running'
                          ? '运行中'
                          : sessionBusyState === 'paused'
                            ? '待处理'
                            : imageGenerationMode
                              ? '生成'
                              : '发送'}
                    </span>
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {showStopAction ? (
                        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
                      ) : sessionBusyState ? (
                        <>
                          <circle cx="12" cy="12" r="7" />
                          <path d="M12 8v4l2.5 1.5" />
                        </>
                      ) : (
                        <>
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
          {composerRightSlot && (
            <div
              style={{
                display: 'flex',
                alignItems: 'stretch',
                flexShrink: 0,
              }}
            >
              {composerRightSlot}
            </div>
          )}
        </div>
        {undoText !== null && (
          <div
            className="composer-undo-toast"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '3px 8px',
              marginTop: 4,
              borderRadius: 8,
              background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
              border: '1px solid color-mix(in oklch, var(--accent) 20%, var(--border-subtle))',
              fontSize: 10,
              color: 'var(--fg-muted)',
            }}
          >
            <span>已清空输入</span>
            <button
              type="button"
              onClick={() => {
                onReplaceInput?.(undoText);
                setUndoText(null);
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--accent)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 10,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              恢复
            </button>
            <button
              type="button"
              onClick={() => setUndoText(null)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--fg-subtle)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 11,
                lineHeight: 1,
                marginLeft: 'auto',
              }}
            >
              ×
            </button>
          </div>
        )}
        {showComposerStatsBar && statsData && (
          <ComposerStatsBar data={statsData} variant={variant} />
        )}
      </div>
    </div>
  );
}
