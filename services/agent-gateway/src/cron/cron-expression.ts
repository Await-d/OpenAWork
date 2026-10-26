/**
 * 5 段 cron 表达式解析 + 时区感知的「下次触发」计算。
 *
 * 背景：`scheduler.ts` 原先的 `parseCronExpression` 是占位实现——它只校验段数，
 * 然后恒定返回「到下一分钟还有多久」，`schedule_tz` 直接被 `void tz` 丢弃。
 * 结果是**所有 `cron` 类型任务都变成每分钟触发一次**，与用户填写的表达式无关
 * （「定时任务没有正确到后台运行」的根因之一）。
 *
 * 本模块补齐两块能力，均为纯函数、零副作用：
 *  1. 字段解析：支持通配符、单值、区间（`a-b`）、区间带步长（`a-b/S`）、
 *     通配符带步长（步长 S）、逗号列表；
 *  2. 下次触发：按 IANA 时区把表达式落到具体时刻上（`nextCronFireAfter`）。
 *
 * 语义对齐 Vixie cron：
 *  - 第 1 段分钟 0-59、第 2 段小时 0-23、第 3 段日 1-31、第 4 段月 1-12、
 *    第 5 段星期 0-7（0 与 7 均为周日）；
 *  - **日与星期同时受限时为「或」关系**（如 `0 0 1 * 1` = 每月 1 号**或**每周一）。
 */

const FIELD_RANGES: readonly { readonly min: number; readonly max: number }[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (0 / 7 = Sunday)
];

const MINUTE_MS = 60_000;
/**
 * 上限：按「天」推进的搜索窗口。闰年 + 月末组合最长间隔是 2 月 29 日
 * （4 年一次），8 年窗口足够覆盖且保证不会无限循环。
 */
const MAX_SEARCH_DAYS = 366 * 8;

export interface ParsedCronExpression {
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  /** 归一化后的星期集合：0=周日 … 6=周六（输入里的 7 已折叠为 0）。 */
  readonly daysOfWeek: readonly number[];
  /** 该字段是否被限缩（非 `*`）；「日 / 星期」的 OR 语义需要它。 */
  readonly dayOfMonthRestricted: boolean;
  readonly dayOfWeekRestricted: boolean;
}

class InvalidCronExpressionError extends Error {
  constructor(expr: string, reason: string) {
    super(`Invalid cron expression "${expr}": ${reason}`);
    this.name = 'InvalidCronExpressionError';
  }
}

function parseField(
  expr: string,
  raw: string,
  bounds: { readonly min: number; readonly max: number },
): { readonly values: readonly number[]; readonly restricted: boolean } {
  const text = raw.trim();
  if (text.length === 0) {
    throw new InvalidCronExpressionError(expr, '存在空字段');
  }
  if (text === '*' || text === '?') {
    const all: number[] = [];
    for (let value = bounds.min; value <= bounds.max; value += 1) all.push(value);
    return { values: all, restricted: false };
  }

  const values = new Set<number>();
  for (const part of text.split(',')) {
    const segment = part.trim();
    if (segment.length === 0) {
      throw new InvalidCronExpressionError(expr, `字段 "${raw}" 含空项`);
    }

    const [rangeText, stepText, ...rest] = segment.split('/');
    if (rest.length > 0) {
      throw new InvalidCronExpressionError(expr, `字段 "${segment}" 的 "/" 用法无效`);
    }

    let step = 1;
    if (stepText !== undefined) {
      step = Number(stepText);
      if (!Number.isInteger(step) || step <= 0) {
        throw new InvalidCronExpressionError(expr, `步长 "${stepText}" 必须是正整数`);
      }
    }

    let low: number;
    let high: number;
    if (rangeText === '*' || rangeText === undefined) {
      low = bounds.min;
      high = bounds.max;
    } else if (rangeText.includes('-')) {
      const [lowText, highText, ...extra] = rangeText.split('-');
      low = Number(lowText);
      high = Number(highText);
      if (extra.length > 0 || !Number.isInteger(low) || !Number.isInteger(high)) {
        throw new InvalidCronExpressionError(expr, `区间 "${rangeText}" 无效`);
      }
    } else {
      const single = Number(rangeText);
      if (!Number.isInteger(single)) {
        throw new InvalidCronExpressionError(expr, `取值 "${rangeText}" 必须是整数`);
      }
      low = single;
      // `a/n` 视为「从 a 到上界、步长 n」（与 quartz 一致；Vixie 语义下等价于 a-max/n）。
      high = stepText === undefined ? single : bounds.max;
    }

    if (low < bounds.min || high > bounds.max || low > high) {
      throw new InvalidCronExpressionError(
        expr,
        `字段 "${segment}" 超出范围 ${bounds.min}-${bounds.max}`,
      );
    }

    for (let value = low; value <= high; value += step) values.add(value);
  }

  return { values: [...values].sort((left, right) => left - right), restricted: true };
}

