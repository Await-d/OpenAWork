/**
 * 模板偏好（本地持久化）：收藏 / 置顶 + 最近使用 + 使用次数统计。
 *
 * 全部存在 localStorage（按用户无关的本地偏好，不入后端），key 前缀 `team.templatePrefs.`。
 * 纯逻辑函数（parse/toggle/touch/排序）与 IO 分离，便于单测。
 */

export interface TemplatePreferences {
  /** 收藏（置顶）的模板 id 列表。 */
  favorites: string[];
  /** 最近使用记录：templateId → 最近一次使用时间戳（ms）。 */
  recent: Record<string, number>;
  /** 累计使用次数：templateId → 次数（每次「采用 / 新建会话」+1）。 */
  usage: Record<string, number>;
}

const STORAGE_KEY = 'team.templatePrefs.v1';
const MAX_RECENT = 20;

export function emptyPreferences(): TemplatePreferences {
  return { favorites: [], recent: {}, usage: {} };
}

/** 容错解析：结构不对的字段降级为默认，绝不抛错。 */
export function parsePreferences(raw: string | null): TemplatePreferences {
  if (!raw) return emptyPreferences();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return emptyPreferences();
    const rec = parsed as Record<string, unknown>;
    const favorites = Array.isArray(rec['favorites'])
      ? rec['favorites'].filter((x): x is string => typeof x === 'string')
      : [];
    const recent = isStringNumberMap(rec['recent']) ? (rec['recent'] as Record<string, number>) : {};
    const usage = isStringNumberMap(rec['usage']) ? (rec['usage'] as Record<string, number>) : {};
    return { favorites: dedupe(favorites), recent: { ...recent }, usage: { ...usage } };
  } catch {
    return emptyPreferences();
  }
}

function isStringNumberMap(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'number');
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list));
}

/** 切换收藏状态（已收藏→取消，未收藏→加入）。 */
export function toggleFavorite(prefs: TemplatePreferences, templateId: string): TemplatePreferences {
  const has = prefs.favorites.includes(templateId);
  return {
    ...prefs,
    favorites: has
      ? prefs.favorites.filter((id) => id !== templateId)
      : [...prefs.favorites, templateId],
  };
}

export function isFavorite(prefs: TemplatePreferences, templateId: string): boolean {
  return prefs.favorites.includes(templateId);
}

/**
 * 记录一次「使用」（采用模板 / 据它新建会话）：更新 recent 时间戳 + usage 次数。
 * recent 超过上限时按时间裁剪到最近 MAX_RECENT 条。
 */
export function touchUsage(
  prefs: TemplatePreferences,
  templateId: string,
  now: number = Date.now(),
): TemplatePreferences {
  const recent = { ...prefs.recent, [templateId]: now };
  // 裁剪 recent 到最近 MAX_RECENT 条。
  const entries = Object.entries(recent).sort((a, b) => b[1] - a[1]);
  const trimmed: Record<string, number> = {};
  for (const [id, ts] of entries.slice(0, MAX_RECENT)) trimmed[id] = ts;
  return {
    ...prefs,
    recent: trimmed,
    usage: { ...prefs.usage, [templateId]: (prefs.usage[templateId] ?? 0) + 1 },
  };
}

/** 清理已不存在的模板 id（被删除后避免偏好里残留脏数据）。 */
export function pruneToExisting(
  prefs: TemplatePreferences,
  existingIds: ReadonlySet<string>,
): TemplatePreferences {
  const favorites = prefs.favorites.filter((id) => existingIds.has(id));
  const recent: Record<string, number> = {};
  for (const [id, ts] of Object.entries(prefs.recent)) {
    if (existingIds.has(id)) recent[id] = ts;
  }
  const usage: Record<string, number> = {};
  for (const [id, n] of Object.entries(prefs.usage)) {
    if (existingIds.has(id)) usage[id] = n;
  }
  return { favorites, recent, usage };
}

/** 取最近使用的模板 id（按时间倒序），可限制数量。 */
export function recentTemplateIds(prefs: TemplatePreferences, limit = MAX_RECENT): string[] {
  return Object.entries(prefs.recent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/* ── localStorage IO（带 SSR / 隐私模式守卫）─────────────────────────────── */

export function loadPreferences(): TemplatePreferences {
  if (typeof window === 'undefined') return emptyPreferences();
  try {
    return parsePreferences(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyPreferences();
  }
}

export function savePreferences(prefs: TemplatePreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 隐私模式 / 配额满：静默忽略，不影响主流程。
  }
}

/**
 * 便捷写入：记录一次模板「使用」并落盘。
 *
 * 给非模板页（如新建会话弹窗）在不接 hook 的情况下直接记录使用信号。
 * 因偏好统一存于同一 localStorage key，模板页下次加载会读到最新统计。
 */
export function recordTemplateUsage(templateId: string, now: number = Date.now()): void {
  if (!templateId) return;
  savePreferences(touchUsage(loadPreferences(), templateId, now));
}
