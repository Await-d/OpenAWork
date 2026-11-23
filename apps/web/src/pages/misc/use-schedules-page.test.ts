// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CronClient, CronExecutionRecord, CronJobRecord } from '@openAwork/web-client';
import {
  SCHEDULES_EVENT_DEBOUNCE_MS,
  SCHEDULES_POLL_INTERVAL_MS,
  useSchedulesPage,
} from './use-schedules-page.js';

type FakeClient = CronClient & {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  setEnabled: ReturnType<typeof vi.fn>;
  runNow: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

/** 每个用例都新建一份 fake client，避免跨用例串味。 */
function createFakeClient(): FakeClient {
  return {
    list: vi.fn(async () => [] as CronJobRecord[]),
    create: vi.fn(async () => job()),
    setEnabled: vi.fn(async () => job()),
    runNow: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    history: vi.fn(async () => [] as CronExecutionRecord[]),
    update: vi.fn(async () => job()),
  } as unknown as FakeClient;
}

const fakeClient = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createCronClient: () => fakeClient.current,
  };
});

/** 认证态的 hoisted 可变入口：默认 'token'，个别用例可临时改成 null 模拟登出。 */
const authState = vi.hoisted(() => ({
  accessToken: 'token' as string | null,
  gatewayUrl: 'http://localhost:3000',
}));
vi.mock('../../stores/auth/auth.js', () => ({
  useAuthStore: (
    selector: (state: { accessToken: string | null; gatewayUrl: string }) => unknown,
  ) => selector({ accessToken: authState.accessToken, gatewayUrl: authState.gatewayUrl }),
}));

/**
 * 可控的 `EventSource` 替身（同 `terminals-api.test.ts` 的做法）：记录构造参数，
 * 并把 `open` / `error` / 具名事件留给用例主动触发，从而精确断言「事件 → 刷新」
 * 与「断连 → 降级轮询 → 恢复 → 停止轮询」。
 */
class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];

  readonly CONNECTING = MockEventSource.CONNECTING;
  readonly OPEN = MockEventSource.OPEN;
  readonly CLOSED = MockEventSource.CLOSED;
  readyState = MockEventSource.CONNECTING;
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closeCount = 0;
  private readonly listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = MockEventSource.CLOSED;
  }

  /** 模拟网关下发一条具名事件（`data` 为原始字符串）。 */
  emit(type: string, data = ''): void {
    const event = { data } as MessageEvent;
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  triggerOpen(): void {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  triggerError(): void {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.(new Event('error'));
  }
}

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('../../components/common/feedback/ToastNotification.js', () => ({ toast: toastSpy }));

/**
 * 页面激活态的可变入口：`CachedRouteOutlet` 不卸载未激活页面，靠 `usePageActivation()`
 * 下发 `isActive`。测试里直接 mock 该 hook，逐个用例切换「已缓存 / 已激活」。
 */
const pageActivation = vi.hoisted(() => ({ active: true }));
vi.mock('../../components/common/routing/CachedRouteOutlet.js', () => ({
  usePageActivation: () => pageActivation.active,
}));

function job(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-a',
    name: '每日同步',
    schedule_kind: 'cron',
    schedule_at: null,
    schedule_every: null,
    schedule_expr: '0 9 * * *',
    schedule_tz: 'Asia/Shanghai',
    prompt: '同步',
    enabled: true,
    delete_after_run: false,
    delivery_mode: 'desktop',
    delivery_target: null,
    last_fired_at: null,
    fire_count: 0,
    scheduleKind: 'cron',
    scheduleDisplay: '每天 9 点',
    status: 'enabled',
    running: false,
    fireCount: 0,
    lastFiredAt: null,
    nextFireAt: null,
    lastExecution: null,
    ...overrides,
  };
}

function failedEntry(): CronExecutionRecord {
  return {
    id: 'exec-failed',
    job_id: 'job-a',
    status: 'failed',
    started_at: 1000,
    finished_at: 2000,
    error: '会话当时正忙',
  };
}

let client: FakeClient;

