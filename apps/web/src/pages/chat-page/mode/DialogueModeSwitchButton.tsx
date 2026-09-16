import type { CSSProperties } from 'react';
import type { DialogueMode } from './dialogue-mode.js';
import './DialogueModeSwitchButton.css';

export const CLARIFY_SWITCH_BUTTON_LABEL = '确认转换';
export const CLARIFY_SWITCH_BUTTON_HINT = '确认方案已完成，切换到编程模式开始实现';

interface DialogueModeSwitchButtonProps {
  /** 当前模式：仅澄清模式渲染该按钮。 */
  mode: DialogueMode;
  onConfirm: () => void;
  /** 请求进行中：按钮进入 loading / 禁用态。 */
  pending?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

/**
 * 「确认转换」CTA：澄清模式下把会话切到编程模式（并结算澄清确认门控）。
 *
 * 只做渲染，不感知请求细节——交互在 `use-dialogue-mode-switch.ts`，
 * 模式状态落地在 ChatPage 的 `subscribeSessionDialogueModeSwitch` 订阅处。
 */
export default function DialogueModeSwitchButton({
  mode,
  onConfirm,
  pending = false,
  disabled = false,
  style,
}: DialogueModeSwitchButtonProps) {
  if (mode !== 'clarify') {
    return null;
  }

  const blocked = disabled || pending;

  return (
    <button
      type="button"
      className="dialogue-mode-switch-button"
      data-testid="dialogue-mode-switch-button"
      data-pending={pending ? 'true' : 'false'}
      aria-label={CLARIFY_SWITCH_BUTTON_HINT}
      title={CLARIFY_SWITCH_BUTTON_HINT}
      aria-busy={pending}
      disabled={blocked}
      onClick={onConfirm}
      style={style}
    >
      {pending ? (
        <span className="dialogue-mode-switch-button__spinner" aria-hidden="true" />
      ) : (
        <svg
          className="dialogue-mode-switch-button__icon"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h13" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      )}
      <span className="dialogue-mode-switch-button__label">{CLARIFY_SWITCH_BUTTON_LABEL}</span>
    </button>
  );
}
