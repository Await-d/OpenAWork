import { z } from 'zod';
import { sqliteGet, sqliteRun } from '../infra/db.js';

interface UserSettingRow {
  value: string;
}

export const USER_DISPLAY_PREFERENCES_KEY = 'user_display_preferences_v1';

/**
 * 显示偏好的完整字段口径。字段与 Web 端 `display-preferences` store
 * （apps/web/src/stores/settings/display-preferences.ts）逐一对应，
 * `workbenchLayoutMode` 对应 uiState store 的工作台布局。
 */
export const userDisplayPreferencesPayloadSchema = z.object({
  // 消息元信息
  showMessageTimestamps: z.boolean(),
  showProviderLabel: z.boolean(),
  showModelName: z.boolean(),
  showDuration: z.boolean(),
  showStopReason: z.boolean(),
  showTokenBreakdown: z.boolean(),
  showEstimatedTokens: z.boolean(),
  showRequestIndex: z.boolean(),
  showToolCount: z.boolean(),
  showMetaLine: z.boolean(),
  // 消息布局
  messageLayout: z.enum(['unified', 'split']),
  // 推理与工具调用
  showReasoningBlock: z.boolean(),
  reasoningExpandedByDefault: z.boolean(),
  toolCallsExpandedByDefault: z.boolean(),
  toolExpandedOverrides: z.object({
    bash: z.boolean(),
    fileEdit: z.boolean(),
    fileRead: z.boolean(),
    mcp: z.boolean(),
    skill: z.boolean(),
    web: z.boolean(),
    batch: z.boolean(),
    other: z.boolean(),
  }),
  // 对话模式
  defaultDialogueMode: z.enum(['clarify', 'coding', 'programmer']),
  // 输入区
  showComposerStatsBar: z.boolean(),
  showVoiceInputButton: z.boolean(),
  // 界面元素显隐
  showCommandPaletteButton: z.boolean(),
  showGatewayStatusIndicator: z.boolean(),
  showTerminalButton: z.boolean(),
  // 外观
  themeMode: z.enum(['system', 'light', 'dark']),
  themeStyle: z.enum([
    'nebula',
    'aurora',
    'linear',
    'forest',
    'sakura',
    'carbon',
    'sunset',
    'ocean',
  ]),
  fileIconTheme: z.enum(['material', 'minimal']),
  // 工作台布局（存储于前端 uiState store）
  workbenchLayoutMode: z.enum(['classic', 'fusion']),
});

/**
 * PUT 语义为部分更新：客户端可以只提交变化字段，服务端读旧合并。
 * 不做 `.default()`——「服务端没存过的字段」保持缺省，客户端据此保留本机值，
 * 保证前后端版本错位时不互相清空对方未知的字段。
 */
export const userDisplayPreferencesUpdateSchema = userDisplayPreferencesPayloadSchema.partial();

export type UserDisplayPreferencesPayload = z.infer<typeof userDisplayPreferencesPayloadSchema>;

export type UserDisplayPreferencesUpdateInput = z.infer<typeof userDisplayPreferencesUpdateSchema>;

const storedDisplayPreferencesSchema = userDisplayPreferencesUpdateSchema.extend({
  updatedAt: z.string().optional(),
});

export interface StoredUserDisplayPreferences {
  preferences: UserDisplayPreferencesUpdateInput;
  updatedAt: string | null;
}

/**
 * 读取显示偏好；无记录或存储行损坏时返回 `null`（由客户端种子自愈，不抛错）。
 */
export function loadUserDisplayPreferences(userId: string): StoredUserDisplayPreferences | null {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, USER_DISPLAY_PREFERENCES_KEY],
  );
  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.value) as unknown;
    const result = storedDisplayPreferencesSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    const { updatedAt, ...preferences } = result.data;
    return { preferences, updatedAt: updatedAt ?? null };
  } catch {
    return null;
  }
}

export function saveUserDisplayPreferences(
  userId: string,
  patch: UserDisplayPreferencesUpdateInput,
): StoredUserDisplayPreferences {
  const existing = loadUserDisplayPreferences(userId);
  const nextPreferences: UserDisplayPreferencesUpdateInput = {
    ...(existing?.preferences ?? {}),
    ...patch,
  };
  const updatedAt = new Date().toISOString();

  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, USER_DISPLAY_PREFERENCES_KEY, JSON.stringify({ ...nextPreferences, updatedAt })],
  );

  return { preferences: nextPreferences, updatedAt };
}
