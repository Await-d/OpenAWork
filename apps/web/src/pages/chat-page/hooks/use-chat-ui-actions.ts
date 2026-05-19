import { useCallback, useEffect } from 'react';
import type { CommandResultCard, RunEvent } from '@openAwork/shared';
import {
  createCommandCardContent,
  matchServerSlashCommand,
} from '../../../components/conversation-runtime/messages/support.js';
import { executeServerCommand } from '../conversation/composer/server-command-item.js';
import { requestSessionListRefresh } from '../../../utils/session/session-list-events.js';
import { applyChatRightPanelEvent, type ChatRightPanelState } from '../state/chat-stream-state.js';

import type { RightPanelTabId } from '../panels/right-panel-tabs.js';
type CapabilityKind = 'agent' | 'mcp' | 'skill' | 'tool';

export interface ChatUiActionsDeps {
  token: string | null;
  gatewayUrl: string;
  currentSessionId: string | null;
  composerCommandDescriptors: import('@openAwork/shared').CommandDescriptor[];
  appendAssistantDerivedMessages: (messages: Array<{ content: string }>) => void;
  appendAssistantEventMessages: (
    events: RunEvent[],
    options?: { excludeCompaction?: boolean },
  ) => void;
  resolveAssistantCapabilityKind: (text: string | undefined) => CapabilityKind | undefined;
  setRightPanelState: (
    value: ChatRightPanelState | ((prev: ChatRightPanelState) => ChatRightPanelState),
  ) => void;
  setRightOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setRightTab: (value: RightPanelTabId | ((prev: RightPanelTabId) => RightPanelTabId)) => void;
  fileEditor: {
    saveFile: (path: string) => Promise<void>;
    openFile: (path: string) => Promise<void>;
  };
  openFileRef: React.MutableRefObject<((path: string) => void) | null>;
  setEditorMode: (value: boolean) => void;
  /**
   * Force the editor pane onto the code tab when a file is opened
   * via openFileRef (chat path-ref click, tool-call path click, etc).
   * Without this, clicking a file while the editor pane is already
   * showing the browser preview tab would silently drop the open
   * intent — the file would be loaded but never displayed.
   */
  setEditorPaneTab: (tab: 'code' | 'browser') => void;
  setSaving: (value: boolean | ((prev: boolean) => boolean)) => void;
  splitDragging: React.MutableRefObject<boolean>;
  splitContainerRef: React.RefObject<HTMLElement | null>;
  setSplitPos: (value: number) => void;
}

export interface ChatUiActionsReturn {
  appendCommandCard: (card: CommandResultCard) => void;
  handleCompactCurrentSession: () => Promise<void>;
  handleSaveFile: (path: string) => Promise<void>;
  handleSplitMouseDown: (e: React.MouseEvent) => void;
}

