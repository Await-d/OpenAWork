/**
 * 「会话内子视图」持久化桶的键规则与载入期归一化。
 *
 * 归属：会话中的子会话（子代理列表折叠、当前打开的子会话）必须跨刷新 / 换端记住，
 * 因此与其它布局偏好一样进 `uiState`（而非组件 `useState` 或裸 localStorage）——
 * 只有这样才会随工作台快照同步到网关 `user_settings`，重启或换设备后能回灌。
 *
 * 键选 sessionId（不是 chat path）：子视图归属的是「哪个会话」，与路由形态无关；
 * 同一会话在 `/chat` 与嵌入视图里是同一份现场。无会话时落 `__default__` 桶。
 *
 * 归一化取向：非法/冗余值整条丢弃（空串等价于「没有记录」），不为每个访问过的
 * 会话留一条无意义记录，避免持久化与快照体积无谓膨胀。
 */

/** 无会话时的兜底桶键。 */
export const DEFAULT_SESSION_SUBVIEW_KEY = '__default__';

/**
 * 桶条目上限：localStorage 与远端快照都是可被手改 / 污染的介质，
 * 只防御无限增长，正常使用远低于该值。
 */
export const MAX_SESSION_SUBVIEW_BUCKETS = 200;

const MAX_SESSION_ID_CHARS = 200;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 会话桶键：去空白后为空即落兜底桶，超长 id 一律判非法（返回兜底）。 */
export function sessionSubviewKey(sessionId: string | null | undefined): string {
  const trimmed = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (trimmed.length === 0 || trimmed.length > MAX_SESSION_ID_CHARS) {
    return DEFAULT_SESSION_SUBVIEW_KEY;
  }
  return trimmed;
}

/** 折叠标记：只保留 `true`——「键不存在」与 `false` 在读取端语义等价。 */
export function normalizeCollapsedFlags(value: unknown): Record<string, boolean> {
  if (!isPlainRecord(value)) {
    return {};
  }

  const next: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== true || key.length === 0 || key.length > MAX_SESSION_ID_CHARS) {
      continue;
    }
    next[key] = true;
    if (Object.keys(next).length >= MAX_SESSION_SUBVIEW_BUCKETS) {
      break;
    }
  }
  return next;
}

/** 「当前打开的子会话」：只保留非空字符串，其余（含空串）视为没有记录。 */
export function normalizeActiveChildSessionIds(value: unknown): Record<string, string> {
  if (!isPlainRecord(value)) {
    return {};
  }

  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string' || key.length === 0 || key.length > MAX_SESSION_ID_CHARS) {
      continue;
    }
    const childSessionId = entry.trim();
    if (childSessionId.length === 0 || childSessionId.length > MAX_SESSION_ID_CHARS) {
      continue;
    }
    next[key] = childSessionId;
    if (Object.keys(next).length >= MAX_SESSION_SUBVIEW_BUCKETS) {
      break;
    }
  }
  return next;
}

/**
 * 写单个折叠桶：折叠时写入 `true`，展开时**删除键**（等价于缺省展开），
 * 无实际变化时返回原引用，避免无谓的订阅通知与快照推送。
 */
export function withCollapsedFlag(
  buckets: Record<string, boolean>,
  key: string,
  collapsed: boolean,
): Record<string, boolean> {
  if (collapsed) {
    return buckets[key] === true ? buckets : { ...buckets, [key]: true };
  }
  if (!(key in buckets)) {
    return buckets;
  }
  const next = { ...buckets };
  delete next[key];
  return next;
}

/** 写单个「当前打开的子会话」桶：传 `null` 删除键（回到「没有记录」）。 */
export function withActiveChildSessionId(
  buckets: Record<string, string>,
  key: string,
  childSessionId: string | null,
): Record<string, string> {
  const normalized = typeof childSessionId === 'string' ? childSessionId.trim() : '';
  if (normalized.length === 0) {
    if (!(key in buckets)) {
      return buckets;
    }
    const next = { ...buckets };
    delete next[key];
    return next;
  }
  if (buckets[key] === normalized) {
    return buckets;
  }
  return { ...buckets, [key]: normalized };
}

export interface ForgetSessionSubviewsResult {
  collapsed: Record<string, boolean>;
  active: Record<string, string>;
  changed: boolean;
}

/**
 * 注销指定会话的子视图现场（会话删除成功后调用）。
 *
 * 为什么需要：桶键是会话 id，而会话会被删除（单删 / 批量删 / team 级联删）。不注销
 * 的话这些键会永久留在持久化与远端快照里，越用越胖，也会让「记住的子会话」指向
 * 一个不存在的会话。
 *
 * 为什么只按明确的删除名单注销、而不按「列表里没有」推断：会话列表默认只取最近
 * 一页（`limit` 20/50）且 chat 侧带 `excludeTeam`，「未出现」绝大多数是「更早的
 * 会话」或「团队会话」，按列表剪除会把用户真实打开过的现场大批误删。
 *
 * 注销口径：
 * - `__default__` 桶不动（它不属于任何具体会话）；
 * - 折叠桶：删掉这些会话作为父会话的记录；
 * - 子会话桶：父会话被删 → 整条删除；被删的是**子会话**（作为值）→ 一并删除
 *   （该记忆已指向幽灵会话，重新进入会话时会因候选校验失效而回落，留着只是垃圾）。
 *
 * `changed` 为 false 时返回**原引用**，调用方据此跳过 setState，避免多余通知。
 */
export function forgetSessionSubviews(
  collapsed: Record<string, boolean>,
  active: Record<string, string>,
  deletedSessionIds: readonly string[],
): ForgetSessionSubviewsResult {
  const deleted = new Set(deletedSessionIds.filter((id) => id.length > 0));
  if (deleted.size === 0) {
    return { collapsed, active, changed: false };
  }

  let collapsedChanged = false;
  const nextCollapsed: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(collapsed)) {
    if (key === DEFAULT_SESSION_SUBVIEW_KEY || !deleted.has(key)) {
      nextCollapsed[key] = value;
      continue;
    }
    collapsedChanged = true;
  }

  let activeChanged = false;
  const nextActive: Record<string, string> = {};
  for (const [key, value] of Object.entries(active)) {
    if (key === DEFAULT_SESSION_SUBVIEW_KEY || (!deleted.has(key) && !deleted.has(value))) {
      nextActive[key] = value;
      continue;
    }
    activeChanged = true;
  }

  return {
    collapsed: collapsedChanged ? nextCollapsed : collapsed,
    active: activeChanged ? nextActive : active,
    changed: collapsedChanged || activeChanged,
  };
}
