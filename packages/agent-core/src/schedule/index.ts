export type ScheduleKind = 'cron' | 'interval' | 'once';

export interface ScheduledTask {
  id: string;
  name: string;
  kind: ScheduleKind;
  expression: string;
  handler: () => Promise<void>;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
}

export interface ScheduleManager {
  add(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'lastRunAt' | 'nextRunAt'>): ScheduledTask;
  remove(taskId: string): void;
  enable(taskId: string): void;
  disable(taskId: string): void;
  list(): ScheduledTask[];
  start(): void;
  stop(): void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function parseIntervalMs(expression: string): number | null {
  const parsed = Number.parseInt(expression, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseOnceTimestamp(expression: string): number | null {
  const parsed = Date.parse(expression);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseCronEveryNMinutes(expression: string): number | null {
  const match = /^\*\/(\d+) \* \* \* \*$/.exec(expression);
  if (!match) {
    return null;
  }
  const group = match[1];
  if (!group) {
    return null;
  }
  const parsed = Number.parseInt(group, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export class ScheduleManagerImpl implements ScheduleManager {
  private tasks = new Map<string, ScheduledTask>();
  private intervalTimers = new Map<string, ReturnType<typeof setInterval>>();
  private onceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private cronTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  add(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'lastRunAt' | 'nextRunAt'>): ScheduledTask {
    const created: ScheduledTask = {
      ...task,
      id: generateId(),
      createdAt: Date.now(),
    };
    this.tasks.set(created.id, created);
    this.updateNextRun(created);
    if (this.running && created.enabled) {
      this.scheduleTask(created.id);
    }
    return { ...created };
  }

  remove(taskId: string): void {
    this.clearTaskTimers(taskId);
    this.tasks.delete(taskId);
  }

  enable(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }
    task.enabled = true;
    this.updateNextRun(task);
    if (this.running) {
      this.scheduleTask(taskId);
    }
  }

  disable(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }
    task.enabled = false;
    task.nextRunAt = undefined;
    this.clearTaskTimers(taskId);
  }

  list(): ScheduledTask[] {
    return [...this.tasks.values()].map((task) => ({ ...task }));
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    for (const task of this.tasks.values()) {
      if (task.enabled) {
        this.scheduleTask(task.id);
      }
    }
    this.ensureCronTicker();
  }

  stop(): void {
    this.running = false;
    for (const timer of this.intervalTimers.values()) {
      clearInterval(timer);
    }
    this.intervalTimers.clear();
    for (const timer of this.onceTimers.values()) {
      clearTimeout(timer);
    }
    this.onceTimers.clear();
    if (this.cronTimer) {
      clearInterval(this.cronTimer);
      this.cronTimer = null;
    }
  }

  private scheduleTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || !task.enabled) {
      return;
    }

    this.clearTaskTimers(taskId);

    if (task.kind === 'interval') {
      const intervalMs = parseIntervalMs(task.expression);
      if (!intervalMs) {
        return;
      }
      task.nextRunAt = Date.now() + intervalMs;
      const timer = setInterval(() => {
        void this.runTask(task.id);
      }, intervalMs);
      this.intervalTimers.set(task.id, timer);
      return;
    }

    if (task.kind === 'once') {
      const target = parseOnceTimestamp(task.expression);
      if (!target) {
        return;
      }
      const delay = Math.max(0, target - Date.now());
      task.nextRunAt = Date.now() + delay;
      const timer = setTimeout(() => {
        void this.runTask(task.id);
      }, delay);
      this.onceTimers.set(task.id, timer);
    }
  }

  private ensureCronTicker(): void {
    if (this.cronTimer) {
      return;
    }
    this.cronTimer = setInterval(() => {
      this.runCronTick();
    }, 60000);
    this.runCronTick();
  }

  private runCronTick(): void {
    if (!this.running) {
      return;
    }

    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    const minuteOfHour = new Date(now).getUTCMinutes();

    for (const task of this.tasks.values()) {
      if (!task.enabled || task.kind !== 'cron') {
        continue;
      }
      const everyNMinutes = parseCronEveryNMinutes(task.expression);
      if (!everyNMinutes) {
        continue;
      }

      const lastRunMinute =
        typeof task.lastRunAt === 'number' ? Math.floor(task.lastRunAt / 60000) : undefined;
      if (lastRunMinute === currentMinute) {
        continue;
      }

      if (minuteOfHour % everyNMinutes === 0) {
        void this.runTask(task.id);
      }

      const deltaMinutes = everyNMinutes - (minuteOfHour % everyNMinutes || everyNMinutes);
      task.nextRunAt = now + deltaMinutes * 60000;
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !task.enabled) {
      return;
    }

    try {
      await task.handler();
    } finally {
      task.lastRunAt = Date.now();
      if (task.kind === 'interval') {
        const intervalMs = parseIntervalMs(task.expression);
        if (intervalMs) {
          task.nextRunAt = Date.now() + intervalMs;
        }
      } else if (task.kind === 'once') {
        task.nextRunAt = undefined;
        task.enabled = false;
        this.clearTaskTimers(task.id);
      }
    }
  }

  private updateNextRun(task: ScheduledTask): void {
    if (!task.enabled) {
      task.nextRunAt = undefined;
      return;
    }
    if (task.kind === 'interval') {
      const intervalMs = parseIntervalMs(task.expression);
      task.nextRunAt = intervalMs ? Date.now() + intervalMs : undefined;
      return;
    }
    if (task.kind === 'once') {
      const when = parseOnceTimestamp(task.expression);
      task.nextRunAt = when ?? undefined;
      return;
    }
    task.nextRunAt = undefined;
  }

  private clearTaskTimers(taskId: string): void {
    const intervalTimer = this.intervalTimers.get(taskId);
    if (intervalTimer) {
      clearInterval(intervalTimer);
      this.intervalTimers.delete(taskId);
    }

    const onceTimer = this.onceTimers.get(taskId);
    if (onceTimer) {
      clearTimeout(onceTimer);
      this.onceTimers.delete(taskId);
    }
  }
}
