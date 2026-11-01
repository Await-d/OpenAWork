import { logGatewayWarn } from '../../infra/gateway-logger.js';
import type { MemoryJobKind } from '@openAwork/agent-core';
import {
  createMemoryJobOwnerId,
  recoverExpiredMemoryJobLeases,
} from '../governance/memory-job-store.js';
import { recoverExpiredMemoryDeliveryLeases } from '../governance/memory-notification-outbox.js';
import {
  dispatchMemoryDeliveries,
  enqueuePendingMemoryNotifications,
} from './memory-delivery-dispatcher.js';
import { planMemoryMaintenanceJobs, runMemoryMaintenanceTick } from './memory-maintenance-tasks.js';

/**
 * 记忆治理后台任务注册（261101-记忆确认写入与周期整理）。
 *
 * 三个任务：
 *   - `memory.governance.tick`：规划当期任务 + 跑一轮整理（间隔 5 分钟）；
 *   - `memory.governance.notify`：入队 + 投递渠道通知（间隔 2 分钟）；
 *   - `memory.governance.lease-recovery`：回收过期 job / 投递租约（间隔 1 分钟）。
 *
 * 开关：`OPENAWORK_DISABLE_MEMORY_MAINTENANCE=1|true` 时**不注册任何任务**。
 * 这不是「回退到自动写记忆」——只是停止维护任务，写记忆仍受一次性确认门约束。
 * 每个 task 的 `onError` 只记一条 warn，绝不把异常抛回调度器。
 */

/** 调度器接口：只依赖 `register`，便于测试注入假实现。 */
export interface MemoryGovernanceScheduler {
  register(task: {
    name: string;
    intervalMs: number;
    initialDelayMs?: number;
    run: () => Promise<void>;
    onError?: (err: unknown) => void;
  }): void;
}

export interface RegisterMemoryGovernanceOptions {
  env?: Record<string, string | undefined>;
}

const DEFAULT_TICK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_NOTIFY_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_LEASE_RECOVERY_INTERVAL_MS = 60 * 1000;

const TICK_INITIAL_DELAY_MS = 60 * 1000;
const NOTIFY_INITIAL_DELAY_MS = 30 * 1000;

function readIntervalMs(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  // 非正数 / NaN 一律回落默认，避免把 setTimeout 送进紧循环。
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function isDisabled(env: Record<string, string | undefined>): boolean {
  const raw = env['OPENAWORK_DISABLE_MEMORY_MAINTENANCE'];
  if (raw === undefined || raw === null) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

export function registerMemoryGovernanceBackgroundTasks(
  scheduler: MemoryGovernanceScheduler,
  options?: RegisterMemoryGovernanceOptions,
): void {
  const env: Record<string, string | undefined> = options?.env ?? globalThis.process?.env;
  if (isDisabled(env)) {
    logGatewayWarn(
      '[memory-governance] 已通过 OPENAWORK_DISABLE_MEMORY_MAINTENANCE 关闭，不注册任何维护任务',
    );
    return;
  }

  const tickIntervalMs = readIntervalMs(
    env,
    'MEMORY_MAINTENANCE_INTERVAL_MS',
    DEFAULT_TICK_INTERVAL_MS,
  );
  const notifyIntervalMs = readIntervalMs(
    env,
    'MEMORY_NOTIFY_INTERVAL_MS',
    DEFAULT_NOTIFY_INTERVAL_MS,
  );
  const leaseRecoveryIntervalMs = readIntervalMs(
    env,
    'MEMORY_LEASE_RECOVERY_INTERVAL_MS',
    DEFAULT_LEASE_RECOVERY_INTERVAL_MS,
  );

  // 进程级 owner：每次启动唯一，重启后不会以同一 owner 续上一个进程的租约。
  const owner = createMemoryJobOwnerId();

  scheduler.register({
    name: 'memory.governance.tick',
    intervalMs: tickIntervalMs,
    initialDelayMs: TICK_INITIAL_DELAY_MS,
    run: async () => {
      const now = new Date();
      planMemoryMaintenanceJobs({ now, userIds: [] });
      await runMemoryMaintenanceTick({ now, owner });
    },
    onError: (error) => {
      logGatewayWarn('[memory-governance] tick 任务失败', { error: describe(error) });
    },
  });

  scheduler.register({
    name: 'memory.governance.notify',
    intervalMs: notifyIntervalMs,
    initialDelayMs: NOTIFY_INITIAL_DELAY_MS,
    run: async () => {
      await enqueuePendingMemoryNotifications();
      await dispatchMemoryDeliveries({ owner: `${owner}:notify` });
    },
    onError: (error) => {
      logGatewayWarn('[memory-governance] notify 任务失败', { error: describe(error) });
    },
  });

  scheduler.register({
    name: 'memory.governance.lease-recovery',
    intervalMs: leaseRecoveryIntervalMs,
    run: async () => {
      const now = new Date();
      recoverExpiredMemoryJobLeases(now);
      recoverExpiredMemoryDeliveryLeases(now);
    },
    onError: (error) => {
      logGatewayWarn('[memory-governance] 租约回收任务失败', { error: describe(error) });
    },
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 仅供测试断言 kind 常量覆盖（避免魔法字符串散落）。 */
export const MEMORY_MAINTENANCE_JOB_KINDS: readonly MemoryJobKind[] = [
  'daily_patrol',
  'weekly_semantic',
  'monthly_review',
];
