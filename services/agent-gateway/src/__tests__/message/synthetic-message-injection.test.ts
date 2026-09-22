import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';
import type * as SyntheticInjectionModule from '../../message/synthetic-message-injection.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'synthetic-injection-test-secret-1234567890';

let dbModule: typeof DbModule;
let adapter: typeof MessageV2AdapterModule;
let injection: typeof SyntheticInjectionModule;

const USER_ID = 'u-synthetic-injection';
const SESSION_ID = 'sess-synthetic-injection';

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  adapter = await import('../../message/message-v2-adapter.js');
  injection = await import('../../message/synthetic-message-injection.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'synthetic-injection@example.test',
    'x',
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', 'idle', '{}', ?)`,
    [SESSION_ID, USER_ID, SESSION_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM part_v2 WHERE session_id = ?', [SESSION_ID]);
  dbModule.sqliteRun('DELETE FROM message_v2 WHERE session_id = ?', [SESSION_ID]);
  dbModule.sqliteRun('DELETE FROM session_messages WHERE session_id = ?', [SESSION_ID]);
});

function inject(notificationId: string, description?: string) {
  return injection.injectSyntheticSessionMessage({
    sessionId: SESSION_ID,
    userId: USER_ID,
    notificationId,
    text: '子代理已完成 · 审计会话唤醒原语',
    ...(description !== undefined ? { description } : {}),
    metadata: {
      source: 'subagent',
      childID: 'child-1',
      agent: 'explore',
      state: 'done',
    },
  });
}

describe('injectSyntheticSessionMessage', () => {
  it('首次注入写入一条 synthetic 消息并保留通知契约', () => {
    const result = inject('task-job:notif-1', '审计会话唤醒原语');

    expect(result.created).toBe(true);
    expect(result.messageId).toBe('task-job:notif-1');

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'task-job:notif-1',
      role: 'synthetic',
      description: '审计会话唤醒原语',
      metadata: {
        source: 'subagent',
        childID: 'child-1',
        agent: 'explore',
        state: 'done',
      },
    });
    expect(messages[0]?.content).toEqual([
      { type: 'text', text: '子代理已完成 · 审计会话唤醒原语', synthetic: true },
    ]);
  });

  it('同一通知身份重复注入是幂等空操作，不产生重复行', () => {
    const first = inject('task-job:notif-2', '重复投递');
    const second = inject('task-job:notif-2', '重复投递');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.messageId).toBe(first.messageId);

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    expect(messages).toHaveLength(1);
  });

  it('不同通知身份各自写入，互不覆盖', () => {
    inject('task-job:notif-3', '第一个');
    inject('task-job:notif-4', '第二个');

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    expect(messages.map((message) => message.id).sort()).toEqual([
      'task-job:notif-3',
      'task-job:notif-4',
    ]);
  });

  it('注入本身不产生 assistant/tool 消息，也不触发模型轮次', () => {
    inject('task-job:notif-5');

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    expect(messages.every((message) => message.role === 'synthetic')).toBe(true);
  });

  it('failed 通知允许空描述仍可读取（正文非空）', () => {
    injection.injectSyntheticSessionMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      notificationId: 'task-job:notif-6',
      text: '子代理已失败',
      metadata: { source: 'subagent', childID: 'child-9', state: 'failed' },
    });

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('synthetic');
    expect(messages[0]?.description).toBeUndefined();
  });
});
