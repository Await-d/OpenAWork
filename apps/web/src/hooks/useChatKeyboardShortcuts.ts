import { useCallback, useEffect } from 'react';

export interface ChatKeyboardShortcutHandlers {
  onCommandPalette?: () => void;
  onSearch?: () => void;
  onToggleDialogueMode?: () => void;
  onCopyLastAssistant?: () => void;
  onToggleMultiSelect?: () => void;
  onOpenTemplates?: () => void;
  onScrollToNextUser?: () => void;
  onScrollToPrevUser?: () => void;
  onToggleSidebar?: () => void;
  onToggleRightPanel?: () => void;
  onNewSession?: () => void;
}

/**
 * Global keyboard shortcut handler for the chat page.
 * Registers shortcuts that work regardless of focus state.
 *
 * Shortcuts:
 * - Cmd+K / Ctrl+K: Command palette
 * - Cmd+F / Ctrl+F: Search in conversation
 * - Cmd+/ / Ctrl+/: Toggle dialogue mode
 * - Cmd+Shift+C: Copy last assistant message
 * - Cmd+Shift+M: Toggle multi-select mode
 * - Cmd+Shift+T: Open prompt templates
 * - Cmd+↑ / Ctrl+↑: Scroll to previous user message
 * - Cmd+↓ / Ctrl+↓: Scroll to next user message
 * - Cmd+B / Ctrl+B: Toggle sidebar
 * - Cmd+\\ / Ctrl+\\: Toggle right panel
 * - Cmd+N / Ctrl+N: New session
 */
export function useChatKeyboardShortcuts(
  handlers: ChatKeyboardShortcutHandlers,
  enabled = true,
): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't intercept when typing in inputs (except for Cmd+K which is universal)
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      const mod = e.metaKey || e.ctrlKey;

      // Cmd+K — always works, even in inputs
      if (mod && e.key === 'k') {
        e.preventDefault();
        handlers.onCommandPalette?.();
        return;
      }

      // Skip other shortcuts when in input fields
      if (isInput) return;

      // Cmd+F — search
      if (mod && e.key === 'f') {
        e.preventDefault();
        handlers.onSearch?.();
        return;
      }

      // Cmd+/ — toggle dialogue mode
      if (mod && e.key === '/') {
        e.preventDefault();
        handlers.onToggleDialogueMode?.();
        return;
      }

      // Cmd+Shift+C — copy last assistant message
      if (mod && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        handlers.onCopyLastAssistant?.();
        return;
      }

      // Cmd+Shift+M — toggle multi-select
      if (mod && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        handlers.onToggleMultiSelect?.();
        return;
      }

      // Cmd+Shift+T — open templates
      if (mod && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        handlers.onOpenTemplates?.();
        return;
      }

      // Cmd+↑ — scroll to previous user message
      if (mod && e.key === 'ArrowUp') {
        e.preventDefault();
        handlers.onScrollToPrevUser?.();
        return;
      }

      // Cmd+↓ — scroll to next user message
      if (mod && e.key === 'ArrowDown') {
        e.preventDefault();
        handlers.onScrollToNextUser?.();
        return;
      }

      // Cmd+B — toggle sidebar
      if (mod && e.key === 'b') {
        e.preventDefault();
        handlers.onToggleSidebar?.();
        return;
      }

      // Cmd+\ — toggle right panel
      if (mod && e.key === '\\') {
        e.preventDefault();
        handlers.onToggleRightPanel?.();
        return;
      }

      // Cmd+N — new session
      if (mod && e.key === 'n') {
        e.preventDefault();
        handlers.onNewSession?.();
        return;
      }
    },
    [enabled, handlers],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleKeyDown]);
}
