/**
 * 遥测同意状态持久化 — 基于 user_settings 表的 key-value 存储。
 *
 * 同意状态结构：{ status: 'accepted' | 'declined', updatedAt: ISO-8601 }
 *
 * 以网关 user_settings 为权威来源，前端 localStorage 仅做缓存。
 */

import { z } from 'zod';
import { sqliteGet, sqliteRun } from '../infra/db.js';

export const TELEMETRY_CONSENT_KEY = 'telemetry_consent';

export type TelemetryConsentStatus = 'accepted' | 'declined';

export interface TelemetryConsent {
  status: TelemetryConsentStatus | null;
  updatedAt: string | null;
}

const consentValueSchema = z.object({
  status: z.enum(['accepted', 'declined']),
  updatedAt: z.string().min(1),
});

interface UserSettingRow {
  value: string;
}

/**
 * 读取用户的遥测同意状态。
 * 返回 `{ status: null, updatedAt: null }` 表示用户尚未做出选择。
 */
export function getTelemetryConsent(userId: string): TelemetryConsent {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, TELEMETRY_CONSENT_KEY],
  );

  if (!row?.value) {
    return { status: null, updatedAt: null };
  }

  try {
    const parsed = JSON.parse(row.value) as unknown;
    const result = consentValueSchema.safeParse(parsed);
    if (result.success) {
      return { status: result.data.status, updatedAt: result.data.updatedAt };
    }
  } catch {
    // 损坏数据降级为未同意
  }

  return { status: null, updatedAt: null };
}

/**
 * 保存用户的遥测同意状态。
 */
export function setTelemetryConsent(userId: string, status: TelemetryConsentStatus): void {
  const value = JSON.stringify({
    status,
    updatedAt: new Date().toISOString(),
  });

  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, TELEMETRY_CONSENT_KEY, value],
  );
}

/**
 * 检查用户是否已明确同意遥测。
 */
export function isTelemetryConsentAccepted(userId: string): boolean {
  return getTelemetryConsent(userId).status === 'accepted';
}
