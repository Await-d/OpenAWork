import type React from 'react';
import { ProviderMark } from '../model-picker/chat-provider-display.js';

export interface ChatComposerModelControlsProps {
  readonly activeProviderId: string;
  readonly activeProviderName?: string;
  readonly activeProviderType?: string;
  readonly activeModelTooltip?: string;
  readonly activeModelSupportsThinking: boolean;
  readonly thinkingEnabled: boolean;
  readonly modelPickerRef: React.RefObject<HTMLButtonElement | null>;
  readonly modelSettingsRef: React.RefObject<HTMLButtonElement | null>;
  readonly showModelPicker: boolean;
  readonly showModelSettings: boolean;
  readonly showModelPickerButton: boolean;
  readonly showModelSettingsButton: boolean;
  readonly onToggleModelPicker: () => void;
  readonly onToggleModelSettings: () => void;
}

export function ChatComposerModelControls(props: ChatComposerModelControlsProps) {
  const showGroup = props.showModelPickerButton || props.showModelSettingsButton;
  if (!showGroup) return null;

  return (
    <div className="composer-model-group">
      {props.showModelPickerButton && (
        <button
          ref={props.modelPickerRef}
          type="button"
          onClick={props.onToggleModelPicker}
          title={props.activeModelTooltip ?? '当前使用模型'}
          aria-label="打开模型选择"
          aria-haspopup="dialog"
          aria-expanded={props.showModelPicker}
          aria-controls="chat-model-picker-dialog"
          className="composer-model-button"
        >
          {props.activeProviderId || props.activeProviderType ? (
            <ProviderMark
              providerId={props.activeProviderId}
              providerName={props.activeProviderName}
              providerType={props.activeProviderType}
              size={12}
            />
          ) : (
            <PlusIcon />
          )}
        </button>
      )}
      {props.showModelSettingsButton && (
        <button
          ref={props.modelSettingsRef}
          type="button"
          onClick={props.onToggleModelSettings}
          title={props.activeModelSupportsThinking ? '思考等级与模型设置' : '模型能力设置'}
          aria-label={
            props.activeModelSupportsThinking ? '打开模型设置与思考等级' : '打开模型能力设置'
          }
          aria-haspopup="dialog"
          aria-expanded={props.showModelSettings}
          aria-controls="chat-model-settings-dialog"
          className={`composer-model-button${props.thinkingEnabled ? ' active' : ''}${
            props.showModelPickerButton ? ' with-divider' : ''
          }`}
        >
          {props.activeModelSupportsThinking ? <ThinkingIcon /> : <SettingsIcon />}
        </button>
      )}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ThinkingIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9.5 9a2.5 2.5 0 1 1 5 0c0 1.6-1.5 2.2-2.2 2.8-.4.3-.6.7-.6 1.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="17" r=".8" fill="currentColor" />
      <path
        d="M12 2a8.5 8.5 0 0 0-5.7 14.8c.4.4.7.9.8 1.5l.2 1.1a1.4 1.4 0 0 0 1.4 1.1h6.6a1.4 1.4 0 0 0 1.4-1.1l.2-1.1c.1-.6.4-1.1.8-1.5A8.5 8.5 0 0 0 12 2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.3.3.5.7.6 1 .1.4.1.7.1 1s0 .6-.1 1c-.1.4-.3.8-.6 1Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
