import type { DialogueMode } from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';

/**
 * 「澄清 → 编程」对话模式切换的**唯一落库入口**。
 *
 * 触发来源通过 `reason` 区分，全部写进审计字段 `dialogueModeSwitch`：
 *   - `clarification_confirmed`：grill 确认节点（`__grill_confirm__`）被用户肯定回答，
 *     `clarificationState.confirmedAt` 首次落库（自动，对应 clarify 提示词的确认门控）；
 *   - `plan_approved`：`ExitPlanMode` 审批通过（自动，用户批准开始实现）；
 *   - `user_confirmed`：用户在界面上显式点击「确认转换」按钮（手动，
 *     见 `routes/session-dialogue-mode.ts`）。
 *
 * 切换语义：
 *   - 会话元数据 `dialogueMode` 置为 `coding`（编程模式），后续轮次使用编程模式提示词
 *     与完整工具面（写 / 执行类工具重新可见）；
 *   - 审计字段 `dialogueModeSwitch: { from, to, reason, at }` 让前端与排障能区分
 *     "用户手动切换 / 由确认门控自动切换"；
 *   - 已在编程 / 程序员模式时是幂等空操作（返回 `switched: false`）。
 *
 * 刻意不改的会话：
 *   - 带 `clarificationIntent` 的会话——那是 team reception 的 handoff 澄清链条，
 *     由编排器（`reception-orchestrator`）自行推进；界面上的「确认转换」按钮也不会
 *     出现在 team 会话里，因此这里不需要为手动来源开口子。
 */
export type DialogueModeSwitchReason =
  | 'clarification_confirmed'
  | 'plan_approved'
  | 'user_confirmed';

export const CLARIFY_COMPLETION_TARGET_MODE: DialogueMode = 'coding';

export const DIALOGUE_MODE_SWITCH_METADATA_KEY = 'dialogueModeSwitch';

export interface DialogueModeSwitchResult {
  dialogueMode?: DialogueMode;
  switched: boolean;
}

export function switchSessionDialogueModeToCoding(input: {
  /**
   * 与模式切换**同一次写入**的附加元数据（例如手动确认路径顺带结算的
   * `clarificationState`）。放在这里而不是调用方二次写库，是为了保持
   * "会话元数据的读-改-写只有一处"——两次独立写库会互相覆盖对方的字段。
   */
  metadataPatch?: Record<string, unknown>;
  reason: DialogueModeSwitchReason;
  sessionId: string;
}): DialogueModeSwitchResult {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [input.sessionId],
  );
  if (!row) {
    return { switched: false };
  }

  const metadata = parseSessionMetadataJson(row.metadata_json);
  if (metadata['dialogueMode'] !== 'clarify') {
    return { switched: false };
  }
  const clarificationIntent = metadata['clarificationIntent'];
  if (typeof clarificationIntent === 'string' && clarificationIntent.trim().length > 0) {
    // team reception 的 handoff 澄清链条：由编排器推进，不在这里改会话模式。
    // 空字符串视为"没有意图"（reception 清理后会留下空串），不构成拦截条件。
    return { switched: false };
  }

  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify({
      ...metadata,
      ...(input.metadataPatch ?? {}),
      dialogueMode: CLARIFY_COMPLETION_TARGET_MODE,
      [DIALOGUE_MODE_SWITCH_METADATA_KEY]: {
        at: Date.now(),
        from: 'clarify',
        reason: input.reason,
        to: CLARIFY_COMPLETION_TARGET_MODE,
      },
    }),
    input.sessionId,
  ]);

  return { switched: true, dialogueMode: CLARIFY_COMPLETION_TARGET_MODE };
}
