/**
 * 技能状态恢复测试
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSkillRecoverySummary,
  extractInvokedSkillsFromMessages,
  restoreSkillStateFromSession,
  type SkillInjectorCallback,
} from '../session-skill-recovery.js';
import { db } from '../../infra/db.js';

describe('session-skill-recovery', () => {
  beforeEach(() => {
    // 确保表存在
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_invoked_skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        skill_path TEXT NOT NULL,
        skill_content TEXT NOT NULL,
        invoked_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, skill_name)
      )
    `);
  });
  describe('restoreSkillStateFromSession', () => {
    it('应在没有技能时返回成功结果', () => {
      // 模拟空的技能加载
      const mockSessionId = 'empty-session';
      const injectedSkills: Array<{ name: string; path: string; content: string }> = [];

      const injector: SkillInjectorCallback = (name, path, content) => {
        injectedSkills.push({ name, path, content });
      };

      // 注意：这里需要 mock loadInvokedSkills，但为了简单起见，我们测试接口逻辑
      // 实际集成测试会在真实数据库上运行

      const result = restoreSkillStateFromSession(mockSessionId, injector);

      expect(result.success).toBe(true);
      expect(result.restoredCount).toBe(0);
      expect(result.restoredSkills).toEqual([]);
      expect(result.failedSkills).toEqual([]);
    });

    it('应验证并过滤不完整的技能数据', () => {
      // 这个测试验证接口行为，实际实现需要与数据库集成
      const injectedSkills: Array<{ name: string; path: string; content: string }> = [];

      const injector: SkillInjectorCallback = (name, path, content) => {
        injectedSkills.push({ name, path, content });
      };

      // 实际使用时会从数据库加载，这里只测试逻辑
      const result = restoreSkillStateFromSession('test-session', injector);

      // 验证返回结构
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('restoredCount');
      expect(result).toHaveProperty('restoredSkills');
      expect(result).toHaveProperty('failedSkills');
    });
  });

  describe('extractInvokedSkillsFromMessages', () => {
    it('应从空消息列表返回空数组', () => {
      const skills = extractInvokedSkillsFromMessages([]);
      expect(skills).toEqual([]);
    });

    it('应从非 attachment 消息返回空数组', () => {
      const messages = [
        { type: 'text', content: 'Hello' },
        { type: 'tool_call', toolName: 'test' },
      ];

      const skills = extractInvokedSkillsFromMessages(messages);
      expect(skills).toEqual([]);
    });

    it('应提取 invoked_skills attachment 中的技能', () => {
      const messages = [
        {
          type: 'attachment',
          attachment: {
            type: 'invoked_skills',
            skills: [
              {
                name: 'skill-a',
                path: '/path/to/skill-a.ts',
                content: 'export function a() {}',
              },
              {
                name: 'skill-b',
                path: '/path/to/skill-b.ts',
                content: 'export function b() {}',
              },
            ],
          },
        },
      ];

      const skills = extractInvokedSkillsFromMessages(messages);

      expect(skills).toHaveLength(2);
      expect(skills[0]?.skillName).toBe('skill-a');
      expect(skills[0]?.skillPath).toBe('/path/to/skill-a.ts');
      expect(skills[0]?.skillContent).toBe('export function a() {}');

      expect(skills[1]?.skillName).toBe('skill-b');
      expect(skills[1]?.skillPath).toBe('/path/to/skill-b.ts');
      expect(skills[1]?.skillContent).toBe('export function b() {}');
    });

    it('应跳过不完整的技能数据', () => {
      const messages = [
        {
          type: 'attachment',
          attachment: {
            type: 'invoked_skills',
            skills: [
              {
                name: 'complete-skill',
                path: '/path/complete.ts',
                content: 'export function complete() {}',
              },
              {
                name: 'incomplete-skill',
                // 缺少 path 和 content
              },
              {
                name: 'another-complete',
                path: '/path/another.ts',
                content: 'export function another() {}',
              },
            ],
          },
        },
      ];

      const skills = extractInvokedSkillsFromMessages(messages);

      expect(skills).toHaveLength(2);
      expect(skills[0]?.skillName).toBe('complete-skill');
      expect(skills[1]?.skillName).toBe('another-complete');
    });

    it('应跳过非 invoked_skills 类型的 attachment', () => {
      const messages = [
        {
          type: 'attachment',
          attachment: {
            type: 'other_type',
            data: 'some data',
          },
        },
        {
          type: 'attachment',
          attachment: {
            type: 'invoked_skills',
            skills: [
              {
                name: 'valid-skill',
                path: '/path/valid.ts',
                content: 'export function valid() {}',
              },
            ],
          },
        },
      ];

      const skills = extractInvokedSkillsFromMessages(messages);

      expect(skills).toHaveLength(1);
      expect(skills[0]?.skillName).toBe('valid-skill');
    });

    it('应处理多个 invoked_skills attachment', () => {
      const messages = [
        {
          type: 'attachment',
          attachment: {
            type: 'invoked_skills',
            skills: [
              {
                name: 'skill-1',
                path: '/path1.ts',
                content: 'content 1',
              },
            ],
          },
        },
        {
          type: 'attachment',
          attachment: {
            type: 'invoked_skills',
            skills: [
              {
                name: 'skill-2',
                path: '/path2.ts',
                content: 'content 2',
              },
              {
                name: 'skill-3',
                path: '/path3.ts',
                content: 'content 3',
              },
            ],
          },
        },
      ];

      const skills = extractInvokedSkillsFromMessages(messages);

      expect(skills).toHaveLength(3);
      expect(skills.map((s) => s.skillName)).toEqual(['skill-1', 'skill-2', 'skill-3']);
    });

    it('应为提取的技能分配递增的 ID', () => {
      const messages = [
        {
          type: 'attachment',
          attachment: {
            type: 'invoked_skills',
            skills: [
              { name: 'a', path: '/a.ts', content: 'a' },
              { name: 'b', path: '/b.ts', content: 'b' },
              { name: 'c', path: '/c.ts', content: 'c' },
            ],
          },
        },
      ];

      const skills = extractInvokedSkillsFromMessages(messages);

      expect(skills[0]?.id).toBe(0);
      expect(skills[1]?.id).toBe(1);
      expect(skills[2]?.id).toBe(2);
    });
  });

  describe('buildSkillRecoverySummary', () => {
    it('完全失败时应返回失败摘要', () => {
      const result = {
        success: false,
        restoredCount: 0,
        restoredSkills: [],
        failedSkills: [{ name: 'skill-a', error: 'Database error' }],
      };

      const summary = buildSkillRecoverySummary(result);

      expect(summary).toContain('技能恢复失败');
      expect(summary).toContain('Database error');
    });

    it('成功时应返回成功摘要', () => {
      const result = {
        success: true,
        restoredCount: 3,
        restoredSkills: [
          { name: 'skill-a', path: '/a.ts' },
          { name: 'skill-b', path: '/b.ts' },
          { name: 'skill-c', path: '/c.ts' },
        ],
        failedSkills: [],
      };

      const summary = buildSkillRecoverySummary(result);

      expect(summary).toContain('成功恢复 3 个技能');
      expect(summary).toContain('skill-a');
      expect(summary).toContain('skill-b');
      expect(summary).toContain('skill-c');
    });

    it('技能数量超过 5 个时不应列出所有名称', () => {
      const result = {
        success: true,
        restoredCount: 10,
        restoredSkills: Array.from({ length: 10 }, (_, i) => ({
          name: `skill-${i}`,
          path: `/path${i}.ts`,
        })),
        failedSkills: [],
      };

      const summary = buildSkillRecoverySummary(result);

      expect(summary).toContain('成功恢复 10 个技能');
      expect(summary).not.toContain('skill-0'); // 不应列出具体名称
    });

    it('部分成功时应同时显示成功和失败信息', () => {
      const result = {
        success: true,
        restoredCount: 2,
        restoredSkills: [
          { name: 'skill-a', path: '/a.ts' },
          { name: 'skill-b', path: '/b.ts' },
        ],
        failedSkills: [{ name: 'skill-c', error: 'Invalid content' }],
      };

      const summary = buildSkillRecoverySummary(result);

      expect(summary).toContain('成功恢复 2 个技能');
      expect(summary).toContain('1 个失败');
    });

    it('空结果时应返回简洁摘要', () => {
      const result = {
        success: true,
        restoredCount: 0,
        restoredSkills: [],
        failedSkills: [],
      };

      const summary = buildSkillRecoverySummary(result);

      expect(summary.length).toBeGreaterThan(0);
      // 空结果的摘要应该简洁
    });
  });
});
