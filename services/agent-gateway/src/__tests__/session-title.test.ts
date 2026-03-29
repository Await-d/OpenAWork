import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  sessions: new Map<string, { title: string | null; userId: string }>(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: (query: string, params: Array<string>) => {
    if (query.includes('COUNT(1) AS count')) {
      const [sessionId, userId] = params;
      const key = `${sessionId}:${userId}`;
      return { count: state.counts.get(key) ?? 0 };
    }
    return undefined;
  },
  sqliteRun: (query: string, params: Array<string>) => {
    if (!query.startsWith('UPDATE sessions SET title = ?')) {
      return;
    }
    const title = params[0];
    const sessionId = params[1];
    const userId = params[2];
    if (!title || !sessionId || !userId) {
      return;
    }
    const row = state.sessions.get(sessionId);
    if (!row || row.userId !== userId) {
      return;
    }
    if ((row.title ?? '').trim().length > 0) {
      return;
    }
    row.title = title;
  },
}));

import { buildSessionTitle, maybeAutoTitle } from '../session-title.js';

describe('session title helpers', () => {
  beforeEach(() => {
    state.counts.clear();
    state.sessions.clear();
  });

  it('builds compact Chinese titles around seven characters', () => {
    expect(buildSessionTitle('请帮我修复会话标题太长的问题')).toBe('修复会话标题太');
  });

  it('builds compact English titles from significant words', () => {
    expect(buildSessionTitle('Please fix the session title length in the chat sidebar')).toBe(
      'Fix session title length',
    );
  });

  it('auto titles a blank session from its first user message only', () => {
    state.sessions.set('session-1', { title: null, userId: 'user-1' });
    state.counts.set('session-1:user-1', 1);

    maybeAutoTitle({
      sessionId: 'session-1',
      userId: 'user-1',
      text: '请帮我修复会话标题太长的问题',
    });

    expect(state.sessions.get('session-1')?.title).toBe('修复会话标题太');
  });

  it('does not retitle a session after the first user message', () => {
    state.sessions.set('session-1', { title: null, userId: 'user-1' });
    state.counts.set('session-1:user-1', 2);

    maybeAutoTitle({
      sessionId: 'session-1',
      userId: 'user-1',
      text: 'Please fix the session title length in the chat sidebar',
    });

    expect(state.sessions.get('session-1')?.title).toBeNull();
  });

  it('does not overwrite an existing manual title', () => {
    state.sessions.set('session-1', { title: '手动标题', userId: 'user-1' });
    state.counts.set('session-1:user-1', 1);

    maybeAutoTitle({
      sessionId: 'session-1',
      userId: 'user-1',
      text: 'Please fix the session title length in the chat sidebar',
    });

    expect(state.sessions.get('session-1')?.title).toBe('手动标题');
  });
});
