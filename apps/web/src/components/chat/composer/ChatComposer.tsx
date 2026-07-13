import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AttachmentBar, ImagePreview, VoiceRecorder } from '@openAwork/shared-ui';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type {
  ComposerMenuState,
  MentionItem,
  SlashCommandItem,
} from '../../conversation-runtime/messages/support.js';
import type { PromptOptimizerResult } from '@openAwork/web-client';
import { detectThinkKeyword } from '../../conversation-runtime/reveal/think-keyword-detector.js';
import type { SavedChatImageDefaults } from '../../../utils/chat/chat-session-defaults.js';
import type { ChatImageGenerationReferenceArtifact } from '../image/ChatImageGenerationControls.js';
import { ChatComposerMenu } from './ChatComposerMenu.js';
import { ChatComposerOptimize } from './ChatComposerOptimize.js';
import { ChatComposerPasteCollapse } from './ChatComposerPasteCollapse.js';
import { ChatComposerImagePanel } from './ChatComposerFeatureToggles.js';
import { ChatComposerQueue } from './ChatComposerQueue.js';
import { ChatComposerToolbar } from './ChatComposerToolbar.js';
import { CompactComposerStatsSummary, ComposerStatsBar } from './ComposerStatsBar.js';
import type { ComposerStatsData } from './ComposerStatsBar.js';
import { getComposerCharacterCount } from './composer-character-count.js';
import { useComposerPlaceholder } from './use-composer-placeholder.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import './ChatComposer.css';

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
  const [undoText, setUndoText] = useState<string | null>(null);
  const [pasteCollapsed, setPasteCollapsed] = useState<{ text: string; lineCount: number } | null>(
    null,
  );
  const [pastePreviewExpanded, setPastePreviewExpanded] = useState(false);
  const [pasteInsertionRange, setPasteInsertionRange] = useState<{
    readonly start: number;
    readonly end: number;
  } | null>(null);
  const composerPlaceholder = useComposerPlaceholder(input, placeholder);
  const characterCount = useMemo(
    () => getComposerCharacterCount(input, statsData?.contextMaxTokens),
    [input, statsData?.contextMaxTokens],
  );

  useEffect(() => {
    if (undoText === null) return;
    const id = window.setTimeout(() => setUndoText(null), 3000);
    return () => window.clearTimeout(id);
  }, [undoText]);

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
      if (pastedText.length > 500) {
        e.preventDefault();
        const lineCount = pastedText.split('\n').length;
        setPasteCollapsed({ text: pastedText, lineCount });
        setPasteInsertionRange({
          start: e.currentTarget.selectionStart,
          end: e.currentTarget.selectionEnd,
        });
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

  return (
    <div
      className="chat-composer"
      style={{
        padding: '0 16px 12px',
        background: 'var(--bg-base)',
        borderTop: '1px solid var(--border-default)',
        transition: 'padding 220ms ease',
      }}
    >
      <div
        className="chat-composer__inner"
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
          className="chat-composer__body"
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
              <div style={{ padding: '0 1px' }}>
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
                  <span className={`composer-char-counter composer-char-${characterCount.tone}`}>
                    {characterCount.label}
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
                  onInsert={(text) => {
                    const textarea = textareaRef.current;
                    const start =
                      pasteInsertionRange?.start ?? textarea?.selectionStart ?? input.length;
                    const end = pasteInsertionRange?.end ?? textarea?.selectionEnd ?? input.length;
                    if (!textarea) {
                      onReplaceInput?.(input.slice(0, start) + text + input.slice(end));
                    } else {
                      onReplaceInput?.(input.slice(0, start) + text + input.slice(end));
                      requestAnimationFrame(() => {
                        textarea.focus();
                        const pos = start + text.length;
                        textarea.setSelectionRange(pos, pos);
                      });
                    }
                    setPasteCollapsed(null);
                    setPastePreviewExpanded(false);
                    setPasteInsertionRange(null);
                  }}
                  onDiscard={() => {
                    setPasteCollapsed(null);
                    setPastePreviewExpanded(false);
                    setPasteInsertionRange(null);
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

              <ChatComposerToolbar
                activeProviderId={activeProviderId}
                activeProviderName={activeProviderName}
                activeProviderType={activeProviderType}
                activeModelTooltip={activeModelTooltip}
                activeModelSupportsThinking={activeModelSupportsThinking}
                thinkingEnabled={thinkingEnabled}
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
                optimizeLoading={optimizeLoading}
                optimizeResult={optimizeResult}
                gatewayUrl={gatewayUrl}
                snippetsToken={snippetsToken}
                onInsertAtCursor={onInsertAtCursor}
                onOptimizePrompt={onOptimizePrompt}
                onSetOptimizeLoading={setOptimizeLoading}
                onSetOptimizeResult={setOptimizeResult}
                onSetOptimizeError={setOptimizeError}
                onQueueMessage={onQueueMessage}
                onSend={onSend}
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
            <div
              className="chat-composer__right-slot"
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
