import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as WatcherModule from '../../handoff/runner/watcher.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let watcherModule: typeof WatcherModule;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  watcherModule = await import('../../handoff/runner/watcher.js');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('HandoffWatcher timer-loop error isolation', () => {
  it('后台 tick reject 时被隔离为 console.error，不产生未捕获异常', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const watcher = new watcherModule.HandoffWatcher({
      watcherIntervalMs: 50,
      recoveryIntervalMs: 50,
    });
    const tickSpy = vi.spyOn(watcher, 'tickOnce').mockRejectedValue(new Error('tick boom'));
    const recoverySpy = vi
      .spyOn(watcher, 'recoveryTick')
      .mockRejectedValue(new Error('recovery boom'));

    watcher.start();
    // 推进数个周期，让两个 timer 各触发多次。
    await vi.advanceTimersByTimeAsync(200);
    await watcher.stop();

    expect(tickSpy).toHaveBeenCalled();
    expect(recoverySpy).toHaveBeenCalled();
    // 拒绝被 .catch 收口为 console.error；测试能正常结束即证明无未捕获异常逃逸。
    expect(errorSpy).toHaveBeenCalled();
  });
});
