import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startEventLoopLagMonitor } from '../../infra/event-loop-lag-monitor.js';

/**
 * 事件循环 lag 探针的判定与去重。
 *
 * `vi.advanceTimersByTime` 会**同时**推进 `Date.now()`，于是探针算出的 lag 恒为 0，
 * 无法构造「定时器被卡住、但墙钟已前进」这一场景。因此这里改为 spy `Date.now` 并
 * 手动推进时钟：`vi.advanceTimersToNextTimer()` 每次只触发一个 tick，lag 完全由我们
 * 给出的时钟值决定。断言的是纯逻辑（阈值比较、基准重排、重复抑制），不依赖真实调度。
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

interface WarnRecord {
  payload: Record<string, unknown>;
}

function createWarnSpy() {
  const warns: WarnRecord[] = [];
  return {
    log: {
      warn: (payload: Record<string, unknown>) => {
        warns.push({ payload });
      },
    },
    warns,
  };
}

/** 安装可控时钟；返回 `setClock` 用于模拟「墙钟前进但 tick 迟到」。 */
function installClock(startMs = 0): { setClock: (value: number) => void } {
  let current = startMs;
  vi.spyOn(Date, 'now').mockImplementation(() => current);
  return { setClock: (value: number) => void (current = value) };
}

describe('startEventLoopLagMonitor', () => {
  it('OPENAWORK_EVENT_LOOP_LAG_MONITOR=0 时完全不启动', () => {
    const { log, warns } = createWarnSpy();
    const { setClock } = installClock();
    const monitor = startEventLoopLagMonitor(log, { OPENAWORK_EVENT_LOOP_LAG_MONITOR: '0' });

    for (let index = 0; index < 10; index += 1) {
      setClock(index * 1_000);
      vi.advanceTimersToNextTimer();
    }

    expect(warns).toHaveLength(0);
    monitor.stop();
  });

  it('tick 按时触发（lag 为 0）时不记录', () => {
    const { log, warns } = createWarnSpy();
    const { setClock } = installClock();
    const monitor = startEventLoopLagMonitor(log, {
      OPENAWORK_EVENT_LOOP_LAG_THRESHOLD_MS: '1000',
    });

    // 探针基准 = 启动时刻 + 250；每次 tick 都让时钟正好落到基准上。
    for (let index = 1; index <= 5; index += 1) {
      setClock(index * 250);
      vi.advanceTimersToNextTimer();
    }

    expect(warns).toHaveLength(0);
    monitor.stop();
  });

  it('lag 超过阈值时记录一次，并带上 lagMs 与 thresholdMs', () => {
    const { log, warns } = createWarnSpy();
    const { setClock } = installClock();
    const monitor = startEventLoopLagMonitor(log, {
      OPENAWORK_EVENT_LOOP_LAG_REPEAT_SUPPRESS_MS: '100000',
      OPENAWORK_EVENT_LOOP_LAG_THRESHOLD_MS: '50',
    });

    // 第一拍按时：基准重排为 250 + 250 = 500。
    setClock(250);
    vi.advanceTimersToNextTimer();
    expect(warns).toHaveLength(0);

    // 第二拍：墙钟已到 1500，基准仍是 500 → lag 1000ms。
    setClock(1_500);
    vi.advanceTimersToNextTimer();

    expect(warns).toHaveLength(1);
    expect(warns[0]?.payload['thresholdMs']).toBe(50);
    expect(warns[0]?.payload['lagMs']).toBe(1_000);

    monitor.stop();
  });

  it('基准按实际触发时刻重排，不会「追赶」成连续多条日志', () => {
    const { log, warns } = createWarnSpy();
    const { setClock } = installClock();
    const monitor = startEventLoopLagMonitor(log, {
      OPENAWORK_EVENT_LOOP_LAG_REPEAT_SUPPRESS_MS: '1',
      OPENAWORK_EVENT_LOOP_LAG_THRESHOLD_MS: '50',
    });

    // 第一拍按时（基准 → 500），随后模拟长阻塞：时钟直接跳到 5000。
    setClock(250);
    vi.advanceTimersToNextTimer();
    expect(warns).toHaveLength(0);

    // 一次长阻塞只应产生一条日志：重排把基准推到 5250，之后各拍都按时。
    setClock(5_000);
    vi.advanceTimersToNextTimer();
    for (let index = 1; index <= 6; index += 1) {
      setClock(5_000 + index * 250);
      vi.advanceTimersToNextTimer();
    }

    expect(warns).toHaveLength(1);

    monitor.stop();
  });

  it('stop 之后不再记录', () => {
    const { log, warns } = createWarnSpy();
    const { setClock } = installClock();
    const monitor = startEventLoopLagMonitor(log, {
      OPENAWORK_EVENT_LOOP_LAG_REPEAT_SUPPRESS_MS: '1',
      OPENAWORK_EVENT_LOOP_LAG_THRESHOLD_MS: '1',
    });

    monitor.stop();
    for (let index = 1; index <= 10; index += 1) {
      setClock(index * 10_000);
      vi.advanceTimersToNextTimer();
    }

    expect(warns).toHaveLength(0);
  });
});
