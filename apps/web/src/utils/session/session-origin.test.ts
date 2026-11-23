import { describe, expect, it } from 'vitest';
import {
  buildSessionOriginBadgeLabel,
  isSourceManagedSession,
  parseSessionOrigin,
  readSessionOrigin,
  UNKNOWN_SESSION_ORIGIN,
} from './session-origin.js';

describe('readSessionOrigin — 来源解析', () => {
  it('渠道会话带 channel.name 时取渠道名', () => {
    expect(
      readSessionOrigin(
        JSON.stringify({
          source: 'channel',
          channel: { id: 'p1', type: 'feishu', name: '研发群' },
        }),
      ),
    ).toEqual({ source: 'channel', channelLabel: '研发群' });
  });

  it('渠道名缺失时回退 channel.type，两者都缺失则为 null', () => {
    expect(
      readSessionOrigin(JSON.stringify({ source: 'channel', channel: { type: 'qq' } })),
    ).toEqual({ source: 'channel', channelLabel: 'qq' });
    expect(readSessionOrigin(JSON.stringify({ source: 'channel', channel: { id: 'p1' } }))).toEqual(
      {
        source: 'channel',
        channelLabel: null,
      },
    );
    expect(readSessionOrigin(JSON.stringify({ source: 'channel' }))).toEqual({
      source: 'channel',
      channelLabel: null,
    });
  });

  it('定时任务 / 桌面端 / 未知来源分别归类', () => {
    expect(readSessionOrigin(JSON.stringify({ source: 'cron' }))).toEqual({
      source: 'cron',
      channelLabel: null,
    });
    expect(readSessionOrigin(JSON.stringify({ source: 'desktop' }))).toEqual({
      source: 'desktop',
      channelLabel: null,
    });
    // 普通会话不写 source：既不能误解为来源会话，也不能抛错。
    expect(readSessionOrigin(JSON.stringify({ dialogueMode: 'coding' }))).toEqual(
      UNKNOWN_SESSION_ORIGIN,
    );
    expect(readSessionOrigin(JSON.stringify({ source: 'future-source' }))).toEqual(
      UNKNOWN_SESSION_ORIGIN,
    );
  });

  it('缺失 / 非法 JSON / 非对象 JSON 一律回退为 unknown（不抛错）', () => {
    expect(readSessionOrigin(undefined)).toEqual(UNKNOWN_SESSION_ORIGIN);
    expect(readSessionOrigin('{not json')).toEqual(UNKNOWN_SESSION_ORIGIN);
    expect(readSessionOrigin('"channel"')).toEqual(UNKNOWN_SESSION_ORIGIN);
    expect(readSessionOrigin('[1,2]')).toEqual(UNKNOWN_SESSION_ORIGIN);
  });

  it('channel 字段为脏数据（字符串 / 数组）时渠道名为 null', () => {
    expect(parseSessionOrigin({ source: 'channel', channel: 'feishu' })).toEqual({
      source: 'channel',
      channelLabel: null,
    });
    expect(parseSessionOrigin({ source: 'channel', channel: ['feishu'] })).toEqual({
      source: 'channel',
      channelLabel: null,
    });
    expect(parseSessionOrigin({ source: 'channel', channel: { name: '   ' } })).toEqual({
      source: 'channel',
      channelLabel: null,
    });
  });
});

describe('isSourceManagedSession — 网页端只读判定', () => {
  it('渠道 / 定时任务为来源托管，其余不是', () => {
    expect(isSourceManagedSession({ source: 'channel', channelLabel: null })).toBe(true);
    expect(isSourceManagedSession({ source: 'cron', channelLabel: null })).toBe(true);
    expect(isSourceManagedSession({ source: 'desktop', channelLabel: null })).toBe(false);
    expect(isSourceManagedSession(UNKNOWN_SESSION_ORIGIN)).toBe(false);
  });
});

describe('buildSessionOriginBadgeLabel — 只读来源标识文案', () => {
  it('渠道带名 / 无名 / 定时任务分别产出对应文案', () => {
    expect(buildSessionOriginBadgeLabel({ source: 'channel', channelLabel: '飞书' })).toBe(
      '渠道：飞书',
    );
    expect(buildSessionOriginBadgeLabel({ source: 'channel', channelLabel: null })).toBe(
      '渠道会话',
    );
    expect(buildSessionOriginBadgeLabel({ source: 'cron', channelLabel: null })).toBe('定时任务');
  });

  it('非来源托管会话返回 null（此时才渲染三模式切换器）', () => {
    expect(buildSessionOriginBadgeLabel({ source: 'desktop', channelLabel: null })).toBeNull();
    expect(buildSessionOriginBadgeLabel(UNKNOWN_SESSION_ORIGIN)).toBeNull();
  });
});
