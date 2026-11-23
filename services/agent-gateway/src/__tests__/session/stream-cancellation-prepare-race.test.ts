/**
 * W-03 / 原 F-05 —— 准备期竞态与 TTL 重叠的可复现测试。
 *
 * 覆盖三条此前未被钉死的真实行为:
 *  1) 准备阶段(两个不同的 clientRequestId 并发进入,execution 尚未 settle)到底是
 *     互斥拒绝 / 双 409 / 还是双跑;
 *  2) TTL 到期后旧执行仍在跑时,新请求能否启动(是否真实重叠);
 *  3) 不同会话仍可并行(不得因单飞锁误伤跨会话)。
 *
 * 这里直接以 `stream-cancellation.ts` 的模块边界为观测点:该模块就是 stream.ts
 * 判定 `SESSION_ALREADY_RUNNING` 与 `getAnyInFlightStreamRequestForSession` 的唯一
 * 真相源,行为与路由层一一对应。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STREAM_REQUEST_LOCK_TTL_MS,
  clearInFlightStreamRequest,
  getAnyInFlightStreamRequestForSession,
  getInFlightStreamRequest,
  reserveInFlightStreamRequest,
} from '../../routes/stream-cancellation.js';

const SESSION_ID = 'prepare-race-session';
const OTHER_SESSION_ID = 'prepare-race-session-other';
const USER_ID = 'prepare-race-user';

function clearAll(): void {
  for (const sessionId of [SESSION_ID, OTHER_SESSION_ID]) {
    const entry = getInFlightStreamRequest(sessionId, 'req-a');
    if (entry) {
      clearInFlightStreamRequest({
        clientRequestId: 'req-a',
        execution: entry.execution,
        sessionId,
      });
    }
    const entryB = getInFlightStreamRequest(sessionId, 'req-b');
    if (entryB) {
      clearInFlightStreamRequest({
        clientRequestId: 'req-b',
        execution: entryB.execution,
        sessionId,
      });
    }
  }
}

afterEach(() => {
  clearAll();
});

describe('准备期并发(两个不同 clientRequestId 同时进入同一会话)', () => {
  it('钉死真实行为:A 先占位且 execution 未 settle 时,B 会被判为「会话正在运行」', async () => {
    // A 进入准备期:reservation 已登记,execution 永远不会在准备期自行 settle。
    const a = reserveInFlightStreamRequest({
      sessionId: SESSION_ID,
      clientRequestId: 'req-a',
      userId: USER_ID,
    });
    expect(a.owner).toBe(true);

    // B 是**不同** clientRequestId,走的是 stream.ts `getAnyInFlightStreamRequestForSession`
    // 的会话级判定 —— 它必须看到 A 仍在飞,从而给出 409,而不是与 A 双跑。
    const blocking = getAnyInFlightStreamRequestForSession({
      excludeClientRequestId: 'req-b',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(blocking).toBeDefined();
    // 且排除的是 B 自己,不是 A:B 不能把自己排除掉后误以为空闲。
    expect(blocking?.clientRequestId).toBe('req-a');

    a.resolve({ statusCode: 200 });
    await a.execution;
  });

  it('B 自己也拿到占位(同会话不同 id)但流式层会用会话级检查淘汰它 —— 确认不会双跑', () => {
    const a = reserveInFlightStreamRequest({
      sessionId: SESSION_ID,
      clientRequestId: 'req-a',
      userId: USER_ID,
    });
    const b = reserveInFlightStreamRequest({
      sessionId: SESSION_ID,
      clientRequestId: 'req-b',
      userId: USER_ID,
    });

    // 不同 id => 不同 key => 各自 owner,故单飞锁本身**不**阻止 B 成为 owner。
    // 这正是需要会话级兜底检查的原因:两条 entry 并存,stream.ts 必须在建执行前
    // 用 `getAnyInFlightStreamRequestForSession(exclude=自己)` 把 B 拦掉。
    expect(a.owner).toBe(true);
    expect(b.owner).toBe(true);

    const seenByB = getAnyInFlightStreamRequestForSession({
      excludeClientRequestId: 'req-b',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(seenByB?.clientRequestId).toBe('req-a');

    a.resolve({ statusCode: 200 });
    b.resolve({ statusCode: 200 });
  });

  it('不同会话可以并行:各自 owner,互不视为「正在运行」', () => {
    const a = reserveInFlightStreamRequest({
      sessionId: SESSION_ID,
      clientRequestId: 'req-a',
      userId: USER_ID,
    });
    const other = reserveInFlightStreamRequest({
      sessionId: OTHER_SESSION_ID,
      clientRequestId: 'req-a',
      userId: USER_ID,
    });

    expect(a.owner).toBe(true);
    expect(other.owner).toBe(true);
    expect(
      getAnyInFlightStreamRequestForSession({ sessionId: SESSION_ID, userId: USER_ID })
        ?.clientRequestId,
    ).toBe('req-a');
    expect(
      getAnyInFlightStreamRequestForSession({
        sessionId: OTHER_SESSION_ID,
        userId: USER_ID,
      })?.clientRequestId,
    ).toBe('req-a');

    a.resolve({ statusCode: 200 });
    other.resolve({ statusCode: 200 });
  });
});

describe('TTL 到期与旧执行重叠', () => {
  it('钉死真实行为:TTL 到期后回收占位,但旧 execution 仍在飞 —— 新请求可启动(真实重叠)', async () => {
    const realNow = Date.now();
    const first = reserveInFlightStreamRequest({
      sessionId: SESSION_ID,
      clientRequestId: 'req-a',
      userId: USER_ID,
    });
    expect(first.owner).toBe(true);

    // 手动把 startedAt 推到 TTL 之前,模拟「旧执行既不 resolve 也不 reject」已超时。
    const entry = getInFlightStreamRequest(SESSION_ID, 'req-a');
    expect(entry).toBeDefined();
    if (entry) {
      entry.startedAt = realNow - STREAM_REQUEST_LOCK_TTL_MS - 1;
    }

    // 会话级检查会回收过期占位 => 同一个会话的新请求不应再被旧 entry 挡住。
    const blocking = getAnyInFlightStreamRequestForSession({
      excludeClientRequestId: 'req-b',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(blocking).toBeUndefined();

    // 新请求（哪怕是同样的 clientRequestId 的重试）可以成为新 owner。
    const retry = reserveInFlightStreamRequest({
      sessionId: SESSION_ID,
      clientRequestId: 'req-a',
      userId: USER_ID,
    });
    expect(retry.owner).toBe(true);
    expect(retry.execution).not.toBe(first.execution);

    // 旧 execution 依然处于 pending —— 这就是「真实重叠」:占位被回收,但旧执行未 abort。
    let firstSettled = false;
    void first.execution.then(
      () => {
        firstSettled = true;
      },
      () => {
        firstSettled = true;
      },
    );
    await Promise.resolve();
    expect(firstSettled).toBe(false);

    // 收尾:新 execution resolve,旧 execution 仍需显式 resolve 才能退出(测试清理)。
    retry.resolve({ statusCode: 200 });
    first.resolve({ statusCode: 200 });
    await first.execution;
  });

  it('TTL 到期回收会记录一条 warn(不静默降级),且仍释放占位以维持可重试语义', () => {
    const realNow = Date.now();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const first = reserveInFlightStreamRequest({
        sessionId: SESSION_ID,
        clientRequestId: 'req-a',
        userId: USER_ID,
      });

      const entry = getInFlightStreamRequest(SESSION_ID, 'req-a');
      expect(entry).toBeDefined();
      if (entry) {
        entry.startedAt = realNow - STREAM_REQUEST_LOCK_TTL_MS - 1;
      }

      // 到期回收经由会话级检查路径触发,必须记录告警。
      expect(
        getAnyInFlightStreamRequestForSession({
          excludeClientRequestId: 'req-b',
          sessionId: SESSION_ID,
          userId: USER_ID,
        }),
      ).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [warnMessage, warnFields] = warnSpy.mock.calls[0] ?? [];
      expect(String(warnMessage)).toContain('TTL');
      expect(warnFields).toMatchObject({ sessionId: SESSION_ID, clientRequestId: 'req-a' });

      // 且占位确实被释放 —— 同会话新请求仍可成为 owner(可重试,不是永久 409)。
      const retry = reserveInFlightStreamRequest({
        sessionId: SESSION_ID,
        clientRequestId: 'req-a',
        userId: USER_ID,
      });
      expect(retry.owner).toBe(true);
      expect(retry.execution).not.toBe(first.execution);

      retry.resolve({ statusCode: 200 });
      first.resolve({ statusCode: 200 });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('TTL 到期回收不应 abort 旧执行的 AbortController(保守策略:不强行打断已进入 I/O 的执行)', () => {
    const realNow = Date.now();
    const first = reserveInFlightStreamRequest({
      sessionId: SESSION_ID,
      clientRequestId: 'req-a',
      userId: USER_ID,
    });

    const entry = getInFlightStreamRequest(SESSION_ID, 'req-a');
    expect(entry).toBeDefined();
    if (entry) {
      entry.startedAt = realNow - STREAM_REQUEST_LOCK_TTL_MS - 1;
    }

    getAnyInFlightStreamRequestForSession({
      excludeClientRequestId: 'req-b',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    // 当前实现只删 entry、不 abort:固化该保守行为,防止回归成「到期即打断」。
    expect(first.abortController.signal.aborted).toBe(false);

    first.resolve({ statusCode: 200 });
  });
});
