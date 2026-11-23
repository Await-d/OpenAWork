import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { useChatKeyboardShortcuts } from '../../../hooks/chat/useChatKeyboardShortcuts.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import {
  scrollToNextUserMessage,
  scrollToPrevUserMessage,
} from '../history/scroll-user-message.js';
import type { DialogueMode } from '../mode/dialogue-mode.js';

type ChatPageShortcutsDeps = {
  enabled: boolean;
  messages: ChatMessage[];
  dialogueMode: DialogueMode;
  /**
   * 是否允许切换对话模式。来源托管会话（渠道 / 定时任务）没有对话模式，
   * 顶栏既不渲染切换器，这条快捷键也必须停用：否则它会改本地模式并置 metadata 脏，
   * 白触发一次 PATCH，且改动会被 `run-send-message` 原样发进 stream 请求。
   * 判定见 utils/session/session-origin。
   */
  dialogueModeEnabled: boolean;
  onDialogueModeChange: (mode: DialogueMode) => void;
  onCopyMessage: (message: ChatMessage) => void;
  multiSelectEnabled: boolean;
  enableMultiSelect: () => void;
  disableMultiSelect: () => void;
  selectAll: (messages: ChatMessage[]) => void;
  scrollRegionRef: RefObject<HTMLDivElement | null>;
  isFusionLayout: boolean;
  toggleReviewPanel: () => void;
  setRightOpen: Dispatch<SetStateAction<boolean>>;
  onCommandPalette: () => void;
  onSearch: () => void;
  onOpenTemplates: () => void;
  onToggleTerminalPanel: () => void;
  onNewSession: () => void;
};

/** 页面快捷键动作域；键位与终端/输入焦点隔离仍由唯一的底层监听器负责。 */
export function useChatPageShortcuts(deps: ChatPageShortcutsDeps): void {
  useChatKeyboardShortcuts(
    {
      onCommandPalette: deps.onCommandPalette,
      onSearch: deps.onSearch,
      // 来源会话不注册该动作：`useChatKeyboardShortcuts` 对未提供的 handler 直接跳过，
      // 因此这里用 undefined 表达「本会话没有可切换的对话模式」，而不是静默吞掉。
      onToggleDialogueMode: deps.dialogueModeEnabled
        ? () => {
            const preferred = useDisplayPreferencesStore.getState().defaultDialogueMode;
            deps.onDialogueModeChange(deps.dialogueMode === preferred ? 'clarify' : preferred);
          }
        : undefined,
      onCopyLastAssistant: () => {
        const lastAssistant = deps.messages.findLast((message) => message.role === 'assistant');
        if (lastAssistant) {
          deps.onCopyMessage(lastAssistant);
          toast('已复制', 'success');
        }
      },
      onToggleMultiSelect: () => {
        if (deps.multiSelectEnabled) {
          deps.disableMultiSelect();
        } else {
          deps.enableMultiSelect();
          requestAnimationFrame(() => deps.selectAll(deps.messages));
        }
      },
      onOpenTemplates: deps.onOpenTemplates,
      onScrollToNextUser: () => scrollToNextUserMessage(deps.scrollRegionRef.current),
      onScrollToPrevUser: () => scrollToPrevUserMessage(deps.scrollRegionRef.current),
      onToggleSidebar: () => useUIStateStore.getState().toggleLeftSidebar(),
      onToggleRightPanel: () => {
        if (deps.isFusionLayout) {
          deps.toggleReviewPanel();
          return;
        }
        deps.setRightOpen((open) => !open);
      },
      onToggleTerminalPanel: deps.onToggleTerminalPanel,
      onCycleTheme: () => window.dispatchEvent(new CustomEvent('app:cycle-theme')),
      onNewSession: deps.onNewSession,
    },
    deps.enabled,
  );
}
