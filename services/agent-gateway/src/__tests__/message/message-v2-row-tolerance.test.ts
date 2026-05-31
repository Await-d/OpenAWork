import { describe, expect, it, vi } from 'vitest';
import {
  tryMessageInfoFromRow,
  tryPartFromRow,
  messageInfoFromRow,
  partFromRow,
  type MessageV2Row,
  type PartV2Row,
} from '../../message/message-v2-schema.js';

/**
 * Regression: `messageInfoFromRow` / `partFromRow` `JSON.parse(row.data)` with
 * no tolerance. The V2 read model is the live source of truth for the chat UI
 * and most callers do `rows.map(...)`, so a SINGLE corrupt `data` column
 * (crash mid-write, disk error, hand-edited DB) would throw and make an entire
 * page / session of messages unreadable. The `try*` variants return `null` +
 * warn so list callers skip the bad row and the rest still loads.
 */

function messageRow(id: string, data: string): MessageV2Row {
  return {
    id,
    session_id: 'ses_1',
    user_id: 'usr_1',
    time_created: 1,
    data,
    created_at: '2026-05-30',
    updated_at: '2026-05-30',
  };
}

function partRow(id: string, data: string): PartV2Row {
  return {
    id,
    message_id: 'msg_1',
    session_id: 'ses_1',
    user_id: 'usr_1',
    time_created: 1,
    data,
    created_at: '2026-05-30',
    updated_at: '2026-05-30',
  };
}

describe('message-v2 row corrupt-tolerance', () => {
  it('合法行：try 变体与原始函数结果一致', () => {
    const mRow = messageRow('msg_1', JSON.stringify({ role: 'user' }));
    expect(tryMessageInfoFromRow(mRow)).toEqual(messageInfoFromRow(mRow));

    const pRow = partRow('prt_1', JSON.stringify({ type: 'text', text: 'hi' }));
    expect(tryPartFromRow(pRow)).toEqual(partFromRow(pRow));
  });

  it('损坏 message.data：原始函数抛错，try 变体返回 null 且告警', () => {
    const bad = messageRow('msg_bad', '{not valid json');
    expect(() => messageInfoFromRow(bad)).toThrow();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(tryMessageInfoFromRow(bad)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('损坏 part.data：原始函数抛错，try 变体返回 null 且告警', () => {
    const bad = partRow('prt_bad', '\u0000garbage');
    expect(() => partFromRow(bad)).toThrow();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(tryPartFromRow(bad)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('混合行用 try 变体过滤后只丢损坏项、保留其余', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rows = [
      messageRow('m1', JSON.stringify({ role: 'user' })),
      messageRow('m2', 'broken'),
      messageRow('m3', JSON.stringify({ role: 'assistant' })),
    ];
    const parsed = rows.map(tryMessageInfoFromRow).filter((m) => m !== null);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((m) => m!.id)).toEqual(['m1', 'm3']);
    vi.restoreAllMocks();
  });
});
