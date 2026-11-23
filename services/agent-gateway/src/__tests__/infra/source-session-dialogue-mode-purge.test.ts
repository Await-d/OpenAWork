/**
 * 存量清洗：来源托管会话（渠道 / 定时任务）metadata 里的 `dialogueMode` 脏键必须被剥掉。
 *
 * 成因：网页端此前用同一个 ChatPage 打开渠道会话，顶栏渲染出**可写**的「澄清 / 编程 /
 * 程序员」切换器 —— 而这两类会话从不写该字段（工具面由渠道 allowlist / permissions 或
 * 定时任务自身配置决定）。读取时的回退值被当成真值展示，于是任何一次 metadata 写入
 *（换模型、切权限档）都会把界面上的假模式落库。该值一旦是 `clarify`，网关的澄清只读
 * 白名单（`clarify-mode-tool-policy`，不含任何渠道回复工具）就会把该会话在渠道侧的回复
 * 能力整套收敛掉 —— 表现为「渠道里再也回不了消息」。
 *
 * 写入侧已封堵（前端不再渲染该切换器 + `buildSessionMetadata` 省略该键 + PATCH 字段级
 * 拒写），本文件钉住存量清洗这一步。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'source-dialogue-purge-secret-1234567890';

const MARKER_KEY = 'source_session_dialogue_mode_purge_v1';
const USER_ID = 'u-source-purge';

let dbModule: typeof DbModule;

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'source-purge@example.test',
    'x',
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions');
  // 一次性函数：每个用例前摘掉标记重新武装（本函数自身幂等性另有断言）。
  dbModule.sqliteRun('DELETE FROM app_meta WHERE key = ?', [MARKER_KEY]);
});

function seedSession(sessionId: string, metadata: Record<string, unknown>): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', 'idle', ?, ?)`,
    [sessionId, USER_ID, JSON.stringify(metadata), sessionId],
  );
}

function readMetadata(sessionId: string): Record<string, unknown> {
  const row = dbModule.sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ?',
    [sessionId],
  );
  return JSON.parse(row?.metadata_json ?? '{}') as Record<string, unknown>;
}

describe('purgeDialogueModeFromSourceSessions', () => {
  it('剥掉渠道 / 定时任务会话的 dialogueMode，其余字段原样保留', () => {
    seedSession('sess-channel', {
      source: 'channel',
      channelChatId: 'chat-1',
      channel: { id: 'p1', type: 'feishu', name: '飞书研发群' },
      dialogueMode: 'clarify',
      permissionMode: 'yolo',
    });
    seedSession('sess-cron', { source: 'cron', cronJobId: 'job-1', dialogueMode: 'programmer' });

    dbModule.purgeDialogueModeFromSourceSessions();

    const channel = readMetadata('sess-channel');
    expect(channel['dialogueMode']).toBeUndefined();
    expect(channel).toMatchObject({
      source: 'channel',
      channelChatId: 'chat-1',
      permissionMode: 'yolo',
    });
    // 渠道身份（含渠道名）必须逐字保留：它同时是前端展示定语与渠道策略的判定依据。
    expect(channel['channel']).toEqual({ id: 'p1', type: 'feishu', name: '飞书研发群' });

    expect(readMetadata('sess-cron')['dialogueMode']).toBeUndefined();
    expect(readMetadata('sess-cron')['cronJobId']).toBe('job-1');
  });

  it('普通会话 / 子代理 / 团队会话的 dialogueMode 不得被动', () => {
    seedSession('sess-plain', { dialogueMode: 'clarify' });
    seedSession('sess-desktop', { source: 'desktop', dialogueMode: 'programmer' });
    // 子代理与团队会话只带 parent 关系、不带 source —— 不能被误判成来源会话。
    seedSession('sess-child', { dialogueMode: 'coding', parentSessionId: 'p-1' });
    seedSession('sess-team', { dialogueMode: 'coding', teamWorkspaceId: 'ws-1' });

    dbModule.purgeDialogueModeFromSourceSessions();

    expect(readMetadata('sess-plain')['dialogueMode']).toBe('clarify');
    expect(readMetadata('sess-desktop')['dialogueMode']).toBe('programmer');
    expect(readMetadata('sess-child')['dialogueMode']).toBe('coding');
    expect(readMetadata('sess-team')['dialogueMode']).toBe('coding');
  });

  it('`"dialogueMode": null` 这类残留同样被清掉（json_type 区分「缺失」与「JSON null」）', () => {
    seedSession('sess-null-value', { source: 'channel', dialogueMode: null, channelChatId: 'c1' });

    dbModule.purgeDialogueModeFromSourceSessions();

    const metadata = readMetadata('sess-null-value');
    expect(Object.hasOwn(metadata, 'dialogueMode')).toBe(false);
    expect(metadata['channelChatId']).toBe('c1');
  });

  it('畸形 / 非对象 metadata 安全跳过，不影响其它行', () => {
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
       VALUES (?, ?, '[]', 'idle', ?, 'bad')`,
      ['sess-broken-json', USER_ID, '{not json'],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
       VALUES (?, ?, '[]', 'idle', ?, 'null')`,
      ['sess-null-json', USER_ID, 'null'],
    );
    seedSession('sess-ok', { source: 'channel', dialogueMode: 'clarify' });

    expect(() => dbModule.purgeDialogueModeFromSourceSessions()).not.toThrow();

    // 损坏行原样保留（json_valid 守卫），合法行照常清理。
    const broken = dbModule.sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ?',
      ['sess-broken-json'],
    );
    expect(broken?.metadata_json).toBe('{not json');
    expect(readMetadata('sess-ok')['dialogueMode']).toBeUndefined();
  });

  it('落 app_meta 标记并幂等：二次调用直接短路', () => {
    seedSession('sess-channel', { source: 'channel', dialogueMode: 'clarify' });

    dbModule.purgeDialogueModeFromSourceSessions();
    expect(dbModule.getAppMetaValue(MARKER_KEY)).toBe('done');

    // 标记已落 + 函数短路：此后再出现的脏行不会被（也不会需要）再次清扫。
    seedSession('sess-later', { source: 'channel', dialogueMode: 'clarify' });
    expect(() => dbModule.purgeDialogueModeFromSourceSessions()).not.toThrow();
    expect(readMetadata('sess-later')['dialogueMode']).toBe('clarify');
  });

  it('无脏行时同样落标记，避免每次启动都扫一遍 sessions', () => {
    seedSession('sess-clean', { source: 'channel', channelChatId: 'c1' });

    dbModule.purgeDialogueModeFromSourceSessions();

    expect(dbModule.getAppMetaValue(MARKER_KEY)).toBe('done');
    expect(readMetadata('sess-clean')['dialogueMode']).toBeUndefined();
  });
});
