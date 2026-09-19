export class SshReconnectScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly attempts = new Map<string, number>();
  private readonly paused = new Set<string>();
  private disposed = false;

  resume(id: string): void {
    this.paused.delete(id);
    this.clearTimer(id);
  }

  pause(id: string): void {
    this.paused.add(id);
    this.reset(id);
  }

  reset(id: string): void {
    this.clearTimer(id);
    this.attempts.delete(id);
  }

  schedule(id: string, reconnect: () => Promise<void>): void {
    if (this.disposed || this.paused.has(id) || this.timers.has(id)) return;
    const attempt = this.attempts.get(id) ?? 0;
    this.attempts.set(id, attempt + 1);
    const timer = setTimeout(
      () => {
        this.timers.delete(id);
        void reconnect().catch(() => this.schedule(id, reconnect));
      },
      Math.min(1_000 * 2 ** Math.min(attempt, 6), 60_000),
    );
    timer.unref();
    this.timers.set(id, timer);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.timers.keys()) this.clearTimer(id);
    this.attempts.clear();
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }
}
