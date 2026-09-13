/**
 * 会话列表时间展示的统一格式化。
 *
 * 会话侧栏（融合布局 / 经典布局 / 团队分区）此前各自实现时间文案：
 * chat 只显示 `M月d日`、team 另写了一份 `formatRelativeTime`，
 * 导致同一份会话数据在不同区域呈现不一致、且缺少「今天 / 昨天」语义。
 *
 * 统一规则（本地时区）：
 * - 1 分钟内        → 刚刚
 * - 1 小时内        → N分钟前
 * - 今天            → HH:mm
 * - 昨天            → 昨天
 * - 最近 7 天内     → 周X
 * - 今年            → M月D日
 * - 跨年            → YYYY/M/D
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export type SessionTimeInput = string | number | Date | null | undefined;

function toValidDate(value: SessionTimeInput): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function startOfDayTimestamp(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * 会话行的时间标签。`now` 可注入以便测试。
 */
export function formatSessionTime(value: SessionTimeInput, now: Date = new Date()): string {
  const target = toValidDate(value);
  if (!target) {
    return '';
  }

  const diffMs = now.getTime() - target.getTime();
  if (diffMs >= 0 && diffMs < MINUTE_MS) {
    return '刚刚';
  }
  if (diffMs >= 0 && diffMs < HOUR_MS) {
    return `${Math.floor(diffMs / MINUTE_MS)}分钟前`;
  }

  const dayDelta = Math.round((startOfDayTimestamp(now) - startOfDayTimestamp(target)) / DAY_MS);
  if (dayDelta <= 0) {
    return `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
  }
  if (dayDelta === 1) {
    return '昨天';
  }
  if (dayDelta < 7) {
    return WEEKDAY_LABELS[target.getDay()] ?? '';
  }
  if (target.getFullYear() === now.getFullYear()) {
    return `${target.getMonth() + 1}月${target.getDate()}日`;
  }

  return `${target.getFullYear()}/${target.getMonth() + 1}/${target.getDate()}`;
}

/**
 * 会话行的完整时间（用于 `title` tooltip），格式 `YYYY-MM-DD HH:mm`。
 */
export function formatSessionTimeTitle(value: SessionTimeInput): string {
  const target = toValidDate(value);
  if (!target) {
    return '';
  }

  return `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())} ${pad2(
    target.getHours(),
  )}:${pad2(target.getMinutes())}`;
}
