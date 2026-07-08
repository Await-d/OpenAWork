import { useEffect } from 'react';

export interface TitlebarKeyboardShortcutsConfig {
  readonly activeTabId: string | null;
  readonly tabs: readonly { readonly id: string }[];
  readonly onClickTab: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  readonly onNewTab: () => void;
}

export function useTitlebarKeyboardShortcuts({
  activeTabId,
  onClickTab,
  onCloseTab,
  onNewTab,
  tabs,
}: TitlebarKeyboardShortcutsConfig): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const ctrl = event.metaKey || event.ctrlKey;

      if (ctrl && event.key === 't' && !event.shiftKey) {
        event.preventDefault();
        onNewTab();
        return;
      }

      if (ctrl && event.key === 'w' && !event.shiftKey) {
        event.preventDefault();
        if (activeTabId) {
          onCloseTab(activeTabId);
        }
        return;
      }

      if (ctrl && event.key === 'Tab') {
        event.preventDefault();
        if (tabs.length < 2) {
          return;
        }
        const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
        const offset = event.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
        const nextTab = tabs[nextIndex];
        if (nextTab) {
          onClickTab(nextTab.id);
        }
        return;
      }

      if (ctrl && /^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const index = parseInt(event.key, 10) - 1;
        const tab = tabs[index];
        if (tab) {
          onClickTab(tab.id);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, onClickTab, onCloseTab, onNewTab, tabs]);
}
