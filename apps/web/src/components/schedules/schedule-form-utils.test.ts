import { describe, expect, it } from 'vitest';
import {
  emptyScheduleDraft,
  formatTimestamp,
  localDateTimeToEpochMs,
  toCreateJobInput,
} from './schedule-form-utils.js';

describe('schedule-form-utils', () => {
  it('cron 草稿转成网关 body（5 段校验）', () => {
    const input = toCreateJobInput({
      ...emptyScheduleDraft(),
      name: '  每日同步 ',
      kind: 'cron',
      cronExpr: ' 0 9 * * * ',
      prompt: ' 同步 ',
      tz: 'Asia/Shanghai',
    });
    expect(input).toMatchObject({
      name: '每日同步',
      prompt: '同步',
      schedule_kind: 'cron',
      schedule_expr: '0 9 * * *',
      schedule_tz: 'Asia/Shanghai',
      enabled: true,
    });
  });

  it('cron 段数不足时报错', () => {
    expect(() =>
      toCreateJobInput({ ...emptyScheduleDraft(), name: 'x', prompt: 'p', cronExpr: '* * * *' }),
    ).toThrow(/5 段/);
  });

  it('every 换算成毫秒并拒绝小于 1 分钟', () => {
    const input = toCreateJobInput({
      ...emptyScheduleDraft(),
      name: 'x',
      prompt: 'p',
      kind: 'every',
      everyValue: '2',
      everyUnit: 'hours',
    });
    expect(input.schedule_every).toBe(7_200_000);

    expect(() =>
      toCreateJobInput({
        ...emptyScheduleDraft(),
        name: 'x',
        prompt: 'p',
        kind: 'every',
        everyValue: '5',
        everyUnit: 'minutes',
      }),
    ).not.toThrow();

    expect(() =>
      toCreateJobInput({
        ...emptyScheduleDraft(),
        name: 'x',
        prompt: 'p',
        kind: 'every',
        everyValue: '0.1',
        everyUnit: 'minutes',
      }),
    ).toThrow(/1 分钟/);
  });

  it('at 必须选择未来时间', () => {
    expect(() =>
      toCreateJobInput({
        ...emptyScheduleDraft(),
        name: 'x',
        prompt: 'p',
        kind: 'at',
        atLocal: '',
      }),
    ).toThrow(/触发时间/);

    const future = new Date(Date.now() + 3_600_000);
    const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const input = toCreateJobInput({
      ...emptyScheduleDraft(),
      name: 'x',
      prompt: 'p',
      kind: 'at',
      atLocal: local,
    });
    expect(typeof input.schedule_at).toBe('number');
  });

  it('名称与提示词必填', () => {
    expect(() => toCreateJobInput({ ...emptyScheduleDraft(), prompt: 'p' })).toThrow(/任务名称/);
    expect(() => toCreateJobInput({ ...emptyScheduleDraft(), name: 'x' })).toThrow(/提示词/);
  });

  it('投递模式：默认 desktop 通知，session 必须给目标会话', () => {
    // 默认必须是「会投递」——`none` 会让任务跑完什么都不留下。
    expect(emptyScheduleDraft().deliveryMode).toBe('desktop');
    expect(
      toCreateJobInput({ ...emptyScheduleDraft(), name: 'x', prompt: 'p' }).delivery_mode,
    ).toBe('desktop');

    expect(() =>
      toCreateJobInput({
        ...emptyScheduleDraft(),
        name: 'x',
        prompt: 'p',
        deliveryMode: 'session',
      }),
    ).toThrow(/目标会话/);

    const withTarget = toCreateJobInput({
      ...emptyScheduleDraft(),
      name: 'x',
      prompt: 'p',
      deliveryMode: 'session',
      deliveryTarget: ' sess-1 ',
    });
    expect(withTarget.delivery_mode).toBe('session');
    expect(withTarget.delivery_target).toBe('sess-1');
  });

  it('localDateTimeToEpochMs / formatTimestamp 边界', () => {
    expect(localDateTimeToEpochMs('')).toBeNull();
    expect(localDateTimeToEpochMs('not-a-date')).toBeNull();
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp(0)).not.toBe('—');
  });
});
