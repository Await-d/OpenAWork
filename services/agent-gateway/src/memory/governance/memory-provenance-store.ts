import { randomUUID } from 'node:crypto';
import type { MemorySourceProvenance } from '@openAwork/agent-core';
import { sqliteGet, sqliteRun } from '../../infra/db.js';

/**
 * 入站渠道消息来源冻结（261101-记忆确认写入与周期整理）。
 *
 * 来源必须在**消息到达时**写入并冻结，不能等生成提议时再从会话的最新 metadata 反推——
 * 会话 metadata 会随后续消息变化，反推会把 A 的消息记成 B 的来源。前端展示确认卡、
 * 决定是否发渠道通知时读的都是这里冻结的值。
 */

interface ProvenanceRow {
  platform: string;
  channel_instance_id: string;
  chat_id: string;
  chat_type: string;
  sender_id: string | null;
  sender_name: string | null;
  channel_message_id: string;
}

function rowToProvenance(row: ProvenanceRow): MemorySourceProvenance {
  return {
    platform: row.platform,
    channelInstanceId: row.channel_instance_id,
    chatId: row.chat_id,
    chatType: row.chat_type === 'private' || row.chat_type === 'group' ? row.chat_type : 'unknown',
    senderId: row.sender_id,
    senderName: row.sender_name,
    platformMessageId: row.channel_message_id,
  };
}

/**
 * 记录一条入站渠道消息的来源。
 *
 * `(session_id, channel_message_id)` 上有唯一索引：同一消息重复到达只记一次，
 * `INSERT OR IGNORE` 保证幂等。平台消息 id 缺失时用「sessionId + 递增占位」兜底，
 * 避免多条无 id 消息塌到同一唯一键上互相覆盖。
 */
export function recordChannelMessageProvenance(input: {
  sessionId: string;
  provenance: MemorySourceProvenance;
  now?: Date;
}): void {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const channelMessageId =
    input.provenance.platformMessageId ?? `${input.sessionId}#${now.getTime()}`;
  sqliteRun(
    `INSERT OR IGNORE INTO memory_message_provenance (
       id, session_id, channel_message_id, platform, channel_instance_id, chat_id,
       chat_type, sender_id, sender_name, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.sessionId,
      channelMessageId,
      input.provenance.platform,
      input.provenance.channelInstanceId,
      input.provenance.chatId,
      input.provenance.chatType,
      input.provenance.senderId,
      input.provenance.senderName,
      createdAt,
    ],
  );
}

/** 读取某渠道消息在会话内冻结的来源；不存在返回 undefined。 */
export function readChannelMessageProvenance(
  sessionId: string,
  channelMessageId: string,
): MemorySourceProvenance | undefined {
  const row = sqliteGet<ProvenanceRow>(
    `SELECT platform, channel_instance_id, chat_id, chat_type, sender_id, sender_name, channel_message_id
     FROM memory_message_provenance
     WHERE session_id = ? AND channel_message_id = ?
     LIMIT 1`,
    [sessionId, channelMessageId],
  );
  return row ? rowToProvenance(row) : undefined;
}

/** 读取会话内最近一条渠道消息来源；无记录返回 undefined。 */
export function readLatestChannelProvenance(sessionId: string): MemorySourceProvenance | undefined {
  const row = sqliteGet<ProvenanceRow>(
    `SELECT platform, channel_instance_id, chat_id, chat_type, sender_id, sender_name, channel_message_id
     FROM memory_message_provenance
     WHERE session_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`,
    [sessionId],
  );
  return row ? rowToProvenance(row) : undefined;
}
