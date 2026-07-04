/**
 * 通用遥测服务 — 与 team-runtime-telemetry.ts 隔离的独立 TelemetryManager 实例。
 *
 * 职责：
 * - 持有通用遥测单例（app_start / session_created / tool_call / skill_installed / error_boundary）
 * - 同意状态门控：用户未同意则不采集
 * - GitHub Issue 同步：error_boundary 事件触发自动创建 Issue（可选）
 *
 * 注意：team-runtime-telemetry.ts 有自己的 TelemetryManager 实例用于 team 专用事件，
 * 两者互不干扰。
 */

import { TelemetryManager, type TelemetryEventName } from '@openAwork/telemetry';
import { getTelemetryConsent } from './telemetry-consent-store.js';
import { syncErrorToGitHub } from './github-sync.js';

interface TelemetrySink {
  isEnabled(): boolean;
  shutdown(): Promise<void>;
  track(name: TelemetryEventName, properties: Record<string, string | number | boolean>): void;
  getInstallId(): string;
}

let manager: TelemetrySink = new TelemetryManager({
  endpoint: process.env['TELEMETRY_ENDPOINT'],
});

/**
 * 追踪一条遥测事件。
 *
 * 调用前会检查用户同意状态——未同意或退出遥测的用户不会产生任何事件。
 * 所有错误静默吞掉，绝不干扰主业务流程。
 *
 * @param userId  当前用户 ID（用于查同意状态）
 * @param name    事件类型
 * @param properties 事件属性（仅允许 string | number | boolean）
 */
export function trackEvent(
  userId: string,
  name: TelemetryEventName,
  properties: Record<string, string | number | boolean> = {},
): void {
  if (!manager.isEnabled()) return;

  const consent = getTelemetryConsent(userId);
  if (consent.status !== 'accepted') return;

  safeTrack(name, properties);

  // error_boundary 事件额外触发 GitHub Issue 同步
  if (name === 'error_boundary') {
    void syncErrorToGitHub(properties, manager.getInstallId());
  }
}

/**
 * 追踪遥测事件（不检查同意状态），仅供网关内部已确认同意的场景使用。
 */
export function trackEventUnchecked(
  name: TelemetryEventName,
  properties: Record<string, string | number | boolean> = {},
): void {
  if (!manager.isEnabled()) return;
  safeTrack(name, properties);

  if (name === 'error_boundary') {
    void syncErrorToGitHub(properties, manager.getInstallId());
  }
}

export function isTelemetryEnabled(): boolean {
  return manager.isEnabled();
}

export function getTelemetryInstallId(): string {
  return manager.getInstallId();
}

export async function shutdownTelemetry(): Promise<void> {
  await manager.shutdown();
}

// ── Test helpers ──────────────────────────────────────────────────

export function __setTelemetrySinkForTesting(next: TelemetrySink): void {
  manager = next;
}

export function __resetTelemetryForTesting(): void {
  manager = new TelemetryManager({ enabled: false });
}

// ── Internal ──────────────────────────────────────────────────────

function safeTrack(
  name: TelemetryEventName,
  properties: Record<string, string | number | boolean>,
): void {
  try {
    manager.track(name, properties);
  } catch (error) {
    console.warn(
      `[telemetry-service] track ${name} 失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
