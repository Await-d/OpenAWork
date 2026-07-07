import type React from 'react';
import { ChatImageGenerationControls } from '../image/ChatImageGenerationControls.js';
import type { ChatImageGenerationReferenceArtifact } from '../image/ChatImageGenerationControls.js';
import type { SavedChatImageDefaults } from '../../../utils/chat/chat-session-defaults.js';

export interface ChatComposerFeatureTogglesProps {
  readonly showWebSearchButton: boolean;
  readonly showImageGenerationButton: boolean;
  readonly showVoiceButton: boolean;
  readonly showAttachmentButton: boolean;
  readonly streaming: boolean;
  readonly imageGenerationBusy: boolean;
  readonly webSearchEnabled: boolean;
  readonly showVoice: boolean;
  readonly imageGenerationMode: boolean;
  readonly hasConfiguredImageModel: boolean;
  readonly imageGenerationDefaults: SavedChatImageDefaults;
  readonly imageModelLabel: string;
  readonly imagePluginEnabled: boolean;
  readonly onToggleWebSearch: () => void;
  readonly onToggleVoice: () => void;
  readonly onRequestFiles: () => void;
  readonly onToggleImageGenerationMode: () => void;
  readonly onUpdateImageGenerationDefaults: (updates: Partial<SavedChatImageDefaults>) => void;
}

export function ChatComposerFeatureToggles(props: ChatComposerFeatureTogglesProps) {
  const disabled = props.streaming || props.imageGenerationBusy;

  return (
    <>
      {props.showWebSearchButton && (
        <IconButton
          active={props.webSearchEnabled}
          disabled={disabled}
          title={props.webSearchEnabled ? '关闭联网搜索' : '开启联网搜索'}
          onClick={props.onToggleWebSearch}
        >
          <GlobeIcon />
        </IconButton>
      )}
      {props.showImageGenerationButton && (
        <ChatImageGenerationControls
          busy={props.imageGenerationBusy}
          disabled={disabled}
          hasConfiguredModel={props.hasConfiguredImageModel}
          imageDefaults={props.imageGenerationDefaults}
          imageMode={props.imageGenerationMode}
          imageModelLabel={props.imageModelLabel}
          imagePluginEnabled={props.imagePluginEnabled}
          onToggleImageMode={props.onToggleImageGenerationMode}
          onUpdateImageDefaults={props.onUpdateImageGenerationDefaults}
          variant="toggle"
        />
      )}
      {props.showVoiceButton && (
        <IconButton
          active={props.showVoice}
          disabled={disabled}
          title={props.showVoice ? '关闭语音输入' : '语音输入'}
          onClick={props.onToggleVoice}
        >
          <MicIcon />
        </IconButton>
      )}
      {props.showAttachmentButton && (
        <IconButton
          disabled={disabled}
          title={props.imageGenerationMode ? '上传参考图' : '上传文件'}
          onClick={props.onRequestFiles}
        >
          <PaperclipIcon />
        </IconButton>
      )}
    </>
  );
}

export interface ImagePanelProps {
  readonly imageGenerationBusy: boolean;
  readonly streaming: boolean;
  readonly hasConfiguredImageModel: boolean;
  readonly imageGenerationDefaults: SavedChatImageDefaults;
  readonly imageGenerationMode: boolean;
  readonly imageModelLabel: string;
  readonly imagePluginEnabled: boolean;
  readonly imageReferenceArtifacts: readonly ChatImageGenerationReferenceArtifact[];
  readonly selectedImageReferenceArtifactId: string | null;
  readonly onToggleImageGenerationMode: () => void;
  readonly onSelectImageReferenceArtifactId?: (artifactId: string | null) => void;
  readonly onUpdateImageGenerationDefaults: (updates: Partial<SavedChatImageDefaults>) => void;
}

export function ChatComposerImagePanel(props: ImagePanelProps) {
  if (!props.imageGenerationMode) return null;

  return (
    <ChatImageGenerationControls
      busy={props.imageGenerationBusy}
      disabled={props.streaming || props.imageGenerationBusy}
      hasConfiguredModel={props.hasConfiguredImageModel}
      imageDefaults={props.imageGenerationDefaults}
      imageMode={props.imageGenerationMode}
      imageModelLabel={props.imageModelLabel}
      imagePluginEnabled={props.imagePluginEnabled}
      referenceArtifacts={[...props.imageReferenceArtifacts]}
      selectedReferenceArtifactId={props.selectedImageReferenceArtifactId}
      onToggleImageMode={props.onToggleImageGenerationMode}
      onSelectReferenceArtifactId={props.onSelectImageReferenceArtifactId}
      onUpdateImageDefaults={props.onUpdateImageGenerationDefaults}
      variant="panel"
    />
  );
}

interface IconButtonProps {
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly title: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}

function IconButton({
  active = false,
  disabled = false,
  title,
  onClick,
  children,
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`icon-btn composer-toolbar-icon${active ? ' active' : ''}`}
    >
      {children}
    </button>
  );
}

function GlobeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" />
      <path d="M12 19v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 22h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
