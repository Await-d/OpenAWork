import { logGatewayWarn } from '../infra/gateway-logger.js';
import { DispatchModelUnavailable, generateDispatchResult } from './dispatch-generation.js';
import {
  claimDispatchJob,
  finishDispatchJob,
  recoverDispatchJobs,
  type DispatchJob,
  type DispatchOutcome,
} from './dispatch-queue.js';

export function isDispatchEnabled(): boolean {
  return process.env['OPENAWORK_ENABLE_DISPATCH'] === '1';
}

export class DispatchScheduler {
  private readonly running = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  private readonly settlements = new Map<
    string,
    { job: DispatchJob; outcome: DispatchOutcome; warned: boolean }
  >();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopping = false;

  constructor(
    private readonly generate = generateDispatchResult,
    private readonly enabled = isDispatchEnabled,
  ) {}

  start(): void {
    if (this.timer || this.stopping) return;
    recoverDispatchJobs();
    this.timer = setInterval(() => this.wake(), 2_000);
    this.timer.unref();
    this.wake();
  }

  async stop(): Promise<void> {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.stopping = true;
    try {
      const flights = [...this.running.values()];
      for (const { controller } of flights) controller.abort();
      await Promise.all(flights.map(({ done }) => done));
      this.flushSettlements();
      recoverDispatchJobs();
    } finally {
      this.settlements.clear();
      this.stopping = false;
    }
  }

  cancel(attemptId: string): void {
    this.running.get(attemptId)?.controller.abort();
  }

  wake(): void {
    if (!this.timer) return;
    this.flushSettlements();
    if (!this.enabled()) return;
    try {
      for (let job = claimDispatchJob(); job; job = claimDispatchJob()) {
        const controller = new AbortController();
        const done = this.run(job, controller.signal).finally(() => {
          this.running.delete(job.id);
          this.wake();
        });
        this.running.set(job.id, { controller, done });
      }
    } catch {
      logGatewayWarn('[dispatch] 派工队列认领失败，稍后重试。');
    }
  }

  private flushSettlements(): void {
    for (const [id, settlement] of this.settlements) {
      try {
        finishDispatchJob(settlement.job, settlement.outcome);
        this.settlements.delete(id);
      } catch {
        if (!settlement.warned) {
          settlement.warned = true;
          logGatewayWarn(`[dispatch] 无法写入结算状态，稍后补写 attempt=${id}`);
        }
      }
    }
  }

  private async run(job: DispatchJob, signal: AbortSignal): Promise<void> {
    const outcome: DispatchOutcome = await Promise.resolve()
      .then(() => this.generate(job, signal))
      .then(
        (result) => ({ result }),
        (error: unknown) => ({
          error:
            error instanceof DispatchModelUnavailable
              ? ('model-unavailable' as const)
              : ('generation-failed' as const),
        }),
      );
    // On shutdown the recovery pass decides which interrupted runs had a user stop request.
    if (!this.stopping) this.settlements.set(job.id, { job, outcome, warned: false });
  }
}

export const dispatchScheduler = new DispatchScheduler();
