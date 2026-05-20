/**
 * 快捷提示词触发按钮 + 面板容器。
 *
 * 独立组件，可放置在任何位置。只需传入 gatewayUrl、token 和
 * onInject 回调即可工作。
 *
 * 使用示例：
 *   <PromptSnippetsTrigger
 *     gatewayUrl={gatewayUrl}
 *     token={token}
 *     disabled={streaming}
 *     onInject={(text) => insertAtCursor(textareaRef, text)}
 *   />
 */

import React, { useRef, useState } from 'react';
import { PromptSnippetsPanel } from './PromptSnippetsPanel.js';

export interface PromptSnippetsTriggerProps {
  gatewayUrl: string;
  token: string | null;
  disabled?: boolean;
  onInject: (text: string) => void;
}

export function PromptSnippetsTrigger({
  gatewayUrl,
  token,
  disabled = false,
  onInject,
}: PromptSnippetsTriggerProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="快捷提示词"
        aria-label="打开快捷提示词面板"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`icon-btn${open ? ' active' : ''}`}
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          width: 26,
          height: 26,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
          background: open
            ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
            : 'var(--bg-overlay)',
          color: open
            ? 'color-mix(in oklch, var(--accent) 82%, var(--fg-on-accent) 18%)'
            : 'var(--fg-muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'opacity 150ms ease, background 150ms ease, color 150ms ease',
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
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </button>

      <PromptSnippetsPanel
        open={open}
        anchorRef={btnRef}
        gatewayUrl={gatewayUrl}
        token={token}
        onInject={onInject}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
