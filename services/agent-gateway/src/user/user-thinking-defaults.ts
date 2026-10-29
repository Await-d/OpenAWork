import { sqliteGet } from '../infra/db.js';
import { resolveStoredDefaultThinkingMode } from '../provider/provider-config.js';
import type { UserDefaultThinkingSelection } from '../session/session-route-selection.js';

interface UserSettingRow {
  value: string;
}

export const USER_DEFAULT_THINKING_KEY = 'default_thinking';

/**
 * 读取用户级「默认思考」设置（设置页 `default_thinking.chat` 档），
 * 作为**没有请求级档位**的轮次（消息通道 / 定时任务 / 程序化续跑）的兜底来源。
 *
 * 为什么需要这一层：`default_thinking` 过去只被 Web 端 `chat-session-defaults`
 * 读取以初始化 UI，真正的思考参数由前端每轮塞进请求体。通道与定时任务由网关
 * 自己构造 `requestData`（不含 `thinking` / `thinkingEnabled` / `reasoningEffort`），
 * 新建的执行会话 metadata 里也没有该键 → 解析结果为空 → 上游请求里根本没有
 * 思考参数，即「设置里开了思考，实际没思考」。
 *
 * 语义约束：
 * - 只在 `enabled === true` 时返回档位。用户关掉默认思考时保持「未指定」，
 *   不要下发显式 `disabled`——那会改变 `thinkingLanguagePrompt` 槽位口径，
 *   也会向上游发送本不必要的禁用字段。
 * - 读取 / 解析失败一律退化为「不兜底」，与改造前行为一致，不阻断对话。
 */
export function resolveUserDefaultThinkingForChat(userId: string): UserDefaultThinkingSelection {
  let raw: unknown;
  try {
    const row = sqliteGet<UserSettingRow>(
      `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
      [userId, USER_DEFAULT_THINKING_KEY],
    );
    raw = row ? (JSON.parse(row.value) as unknown) : undefined;
  } catch {
    raw = undefined;
  }

  const chat = resolveStoredDefaultThinkingMode(raw, 'chat');
  if (chat.enabled !== true) {
    return {};
  }

  return { thinkingEnabled: true, reasoningEffort: chat.effort };
}
