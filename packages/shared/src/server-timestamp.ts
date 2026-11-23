/**
 * 服务端时间戳的**唯一解析入口**。
 *
 * 网关的 SQLite 时间列由 `datetime('now')` 写入：**UTC、秒级、空格分隔、不带时区后缀**
 * （例如 `2026-11-18 15:48:55`）。而 `Date.parse('2026-11-18 15:48:55')` / `new Date(...)`
 * 在 V8 中按**本地时区**解释这种字符串——东八区下它会被当成「本地 15:48:55」，
 * 即真实时刻（UTC 15:48:55 = 本地 23:48:55）整体**少 8 小时**。
 *
 * 现象：会话列表的「更新时间 / 相对时间」、按天分组、通知、审计日志、用量记录
 * 全都比系统时间早 8 小时。
 *
 * 因此凡是「解析服务端下发的时间」，都必须走本模块：
 * - 无时区 SQLite 文本 → 按 **UTC** 解析（补 `Z`）；
 * - 带 `Z` / `±HH:mm` 的 ISO 8601 → 原样解析（本身已带时区语义）；
 * - epoch 毫秒（`number`）→ 原样返回；
 * - `Date` 实例 → `getTime()`。
 *
 * 存储语义**不变**（仍是 UTC），本模块只负责把「UTC 文本」正确还原成时间点，
 * 再由调用方按**本地时区**格式化。禁止反向操作——不要在显示层做 `-8h` / `+8h`
 * 之类的时区补偿，那只会把同一个 bug 换个方向再写一遍。
 */

/** SQLite `datetime('now')` 的输出形态：UTC、秒级、空格分隔、无时区后缀。 */
export const SQLITE_UTC_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/** 解析入参的联合类型：网关下发的原始时间值。 */
export type ServerTimestampInput = string | number | Date | null | undefined;

/**
 * 把服务端时间值归一为 **epoch 毫秒**；无法解析时返回 `null`。
 *
 * 不做任何时区补偿——只是补齐缺失的时区语义后交给 `Date` 解析。
 */
export function parseServerTimestamp(value: ServerTimestampInput): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // 纯数字字符串按 epoch 毫秒处理（部分 SQLite 列以 TEXT 存放毫秒）。
  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
  const normalized = SQLITE_UTC_DATETIME_PATTERN.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 服务端时间值 → `Date`；无法解析时返回 `null`。 */
export function toServerDate(value: ServerTimestampInput): Date | null {
  const timestamp = parseServerTimestamp(value);
  return timestamp === null ? null : new Date(timestamp);
}

/**
 * 服务端时间值 → **本地时区**的日期时间文案；无法解析时返回 `fallback`。
 *
 * 默认等价于 `toLocaleString('zh-CN', { hour12: false })`。
 */
export function formatServerDateTime(
  value: ServerTimestampInput,
  options?: Intl.DateTimeFormatOptions & { locale?: string; fallback?: string },
): string {
  const { locale = 'zh-CN', fallback = '—', ...formatOptions } = options ?? {};
  const date = toServerDate(value);
  if (!date) {
    return fallback;
  }
  const resolved: Intl.DateTimeFormatOptions =
    Object.keys(formatOptions).length > 0 ? formatOptions : { hour12: false };
  return date.toLocaleString(locale, resolved);
}

/** 服务端时间值 → **本地时区**的 `HH:mm` 文案；无法解析时返回 `fallback`。 */
export function formatServerTime(
  value: ServerTimestampInput,
  options?: { locale?: string; fallback?: string },
): string {
  return formatServerDateTime(value, {
    locale: options?.locale,
    fallback: options?.fallback,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 服务端时间值 → **本地时区**的日期文案；无法解析时返回 `fallback`。 */
export function formatServerDate(
  value: ServerTimestampInput,
  options?: { locale?: string; fallback?: string },
): string {
  const { locale, fallback } = options ?? {};
  const date = toServerDate(value);
  if (!date) {
    return fallback ?? '—';
  }
  return date.toLocaleDateString(locale ?? 'zh-CN');
}

/**
 * 服务端时间值 → 带 `Z` 的 ISO 8601 字符串（UTC）；无法解析时返回 `null`。
 *
 * 用于需要把「无时区文本」转成**自带时区语义**的流转场景（缓存键、二次下发）。
 */
export function toServerIsoString(value: ServerTimestampInput): string | null {
  const timestamp = parseServerTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}
