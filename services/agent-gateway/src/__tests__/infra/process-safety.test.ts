/**
 * Regression: the gateway must install last-resort process-level error
 * handlers. The codebase has many fire-and-forget paths (`void promise`,
 * background timers, SSE pushes); on Node 15+ a single missed `.catch()`
 * reaches `process` as an `unhandledRejection` and terminates the WHOLE
 * gateway by default, killing every connected session. These tests pin that
 * the handlers are installed, log the failure, keep serving by default, and
 * fail-fast only when explicitly opted in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installProcessSafetyHandlers,
  __resetProcessSafetyForTest,
} from '../../infra/process-safety.js';

interface FakeProc {
  on: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  handlers: Map<string, (...args: unknown[]) => void>;
}

function makeProc(): FakeProc {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
    }),
    exit: vi.fn(),
  };
}

beforeEach(() => {
  __resetProcessSafetyForTest();
});

afterEach(() => {
  __resetProcessSafetyForTest();
  vi.restoreAllMocks();
});

describe('installProcessSafetyHandlers', () => {
  it('注册 unhandledRejection / uncaughtException 两个处理器', () => {
    const proc = makeProc();
    const logger = { error: vi.fn() };
    installProcessSafetyHandlers({ logger, proc: proc as never });

    expect(proc.handlers.has('unhandledRejection')).toBe(true);
    expect(proc.handlers.has('uncaughtException')).toBe(true);
  });

  it('unhandledRejection 被记录且默认不退出进程（保持服务）', () => {
    const proc = makeProc();
    const logger = { error: vi.fn() };
    installProcessSafetyHandlers({ logger, proc: proc as never });

    proc.handlers.get('unhandledRejection')!(new Error('boom'));

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [obj] = logger.error.mock.calls[0]!;
    expect((obj as { kind: string }).kind).toBe('unhandledRejection');
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it('uncaughtException 默认记录但不退出；非 Error reason 被规范化', () => {
    const proc = makeProc();
    const logger = { error: vi.fn() };
    installProcessSafetyHandlers({ logger, proc: proc as never });

    // A non-Error rejection reason must be normalized, not crash the handler.
    proc.handlers.get('uncaughtException')!('string failure');

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it('exitOnUncaughtException=true 时 uncaughtException 记录后 exit(1)', () => {
    const proc = makeProc();
    const logger = { error: vi.fn() };
    installProcessSafetyHandlers({ logger, proc: proc as never, exitOnUncaughtException: true });

    proc.handlers.get('uncaughtException')!(new Error('fatal'));

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it('幂等：重复安装不重复注册监听器', () => {
    const proc = makeProc();
    const logger = { error: vi.fn() };
    installProcessSafetyHandlers({ logger, proc: proc as never });
    installProcessSafetyHandlers({ logger, proc: proc as never });

    // Two events × one install = 2 `on` calls; a second install must no-op.
    expect(proc.on).toHaveBeenCalledTimes(2);
  });
});
