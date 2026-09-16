/**
 * 「确认转换」按钮的交互逻辑：把用户显式确认（澄清 → 编程模式）落到服务端，
 * 并把结果广播给持有对话模式状态的页面。
 *
 * 为什么需要服务端确认而不是只改本地状态：
 *   - 服务端要在同一次写入里切换 `dialogueMode`、写审计字段（`dialogueModeSwitch.reason`）
 *     并结算澄清确认门控（`clarificationState` 的确认节点），保证"已进入编程模式"与
 *     "共识已确认"不会出现中间态；
 *   - 手工切换走的通道与自动门控完全一致（同为 `switchSessionDialogueModeToCoding`），
 *     只是 reason 为 `user_confirmed`。
 *
 * 模式状态的落地仍然是 ChatPage 那一处订阅（`subscribeSessionDialogueModeSwitch`）：
 * 本 hook 只负责请求 + 广播，不直接持有模式 state，避免两处各自维护。
 */

import { useCallback, useRef, useState } from 'react';
import { createDialogueModeClient } from '@openAwork/web-client';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import { publishSessionDialogueModeSwitch } from '../../../utils/session/dialogue-mode-events.js';

export interface UseDialogueModeSwitchOptions {
  /**
   * 是否允许确认转换（仅澄清模式为 true）。为 false 时 `confirmSwitchToCoding`
   * 是空操作，避免误触发。
   */
  enabled: boolean;
  gatewayUrl: string;
  sessionId: string | null;
  token: string | null;
}

export interface DialogueModeSwitchController {
  /** 点击「确认转换」：请求服务端切换，成功后广播新模式。 */
  confirmSwitchToCoding: () => Promise<void>;
  /** 请求进行中（按钮 loading / 禁用态）。 */
  pending: boolean;
}

export function useDialogueModeSwitch(
  options: UseDialogueModeSwitchOptions,
): DialogueModeSwitchController {
  const { enabled, gatewayUrl, sessionId, token } = options;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const confirmSwitchToCoding = useCallback(async () => {
    if (!enabled || !sessionId || !token || pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    try {
      const result = await createDialogueModeClient(gatewayUrl).confirmClarifySwitch(
        token,
        sessionId,
      );
      if (result.dialogueMode) {
        publishSessionDialogueModeSwitch({
          dialogueMode: result.dialogueMode,
          sessionId,
          source: 'user',
        });
      }
      if (!result.switched) {
        toast('当前会话已不在澄清模式，无需重复确认。', 'info', 2600);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '确认切换失败，请重试。', 'error', 4200);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [enabled, gatewayUrl, sessionId, token]);

  return { confirmSwitchToCoding, pending };
}
