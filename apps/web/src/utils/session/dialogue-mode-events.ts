import type { DialogueMode } from '@openAwork/shared';

const DIALOGUE_MODE_SWITCH_EVENT = 'openAwork:session-dialogue-mode-switch';

/**
 * 模式切换来源：
 * - `auto`：服务端在"设计已完成"门控命中（共识确认 / 计划批准）时自动切换，
 *   也叫"回应答结果回传"（`publishDialogueModeSwitchFromReply`）；
 * - `user`：用户点击界面上的「确认转换」按钮显式切换。
 * 仅用于提示文案与埋点，不参与状态判定。
 */
export type DialogueModeSwitchSource = 'auto' | 'user';

export interface SessionDialogueModeSwitch {
  dialogueMode: DialogueMode;
  sessionId: string;
  source: DialogueModeSwitchSource;
}

/**
 * 服务端在澄清模式"设计已完成"后会把会话自动切换到编程模式：
 * 网关 `session/dialogue-mode-auto-switch.ts` 改写会话元数据 `dialogueMode`，
 * 并在问题回复响应里回传新模式（见 `QuestionReplyResult`）。
 *
 * 回答问题的入口分散在 chat inline 面板、全局待办面板等多个互不持有对话框
 * 状态（`dialogueMode`）的组件里，因此用 window 事件广播、由持有状态的页面
 * 按 sessionId 订阅，而不是逐层透传回调。
 */
export function publishSessionDialogueModeSwitch(input: SessionDialogueModeSwitch): void {
  if (typeof window === 'undefined' || input.sessionId.trim().length === 0) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<SessionDialogueModeSwitch>(DIALOGUE_MODE_SWITCH_EVENT, {
      detail: {
        dialogueMode: input.dialogueMode,
        sessionId: input.sessionId,
        source: input.source,
      },
    }),
  );
}

export function subscribeSessionDialogueModeSwitch(
  onSwitch: (next: SessionDialogueModeSwitch) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleSwitch = (event: Event) => {
    const detail = (event as CustomEvent<Partial<SessionDialogueModeSwitch>>).detail;
    const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : '';
    const dialogueMode = detail?.dialogueMode;
    if (
      sessionId.trim().length === 0 ||
      (dialogueMode !== 'clarify' && dialogueMode !== 'coding' && dialogueMode !== 'programmer')
    ) {
      return;
    }

    onSwitch({ dialogueMode, sessionId, source: detail?.source === 'user' ? 'user' : 'auto' });
  };

  window.addEventListener(DIALOGUE_MODE_SWITCH_EVENT, handleSwitch);
  return () => window.removeEventListener(DIALOGUE_MODE_SWITCH_EVENT, handleSwitch);
}

/**
 * 问题回复结果的统一落地口：服务端只在自动切换发生时才回传 `dialogueMode`，
 * 这里负责把它广播给会话页面。没有回传时是空操作。
 */
export function publishDialogueModeSwitchFromReply(input: {
  dialogueMode?: DialogueMode;
  sessionId: string;
}): void {
  if (!input.dialogueMode) {
    return;
  }

  publishSessionDialogueModeSwitch({
    dialogueMode: input.dialogueMode,
    sessionId: input.sessionId,
    source: 'auto',
  });
}
