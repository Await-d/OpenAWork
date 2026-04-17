import { useCallback, useEffect } from 'react';
import type { CommandResultCard, RunEvent } from '@openAwork/shared';
import { createCommandCardContent, matchServerSlashCommand } from './support.js';
import { executeServerCommand } from './server-command-item.js';
import { requestSessionListRefresh } from '../../utils/session-list-events.js';
import { applyChatRightPanelEvent, type ChatRightPanelState } from '../chat-stream-state.js';

type RightPanelTabId = 'agent' | 'mcp' | 'plan' | 'tools' | 'overview' | 'history' | 'viz';
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
      const onMove = (ev: MouseEvent) => {
        if (!splitDragging.current) return;
        const rect = container.getBoundingClientRect();
        const pct = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100));
        setSplitPos(pct);
      };
      const onUp = () => {
        splitDragging.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [setSplitPos, splitContainerRef, splitDragging],
  );

  useEffect(() => {
    openFileRef.current = (path: string) => {
      setEditorMode(true);
      void fileEditor.openFile(path);
    };
    return () => {
      openFileRef.current = null;
    };
  }, [openFileRef, fileEditor, setEditorMode]);

  return {
    appendCommandCard,
    handleCompactCurrentSession,
    handleSaveFile,
    handleSplitMouseDown,
  };
}
