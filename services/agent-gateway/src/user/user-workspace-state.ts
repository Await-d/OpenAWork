/**
 * 工作台现场（打开记录 + 面板布局）的用户级持久化。
 *
 * 这一份快照回答的是「上次离开时工作台长什么样」：
 * - `uiState`：前端 `openAwork-ui-state` 的持久化载荷（按 workspace 的预览地址、
 *   编辑器打开的文件、面板开关与宽度、标题栏会话标签等）；
 * - `bookmarks`：内置浏览器书签；
 * - `browserTabsByWorkspace`：每个工作区的浏览器标签与历史（原来只有一份全局记录，
 *   多工作区会互相覆盖）。
 *
 * 与浏览器标签接口的关键差别：**快照整体替换**。客户端提交的就是一份完整现场，
 * 逐字段合并反而会让「已经关掉的面板 / 移出列表的文件」在服务端残留。
 *
 * 校验策略：`uiState` 的形状归前端所有（字段随版本演进），服务端只保证它是对象
 * 且整包不超过 `WORKSPACE_STATE_MAX_BYTES`；书签与标签页这些跨端消费的结构才做
 * 严格校验。脏数据一律按「没有记录」处理，不让一条历史坏行把接口打成 500。
 */
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { sqliteGet, sqliteRun } from '../infra/db.js';

interface UserSettingRow {
  value: string;
}

export const USER_WORKSPACE_STATE_KEY = 'user_workspace_state_v1';

/** 单用户快照的字节上限：正常现场几十 KB，512 KiB 已能拦住异常膨胀。 */
export const WORKSPACE_STATE_MAX_BYTES = 512 * 1024;
/** 最多记住多少个工作区；超出部分客户端下次推送时会被裁剪。 */
export const WORKSPACE_STATE_MAX_WORKSPACES = 50;
/** 书签条数上限（与开始页展示无关，仅防无限增长）。 */
export const WORKSPACE_STATE_MAX_BOOKMARKS = 200;
const MAX_TABS_PER_WORKSPACE = 20;
const MAX_HISTORY_PER_TAB = 50;
const MAX_URL_CHARS = 2048;
const MAX_TITLE_CHARS = 200;
const MAX_WORKSPACE_KEY_CHARS = 1024;

const savedTabSchema = z.object({
  id: z.string().min(1).max(120),
  url: z.string().max(MAX_URL_CHARS),
  title: z.string().max(MAX_TITLE_CHARS).optional(),
  faviconUrl: z.string().max(MAX_URL_CHARS).optional(),
  history: z.array(z.string().max(MAX_URL_CHARS)).max(MAX_HISTORY_PER_TAB),
  // 与旧标签接口保持一致：-1 表示「历史为空」的脏数据，允许回读时归一。
  historyIndex: z.number().int().min(-1),
});

const workspaceTabsSchema = z.object({
  tabs: z.array(savedTabSchema).max(MAX_TABS_PER_WORKSPACE),
  activeTabId: z.string().max(120),
});

const bookmarkSchema = z.object({
  id: z.string().min(1).max(120),
  url: z.string().max(MAX_URL_CHARS),
  title: z.string().max(MAX_TITLE_CHARS),
  faviconUrl: z.string().max(MAX_URL_CHARS).optional(),
  createdAt: z.number(),
});

const browserTabsByWorkspaceSchema = z
  .record(workspaceTabsSchema)
  .refine((map) => Object.keys(map).length <= WORKSPACE_STATE_MAX_WORKSPACES, {
    message: `最多同步 ${WORKSPACE_STATE_MAX_WORKSPACES} 个工作区`,
  })
  .refine((map) => Object.keys(map).every((key) => key.length <= MAX_WORKSPACE_KEY_CHARS), {
    message: '工作区键过长',
  });

/** 快照载荷：客户端 PUT 的完整现场。 */
export const workspaceStateSchema = z
  .object({
    /** 快照结构版本：留给客户端做向后兼容，服务端只透传。 */
    version: z.number().int().min(1).max(100),
    /** 前端 UI store 的持久化版本，回灌时用于跑迁移。 */
    uiStateVersion: z.number().int().min(1).max(10_000),
    uiState: z.record(z.unknown()),
    bookmarks: z.array(bookmarkSchema).max(WORKSPACE_STATE_MAX_BOOKMARKS),
    browserTabsByWorkspace: browserTabsByWorkspaceSchema,
  })
  .superRefine((value, ctx) => {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (bytes > WORKSPACE_STATE_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `工作台快照过大（${bytes} 字节），上限 ${WORKSPACE_STATE_MAX_BYTES} 字节`,
      });
    }
  });

export type WorkspaceStatePayload = z.infer<typeof workspaceStateSchema>;

const storedWorkspaceStateSchema = workspaceStateSchema.and(
  z.object({ updatedAt: z.string().optional() }),
);

export interface StoredUserWorkspaceState {
  state: WorkspaceStatePayload;
  updatedAt: string | null;
}

/** 读取快照；无记录 / 校验失败返回 `null`（客户端回落到本机缓存）。 */
export function loadUserWorkspaceState(userId: string): StoredUserWorkspaceState | null {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, USER_WORKSPACE_STATE_KEY],
  );
  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.value) as unknown;
    const result = storedWorkspaceStateSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    const { updatedAt, ...state } = result.data;
    return { state, updatedAt: updatedAt ?? null };
  } catch {
    return null;
  }
}

/** 整体替换快照。 */
export function saveUserWorkspaceState(
  userId: string,
  state: WorkspaceStatePayload,
): StoredUserWorkspaceState {
  const updatedAt = new Date().toISOString();

  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, USER_WORKSPACE_STATE_KEY, JSON.stringify({ ...state, updatedAt })],
  );

  return { state, updatedAt };
}
