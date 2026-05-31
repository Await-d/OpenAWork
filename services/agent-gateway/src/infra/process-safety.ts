/**
 * Process-level last-resort error handlers.
 *
 * The gateway has many deliberately fire-and-forget paths (`void promise`,
 * background timers, stream pipelines, SSE pushes). Each is individually
 * `.catch()`'d, but a single missed handler anywhere would, on Node 15+,
 * reach `process` as an `unhandledRejection` and terminate the WHOLE gateway
 * by default — taking down every connected session/user because one stray
 * background task slipped. An `uncaughtException` from a background timer or
 * event emitter (outside Fastify's per-request error boundary) is the same
 * blast radius.
 *
 * This installs last-resort handlers that LOG loudly and, by default, keep the
 * process serving — consistent with the codebase's failure-isolation
 * philosophy (every shutdown branch is wrapped in try/catch, every poll loop
 * swallows-and-backs-off, every fire-and-forget is `.catch()`'d). The default
 * keep-alive behaviour can be flipped to fail-fast (log then `exit(1)`, so a
 * process manager / Tauri sidecar supervisor restarts a process that may be in
 * an undefined state) via `OPENAWORK_EXIT_ON_UNCAUGHT=1`.
 */

export interface ProcessSafetyLogger {
  error: (obj: unknown, msg?: string) => void;
}

interface ProcessLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  exit?: (code?: number) => never;
}

export interface InstallProcessSafetyOptions {
  logger: ProcessSafetyLogger;
  /** Injectable for tests; defaults to `globalThis.process`. */
  proc?: ProcessLike;
  /**
   * When true, an `uncaughtException` is logged and then the process exits(1)
   * so a supervisor can restart it (fail-fast). Defaults to the
   * `OPENAWORK_EXIT_ON_UNCAUGHT` env flag, otherwise false (keep serving).
   */
  exitOnUncaughtException?: boolean;
}

let installed = false;

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * Install `unhandledRejection` / `uncaughtException` handlers. Idempotent:
 * a second call is a no-op so hot-reload / repeated boots don't stack
 * listeners (which would otherwise log each event N times and leak handlers).
 */
export function installProcessSafetyHandlers(options: InstallProcessSafetyOptions): void {
  if (installed) return;
  const proc = options.proc ?? (globalThis.process as unknown as ProcessLike | undefined);
  if (!proc?.on) return;
  installed = true;

  const exitOnUncaught =
    options.exitOnUncaughtException ??
    globalThis.process?.env?.['OPENAWORK_EXIT_ON_UNCAUGHT'] === '1';

  proc.on('unhandledRejection', (reason: unknown) => {
    const err = toError(reason);
    // Recoverable: a background promise missed its `.catch()`. Logging and
    // continuing is strictly safer than letting Node terminate every session.
    options.logger.error(
      { err, kind: 'unhandledRejection' },
      `[process-safety] unhandled promise rejection: ${err.message}`,
    );
  });

  proc.on('uncaughtException', (reason: unknown) => {
    const err = toError(reason);
    options.logger.error(
      { err, kind: 'uncaughtException' },
      `[process-safety] uncaught exception: ${err.message}`,
    );
    if (exitOnUncaught && proc.exit) {
      // Fail-fast: the process may be in an undefined state; let the
      // supervisor restart it cleanly rather than serve from a bad state.
      proc.exit(1);
    }
  });
}

/** Test-only: reset the idempotency latch so a fresh install can be asserted. */
export function __resetProcessSafetyForTest(): void {
  installed = false;
}
