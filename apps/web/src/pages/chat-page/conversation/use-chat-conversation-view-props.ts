/**
 * useChatConversationViewProps —— `<ChatConversationView>` 双分支 prop surface 的单一事实来源。
 *
 * 背景（组装层瘦身 P1）：`ChatPage` 曾经在 fusion / classic 两个分支各写一份
 * 近 220 / 234 行的 `<ChatConversationView ...>` prop 列表，两者只有 `topBar`
 * 与 `compact` 不同，其余完全重复。本 hook 把「公共 props」收敛成**只组装一次**
 * 的对象，交给 `layout/FusionChatRegion` 与 `layout/ClassicChatRegion` 消费。
 *
 * 设计原则：
 * 1. **单一输入对象**：输入是 `ChatConversationViewPropsInput`（一个对象），而不是
 *    ~200 个位置参数——避免巨型 builder 签名。
 * 2. **类型派生**：公共 props 直接 `Omit` 自 `ChatConversationViewProps`，
 *    保证与子视图契约严格一致（漏 / 改名一个 props 就编译不过）。
 * 3. **不手写 memo**：对象身份交给 React Compiler（仓库规则），此处不写
 *    `useMemo` / `useCallback`。
 * 4. **slot 不下沉**：`beforeMessages` / `afterMessages` / `composerRightSlot`
 *    由调用方作为公共 props 传入（两分支一致），只有 `topBar` / `compact`
 *    留在区域容器里按分支组装。
 *
 * `chrome` 是区域容器组装各自 `topBar` 所需的公共输入（顶栏 / 多选 / 工作流条等），
 * 与 `ChatConversationView` 自身契约无关，故单独分组。
 *
 * 详见 `.agentdocs/workflow/260921-ChatPage组装层瘦身方案.md` Phase 1。
 */

import type { WorkflowRuntimeState } from '@openAwork/shared';
import type { SessionTask } from '@openAwork/web-client';
import type { ChatTodoController } from '../../../components/conversation-runtime/views/todo-bar.js';
import type { WorkspaceBindingChipState } from '../../../components/chat/session/ChatTopBar.js';
import type { UseSessionTerminalsResult } from '../../../components/conversation-runtime/terminals/use-session-terminals.js';
import type { useMessageMultiSelect } from '../../../components/chat/message/message-multi-select.js';
import type { useBookmarkStore } from '../../../stores/chat/bookmarks.js';
import type { DialogueMode } from '../mode/dialogue-mode.js';
import type {
  ChatConversationViewProps,
  ConversationComposerExtras,
  SessionConversationSource,
} from './ChatConversationView.js';

/**
 * bookmark store 的 state/action 面。
 *
 * `ReturnType<typeof useBookmarkStore>` 在 Zustand 的 `UseBoundStore` 重载下退化为
 * `unknown`，故经 `getState()` 反推 store 形状。
 */
type BookmarkStoreApi = ReturnType<typeof useBookmarkStore.getState>;

/**
 * 两分支共享的 `ChatConversationView` props。
 *
 * `topBar` 与 `compact` 因分支而异（fusion 紧凑 + 融合顶栏；classic 常规 + 经典顶栏），
 * 由区域容器负责填充，故从公共子集里剔除。
 */
export type ChatConversationViewCommonProps = Omit<
  ChatConversationViewProps,
  'topBar' | 'compact'
>;

/**
 * 区域容器组装分支 `topBar` 所需的公共输入。
 *
 * 包含两分支都会用到的共享 chrome；`editorMode` / `editorFullScreen` 等 classic
 * 专属项也放在这里，fusion 容器忽略即可（不参与 fusion 渲染）。
 */
export interface ChatConversationViewChromeInputs {
  onChangeDialogueMode: (mode: DialogueMode) => void;
  onConfirmClarifySwitch: () => void;
  clarifySwitchPending: boolean;
  onToggleRightOpen: () => void;
  sessionTerminals: UseSessionTerminalsResult;
  terminalPanelOpened: boolean;
  onToggleTerminalPanel: () => void;
  openCommandPalette: () => void;
  bookmarkStore: BookmarkStoreApi;
  multiSelect: ReturnType<typeof useMessageMultiSelect>;
  todoController: ChatTodoController;
  todoDetailsId?: string;
  workspaceBinding: WorkspaceBindingChipState;
  reviewPanelOpened: boolean;
  onToggleReviewPanel: () => void;
  activeModelOptionLabel?: string;
  effectiveModelId: string;
  dialogueModeLabel: string;
  workflowRuntime: WorkflowRuntimeState | null;
  sessionTasks: SessionTask[];
  // ─── classic 专属 ───────────────────────────────────────────────────
  editorFullScreen: boolean;
  onToggleEditorMode: () => void;
  onToggleEditorFullScreen: () => void;
  quickTerminalOpen: boolean;
  onToggleQuickTerminal: () => void;
  browserPreviewUrl: string | null;
  onOpenBrowser: () => void;
  editorPaneTab: 'code' | 'browser';
  onActivateCodeTab: () => void;
  onActivateBrowserTab: () => void;
}

/** 公共 props 组装输入：公共 props + 区域 chrome，全部塞进**一个**对象。 */
export interface ChatConversationViewPropsInput
  extends Omit<ChatConversationViewCommonProps, 'sessionSource' | 'composerExtras'> {
  /** session 来源标识；chat 端固定 'chat'，缺省即 'chat'。 */
  sessionSource?: SessionConversationSource;
  /** composer 能力开关；缺省使用 chat 端全开集合。 */
  composerExtras?: ConversationComposerExtras;
  chrome: ChatConversationViewChromeInputs;
}

/** hook 返回值：公共 props + 区域 chrome。 */
export interface ChatConversationViewModel extends ChatConversationViewCommonProps {
  chrome: ChatConversationViewChromeInputs;
}

/** chat 端默认打开的 composer 能力集合（imageGen / skill / 多选 / 书签 / 模板等）。 */
const CHAT_SESSION_COMPOSER_EXTRAS: ConversationComposerExtras = {
  imageGeneration: true,
  skillRecommendation: true,
  multiSelect: true,
  bookmarks: true,
  promptTemplate: true,
  commandPalette: true,
  dialogueModeToggle: true,
  permissionMode: true,
  agentSwitch: true,
};

/**
 * 产出双分支共享的 `ChatConversationView` props 对象（**只组装一次**）。
 *
 * 调用点把公共 props 与 `chrome` 塞进一个输入对象；本 hook 补齐 chat 端默认值
 * 并原样返回，区域容器只需 `model={returnValue}`。
 */
export function useChatConversationViewProps(
  input: ChatConversationViewPropsInput,
): ChatConversationViewModel {
  const {
    chrome,
    sessionSource = 'chat',
    composerExtras = CHAT_SESSION_COMPOSER_EXTRAS,
    ...view
  } = input;

  return { ...view, sessionSource, composerExtras, chrome };
}