export function useChatUiActions(deps: ChatUiActionsDeps): ChatUiActionsReturn {
  const {
    token,
    gatewayUrl,
    currentSessionId,
    composerCommandDescriptors,
    appendAssistantDerivedMessages,
    appendAssistantEventMessages,
    resolveAssistantCapabilityKind,
    setRightPanelState,
    setRightOpen,
    setRightTab,
    fileEditor,
    openFileRef,
    setEditorMode,
    setEditorPaneTab,
    setSaving,
    splitDragging,
    splitContainerRef,
    setSplitPos,
  } = deps;

  const appendCommandCard = useCallback(
    (card: CommandResultCard) => {
      appendAssistantDerivedMessages([
        {
          content: createCommandCardContent(card, {
            kindOverride:
              card.type === 'compaction'
                ? 'compaction'
                : resolveAssistantCapabilityKind(`${card.title}\n${card.message}`),
          }),
        },
      ]);
    },
    [appendAssistantDerivedMessages, resolveAssistantCapabilityKind],
  );

  const handleCompactCurrentSession = useCallback(async () => {
    const matchedCompactCommand = matchServerSlashCommand('/compact', composerCommandDescriptors);
    if (!matchedCompactCommand) {
      appendCommandCard({
        type: 'status',
        title: '压缩暂不可用',
        message: '当前命令注册表里没有可执行的压缩命令。',
        tone: 'warning',
      });
      setRightOpen(true);
      setRightTab('overview');
      return;
    }

    await executeServerCommand({
      command: matchedCompactCommand,
      currentSessionId,
      gatewayUrl,
      rawInput: matchedCompactCommand.label,
      token,
      unavailableTitle: '压缩暂不可用',
      unavailableMessage: `需要先进入一个已有会话后再执行 ${matchedCompactCommand.label}。`,
      onCard: (card) => appendCommandCard(card),
      onEvents: (events) => {
        setRightPanelState((prev) =>
          events.reduce((next, event) => applyChatRightPanelEvent(next, event), prev),
        );
        appendAssistantEventMessages(events, { excludeCompaction: true });
      },
      onOpenRightPanel: () => setRightOpen(true),
    });
    setRightTab('overview');
    requestSessionListRefresh();
  }, [
    appendAssistantEventMessages,
    appendCommandCard,
    composerCommandDescriptors,
    currentSessionId,
    gatewayUrl,
    token,
    setRightPanelState,
    setRightOpen,
    setRightTab,
  ]);

  const handleSaveFile = useCallback(
    async (path: string) => {
      setSaving(true);
      await fileEditor.saveFile(path);
      setSaving(false);
    },
    [fileEditor, setSaving],
  );

  const handleSplitMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      splitDragging.current = true;
      const container = splitContainerRef.current;
      if (!container) return;

      // 拖动期间在 document.body 上挂一层全屏透明 overlay,目的是:
      //   1) 屏蔽 iframe 的 pointer events — 否则鼠标一进入浏览器预览
      //      iframe 区域,mousemove 会被 iframe 文档吃掉,外层 window
      //      监听不到,拖动方向受限只能往代码区域那一侧。
      //   2) 锁定光标为 col-resize,保持拖动时的视觉反馈。
      // mouseup 时移除 overlay,正常事件流恢复。
      const overlay = document.createElement('div');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483646;cursor:col-resize;background:transparent;user-select:none;';
      document.body.appendChild(overlay);

      // 拖动期间走 CSS variable 直接改样式,不进 React state — 60Hz 下避免:
      //  1) zustand persist 每帧 JSON.stringify ui-state 并写 localStorage
      //  2) ChatPage 顶层订阅 splitPos 触发整树 rerender
      let latestPct = 50;
      let rafScheduled = false;
      const applyPct = (pct: number) => {
        latestPct = pct;
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
          rafScheduled = false;
          container.style.setProperty('--split-pos', `${latestPct}%`);
        });
      };

      const onMove = (ev: MouseEvent) => {
        if (!splitDragging.current) return;
        const rect = container.getBoundingClientRect();
        const pct = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100));
        applyPct(pct);
      };
      const onUp = () => {
        splitDragging.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        try {
          overlay.remove();
        } catch {
          /* already removed */
        }
        // setSplitPos here points at writeSplitPos (see ChatPage),
        // a tiny `localStorage.setItem` call. No zustand subscriber
        // chain, no persist middleware re-stringifying the entire UI
        // state — sub-millisecond, safe to run synchronously in the
        // mouseup handler.
        setSplitPos(latestPct);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [setSplitPos, splitContainerRef, splitDragging],
  );

  useEffect(() => {
    openFileRef.current = (path: string) => {
      // Always force the editor pane open on the code tab so a click
      // from chat / tool-call / hover popover lands in a visible
      // panel, even if the pane was previously on the browser tab
      // or fully collapsed.
      setEditorMode(true);
      setEditorPaneTab('code');
      void fileEditor.openFile(path);
    };
    return () => {
      openFileRef.current = null;
    };
  }, [openFileRef, fileEditor, setEditorMode, setEditorPaneTab]);

  return {
    appendCommandCard,
    handleCompactCurrentSession,
    handleSaveFile,
    handleSplitMouseDown,
  };
}
