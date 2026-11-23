/**
 * 工具的「结果视图」：把各式各样的输出压成**两种可渲染形态之一**。
 *
 * 管理类（`mcp_manage_servers` / `skill_manage` / …）、模型检索（`models`）与渠道读取
 * （`Plugin*` / `Feishu*`）本质上是同一件事——「一个或多个实体的列表」——只是字段名
 * 各不相同。如果各自写一套卡片，就会出现三套行高、三种徽章、三个空状态。
 *
 * 所以这里只定义视图数据，渲染交给唯一的 `ResultViewPreview`：
 * - `groups`：行卡列表（可带分组标题、首字母方块、状态徽章、右侧值）
 * - `table`：表格（用于天然列对齐的数据，或列名来自用户自建字段的场景）
 *
 * 构造器（`admin-result-view.ts` / `models-result-view.ts` / `channel-result-view.ts`）
 * 只负责把输出转成这个模型，不碰 DOM。
 */

export interface ResultBadge {
  label: string;
  tone: 'ok' | 'off' | 'warn' | 'error' | 'count' | 'soft';
}

export interface ResultRow {
  /** 首字母方块的内容；省略则不渲染方块。 */
  avatar?: string;
  /** 方块色档（0–5），由 title 哈希决定时留空。 */
  tone?: number;
  title: string;
  badges?: ResultBadge[];
  description?: string;
  /** 次要信息行（技术字段）。 */
  meta?: string[];
  /** 最右侧的值：定价、成员数之类。 */
  trailing?: string;
  /** `trailing` 的悬浮说明（例如「输入 / 输出，每百万 token」）。 */
  trailingTitle?: string;
}

export interface ResultGroup {
  /** 分组标题；只有一组时可以省略。 */
  label?: string;
  /** 分组标题右侧的计数徽章。 */
  count?: number;
  rows: ResultRow[];
}

export interface ResultCell {
  text: string;
  mono?: boolean;
  strong?: boolean;
  badge?: ResultBadge;
}

export interface ResultTable {
  columns: string[];
  rows: ResultCell[][];
}

export interface ResultView {
  groups?: ResultGroup[];
  table?: ResultTable;
  /** 头部结论，如「1 个已停用」「共 42 个，显示前 20 个」。 */
  note?: string;
  /** 结构性提示，如「还有更多」或解析受限说明。 */
  footnote?: string;
}

/**
 * 从对象里按优先级取第一个非空字符串字段。
 *
 * 用于「字段名不确定但语义确定」的场景：管理类七个工具的标题字段分别是
 * `name` / `displayName` / `label` / `key` / `id`，逐个判断工具名不如按语义取。
 */
export function pickText(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** 取第一个数值字段（`enabled` 这类布尔另走 `pickBoolean`）。 */
export function pickNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function pickBoolean(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

/** 行卡方块底色：同名同色、跨会话稳定（djb2，只取 6 档）。 */
export function resultToneIndex(seed: string): number {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(index)) >>> 0;
  }
  return hash % 6;
}

/** 取名称的前 1–2 个字符作为方块内容（中文取 1 字，拉丁取 2 字母）。 */
export function resultAvatarText(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return '?';
  const first = trimmed.slice(0, 1);
  if (/[\u4e00-\u9fa5]/.test(first)) return first;
  const match = /^[A-Za-z0-9]+/.exec(trimmed);
  const latin = match?.[0] ?? trimmed;
  return latin.slice(0, 2).toUpperCase();
}

/**
 * ISO 时间戳（或毫秒数）→ `MM-DD HH:mm`。
 *
 * 注意 `0` 要当成「未知」而不是 1970：网关的 `parseReleased()` 解析失败时返回 0，
 * 直接格式化会渲染成 1970 年，看起来像数据坏了。
 */
export function formatShortDateTime(value: unknown): string | undefined {
  const date = toDate(value);
  if (!date) return undefined;
  const pad = (input: number): string => String(input).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 只到日：`MM-DD`，跨年时补上年份。 */
export function formatShortDate(value: unknown): string | undefined {
  const date = toDate(value);
  if (!date) return undefined;
  const pad = (input: number): string => String(input).padStart(2, '0');
  const now = new Date();
  const prefix = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}-`;
  return `${prefix}${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDate(value: unknown): Date | null {
  if (typeof value === 'number') {
    // 0 表示「未知」——网关的 released 字段就是这么用的。
    if (!Number.isFinite(value) || value <= 0) return null;
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 美元定价：`3` → `$3`，`0.275` → `$0.275`，去掉无意义的尾随零。 */
export function formatUsdPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '$0';
  const fixed = value >= 1 ? value.toFixed(2) : value.toFixed(3);
  return `$${fixed.replace(/\.?0+$/, '')}`;
}

/** 大数字压缩：`1243` → `1.2k`。 */
export function formatResultCount(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
