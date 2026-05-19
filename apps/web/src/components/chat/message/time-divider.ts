/**
 * Decides whether a time divider should be inserted before a chat
 * group, and what label it should carry. Pure helper so the
 * formatting rules can be unit-tested without mounting the chat
 * list.
 *
 * Rules:
 *   - First group in the list always gets an absolute divider
 *     (anchors the conversation start).
 *   - Same-day, gap >= MIN_GAP_MS → relative label ("3 分钟前").
 *   - Same-day, gap < MIN_GAP_MS → no divider (continuation).
 *   - Different day, yesterday → "昨天 HH:mm".
 *   - Different day within 7 days → "周X HH:mm".
 *   - Older → absolute date "YYYY-MM-DD HH:mm".
 *
 * Only emits dividers between groups; messages within the same
 * grouped bubble (multi-entry group) share a single label.
 */

const MIN_GAP_MS = 5 * 60 * 1000; // 5 minutes
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface TimeDividerDecision {
  /** Whether to render a divider above this group. */
  show: boolean;
  /** Human-friendly label (Chinese), only meaningful when show=true. */
  label: string;
}

/**
 * Compute the divider decision for `currentTs` given the previous
 * group's timestamp (or null when this is the first group). `now`
 * lets tests inject a fixed clock.
 */
export function decideTimeDivider(
  currentTs: number | null | undefined,
  previousTs: number | null | undefined,
  now: number = Date.now(),
): TimeDividerDecision {
  if (currentTs == null || !Number.isFinite(currentTs)) {
    return { show: false, label: '' };
  }

  // First group: anchor with an absolute label so users know where
  // in time the conversation began without having to hover meta.
  if (previousTs == null || !Number.isFinite(previousTs)) {
    return { show: true, label: formatAbsolute(currentTs, now) };
  }

  const gap = currentTs - previousTs;
  const sameDay = isSameLocalDay(currentTs, previousTs);

  if (sameDay && gap < MIN_GAP_MS) {
    return { show: false, label: '' };
  }

  if (sameDay) {
    return { show: true, label: formatRelative(gap) };
  }

  return { show: true, label: formatAbsolute(currentTs, now) };
}

/**
 * "刚刚" / "N 分钟前" / "N 小时前" — used for same-day, > 5 min gaps.
 */
function formatRelative(gapMs: number): string {
  const minutes = Math.floor(gapMs / (60 * 1000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/**
 * Cross-day labels. Yesterday and within-a-week use friendly
 * Chinese aliases; older falls back to ISO-style date.
 */
function formatAbsolute(ts: number, now: number): string {
  const d = new Date(ts);
  const today = startOfLocalDay(new Date(now));
  const target = startOfLocalDay(d);
  const dayDelta = Math.round((today.getTime() - target.getTime()) / DAY_MS);
  const time = formatHHMM(d);

  if (dayDelta === 0) return time;
  if (dayDelta === 1) return `昨天 ${time}`;
  if (dayDelta > 1 && dayDelta < 7) {
    return `${WEEKDAY_LABELS[d.getDay()]} ${time}`;
  }
  if (Math.abs(now - ts) < WEEK_MS) {
    // Future-dated within a week (rare, e.g. clock skew) — still
    // surface the weekday + time without a confusing "X 天前".
    return `${WEEKDAY_LABELS[d.getDay()]} ${time}`;
  }
  return `${formatYMD(d)} ${time}`;
}

function startOfLocalDay(d: Date): Date {
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatHHMM(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
