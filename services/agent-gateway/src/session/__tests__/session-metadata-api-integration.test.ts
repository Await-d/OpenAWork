/**
 * 会话元数据 API 集成测试
 * 验证新增的 10 个元数据字段能正确通过 API 返回
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate, sqliteGet, sqliteRun } from '../../infra/db.js';
import { toPublicSessionResponse } from '../../routes/session-route-helpers.js';
import type { SessionRow } from '../../routes/sessions.js';

describe('session-metadata-api-integration', () => {
  let testSessionId: string;
  const testUserId = 'test-user-api-metadata';

  beforeAll(async () => {
    await migrate();
  });

  beforeEach(() => {
    testSessionId = randomUUID();

    const existingUser = sqliteGet<{ id: string }>('SELECT id FROM users WHERE id = ?', [
      testUserId,
    ]);

    if (!existingUser) {
      sqliteRun(
        `INSERT INTO users (id, email, password_hash, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [testUserId, 'test-api@example.com', 'test-hash'],
      );
    }
  });

  afterEach(() => {
    sqliteRun('DELETE FROM sessions WHERE id = ?', [testSessionId]);
  });

  describe('toPublicSessionResponse 序列化', () => {
    it('应正确序列化所有新增的元数据字段', () => {
      // 创建包含所有元数据的会话
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
          JSON.stringify({ modelId: 'claude-3-5-sonnet' }),
          'api-test-agent',
          '#FF6B6B',
          'detailed',
          'API 测试会话',
          'integration-test',
          'coordinator',
          'wt-api-789',
          101,
          'https://github.com/org/project/pull/101',
          'org/project',
        ],
      );

      // 读取会话
      const session = sqliteGet<SessionRow>(
        `SELECT id, user_id, state_status, metadata_json, title, created_at, updated_at,
                agent_name, agent_color, agent_setting, custom_title, tag, mode,
                worktree_session, pr_number, pr_url, pr_repository
         FROM sessions WHERE id = ?`,
        [testSessionId],
      );

      expect(session).toBeDefined();

      // 使用 toPublicSessionResponse 序列化
      const response = toPublicSessionResponse(session!, [], []);

      // 验证基础字段
      expect(response.id).toBe(testSessionId);
      expect(response.state_status).toBe('idle');

      // 验证所有新增字段都被正确包含
      expect(response.agent_name).toBe('api-test-agent');
      expect(response.agent_color).toBe('#FF6B6B');
      expect(response.agent_setting).toBe('detailed');
      expect(response.custom_title).toBe('API 测试会话');
      expect(response.tag).toBe('integration-test');
      expect(response.mode).toBe('coordinator');
      expect(response.worktree_session).toBe('wt-api-789');
      expect(response.pr_number).toBe(101);
      expect(response.pr_url).toBe('https://github.com/org/project/pull/101');
      expect(response.pr_repository).toBe('org/project');
    });

    it('应正确处理部分字段为 NULL 的情况', () => {
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json,
          agent_name, pr_number,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [testSessionId, testUserId, 'idle', '{}', 'partial-agent', 42],
      );

      const session = sqliteGet<SessionRow>(
        `SELECT id, user_id, state_status, metadata_json, title, created_at, updated_at,
                agent_name, agent_color, agent_setting, custom_title, tag, mode,
                worktree_session, pr_number, pr_url, pr_repository
         FROM sessions WHERE id = ?`,
        [testSessionId],
      );

      const response = toPublicSessionResponse(session!, [], []);

      // 有值的字段应存在
      expect(response.agent_name).toBe('partial-agent');
      expect(response.pr_number).toBe(42);

      // NULL 字段应存在但值为 null
      expect('agent_color' in response).toBe(true);
      expect(response.agent_color).toBeNull();
      expect('custom_title' in response).toBe(true);
      expect(response.custom_title).toBeNull();
    });

    it('应支持旧会话（所有新字段为 NULL）的向后兼容', () => {
      sqliteRun(
        `INSERT INTO sessions (
          id, user_id, state_status, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [testSessionId, testUserId, 'idle', '{}'],
      );

      const session = sqliteGet<SessionRow>(
        `SELECT id, user_id, state_status, metadata_json, title, created_at, updated_at,
                agent_name, agent_color, agent_setting, custom_title, tag, mode,
                worktree_session, pr_number, pr_url, pr_repository
         FROM sessions WHERE id = ?`,
        [testSessionId],
      );

      const response = toPublicSessionResponse(session!, [], []);

      // 基础功能应正常工作
      expect(response.id).toBe(testSessionId);
      expect(response.state_status).toBe('idle');
      expect(response.messages).toEqual([]);

      // 所有新字段都应该存在且为 null
      expect(response.agent_name).toBeNull();
      expect(response.agent_color).toBeNull();
      expect(response.agent_setting).toBeNull();
      expect(response.custom_title).toBeNull();
      expect(response.tag).toBeNull();
      expect(response.mode).toBeNull();
      expect(response.worktree_session).toBeNull();
      expect(response.pr_number).toBeNull();
      expect(response.pr_url).toBeNull();
      expect(response.pr_repository).toBeNull();
    });
  });
});
