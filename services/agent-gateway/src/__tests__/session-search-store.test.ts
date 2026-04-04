import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import {
  buildSearchableMessageText,
  searchSessionMessages,
  upsertSessionMessageSearchDocument,
} from '../session-search-store.js';

describe('session search store', () => {
  beforeEach(() => {
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteRunMock.mockReset();
  });

  it('extracts searchable text from text and modified files summary content', () => {
    const text = buildSearchableMessageText(
      JSON.stringify([
        { type: 'text', text: '这里是会话正文' },
        { type: 'modified_files_summary', title: '变更摘要', summary: '新增搜索索引' },
        { type: 'tool_call', toolCallId: 'tool-1', toolName: 'bash', input: { command: 'pwd' } },
      ]),
    );

    expect(text).toContain('这里是会话正文');
    expect(text).toContain('变更摘要：新增搜索索引');
    expect(text).not.toContain('tool-1');
  });

  it('upserts an fts document with normalized content', () => {
    upsertSessionMessageSearchDocument({
      contentJson: JSON.stringify([{ type: 'text', text: '搜索我' }]),
      id: 'message-1',
      role: 'assistant',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(mocks.sqliteRunMock).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM session_messages_fts WHERE message_id = ?',
      ['message-1'],
    );
    expect(mocks.sqliteRunMock).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO session_messages_fts (message_id, session_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)',
      ['message-1', 'session-1', 'user-1', 'assistant', '搜索我'],
    );
  });

  it('maps FTS rows into session search results', () => {
    mocks.sqliteAllMock.mockReturnValueOnce([
      {
        id: 'message-1',
        session_id: 'session-1',
        role: 'assistant',
        created_at_ms: 123,
        title: '设计讨论',
        updated_at: '2026-04-04T00:00:00.000Z',
        snippet: '这里有 <mark>关键上下文</mark>',
      },
    ]);

    const results = searchSessionMessages({
      limit: 5,
      query: '关键上下文',
      userId: 'user-1',
    });

    expect(mocks.sqliteAllMock).toHaveBeenCalledWith(
      expect.stringContaining('FROM session_messages_fts fts'),
      ['"关键上下文"', 'user-1', 5],
    );
    expect(results).toEqual([
      {
        createdAtMs: 123,
        messageId: 'message-1',
        role: 'assistant',
        sessionId: 'session-1',
        snippet: '这里有 <mark>关键上下文</mark>',
        title: '设计讨论',
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
    ]);
  });
});
