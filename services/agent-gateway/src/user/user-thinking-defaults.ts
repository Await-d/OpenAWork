import { sqliteGet } from '../infra/db.js';
import { resolveStoredDefaultThinkingMode } from '../provider/provider-config.js';
import type { DefaultThinkingSettings } from '../provider/provider-config.js';
import type { UserDefaultThinkingSelection } from '../session/session-route-selection.js';

interface UserSettingRow {
  value: string;
}

export const USER_DEFAULT_THINKING_KEY = 'default_thinking';

export function readUserChatThinkingSettings(userId: string): DefaultThinkingSettings['chat'] {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, USER_DEFAULT_THINKING_KEY],
  );
  let raw: unknown;
  try {
    raw = row ? JSON.parse(row.value) : undefined;
  } catch {
    // A malformed stored value is treated the same as in the settings page.
    raw = undefined;
  }
  return resolveStoredDefaultThinkingMode(raw, 'chat');
}

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
 * - 开启（`enabled === true`）时返回档位；
 * - 关闭时**显式返回 `thinkingEnabled: false`**。不能像以前那样留空：留空会让
 *   上游回到自己的默认行为，而 DeepSeek / Gemini 2.5 等平台默认就是开启思考，
 *   于是「用户在设置里关掉思考」只对 Web 正常轮生效，通道 / 定时任务仍在思考。
 *   Web 正常轮本身也总是显式带 `thinkingEnabled`（关闭时即 `disabled`），
 *   这一层对齐同一口径。
 * - 只读库失败（异常）时返回空对象、不兜底：数据库抖动不该被解释成「用户关了
 *   思考」，否则一次 SQLite 异常会让所有通道轮静默失去思考能力。
 */
export function resolveUserDefaultThinkingForChat(userId: string): UserDefaultThinkingSelection {
  try {
    const chat = readUserChatThinkingSettings(userId);
    return chat.enabled
      ? { thinkingEnabled: true, reasoningEffort: chat.effort }
      : { thinkingEnabled: false };
  } catch {
    // 读取失败 → 不兜底（保持改造前行为，不阻断对话）。
    return {};
  }
}
