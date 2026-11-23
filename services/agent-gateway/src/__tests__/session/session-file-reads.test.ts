import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, connectDb, migrate, sqliteAll, sqliteRun } from '../../infra/db.js';
import {
  hasFileReadEvidence,
  recordFileRead,
  recordFileReadFromToolOutput,
} from '../../session/session-file-reads.js';

const SESSION_ID = 'reads-session';
const OTHER_SESSION_ID = 'reads-other-session';

let requestCounter = 0;

beforeAll(async () => {
  await connectDb();
  await migrate();
});

beforeEach(() => {
  // audit_logs.session_id 是 ON DELETE SET NULL，必须在删 sessions 之前清掉，
  // 否则残留行会以 `session_id = NULL` 的形式跨用例累积。
  sqliteRun('DELETE FROM session_file_reads');
  sqliteRun('DELETE FROM audit_logs');
  sqliteRun('DELETE FROM sessions');
  sqliteRun('DELETE FROM users');
  sqliteRun(
    "INSERT INTO users (id, email, password_hash) VALUES ('reads-user', 'reads@example.test', 'hash')",
  );
  sqliteRun("INSERT INTO sessions (id, user_id, metadata_json) VALUES (?, 'reads-user', '{}')", [
    SESSION_ID,
  ]);
  sqliteRun("INSERT INTO sessions (id, user_id, metadata_json) VALUES (?, 'reads-user', '{}')", [
    OTHER_SESSION_ID,
  ]);
  requestCounter = 0;
});

afterAll(async () => {
  await closeDb();
});

/** 造一条历史 `read` 审计行（模拟升级前 / 未经专用表记账的读取）。 */
function seedLegacyRead(input: {
  path: string;
  sessionId?: string;
  isError?: number;
  toolName?: string;
}): void {
  requestCounter += 1;
  const requestId = `legacy-request-${requestCounter}`;
  const payload = JSON.stringify({ path: input.path });
  sqliteRun(
    `INSERT INTO audit_logs (session_id, tool_name, request_id, input_json, output_json, is_error)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.sessionId ?? SESSION_ID,
      input.toolName ?? 'read',
      requestId,
      payload,
      payload,
      input.isError ?? 0,
    ],
  );
}

describe('read 证据：专用表记账', () => {
  it('记录后可命中，未记录时为 false', () => {
    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/a.ts')).toBe(false);
    recordFileRead(SESSION_ID, '/repo/src/a.ts');
    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/a.ts')).toBe(true);
    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/b.ts')).toBe(false);
  });

  it('证据按会话隔离', () => {
    recordFileRead(SESSION_ID, '/repo/src/a.ts');
    expect(hasFileReadEvidence(OTHER_SESSION_ID, '/repo/src/a.ts')).toBe(false);
  });

  it('重复读同一文件保持幂等（主键 upsert，不堆行）', () => {
    recordFileRead(SESSION_ID, '/repo/src/c.ts');
    recordFileRead(SESSION_ID, '/repo/src/c.ts');
    recordFileRead(SESSION_ID, '/repo/src/c.ts');
    const rows = sqliteAll<{ path: string }>(
      'SELECT path FROM session_file_reads WHERE session_id = ?',
      [SESSION_ID],
    );
    expect(rows).toHaveLength(1);
  });

  it('空 sessionId / 空路径不写入也不抛错', () => {
    expect(() => recordFileRead('', '/repo/src/a.ts')).not.toThrow();
    expect(() => recordFileRead(SESSION_ID, '')).not.toThrow();
    expect(hasFileReadEvidence('', '/repo/src/a.ts')).toBe(false);
    expect(hasFileReadEvidence(SESSION_ID, '')).toBe(false);
  });
});

describe('read 证据：原缺陷回归（50 条审计窗口）', () => {
  it('读过目标文件后又跑了 60 次 read，仍能命中（不再被窗口挤出）', () => {
    // 修复前的实现只扫 audit_logs 最近 50 条 read 行，这一串噪音会把证据挤出去。
    recordFileRead(SESSION_ID, '/repo/src/target.ts');
    for (let index = 0; index < 60; index += 1) {
      seedLegacyRead({ path: `/repo/src/noise-${index}.ts` });
    }

    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/target.ts')).toBe(true);
  });

  it('旧会话的 read 在 200 条噪音之后仍被兜底窗口认下', () => {
    seedLegacyRead({ path: '/repo/src/legacy.ts' });
    for (let index = 0; index < 200; index += 1) {
      seedLegacyRead({ path: `/repo/src/noise-${index}.ts` });
    }

    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/legacy.ts')).toBe(true);
  });

  it('兜底窗口保留上限：超过 500 条后不再命中（避免全表扫）', () => {
    seedLegacyRead({ path: '/repo/src/legacy.ts' });
    for (let index = 0; index < 520; index += 1) {
      seedLegacyRead({ path: `/repo/src/noise-${index}.ts` });
    }

    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/legacy.ts')).toBe(false);
  });
});

describe('read 证据：只认成功的 read', () => {
  it('失败的 read 不计入证据', () => {
    seedLegacyRead({ path: '/repo/src/failed.ts', isError: 1 });
    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/failed.ts')).toBe(false);
  });

  it('非 read 工具的审计行不计入证据', () => {
    seedLegacyRead({ path: '/repo/src/grep-only.ts', toolName: 'grep' });
    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/grep-only.ts')).toBe(false);
  });
});

describe('recordFileReadFromToolOutput：从 read 输出取归一化路径', () => {
  it('输出含 path 时记账，与 edit 侧传的绝对路径口径一致', () => {
    recordFileReadFromToolOutput(SESSION_ID, {
      path: '/repo/src/b.ts',
      content: 'export {};',
      truncated: false,
    });
    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/b.ts')).toBe(true);
  });

  it('非对象 / 缺 path / 数组输出不记账也不抛错', () => {
    expect(() => recordFileReadFromToolOutput(SESSION_ID, null)).not.toThrow();
    expect(() => recordFileReadFromToolOutput(SESSION_ID, 'plain text')).not.toThrow();
    expect(() => recordFileReadFromToolOutput(SESSION_ID, ['/repo/src/x.ts'])).not.toThrow();
    expect(() => recordFileReadFromToolOutput(SESSION_ID, { content: 'x' })).not.toThrow();
    expect(() => recordFileReadFromToolOutput(SESSION_ID, { path: '' })).not.toThrow();

    expect(hasFileReadEvidence(SESSION_ID, 'plain text')).toBe(false);
    expect(hasFileReadEvidence(SESSION_ID, '/repo/src/x.ts')).toBe(false);
  });
});
