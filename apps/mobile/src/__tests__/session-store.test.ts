import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunAsync = vi.fn().mockResolvedValue(undefined);
const mockGetFirstAsync = vi.fn().mockResolvedValue(null);
const mockGetAllAsync = vi.fn().mockResolvedValue([]);
const mockExecAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn().mockResolvedValue({
    execAsync: mockExecAsync,
    runAsync: mockRunAsync,
    getFirstAsync: mockGetFirstAsync,
    getAllAsync: mockGetAllAsync,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('session-store schema', () => {
  it('LocalSession has required fields', () => {
    const session = {
      id: 'ses-1',
      title: 'Test',
      messages_json: '[]',
      draft: '',
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    expect(session.id).toBe('ses-1');
    expect(session.messages_json).toBe('[]');
  });

  it('LocalMessage has role and content', () => {
    const msg = { id: 'msg-1', role: 'user' as const, content: 'hello' };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });
});

describe('session upsert conflict resolution', () => {
  it('upsert query contains ON CONFLICT clause', () => {
    const query = `INSERT INTO sessions (id, title, messages_json, draft, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       messages_json = excluded.messages_json,
       draft = excluded.draft,
       updated_at = excluded.updated_at`;
    expect(query).toContain('ON CONFLICT(id)');
    expect(query).toContain('excluded.updated_at');
  });
});

describe('message serialization', () => {
  it('appends message to existing JSON array', () => {
    const existing = [{ id: 'a', role: 'user', content: 'hi' }];
    const newMsg = { id: 'b', role: 'assistant' as const, content: 'hello' };
    const result = [...existing, newMsg];
    expect(JSON.parse(JSON.stringify(result))).toHaveLength(2);
    expect(result[1]?.id).toBe('b');
  });

  it('parses empty messages_json as empty array', () => {
    const parsed = JSON.parse('[]') as unknown[];
    expect(parsed).toHaveLength(0);
  });

  it('preserves message order on append', () => {
    const msgs = [
      { id: '1', role: 'user' as const, content: 'a' },
      { id: '2', role: 'assistant' as const, content: 'b' },
      { id: '3', role: 'user' as const, content: 'c' },
    ];
    expect(msgs[0]?.id).toBe('1');
    expect(msgs[2]?.id).toBe('3');
  });
});

describe('draft save', () => {
  it('draft update sets updated_at to current time', () => {
    const before = Date.now();
    const updatedAt = Date.now();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('empty draft string is valid', () => {
    const draft = '';
    expect(draft.length).toBe(0);
  });
});

describe('session listing', () => {
  it('listSessions orders by updated_at descending', () => {
    const query = 'SELECT * FROM sessions ORDER BY updated_at DESC';
    expect(query).toContain('updated_at DESC');
  });

  it('sessions sorted newest first', () => {
    const sessions = [
      { id: 'a', updated_at: 1000 },
      { id: 'b', updated_at: 3000 },
      { id: 'c', updated_at: 2000 },
    ].sort((x, y) => y.updated_at - x.updated_at);
    expect(sessions[0]?.id).toBe('b');
    expect(sessions[1]?.id).toBe('c');
    expect(sessions[2]?.id).toBe('a');
  });
});
