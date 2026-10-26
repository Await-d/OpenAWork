import { describe, expect, it } from 'vitest';

import { parseSessionInfoText, parseSessionListTable } from './session-text-view.js';

const LIST_TABLE = [
  '| Session ID | Messages | First | Last | Status | Title |',
  '| --- | --- | --- | --- | --- | --- |',
  '| ses_a | 12 | 2026-10-01T00:00:00.000Z | 2026-10-02T00:00:00.000Z | active | 修复登录 |',
  '| ses_b | 3 | 2026-10-03T00:00:00.000Z | 2026-10-03T01:00:00.000Z | completed | 重构 diff |',
].join('\n');

describe('parseSessionListTable', () => {
  it('把 Markdown 表格还原成会话列表（跳过表头与分隔行）', () => {
    const sessions = parseSessionListTable(LIST_TABLE);

    expect(sessions).toHaveLength(2);
    expect(sessions?.[0]).toMatchObject({
      id: 'ses_a',
      name: '修复登录',
      status: 'active',
      messageCount: 12,
      createdAt: '2026-10-01T00:00:00.000Z',
      lastActivity: '2026-10-02T00:00:00.000Z',
    });
  });

  it('标题里含竖线时把后续列拼回标题，不吞信息', () => {
    const table = [
      '| Session ID | Messages | First | Last | Status | Title |',
      '| --- | --- | --- | --- | --- | --- |',
      '| ses_a | 1 | a | b | active | 修复 A | B |',
    ].join('\n');

    expect(parseSessionListTable(table)?.[0]?.name).toBe('修复 A | B');
  });

  it('空列表文本返回空数组（渲染空态）', () => {
    expect(parseSessionListTable('No sessions found.')).toEqual([]);
  });

  it('非表格 / 空文本返回 null', () => {
    expect(parseSessionListTable('hello')).toBeNull();
    expect(parseSessionListTable('   ')).toBeNull();
    expect(parseSessionListTable({ sessions: [] })).toBeNull();
  });
});

const INFO_TEXT = [
  'Session ID: ses_a',
  'Messages: 12',
  'Date Range: 2026-10-01T00:00:00.000Z to 2026-10-02T00:00:00.000Z',
  'Status: active',
  'Has Todos: Yes (3 items)',
  'File Diffs: 2',
  'Snapshots: 1',
  'Weakest Guarantee: strong',
  'Sources: file-diff, snapshot',
  'Latest Snapshot: snap_1',
  'Children: 1',
  'Parent Session: None',
].join('\n');

describe('parseSessionInfoText', () => {
  it('解析 Key: Value 详情，并把未建模字段留在 extra', () => {
    const info = parseSessionInfoText(INFO_TEXT);

    expect(info).toMatchObject({
      sessionId: 'ses_a',
      status: 'active',
      messageCount: 12,
      todos: 'Yes (3 items)',
      fileDiffs: '2',
      snapshots: '1',
      children: '1',
    });
    expect(info?.extra.map(([key]) => key)).toEqual([
      'Weakest Guarantee',
      'Sources',
      'Latest Snapshot',
    ]);
  });

  it('Parent Session: None 视为没有父会话', () => {
    expect(parseSessionInfoText(INFO_TEXT)?.parentSession).toBeUndefined();
  });

  it('有父会话时保留 id', () => {
    const info = parseSessionInfoText('Session ID: ses_a\nParent Session: ses_parent');

    expect(info?.parentSession).toBe('ses_parent');
  });

  it('缺少 Session ID 返回 null（不是详情输出）', () => {
    expect(parseSessionInfoText('Messages: 3\nStatus: active')).toBeNull();
    expect(parseSessionInfoText('')).toBeNull();
    expect(parseSessionInfoText({ sessionId: 'x' })).toBeNull();
  });
});
