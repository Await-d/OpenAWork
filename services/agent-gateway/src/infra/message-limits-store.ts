import { z } from 'zod';
import { sqliteGet, sqliteRun } from './db.js';
import { logGatewayWarn } from './gateway-logger.js';

export const MESSAGE_MIN_CHARS = 1024;
export const MESSAGE_HARD_MAX_CHARS = 200000;
export const MESSAGE_DEFAULT_MAX_CHARS = 32768;

export const messageMaxCharsSchema = z
  .number()
  .int()
  .min(MESSAGE_MIN_CHARS)
  .max(MESSAGE_HARD_MAX_CHARS);

/** 每次外部校验直接读库；数据库故障必须向上传播。 */
export function readMessageMaxChars(): number {
  const row = sqliteGet<{ max_chars: unknown }>(
    'SELECT max_chars FROM message_limits WHERE id = 1',
    [],
  );
  if (!row) return MESSAGE_DEFAULT_MAX_CHARS;
  const parsed = messageMaxCharsSchema.safeParse(row.max_chars);
  if (parsed.success) return parsed.data;
  logGatewayWarn('消息字符上限配置损坏，使用默认值。', { maxChars: row.max_chars });
  return MESSAGE_DEFAULT_MAX_CHARS;
}

export function writeMessageMaxChars(maxChars: number): void {
  const validated = messageMaxCharsSchema.parse(maxChars);
  sqliteRun(
    `INSERT INTO message_limits (id, max_chars) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET max_chars = excluded.max_chars`,
    [validated],
  );
}

export function readMessageLimitsSnapshot(canEdit: boolean) {
  return {
    maxChars: readMessageMaxChars(),
    minChars: MESSAGE_MIN_CHARS,
    hardMaxChars: MESSAGE_HARD_MAX_CHARS,
    defaultMaxChars: MESSAGE_DEFAULT_MAX_CHARS,
    canEdit,
  };
}
