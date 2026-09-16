/**
 * 预览快捷键提示条：只渲染 hook 交回的「已接线」描述符，组合键与动作名全部来自
 * `BROWSER_PREVIEW_SHORTCUTS`，禁止在此手写快捷键字面量。
 */

import type { CSSProperties } from 'react';

import type { BrowserPreviewShortcutDescriptor } from './hooks/use-browser-preview-shortcuts.js';

const HINTS_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  padding: '4px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--fg-subtle)',
  fontSize: 10,
  lineHeight: 1.6,
  // 唯一可收缩的 chrome：宿主高度不足时（窄面板）先压提示条，绝不把内容区挤成 0。
  flexShrink: 1,
  minHeight: 0,
  overflow: 'hidden',
};

const COMBO_STYLE: CSSProperties = {
  padding: '0 4px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-xs)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-muted)',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 10,
};

interface BrowserShortcutHintsProps {
  shortcuts: readonly BrowserPreviewShortcutDescriptor[];
}

export function BrowserShortcutHints({ shortcuts }: BrowserShortcutHintsProps) {
  if (shortcuts.length === 0) return null;

  return (
    <div data-testid="browser-shortcut-hints" style={HINTS_STYLE}>
      <span>预览聚焦时可用</span>
      {shortcuts.map((shortcut) => (
        <span key={shortcut.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {shortcut.label}
          <kbd style={COMBO_STYLE}>{shortcut.combination}</kbd>
        </span>
      ))}
    </div>
  );
}
