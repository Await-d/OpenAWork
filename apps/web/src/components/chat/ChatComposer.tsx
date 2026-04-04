import React, { useEffect, useMemo, useRef } from 'react';
import { AttachmentBar, ImagePreview, VoiceRecorder } from '@openAwork/shared-ui';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type {
  ComposerMenuState,
  MentionItem,
  SlashCommandItem,
} from '../../pages/chat-page/support.js';

function getSlashBadgeStyle(source: SlashCommandItem['source']): React.CSSProperties {
  switch (source) {
    case 'agent':
      return {
        background: 'color-mix(in oklch, var(--warning) 14%, transparent)',
        color: 'color-mix(in oklch, var(--warning) 84%, white 16%)',
      };
    case 'mcp':
      return {
        background: 'color-mix(in oklch, var(--info, #3b82f6) 14%, transparent)',
        color: 'color-mix(in oklch, var(--info, #3b82f6) 82%, white 18%)',
      };
    case 'skill':
      return {
        background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
        color: 'color-mix(in oklch, var(--accent) 80%, white 20%)',
      };
    case 'tool':
      return {
        background: 'color-mix(in oklch, var(--success, #10b981) 14%, transparent)',
        color: 'color-mix(in oklch, var(--success, #10b981) 82%, white 18%)',
      };
    default:
      return {
        background: 'var(--accent-muted)',
        color: 'var(--accent)',
      };
  }
}

const composerHeaderTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const composerListPrimaryTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

interface ChatComposerProps {
  variant: 'home' | 'session';
  editorMode?: boolean;
  activeProviderId: string;
  activeModelTooltip?: string;
  modelPickerRef: React.RefObject<HTMLButtonElement | null>;
  modelSettingsRef: React.RefObject<HTMLButtonElement | null>;
  showModelPicker: boolean;
  showModelSettings: boolean;
  activeModelSupportsThinking: boolean;
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
  onToggleWebSearch: () => void;
}

