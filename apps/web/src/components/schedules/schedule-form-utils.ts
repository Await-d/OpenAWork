import type { CreateCronJobInput, CronScheduleKind } from '@openAwork/web-client';

/**
 * `/schedules` 页新建表单的纯逻辑，抽出来便于单测（页面本身只做渲染与派发）。
 */

/** 结果投递方式；与网关 `delivery_mode` 一致。 */
export type ScheduleDeliveryMode = 'none' | 'session' | 'desktop';

export interface ScheduleFormDraft {
  name: string;
  kind: CronScheduleKind;
  /** cron 表达式（`kind === 'cron'` 时使用）。 */
  cronExpr: string;
  /** `every` 的间隔数值（配合 `everyUnit`）。 */
  everyValue: string;
  everyUnit: 'minutes' | 'hours' | 'days';
  /** `at` 的 `datetime-local` 值。 */
  atLocal: string;
  tz: string;
  prompt: string;
  /**
   * 结果投递方式。默认 `desktop`：产出主动通知到当前用户的所有在线客户端
   * （侧栏铃铛 + 页面隐藏时的系统通知），不必先选中某个会话。
   * `none` 会让任务跑完什么都不留下——正是本轮修掉的「空壳」体验，因此不作默认。
   */
  deliveryMode: ScheduleDeliveryMode;
  /** `deliveryMode === 'session'` 时的目标会话 id。 */
  deliveryTarget: string;
}

const UNIT_MS: Readonly<Record<ScheduleFormDraft['everyUnit'], number>> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function resolveBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

export function emptyScheduleDraft(): ScheduleFormDraft {
  return {
    name: '',
    kind: 'cron',
    cronExpr: '0 9 * * *',
    everyValue: '30',
    everyUnit: 'minutes',
    atLocal: '',
    tz: resolveBrowserTimeZone(),
    prompt: '',
    deliveryMode: 'desktop',
    deliveryTarget: '',
  };
}

/** 把 `datetime-local` 值（本地墙上时间）转成 epoch 毫秒；无效返回 `null`。 */
export function localDateTimeToEpochMs(value: string): number | null {
  const text = value.trim();
  if (text.length === 0) return null;
  const parsed = new Date(text);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 校验并转换成网关 `POST /cron/jobs` 的 body；非法时抛出带中文原因的错误。 */
export function toCreateJobInput(draft: ScheduleFormDraft): CreateCronJobInput {
  const name = draft.name.trim();
  const prompt = draft.prompt.trim();
  if (name.length === 0) throw new Error('请填写任务名称。');
  if (prompt.length === 0) throw new Error('请填写任务提示词（到点要执行什么）。');

  // 投递配置与调度无关，提前算好（session 模式必须给出目标会话，
  // 否则网关会退化成「只跑不投」——正是要被修掉的空壳行为）。
  const deliveryTarget = draft.deliveryTarget.trim();
  if (draft.deliveryMode === 'session' && deliveryTarget.length === 0) {
    throw new Error('选择「投递到指定会话」时必须填写目标会话 id。');
  }
  const delivery = {
    delivery_mode: draft.deliveryMode,
    ...(draft.deliveryMode === 'session' ? { delivery_target: deliveryTarget } : {}),
  };

  const base = {
    name,
    prompt,
    enabled: true,
    schedule_tz: draft.tz.trim() || 'UTC',
    ...delivery,
  };

  if (draft.kind === 'cron') {
    const expr = draft.cronExpr.trim();
    if (expr.length === 0) throw new Error('请填写 5 段 cron 表达式（分 时 日 月 周）。');
    if (expr.split(/\s+/).length !== 5) {
      throw new Error('cron 表达式必须是 5 段：分 时 日 月 周。');
    }
    return { ...base, schedule_kind: 'cron', schedule_expr: expr };
  }

  if (draft.kind === 'every') {
    const value = Number(draft.everyValue);
    if (!Number.isFinite(value) || value <= 0) throw new Error('间隔必须是大于 0 的数字。');
    const every = Math.round(value * UNIT_MS[draft.everyUnit]);
    if (every < 60_000) throw new Error('间隔不能小于 1 分钟（避免高频空转）。');
    return { ...base, schedule_kind: 'every', schedule_every: every };
  }

  const at = localDateTimeToEpochMs(draft.atLocal);
  if (at === null) throw new Error('请选择一次性触发时间。');
  if (at <= Date.now()) throw new Error('一次性触发时间必须是未来时间。');
  return { ...base, schedule_kind: 'at', schedule_at: at };
}

export function formatTimestamp(ms?: number | null): string {
  if (ms === undefined || ms === null) return '—';
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}
