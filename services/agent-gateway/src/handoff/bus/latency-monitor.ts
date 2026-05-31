/**
 * 260518 · L1.6 延迟监控
 *
 * 用户感知延迟硬约束（L1.6.1）：
 *   - a→b 直答路径：p95 < 3s
 *   - a→b "已开始处理"确认：p95 < 2s
 *   - 后台任务推送通知：p95 < 5s
 *   - 进度推送间隔：≤ 60s
 *
 * 本模块提供：
 *   1. recordLatency(type, durationMs) — 记录一次延迟采样
 *   2. getLatencyStats(type) — 获取 p50/p95/p99 统计
 *   3. checkLatencyViolation(type, durationMs) — 检查是否违反约束
 *
 * 实现：内存滑动窗口（最近 1000 条），不持久化。
 * 后续可接入 telemetry 系统（Prometheus / OpenTelemetry）。
 */

import { recordTeamRuntimeIncident } from '../../team/team-runtime-diagnostics-store.js';

export type LatencyType =
  | 'a_to_b_direct' // 用户输入 → b 直答回复
  | 'a_to_b_ack' // 用户输入 → "已开始处理"确认
  | 'substate_push' // substate 变更 → 前端收到推送
  | 'progress_interval'; // 两次进度推送之间的间隔

interface LatencyThreshold {
  p95Ms: number;
  label: string;
}

const THRESHOLDS: Record<LatencyType, LatencyThreshold> = {
  a_to_b_direct: { p95Ms: 3000, label: 'a→b 直答' },
  a_to_b_ack: { p95Ms: 2000, label: 'a→b 确认' },
  substate_push: { p95Ms: 5000, label: '后台推送' },
  progress_interval: { p95Ms: 60000, label: '进度间隔' },
};

const WINDOW_SIZE = 1000;

interface LatencyWindow {
  samples: number[];
  /** 按升序排列的副本（用于 percentile 计算），在 getStats 时惰性排序 */
  dirty: boolean;
  sorted: number[];
}

const windows = new Map<LatencyType, LatencyWindow>();

function getWindow(type: LatencyType): LatencyWindow {
  let w = windows.get(type);
  if (!w) {
    w = { samples: [], dirty: false, sorted: [] };
    windows.set(type, w);
  }
  return w;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function recordLatency(type: LatencyType, durationMs: number, userId?: string | null): void {
  const w = getWindow(type);
  w.samples.push(durationMs);
  if (w.samples.length > WINDOW_SIZE) {
    w.samples.shift();
  }
  w.dirty = true;

  // 检查是否违反约束
  const threshold = THRESHOLDS[type];
  if (durationMs > threshold.p95Ms) {
    recordTeamRuntimeIncident({
      category: 'latency_violation',
      code: `latency:${type}`,
      context: {
        durationMs,
        thresholdMs: threshold.p95Ms,
        type,
      },
      message: `${threshold.label} 延迟 ${durationMs}ms 超过阈值 ${threshold.p95Ms}ms`,
      severity: 'warning',
      timestamp: Date.now(),
      userId: userId ?? null,
    });
    console.warn(
      `[latency-monitor] ⚠️ ${threshold.label} 延迟 ${durationMs}ms 超过 p95 阈值 ${threshold.p95Ms}ms`,
    );
  }
}

export interface LatencyStats {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  minMs: number;
  avgMs: number;
  thresholdMs: number;
  violationCount: number;
}

export function getLatencyStats(type: LatencyType): LatencyStats {
  const w = getWindow(type);
  if (w.samples.length === 0) {
    return {
      count: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      minMs: 0,
      avgMs: 0,
      thresholdMs: THRESHOLDS[type].p95Ms,
      violationCount: 0,
    };
  }

  if (w.dirty) {
    w.sorted = [...w.samples].sort((a, b) => a - b);
    w.dirty = false;
  }

  const sorted = w.sorted;
  const count = sorted.length;
  const threshold = THRESHOLDS[type].p95Ms;

  return {
    count,
    p50Ms: sorted[Math.floor(count * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(count * 0.95)] ?? 0,
    p99Ms: sorted[Math.floor(count * 0.99)] ?? 0,
    maxMs: sorted[count - 1] ?? 0,
    minMs: sorted[0] ?? 0,
    avgMs: Math.round(sorted.reduce((sum, v) => sum + v, 0) / count),
    thresholdMs: threshold,
    violationCount: sorted.filter((v) => v > threshold).length,
  };
}

export function checkLatencyViolation(type: LatencyType, durationMs: number): boolean {
  return durationMs > THRESHOLDS[type].p95Ms;
}

/** 获取所有类型的统计（用于 /team/runtime 端点暴露给前端） */
export function getAllLatencyStats(): Record<LatencyType, LatencyStats> {
  return {
    a_to_b_direct: getLatencyStats('a_to_b_direct'),
    a_to_b_ack: getLatencyStats('a_to_b_ack'),
    substate_push: getLatencyStats('substate_push'),
    progress_interval: getLatencyStats('progress_interval'),
  };
}

/** 测试用：重置所有窗口 */
export function __resetLatencyMonitorForTesting(): void {
  windows.clear();
}