function ComposerHintChip({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 7px',
        borderRadius: 999,
        border: '1px solid var(--border-subtle)',
        background: tone === 'accent' ? 'var(--accent-muted)' : 'transparent',
        color: tone === 'accent' ? 'var(--accent)' : 'var(--text-3)',
        fontSize: 10,
        fontWeight: tone === 'accent' ? 600 : 500,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

export function ChatComposer({
  variant,
  editorMode = false,
  activeProviderId,
  activeModelTooltip,
  modelPickerRef,
  modelSettingsRef,
  showModelPicker,
  showModelSettings,
  activeModelSupportsThinking,
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
  onToggleWebSearch,
}: ChatComposerProps) {
  const isHomeVariant = variant === 'home';
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

  const slashIncludesWorkspaceCatalog = slashCommandItems.some((item) => item.source !== 'command');
  const canSubmit = input.trim().length > 0 || attachedFiles.length > 0;
  const effectiveStopCapability =
    stopCapability !== 'none' ? stopCapability : canStopSession ? 'precise' : 'none';
  const showStopAction =
    streaming || effectiveStopCapability === 'precise' || effectiveStopCapability === 'best_effort';
  const hasRemoteSessionBusyState = !showStopAction && sessionBusyState !== null;
  const showQueueAction =
    Boolean(onQueueMessage) && (showStopAction || hasRemoteSessionBusyState) && canSubmit;
  const primaryButtonDisabled = showStopAction
    ? stoppingStream
    : hasRemoteSessionBusyState
      ? true
      : !canSubmit;

  return (
    <div
      style={{
        padding: '4px 10px 8px',
        background: 'var(--bg)',
        transition: 'padding 220ms ease',
      }}
    >
      <div
        style={{
          maxWidth: editorMode ? 680 : 740,
          margin: '0 auto',
          width: '100%',
          position: 'relative',
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
        {composerMenu && currentItems.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 'calc(100% + 14px)',
              zIndex: 12,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 'min(100%, 600px)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                borderRadius: 14,
                boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px 7px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--bg-2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 999,
                      background: 'var(--accent-muted)',
                      color: 'var(--accent)',
                      flexShrink: 0,
                    }}
                  >
                    {composerMenu.type === 'slash' ? '/' : '@'}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={composerHeaderTitleStyle}>
                      {composerMenu.type === 'slash'
                        ? slashIncludesWorkspaceCatalog
                          ? '快捷命令与工作区能力'
                          : '快捷命令'
                        : '工作区文件'}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--text-3)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {composerMenu.type === 'slash'
                        ? slashIncludesWorkspaceCatalog
                          ? '按 Enter 或 Tab 插入；仅 / 命令会在发送时直接执行'
                          : '按 Enter 或 Tab 插入 / 执行'
                        : '输入 @ 引用文件到当前消息'}
                    </div>
                  </div>
                </div>
                <ComposerHintChip
                  label={`${composerMenu.type === 'slash' ? '/' : '@'}${composerMenu.query || '...'}`}
                  tone="accent"
                />
              </div>
              <div
                ref={composerListRef}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '8px 6px',
                  gap: 4,
                  maxHeight: 'min(320px, 45vh)',
                  overflowY: 'auto',
                }}
              >
                {currentItems.map((item, index) => {
                  const selected = index === composerMenu.selectedIndex;
                  const slashItem =
                    composerMenu.type === 'slash' && item.kind === 'slash' ? item : null;
                  return (
                    <button
                      ref={(node) => {
                        composerItemRefs.current[index] = node;
                      }}
                      key={item.id}
                      type="button"
                      onMouseEnter={() => {
                        onComposerHover(index);
                      }}
                      onClick={() => {
                        void onApplyComposerSelection(item);
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        borderRadius: 10,
                        background: selected ? 'var(--accent-muted)' : 'transparent',
                        color: 'var(--text)',
                        padding: '8px 10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                      >
                        <span style={composerListPrimaryTextStyle} title={item.label}>
                          {item.label}
                        </span>
                        {item.description && (
                          <span
                            style={{
                              marginTop: 2,
                              fontSize: 10,
                              lineHeight: 1.45,
                              color: 'var(--text-3)',
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              maxWidth: '100%',
                            }}
                            title={item.description}
                          >
                            {item.description}
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-3)',
                          flexShrink: 0,
                          marginLeft: 8,
                          alignSelf: 'flex-start',
                        }}
                      >
                        {slashItem ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              height: 18,
                              padding: '0 6px',
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: '0.01em',
                              ...getSlashBadgeStyle(slashItem.source),
                            }}
                          >
                            {slashItem.badgeLabel ?? '命令'}
                          </span>
                        ) : (
                          '@'
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div
          className="composer-shell"
          style={{
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            borderRadius: 14,
            transition: 'padding 220ms ease, border-radius 220ms ease, gap 220ms ease',
          }}
        >
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
            <div style={{ borderRadius: 12, overflow: 'hidden' }}>
              <VoiceRecorder onTranscript={onVoiceTranscript} style={{ marginBottom: 0 }} />
            </div>
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
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      maxWidth: '100%',
                      gap: 6,
                      padding: '3px 8px',
                      borderRadius: 999,
                      border: item.requiresAttachmentRebind
                        ? '1px solid color-mix(in srgb, #f59e0b 28%, var(--border))'
                        : '1px solid color-mix(in oklch, var(--accent) 18%, var(--border))',
                      background: item.requiresAttachmentRebind
                        ? 'color-mix(in srgb, #f59e0b 12%, transparent)'
                        : index === 0
                          ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                          : 'color-mix(in oklch, var(--surface) 80%, transparent)',
                      color: item.requiresAttachmentRebind
                        ? '#fcd34d'
                        : index === 0
                          ? 'var(--accent)'
                          : 'var(--text-2)',
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
                  <ComposerHintChip label={`+${queuedMessages.length - 3} 条待发`} tone="accent" />
                )}
              </div>
            </div>
          )}

          <div
            style={{
              border: 'none',
              background: isHomeVariant
                ? 'linear-gradient(180deg, color-mix(in oklch, var(--bg-2) 94%, var(--surface) 6%), var(--bg-2))'
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
            <textarea
              ref={textareaRef}
              value={input}
              onChange={onInputChange}
              onSelect={onInputSelect}
              onPaste={onInputPaste}
              onKeyDown={onKeyDown}
              placeholder="发送消息…（Enter 发送，Shift+Enter 换行）"
              rows={1}
              style={{
                width: '100%',
                minHeight: 52,
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: 'var(--text)',
                fontSize: 11.5,
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.6,
                maxHeight: 130,
                overflowY: 'auto',
                transition: 'min-height 220ms ease, font-size 220ms ease, max-height 220ms ease',
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
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--surface)',
                    overflow: 'hidden',
                    flexShrink: 0,
                    maxWidth: 56,
                  }}
                >
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
                      color: 'var(--text-2)',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'height 220ms ease, color 150ms ease, background 150ms ease',
                    }}
                  >
                    {activeProviderId ? (
                      <img
                        src={`/logo-${activeProviderId}.svg`}
                        alt={activeProviderId}
                        width={12}
                        height={12}
                        style={{
                          objectFit: 'contain',
                          filter: 'var(--provider-logo-filter, none)',
                          flexShrink: 0,
                        }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
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
                        <path d="M12 3v18" />
                        <path d="M3 12h18" />
                      </svg>
                    )}
                  </button>
                  <button
                    ref={modelSettingsRef}
                    type="button"
                    onClick={onToggleModelSettings}
                    title={activeModelSupportsThinking ? '思考等级与模型设置' : '模型能力设置'}
                    aria-label={
                      activeModelSupportsThinking ? '打开模型设置与思考等级' : '打开模型能力设置'
                    }
                    aria-haspopup="dialog"
                    aria-expanded={showModelSettings}
                    aria-controls="chat-model-settings-dialog"
                    style={{
                      width: 26,
                      height: 26,
                      border: 'none',
                      borderLeft: '1px solid var(--border-subtle)',
                      background: thinkingEnabled
                        ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                        : 'transparent',
                      color: thinkingEnabled
                        ? 'color-mix(in oklch, var(--accent) 80%, white 20%)'
                        : 'var(--text-3)',
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
                </div>
                <button
                  type="button"
                  onClick={onToggleWebSearch}
                  disabled={streaming}
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
                    opacity: streaming ? 0.45 : 1,
                    background: webSearchEnabled
                      ? 'color-mix(in oklch, var(--info, #3b82f6) 10%, transparent)'
                      : 'var(--surface)',
                    color: webSearchEnabled
                      ? 'color-mix(in oklch, var(--info, #3b82f6) 82%, white 18%)'
                      : 'var(--text-3)',
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
                <button
                  type="button"
                  onClick={onToggleVoice}
                  disabled={streaming}
                  title="语音输入"
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
                    opacity: streaming ? 0.45 : 1,
                    background: 'var(--surface)',
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
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="8" y1="22" x2="16" y2="22" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onRequestFiles}
                  disabled={streaming}
                  title="上传文件"
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
                    opacity: streaming ? 0.45 : 1,
                    background: 'var(--surface)',
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
                <ComposerHintChip label="/ 命令" />
                <ComposerHintChip label="@ 文件" />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
                    color: 'var(--text-3)',
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
                      : sessionBusyState === 'running'
                        ? '会话持续运行中 · 正在同步最新结果'
                        : sessionBusyState === 'paused'
                          ? '会话等待处理 · 处理后继续同步'
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
                    void onSend();
                  }}
                  disabled={primaryButtonDisabled}
                  className="btn-accent"
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
                        ? 'color-mix(in srgb, #f59e0b 14%, transparent)'
                        : 'rgba(239, 68, 68, 0.14)'
                      : sessionBusyState === 'running'
                        ? 'color-mix(in oklch, var(--accent) 14%, transparent)'
                        : sessionBusyState === 'paused'
                          ? 'rgba(245, 158, 11, 0.14)'
                          : undefined,
                    color: showStopAction
                      ? effectiveStopCapability === 'best_effort'
                        ? '#fcd34d'
                        : 'rgb(252, 165, 165)'
                      : sessionBusyState === 'running'
                        ? 'var(--accent)'
                        : sessionBusyState === 'paused'
                          ? '#fcd34d'
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
      </div>
    </div>
  );
}
