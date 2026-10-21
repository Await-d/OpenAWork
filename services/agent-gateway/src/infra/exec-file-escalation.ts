/**
 * `execFile` with a real termination guarantee.
 *
 * Node's `execFile({ timeout })` only sends `killSignal` (SIGTERM by default)
 * when the deadline elapses. A child that ignores or traps SIGTERM keeps the
 * promise pending forever — and because the gateway dispatches tools from the
 * same process, that leaves the tool call (and the session stream) stuck.
 *
 * This wrapper keeps `execFile`'s normal output/maxBuffer/error semantics but
 * schedules a SIGKILL shortly after the timeout, so the callback always fires.
 */

import { execFile, type ChildProcess, type ExecFileOptions } from 'node:child_process';

export const DEFAULT_SIGKILL_GRACE_MS = 3_000;

export interface ExecFileWithEscalationOptions extends Omit<
  ExecFileOptions,
  'timeout' | 'killSignal' | 'encoding'
> {
  /** Wall-clock deadline before SIGTERM is sent. */
  timeoutMs: number;
  /** Extra time allowed after the deadline before SIGKILL. */
  graceMs?: number;
}

export interface ExecFileWithEscalationResult {
  stdout: string;
  stderr: string;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function execFileWithEscalation(
  file: string,
  args: readonly string[],
  options: ExecFileWithEscalationOptions,
): Promise<ExecFileWithEscalationResult> {
  const { timeoutMs, graceMs = DEFAULT_SIGKILL_GRACE_MS, ...execOptions } = options;

  return new Promise((resolve, reject) => {
    let escalation: NodeJS.Timeout | null = null;
    let child: ChildProcess;

    const clearEscalation = () => {
      if (escalation !== null) {
        clearTimeout(escalation);
        escalation = null;
      }
    };

    try {
      child = execFile(
        file,
        args,
        { ...execOptions, timeout: timeoutMs, encoding: 'utf8' },
        (error, stdout, stderr) => {
          clearEscalation();
          if (error) {
            reject(toError(error));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    } catch (error) {
      reject(toError(error));
      return;
    }

    // `timeout` itself only asks the child to terminate. Give it a short grace
    // period to exit cleanly, then force it so the callback cannot hang.
    escalation = setTimeout(() => {
      escalation = null;
      try {
        child.kill('SIGKILL');
      } catch {
        /* process already gone */
      }
    }, timeoutMs + graceMs);
    escalation.unref?.();
  });
}
