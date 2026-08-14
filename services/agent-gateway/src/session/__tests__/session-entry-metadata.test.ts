/**
 * 会话元数据扩展测试
 * 测试 10 个新增字段的存储、读取和序列化
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate, sqliteGet, sqliteRun } from '../../infra/db.js';
import type { SessionRow } from '../../routes/sessions.js';

describe('session-entry-metadata', () => {
  let testSessionId: string;
  const testUserId = 'test-user-metadata';

  beforeAll(async () => {
    // 初始化数据库 schema
    await migrate();
  });

  beforeEach(() => {
    testSessionId = randomUUID();

    // 确保测试用户存在
    const existingUser = sqliteGet<{ id: string }>('SELECT id FROM users WHERE id = ?', [
      testUserId,
    ]);

    if (!existingUser) {
      sqliteRun(
        `INSERT INTO users (id, email, password_hash, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [testUserId, 'test-metadata@example.com', 'test-hash'],
      );
    }
  });

  afterEach(() => {
    sqliteRun('DELETE FROM sessions WHERE id = ?', [testSessionId]);
  });

  describe('创建会话时设置元数据', () => {
    it('应支持创建会话时设置所有 10 个新字段', () => {
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json,
          agent_name, agent_color, agent_setting, custom_title, tag, mode,
          worktree_session, pr_number, pr_url, pr_repository,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          testSessionId,
          testUserId,
          'idle',
          '{}',
          'test-agent',
          '#FF5733',
          'fast',
          '自定义标题',
          'feature',
          'normal',
          'worktree-123',
          42,
          'https://github.com/user/repo/pull/42',
          'user/repo',
        ],
      );

      const session = sqliteGet<SessionRow>(
        `SELECT id, user_id, agent_name, agent_color, agent_setting, custom_title,
                tag, mode, worktree_session, pr_number, pr_url, pr_repository
         FROM sessions WHERE id = ?`,
        [testSessionId],
      );

      expect(session).toBeDefined();
      expect(session?.agent_name).toBe('test-agent');
      expect(session?.agent_color).toBe('#FF5733');
      expect(session?.agent_setting).toBe('fast');
      expect(session?.custom_title).toBe('自定义标题');
      expect(session?.tag).toBe('feature');
      expect(session?.mode).toBe('normal');
      expect(session?.worktree_session).toBe('worktree-123');
      expect(session?.pr_number).toBe(42);
      expect(session?.pr_url).toBe('https://github.com/user/repo/pull/42');
      expect(session?.pr_repository).toBe('user/repo');
    });

    it('应支持 mode 字段的 coordinator 值', () => {
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json, mode,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [testSessionId, testUserId, 'idle', '{}', 'coordinator'],
      );

      const session = sqliteGet<SessionRow>('SELECT id, mode FROM sessions WHERE id = ?', [
        testSessionId,
      ]);

      expect(session?.mode).toBe('coordinator');
    });

    it('应支持字段为 NULL 的情况（向后兼容）', () => {
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [testSessionId, testUserId, 'idle', '{}'],
      );

      const session = sqliteGet<SessionRow>(
        `SELECT id, agent_name, agent_color, agent_setting, custom_title,
                tag, mode, worktree_session, pr_number, pr_url, pr_repository
         FROM sessions WHERE id = ?`,
        [testSessionId],
      );

      expect(session).toBeDefined();
      expect(session?.agent_name).toBeNull();
      expect(session?.agent_color).toBeNull();
      expect(session?.agent_setting).toBeNull();
      expect(session?.custom_title).toBeNull();
      expect(session?.tag).toBeNull();
      expect(session?.mode).toBeNull();
      expect(session?.worktree_session).toBeNull();
      expect(session?.pr_number).toBeNull();
      expect(session?.pr_url).toBeNull();
      expect(session?.pr_repository).toBeNull();
    });
  });

  describe('更新会话元数据', () => {
    beforeEach(() => {
      // 创建初始会话
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [testSessionId, testUserId, 'idle', '{}'],
      );
    });

    it('应支持更新单个字段', () => {
      sqliteRun('UPDATE sessions SET agent_name = ? WHERE id = ?', [
        'updated-agent',
        testSessionId,
      ]);

      const session = sqliteGet<SessionRow>('SELECT agent_name FROM sessions WHERE id = ?', [
        testSessionId,
      ]);

      expect(session?.agent_name).toBe('updated-agent');
    });

    it('应支持批量更新多个字段', () => {
      sqliteRun(
        `UPDATE sessions SET
          agent_name = ?,
          agent_color = ?,
          custom_title = ?,
          tag = ?,
          mode = ?
         WHERE id = ?`,
        ['batch-agent', '#00FF00', 'Batch Title', 'bugfix', 'coordinator', testSessionId],
      );

      const session = sqliteGet<SessionRow>(
        'SELECT agent_name, agent_color, custom_title, tag, mode FROM sessions WHERE id = ?',
        [testSessionId],
      );

      expect(session?.agent_name).toBe('batch-agent');
      expect(session?.agent_color).toBe('#00FF00');
      expect(session?.custom_title).toBe('Batch Title');
      expect(session?.tag).toBe('bugfix');
      expect(session?.mode).toBe('coordinator');
    });

    it('应支持更新 PR 相关字段', () => {
      sqliteRun(
        `UPDATE sessions SET
          pr_number = ?,
          pr_url = ?,
          pr_repository = ?
         WHERE id = ?`,
        [123, 'https://github.com/test/repo/pull/123', 'test/repo', testSessionId],
      );

      const session = sqliteGet<SessionRow>(
        'SELECT pr_number, pr_url, pr_repository FROM sessions WHERE id = ?',
        [testSessionId],
      );

      expect(session?.pr_number).toBe(123);
      expect(session?.pr_url).toBe('https://github.com/test/repo/pull/123');
      expect(session?.pr_repository).toBe('test/repo');
    });

    it('应支持将字段设置为 NULL', () => {
      // 先设置值
      sqliteRun('UPDATE sessions SET agent_name = ?, agent_color = ? WHERE id = ?', [
        'temp-agent',
        '#FF0000',
        testSessionId,
      ]);

      // 再清空
      sqliteRun('UPDATE sessions SET agent_name = NULL, agent_color = NULL WHERE id = ?', [
        testSessionId,
      ]);

      const session = sqliteGet<SessionRow>(
        'SELECT agent_name, agent_color FROM sessions WHERE id = ?',
        [testSessionId],
      );

      expect(session?.agent_name).toBeNull();
      expect(session?.agent_color).toBeNull();
    });
  });

  describe('会话恢复时保留元数据', () => {
    it('应在查询时完整返回所有元数据字段', () => {
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json,
          agent_name, agent_color, agent_setting, custom_title, tag, mode,
          worktree_session, pr_number, pr_url, pr_repository,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          testSessionId,
          testUserId,
          'idle',
          '{}',
          'recovery-agent',
          '#ABCDEF',
          'balanced',
          'Recovery Test',
          'enhancement',
          'normal',
          'wt-456',
          789,
          'https://github.com/org/project/pull/789',
          'org/project',
        ],
      );

      // 模拟会话恢复查询
      const session = sqliteGet<SessionRow>(
        `SELECT id, user_id, state_status, metadata_json,
                agent_name, agent_color, agent_setting, custom_title, tag, mode,
                worktree_session, pr_number, pr_url, pr_repository,
                created_at, updated_at
         FROM sessions WHERE id = ?`,
        [testSessionId],
      );

      expect(session).toBeDefined();
      expect(session?.id).toBe(testSessionId);
      expect(session?.agent_name).toBe('recovery-agent');
      expect(session?.agent_color).toBe('#ABCDEF');
      expect(session?.agent_setting).toBe('balanced');
      expect(session?.custom_title).toBe('Recovery Test');
      expect(session?.tag).toBe('enhancement');
      expect(session?.mode).toBe('normal');
      expect(session?.worktree_session).toBe('wt-456');
      expect(session?.pr_number).toBe(789);
      expect(session?.pr_url).toBe('https://github.com/org/project/pull/789');
      expect(session?.pr_repository).toBe('org/project');
    });

    it('应支持部分字段有值、部分字段为空的混合场景', () => {
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json,
          agent_name, custom_title, pr_number,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [testSessionId, testUserId, 'idle', '{}', 'partial-agent', 'Partial Data', 100],
      );

      const session = sqliteGet<SessionRow>(
        `SELECT id, agent_name, agent_color, custom_title, tag, pr_number, pr_url
         FROM sessions WHERE id = ?`,
        [testSessionId],
      );

      expect(session?.agent_name).toBe('partial-agent');
      expect(session?.custom_title).toBe('Partial Data');
      expect(session?.pr_number).toBe(100);
      // 未设置的字段应为 NULL
      expect(session?.agent_color).toBeNull();
      expect(session?.tag).toBeNull();
      expect(session?.pr_url).toBeNull();
    });
  });

  describe('数据类型和约束验证', () => {
    it('mode 字段应拒绝非法值', () => {
      expect(() => {
        sqliteRun(
          `INSERT INTO sessions (
            id, user_id, state_status, metadata_json, mode,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [testSessionId, testUserId, 'idle', '{}', 'invalid-mode'],
        );
      }).toThrow();
    });

    it('pr_number 应为整数类型', () => {
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json, pr_number,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [testSessionId, testUserId, 'idle', '{}', 999],
      );

      const session = sqliteGet<SessionRow>('SELECT pr_number FROM sessions WHERE id = ?', [
        testSessionId,
      ]);

      expect(session?.pr_number).toBe(999);
      expect(typeof session?.pr_number).toBe('number');
    });

    it('文本字段应支持中文和特殊字符', () => {
      const specialTitle = '测试标题 🚀 with emoji & symbols @#$%';
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json, custom_title,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [testSessionId, testUserId, 'idle', '{}', specialTitle],
      );

      const session = sqliteGet<SessionRow>('SELECT custom_title FROM sessions WHERE id = ?', [
        testSessionId,
      ]);

      expect(session?.custom_title).toBe(specialTitle);
    });
  });
});