export function parseCronExpressionFields(expr: string): ParsedCronExpression {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new InvalidCronExpressionError(
      expr,
      `需要 5 段（分 时 日 月 周），实际 ${parts.length} 段`,
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const minutes = parseField(expr, minute, FIELD_RANGES[0]!);
  const hours = parseField(expr, hour, FIELD_RANGES[1]!);
  const dom = parseField(expr, dayOfMonth, FIELD_RANGES[2]!);
  const months = parseField(expr, month, FIELD_RANGES[3]!);
  const dow = parseField(expr, dayOfWeek, FIELD_RANGES[4]!);

  return {
    minutes: minutes.values,
    hours: hours.values,
    daysOfMonth: dom.values,
    months: months.values,
    // 7 → 0（周日），去重后排序。
    daysOfWeek: [...new Set(dow.values.map((value) => (value === 7 ? 0 : value)))].sort(
      (left, right) => left - right,
    ),
    dayOfMonthRestricted: dom.restricted,
    dayOfWeekRestricted: dow.restricted,
  };
}

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    formatterCache.set(timeZone, formatter);
    return formatter;
  } catch {
    // 非法 / 未安装的 IANA 时区：交由调用方回落 UTC，不抛错（任务不该因时区名
    // 打错而永久停摆）。
    return null;
  }
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** 把 UTC 毫秒按目标时区拆成「墙上时间」分量。时区不可用时按 UTC 处理。 */
function toZonedParts(utcMs: number, timeZone: string): ZonedParts {
  const formatter = getZonedFormatter(timeZone);
  if (!formatter) {
    const date = new Date(utcMs);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      weekday: date.getUTCDay(),
    };
  }

  const parts = formatter.formatToParts(new Date(utcMs));
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekdayText = read('weekday');
  const hourText = read('hour');
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    // `hour12: false` 在部分 ICU 版本下把午夜渲染成 24，归一成 0。
    hour: Number(hourText) % 24,
    minute: Number(read('minute')),
    weekday: WEEKDAY_INDEX[weekdayText] ?? new Date(utcMs).getUTCDay(),
  };
}

/** 目标时区在给定时刻的 UTC 偏移（毫秒，东八区为 +8h）。 */
function getTimeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = toZonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  return asUtc - (utcMs - (utcMs % MINUTE_MS));
}

/**
 * 把「目标时区的墙上时间」换算成 UTC 毫秒。
 *
 * 先按 UTC 猜一次，再用猜出的偏移修正，重复一次即可收敛（夏令时切换窗口的
 * 歧义时刻会落到前一个偏移上——对定时任务来说「要么这一分钟、要么下一分钟」
 * 都可接受，不做额外消歧）。
 */
function zonedTimeToUtc(input: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly timeZone: string;
}): number {
  const guess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0);
  const firstOffset = getTimeZoneOffsetMs(guess, input.timeZone);
  const candidate = guess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(candidate, input.timeZone);
  return secondOffset === firstOffset ? candidate : guess - secondOffset;
}

function matchesDay(parsed: ParsedCronExpression, parts: ZonedParts): boolean {
  if (!parsed.months.includes(parts.month)) return false;

  const domMatches = parsed.daysOfMonth.includes(parts.day);
  const dowMatches = parsed.daysOfWeek.includes(parts.weekday);
  // Vixie cron：日与星期同时受限时取「或」；只有一方受限时取该方。
  if (parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted) return domMatches || dowMatches;
  if (parsed.dayOfMonthRestricted) return domMatches;
  if (parsed.dayOfWeekRestricted) return dowMatches;
  return true;
}

function addDays(parts: ZonedParts, days: number): ZonedParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    weekday: shifted.getUTCDay(),
  };
}

/**
 * 计算 `fromMs` 之后（严格大于）的第一个触发时刻；表达式合法但 8 年内无解时返回
 * `null`（如 `0 0 30 2 *`）。
 *
 * `from` 会被推进到下一整分再开始搜索，避免「同一分钟重复触发」。
 */
export function nextCronFireAfter(expr: string, timeZone: string, fromMs: number): number | null {
  const parsed = parseCronExpressionFields(expr);
  const tz = typeof timeZone === 'string' && timeZone.trim().length > 0 ? timeZone.trim() : 'UTC';
  const lowerBound = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;

  const startParts = toZonedParts(lowerBound, tz);
  for (let dayOffset = 0; dayOffset <= MAX_SEARCH_DAYS; dayOffset += 1) {
    const day = addDays(startParts, dayOffset);
    if (!matchesDay(parsed, day)) continue;

    for (const hour of parsed.hours) {
      for (const minute of parsed.minutes) {
        const candidate = zonedTimeToUtc({
          year: day.year,
          month: day.month,
          day: day.day,
          hour,
          minute,
          timeZone: tz,
        });
        if (candidate >= lowerBound) return candidate;
      }
    }
  }

  return null;
}

/**
 * 校验表达式是否可解析；供路由 / 工具层在写入前拦截坏表达式
 * （否则 `scheduleJob` 只能静默 return，任务变成「永不触发」）。
 */
export function isValidCronExpression(expr: string): boolean {
  try {
    parseCronExpressionFields(expr);
    return true;
  } catch {
    return false;
  }
}
