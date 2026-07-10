import { sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import { channelLogInfo } from './channel-log.js';

const SOURCE_PERIOD_KEY = '__source__';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface QQWakeupEligibility {
  readonly enabled: boolean;
  readonly periodKey: string | null;
  readonly sourceMessageId: string | null;
  readonly sourceTimestamp: number;
}

interface QQWakeupWindowRow {
  readonly source_message_id: string | null;
  readonly source_timestamp: number;
}

interface QQWakeupExistingRow {
  readonly exists_flag: number;
}

export function ensureQQWakeupSchema(): void {
  sqliteRun(`
    CREATE TABLE IF NOT EXISTS qq_wakeup_windows (
      plugin_id TEXT NOT NULL,
      open_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      source_message_id TEXT,
      source_timestamp INTEGER NOT NULL,
      sent_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, open_id, period_key)
    )
  `);
  sqliteRun(
    'CREATE INDEX IF NOT EXISTS idx_qq_wakeup_windows_open_id ON qq_wakeup_windows(plugin_id, open_id, sent_at DESC)',
  );
}

export function resolveQQWakeupEligibility(
  pluginId: string,
  openId: string,
  now = Date.now(),
): QQWakeupEligibility {
  ensureQQWakeupSchema();
  const source = sqliteGet<QQWakeupWindowRow>(
    `
      SELECT source_message_id, source_timestamp
      FROM qq_wakeup_windows
      WHERE plugin_id = ? AND open_id = ? AND period_key = ?
      LIMIT 1
    `,
    [pluginId, openId, SOURCE_PERIOD_KEY],
  );
  const sourceTimestamp = source?.source_timestamp ?? now;
  const periodKey = getWakeupPeriodKey(sourceTimestamp, now);
  if (periodKey === null) {
    return {
      enabled: false,
      periodKey: null,
      sourceMessageId: source?.source_message_id ?? null,
      sourceTimestamp,
    };
  }

  const existing = sqliteGet<QQWakeupExistingRow>(
    `
      SELECT 1 AS exists_flag
      FROM qq_wakeup_windows
      WHERE plugin_id = ? AND open_id = ? AND period_key = ?
      LIMIT 1
    `,
    [pluginId, openId, periodKey],
  );
  const enabled = existing === undefined;
  channelLogInfo('qq wakeup eligibility resolved', {
    pluginId,
    openId,
    enabled,
    periodKey,
  });
  return {
    enabled,
    periodKey,
    sourceMessageId: source?.source_message_id ?? null,
    sourceTimestamp,
  };
}

export function markQQWakeupSent(input: {
  readonly pluginId: string;
  readonly openId: string;
  readonly periodKey: string;
  readonly sourceMessageId: string | null;
  readonly sourceTimestamp: number;
  readonly now?: number;
}): void {
  ensureQQWakeupSchema();
  const now = input.now ?? Date.now();
  sqliteTransaction(() => {
    sqliteRun(
      `
        INSERT OR REPLACE INTO qq_wakeup_windows (
          plugin_id,
          open_id,
          period_key,
          source_message_id,
          source_timestamp,
          sent_at,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          COALESCE((
            SELECT created_at
            FROM qq_wakeup_windows
            WHERE plugin_id = ? AND open_id = ? AND period_key = ?
          ), ?),
          ?
        )
      `,
      [
        input.pluginId,
        input.openId,
        input.periodKey,
        input.sourceMessageId,
        input.sourceTimestamp,
        now,
        input.pluginId,
        input.openId,
        input.periodKey,
        now,
        now,
      ],
    );
  });
  channelLogInfo('qq wakeup sent marker stored', {
    pluginId: input.pluginId,
    openId: input.openId,
    periodKey: input.periodKey,
  });
}

function getWakeupPeriodKey(sourceTimestamp: number, now: number): string | null {
  const diffMs = now - sourceTimestamp;
  if (diffMs < 0) {
    return null;
  }
  if (diffMs < DAY_MS) {
    return 'day-0';
  }
  if (diffMs < 3 * DAY_MS) {
    return 'day-1-3';
  }
  if (diffMs < 7 * DAY_MS) {
    return 'day-3-7';
  }
  if (diffMs < 30 * DAY_MS) {
    return 'day-7-30';
  }
  return null;
}