beforeEach(() => {
  authState.accessToken = 'token';
  authState.gatewayUrl = 'http://localhost:3000';
  pageActivation.active = true;
  client = createFakeClient();
  fakeClient.current = client;
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 首屏加载完成（loading 从 true 回到 false）。 */
async function renderLoaded() {
  const hook = renderHook(() => useSchedulesPage());
  await waitFor(() => expect(hook.result.current.jobs.length).toBeGreaterThan(0));
  return hook;
}

describe('useSchedulesPage', () => {
  it('首屏拉列表，并保留列表响应里每个任务的 lastExecution（视图直接读 job 上的）', async () => {
    client.list.mockResolvedValue([job({ lastExecution: failedEntry() })]);
    const { result } = renderHook(() => useSchedulesPage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.jobs).toHaveLength(1);
    // 重构后不再额外派一份 latestExecutions：视图消费的就是 job.lastExecution。
    expect(result.current.jobs[0]?.lastExecution?.status).toBe('failed');
    expect(result.current.error).toBeNull();
  });

  it('晚到的旧响应被丢弃：新请求先返回后，陈旧响应不得覆盖列表', async () => {
    let resolveOld: (value: CronJobRecord[]) => void = () => undefined;
    let resolveNew: (value: CronJobRecord[]) => void = () => undefined;
    client.list
      .mockImplementationOnce(() => new Promise<CronJobRecord[]>((r) => (resolveOld = r)))
      .mockImplementationOnce(() => new Promise<CronJobRecord[]>((r) => (resolveNew = r)));

    const { result } = renderHook(() => useSchedulesPage());
    // 首屏请求（seq=1）挂起中；触发第二次 reload（seq=2），其 list 同样挂起。
    act(() => {
      void result.current.handleEnable('job-a');
    });
    // 必须先确认第二次请求真的发出（否则旧响应回来时代号仍是 1，测不到丢弃分支）。
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2));

    // 第二次（较新）先返回新列表，第一次（较旧）后返回旧快照。
    await act(async () => {
      resolveNew([job({ id: 'job-new' })]);
      resolveOld([job({ id: 'job-old' })]);
    });

    expect(result.current.jobs.map((item) => item.id)).toEqual(['job-new']);
  });

  it('静默后台刷新失败不弹错误横幅，也不清空已加载的列表', async () => {
    vi.useFakeTimers();
    // 首个请求成功、之后刷新失败；按「是否已有成功响应」区分，不用 `...Once` 串行，
    // 以免依赖 effect 内立即补刷新与首屏加载的先后顺序。
    let served = false;
    client.list.mockImplementation(async () => {
      if (served) throw new Error('网络抖动');
      served = true;
      return [job()];
    });

    const { result } = renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.jobs).toHaveLength(1);

    // SSE 事件触发的静默刷新失败：不弹横幅、列表保持。
    await act(async () => {
      MockEventSource.instances[0]?.emit(
        'cron.jobs.changed',
        '{"reason":"updated","jobId":"job-a"}',
      );
      await vi.advanceTimersByTimeAsync(SCHEDULES_EVENT_DEBOUNCE_MS);
    });
    expect(client.list).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.jobs).toHaveLength(1);
  });

  it('动作后刷新：setEnabled 只改启停，绝不回写投递配置', async () => {
    client.list.mockResolvedValue([job()]);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.handleDisable('job-a');
    });

    expect(client.setEnabled).toHaveBeenCalledExactlyOnceWith('token', 'job-a', false);
    expect(client.update).not.toHaveBeenCalled();
  });

  it('handleDeliveryChange 走 update 且不触碰 setEnabled', async () => {
    client.list.mockResolvedValue([job()]);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.handleDeliveryChange('job-a', 'none');
    });

    expect(client.update).toHaveBeenCalledExactlyOnceWith('token', 'job-a', {
      delivery_mode: 'none',
    });
    expect(client.setEnabled).not.toHaveBeenCalled();
  });

  it('投到会话时先挂起、不落库；确认后才写 delivery_target', async () => {
    client.list.mockResolvedValue([job()]);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.handleDeliveryChange('job-a', 'session');
    });

    // 关键点：换成选择器后，「切到 session」本身不再立即写网关（旧实现是 prompt 后直接写）。
    expect(client.update).not.toHaveBeenCalled();
    expect(result.current.pendingSessionDelivery?.jobId).toBe('job-a');
    expect(result.current.pendingSessionDelivery?.jobName).toBeTruthy();

    await act(async () => {
      await result.current.confirmSessionDelivery('sess-9');
    });

    expect(client.update).toHaveBeenCalledExactlyOnceWith('token', 'job-a', {
      delivery_mode: 'session',
      delivery_target: 'sess-9',
    });
    expect(result.current.pendingSessionDelivery).toBeNull();
  });

  it('取消选择会话时不写网关，挂起态清空', async () => {
    client.list.mockResolvedValue([job()]);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.handleDeliveryChange('job-a', 'session');
    });
    act(() => {
      result.current.cancelSessionDelivery();
    });

    expect(client.update).not.toHaveBeenCalled();
    expect(result.current.pendingSessionDelivery).toBeNull();
  });

  it('没有挂起目标时 confirmSessionDelivery 是空操作', async () => {
    client.list.mockResolvedValue([job()]);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.confirmSessionDelivery('sess-9');
    });

    expect(client.update).not.toHaveBeenCalled();
  });

  it('handleCreate 校验失败时把原因落到 error，且不发出请求', async () => {
    client.list.mockResolvedValue([job()]);
    const { result } = await renderLoaded();

    act(() => {
      result.current.setDraft({ ...result.current.draft, name: '', prompt: '' });
    });

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(client.create).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/任务名称/);
    expect(result.current.showForm).toBe(false);
  });

  it('handleHistory 把执行历史放进面板并在完成后清掉 busy', async () => {
    client.list.mockResolvedValue([job()]);
    client.history.mockResolvedValue([failedEntry()]);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.handleHistory('job-a', '每日同步');
    });

    expect(client.history).toHaveBeenCalledExactlyOnceWith('token', 'job-a', { limit: 5 });
    expect(result.current.historyView?.entries).toHaveLength(1);
    expect(result.current.historyJobId).toBeNull();
  });

  it('加载中 token 变 null 后 loading 不停留在 true（登出 / 网关重置）', async () => {
    let resolveOld: (value: CronJobRecord[]) => void = () => undefined;
    client.list.mockImplementationOnce(() => new Promise<CronJobRecord[]>((r) => (resolveOld = r)));

    const { result, rerender } = renderHook(() => useSchedulesPage());
    // 首屏非静默加载：loading=true。
    expect(result.current.loading).toBe(true);

    // 登出：token 变 null，触发 effect 重跑（新的 reload 走 !token 早退分支）。
    authState.accessToken = null;
    rerender();
    expect(result.current.jobs).toHaveLength(0);

    // 旧请求（seq=1）此刻才返回：它已过期，必须丢弃且不得把 loading 卡在 true。
    await act(async () => {
      resolveOld([job()]);
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.jobs).toHaveLength(0);
  });

  it('卸载后 SSE 被 close()，降级轮询定时器也不再发请求', async () => {
    vi.useFakeTimers();
    client.list.mockImplementation(async () => [job()]);

    const { unmount } = renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const source = MockEventSource.instances[0];
    if (!source) throw new Error('EventSource 未被构造');

    // 先让 SSE 断连进入降级轮询，再卸载：两条通道都必须被清理。
    await act(async () => {
      source.triggerError();
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsBeforeUnmount = client.list.mock.calls.length;

    unmount();

    expect(source.closeCount).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCHEDULES_POLL_INTERVAL_MS * 4);
    });
    expect(client.list.mock.calls.length).toBe(callsBeforeUnmount);
  });

  it('页面失活时不得因清理而去抖补发请求（R-05 激活门控）', async () => {
    vi.useFakeTimers();
    client.list.mockImplementation(async () => [job()]);

    const { rerender } = renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const source = MockEventSource.instances[0];
    if (!source) throw new Error('EventSource 未被构造');
    const callsAfterMount = client.list.mock.calls.length;

    // 去抖窗口内收到一条事件后立即失活：cleanup 已清掉待处理去抖定时器，
    // 失活后整段去抖窗口 + 多个轮询周期内都不得再发请求。
    source.emit('cron.jobs.changed', '{"reason":"updated","jobId":"job-a"}');
    pageActivation.active = false;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCHEDULES_EVENT_DEBOUNCE_MS * 2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCHEDULES_POLL_INTERVAL_MS * 2);
    });

    expect(client.list.mock.calls.length).toBe(callsAfterMount);
  });

  it('页面处于缓存（未激活）时不建立 SSE 连接，也不轮询', async () => {
    vi.useFakeTimers();
    client.list.mockImplementation(async () => [job()]);

    pageActivation.active = false;
    renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAfterMount = client.list.mock.calls.length;

    // 未激活：既不建连、也不挂定时器——标签可见 + 定时器到点都不该发请求。
    expect(MockEventSource.instances).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCHEDULES_POLL_INTERVAL_MS * 4);
    });
    expect(client.list.mock.calls.length).toBe(callsAfterMount);
  });

  it('页面重新激活时立即补一次刷新并建立 SSE 连接', async () => {
    vi.useFakeTimers();
    client.list.mockImplementation(async () => [job()]);

    pageActivation.active = false;
    const { rerender } = renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCHEDULES_POLL_INTERVAL_MS * 2);
    });
    const callsWhileInactive = client.list.mock.calls.length;
    expect(MockEventSource.instances).toHaveLength(0);

    // 切回页面：不等 15s，立刻补一次，并建成 SSE。
    pageActivation.active = true;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(client.list.mock.calls.length).toBe(callsWhileInactive + 1);
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('文档不可见（hidden）时即便页面激活也不请求，恢复可见后立即补一次', async () => {
    vi.useFakeTimers();
    client.list.mockImplementation(async () => [job()]);

    const { rerender } = renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAfterMount = client.list.mock.calls.length;

    const visibilitySpy = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden' as DocumentVisibilityState);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCHEDULES_POLL_INTERVAL_MS * 3);
    });

    // 页面激活但文档不可见：保持既有语义，不请求。
    expect(client.list.mock.calls.length).toBe(callsAfterMount);

    // 文档恢复可见：立即补一次。
    visibilitySpy.mockReturnValue('visible' as DocumentVisibilityState);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(client.list.mock.calls.length).toBe(callsAfterMount + 1);
    visibilitySpy.mockRestore();
    rerender();
  });

  it('SSE 建连：URL 携带 encodeURIComponent 后的 token，且连上后不再轮询', async () => {
    vi.useFakeTimers();
    authState.accessToken = 'tok en+/=';
    client.list.mockImplementation(async () => [job()]);

    renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const source = MockEventSource.instances[0];
    if (!source) throw new Error('EventSource 未被构造');
    expect(source.url).toBe('http://localhost:3000/cron/events?token=tok%20en%2B%2F%3D');

    // 连接成功（onopen）后没有降级轮询：等到下一个轮询周期也不该多发请求。
    const callsAfterMount = client.list.mock.calls.length;
    await act(async () => {
      source.triggerOpen();
      await vi.advanceTimersByTimeAsync(SCHEDULES_POLL_INTERVAL_MS * 2);
    });
    expect(client.list.mock.calls.length).toBe(callsAfterMount);
  });

  it('收到 cron.jobs.changed 后去抖静默刷新，同一批事件只重拉一次', async () => {
    vi.useFakeTimers();
    client.list.mockImplementation(async () => [job()]);

    renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const source = MockEventSource.instances[0];
    if (!source) throw new Error('EventSource 未被构造');
    const callsAfterMount = client.list.mock.calls.length;

    // 一次操作可能连发多条事件：全部落在去抖窗口内，只应合并成一次刷新。
    await act(async () => {
      source.emit('cron.jobs.changed', '{"reason":"created","jobId":"job-a"}');
      source.emit('cron.jobs.changed', '{"reason":"run_started","jobId":"job-a"}');
      source.emit('cron.jobs.changed', '{"reason":"run_finished","jobId":"job-a"}');
      // 去抖未到点：还没发起请求。
      await vi.advanceTimersByTimeAsync(SCHEDULES_EVENT_DEBOUNCE_MS - 1);
    });
    expect(client.list.mock.calls.length).toBe(callsAfterMount);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(client.list.mock.calls.length).toBe(callsAfterMount + 1);
  });

  it('SSE 断连后降级为轮询，连接恢复（onopen）后停止轮询', async () => {
    vi.useFakeTimers();
    client.list.mockImplementation(async () => [job()]);

    renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const source = MockEventSource.instances[0];
    if (!source) throw new Error('EventSource 未被构造');
    const callsAfterMount = client.list.mock.calls.length;

    // 断连：降级轮询接管，到点即静默重拉。
    await act(async () => {
      source.triggerError();
      await vi.advanceTimersByTimeAsync(SCHEDULES_POLL_INTERVAL_MS);
    });
    expect(client.list.mock.calls.length).toBe(callsAfterMount + 1);

    // 恢复连接：再等一个轮询周期不应再触发轮询请求。
    await act(async () => {
      source.triggerOpen();
      await vi.advanceTimersByTimeAsync(SCHEDULES_POLL_INTERVAL_MS * 2);
    });
    expect(client.list.mock.calls.length).toBe(callsAfterMount + 1);
  });

  it('网关地址变化时重建 EventSource 并关闭旧连接', async () => {
    vi.useFakeTimers();
    client.list.mockImplementation(async () => [job()]);

    const { rerender } = renderHook(() => useSchedulesPage());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const first = MockEventSource.instances[0];
    if (!first) throw new Error('EventSource 未被构造');

    authState.gatewayUrl = 'http://other-host:3000';
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(first.closeCount).toBe(1);
    const second = MockEventSource.instances[1];
    if (!second) throw new Error('新 EventSource 未被构造');
    expect(second.url).toBe('http://other-host:3000/cron/events?token=token');
  });
});
