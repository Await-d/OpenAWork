/**
 * 内置浏览器标签的用户级持久化（跨设备 / 跨重装恢复）。
 *
 * **已被 `user-workspace-state.ts` 取代（保留接口兼容）**：这份记录是「全用户一份」，
 * 多工作区会互相覆盖；新的「工作台现场」快照按工作区存标签，并顺带同步预览地址、
 * 书签与面板布局。当前前端不再写入本接口，仅在旧客户端上仍会读写。
 *
 * 为什么需要服务端存储：标签原本只存在 `localStorage`，而 localStorage 有三个致命短板
 * ——换机器、清缓存、桌面端 WebView 存储目录变化都会让「上次打开的页面」凭空消失，
 * 且无法在设备间同步。把标签记在 `user_settings` 里，与显示偏好同一套设施，
 * 客户端启动时以服务端为准、本地仅作缓存。
 *
 * 口径与前端 `BrowserTab` 保持一致，但**只保留可恢复的部分**：`id` / `url` / `title` /
 * `faviconUrl` / `history` / `historyIndex`。页面运行时状态（滚动位置、表单内容、
 * SPA 内部路由）本就不属于「标签」的语义，也不该由服务端保存。
 */
import { z } from 'zod';
import { sqliteGet, sqliteRun } from '../infra/db.js';

interface UserSettingRow {
  value: string;
}

export const USER_BROWSER_TABS_KEY = 'user_browser_tabs_v1';

/** 标签数量上限：与服务端只做「记住上次打开什么」的定位一致，不必无上限增长。 */
export const BROWSER_TABS_MAX_TABS = 20;
/** 单标签历史深度上限；与前端 `HISTORY_LIMIT` 解耦，服务端只保留足够恢复的量。 */
export const BROWSER_TABS_MAX_HISTORY = 50;
/** 单个 URL 长度上限：拦住异常长串把整行 JSON 撑爆。 */
export const BROWSER_TABS_MAX_URL_CHARS = 2048;
/** 标题长度上限。 */
export const BROWSER_TABS_MAX_TITLE_CHARS = 200;

const browserTabSchema = z.object({
  id: z.string().min(1).max(120),
  url: z.string().max(BROWSER_TABS_MAX_URL_CHARS),
  title: z.string().max(BROWSER_TABS_MAX_TITLE_CHARS).optional(),
  faviconUrl: z.string().max(BROWSER_TABS_MAX_URL_CHARS).optional(),
  history: z.array(z.string().max(BROWSER_TABS_MAX_URL_CHARS)).max(BROWSER_TABS_MAX_HISTORY),
  historyIndex: z.number().int().min(-1),
});

export type PersistedBrowserTab = z.infer<typeof browserTabSchema>;

export const userBrowserTabsPayloadSchema = z.object({
  tabs: z.array(browserTabSchema).max(BROWSER_TABS_MAX_TABS),
  activeTabId: z.string().max(120),
});

/**
 * PUT 语义为部分更新：客户端可以只提交 `tabs`（例如只新增了一个标签），服务端读旧合并。
 *
 * 与显示偏好一致地不用 `.default()`：服务端没存过的字段保持缺省，客户端据此保留本机值，
 * 版本错位时不会互相清空。
 */
export const userBrowserTabsUpdateSchema = userBrowserTabsPayloadSchema.partial();

export type UserBrowserTabsPayload = z.infer<typeof userBrowserTabsPayloadSchema>;
export type UserBrowserTabsUpdateInput = z.infer<typeof userBrowserTabsUpdateSchema>;

const storedBrowserTabsSchema = userBrowserTabsUpdateSchema.extend({
  updatedAt: z.string().optional(),
});

export interface StoredUserBrowserTabs {
  tabs: UserBrowserTabsUpdateInput;
  updatedAt: string | null;
}

/**
 * 读取标签；无记录或存储行损坏时返回 `null`（客户端回落到本机缓存，不抛错）。
 *
 * 校验失败一律当作「没有记录」而不是抛错：一条历史脏数据不该让整个偏好接口 500。
 */
export function loadUserBrowserTabs(userId: string): StoredUserBrowserTabs | null {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, USER_BROWSER_TABS_KEY],
  );
  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.value) as unknown;
    const result = storedBrowserTabsSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    const { updatedAt, ...tabs } = result.data;
    return { tabs, updatedAt: updatedAt ?? null };
  } catch {
    return null;
  }
}

export function saveUserBrowserTabs(
  userId: string,
  patch: UserBrowserTabsUpdateInput,
): StoredUserBrowserTabs {
  const existing = loadUserBrowserTabs(userId);
  // `tabs` 是整体替换而不是按下标合并：客户端提交的是「完整的一份标签快照」，
  // 按项合并会在删除标签时把旧项又留下来。
  const nextTabs: UserBrowserTabsUpdateInput = {
    ...(existing?.tabs ?? {}),
    ...patch,
  };
  const updatedAt = new Date().toISOString();

  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, USER_BROWSER_TABS_KEY, JSON.stringify({ ...nextTabs, updatedAt })],
  );

  return { tabs: nextTabs, updatedAt };
}
