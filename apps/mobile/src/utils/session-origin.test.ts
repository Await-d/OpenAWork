import { describe, expect, it } from 'vitest';
import {
  buildSessionOriginBadgeLabel,
  isSourceManagedSession,
  readSessionOrigin,
  UNKNOWN_SESSION_ORIGIN,
} from './session-origin';

/**
 * 移动端的来源判定与网页端 `apps/web/src/utils/session/session-origin.ts` 是两份等价实现
 * （不共享的原因见该模块注释）。这里锁住两端必须一致的判定：渠道 / 定时任务 = 只读模式栏。
 */
describe('readSessionOrigin', () => {
  it('渠道会话取渠道名，缺失时回退 type', () => {
    expect(
      readSessionOrigin(
        JSON.stringify({ source: 'channel', channel: { type: 'feishu', name: '研发群' } }),
      ),
    ).toEqual({ source: 'channel', channelLabel: '研发群' });
    expect(
      readSessionOrigin(JSON.stringify({ source: 'channel', channel: { type: 'qq' } })),
    ).toEqual({ source: 'channel', channelLabel: 'qq' });
    expect(readSessionOrigin(JSON.stringify({ source: 'channel' }))).toEqual({
      source: 'channel',
      channelLabel: null,
    });
  });

  it('定时任务 / 桌面端 / 缺失 / 非法 JSON 分别归类且不抛错', () => {
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
    expect(readSessionOrigin(undefined)).toEqual(UNKNOWN_SESSION_ORIGIN);
    expect(readSessionOrigin('{not json')).toEqual(UNKNOWN_SESSION_ORIGIN);
    expect(readSessionOrigin('"channel"')).toEqual(UNKNOWN_SESSION_ORIGIN);
  });
});

describe('isSourceManagedSession / buildSessionOriginBadgeLabel', () => {
  it('渠道与定时任务为来源托管，模式栏须退化为只读标识', () => {
    expect(isSourceManagedSession({ source: 'channel', channelLabel: null })).toBe(true);
    expect(isSourceManagedSession({ source: 'cron', channelLabel: null })).toBe(true);
    expect(isSourceManagedSession(UNKNOWN_SESSION_ORIGIN)).toBe(false);

    expect(buildSessionOriginBadgeLabel({ source: 'channel', channelLabel: '飞书' })).toBe(
      '渠道：飞书',
    );
    expect(buildSessionOriginBadgeLabel({ source: 'channel', channelLabel: null })).toBe(
      '渠道会话',
    );
    expect(buildSessionOriginBadgeLabel({ source: 'cron', channelLabel: null })).toBe('定时任务');
    // 非来源会话返回 null：此时才渲染可写的模式选择器。
    expect(buildSessionOriginBadgeLabel(UNKNOWN_SESSION_ORIGIN)).toBeNull();
  });
});
