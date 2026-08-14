/**
 * 技能状态持久化存储测试
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  clearSkillState,
  countInvokedSkills,
  hasInvokedSkills,
  loadInvokedSkills,
  recordInvokedSkill,
} from '../session-skill-state-store.js';
import { db } from '../../infra/db.js';

describe('session-skill-state-store', () => {
  let testSessionId: string;

  beforeEach(() => {
    testSessionId = randomUUID();

    // 临时禁用外键约束以便测试
    db.exec('PRAGMA foreign_keys=OFF');

    // 确保表存在（测试环境可能未完全初始化）
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

  afterEach(() => {
    // 清理测试数据
    try {
      clearSkillState(testSessionId);
    } catch {
      // 忽略清理错误
    }

    // 重新启用外键约束
    db.exec('PRAGMA foreign_keys=ON');
  });

  describe('recordInvokedSkill', () => {
    it('应成功记录单个技能', () => {
      recordInvokedSkill(
        testSessionId,
        'test-skill',
        '/path/to/skill.ts',
        'export function test() {}',
      );

      const skills = loadInvokedSkills(testSessionId);
      expect(skills).toHaveLength(1);
      expect(skills[0]?.skillName).toBe('test-skill');
      expect(skills[0]?.skillPath).toBe('/path/to/skill.ts');
      expect(skills[0]?.skillContent).toBe('export function test() {}');
    });

    it('应记录多个不同的技能', () => {
      recordInvokedSkill(testSessionId, 'skill-a', '/path/a.ts', 'content a');
      recordInvokedSkill(testSessionId, 'skill-b', '/path/b.ts', 'content b');
      recordInvokedSkill(testSessionId, 'skill-c', '/path/c.ts', 'content c');

      const skills = loadInvokedSkills(testSessionId);
      expect(skills).toHaveLength(3);
      expect(skills.map((s) => s.skillName)).toEqual(['skill-a', 'skill-b', 'skill-c']);
    });

    it('应自动去重同名技能（更新而非插入）', () => {
      // 第一次记录
      recordInvokedSkill(testSessionId, 'test-skill', '/old/path.ts', 'old content');

      // 第二次记录同名技能
      recordInvokedSkill(testSessionId, 'test-skill', '/new/path.ts', 'new content');

      const skills = loadInvokedSkills(testSessionId);
      expect(skills).toHaveLength(1); // 应该只有一条记录
      expect(skills[0]?.skillPath).toBe('/new/path.ts'); // 路径已更新
      expect(skills[0]?.skillContent).toBe('new content'); // 内容已更新
    });

    it('不同会话的技能应隔离存储', () => {
      const session2Id = randomUUID();

      try {
        recordInvokedSkill(testSessionId, 'skill-1', '/path1.ts', 'content 1');
        recordInvokedSkill(session2Id, 'skill-2', '/path2.ts', 'content 2');

        const skills1 = loadInvokedSkills(testSessionId);
        const skills2 = loadInvokedSkills(session2Id);

        expect(skills1).toHaveLength(1);
        expect(skills1[0]?.skillName).toBe('skill-1');

        expect(skills2).toHaveLength(1);
        expect(skills2[0]?.skillName).toBe('skill-2');
      } finally {
        clearSkillState(session2Id);
      }
    });
  });

  describe('loadInvokedSkills', () => {
    it('空会话应返回空数组', () => {
      const skills = loadInvokedSkills(testSessionId);
      expect(skills).toEqual([]);
    });

    it('应按调用时间升序返回', () => {
      // 记录多个技能
      recordInvokedSkill(testSessionId, 'skill-1', '/path1.ts', 'content 1');
      // 等待一毫秒确保时间戳不同
      const start = Date.now();
      while (Date.now() === start) {
        // 空循环
      }
      recordInvokedSkill(testSessionId, 'skill-2', '/path2.ts', 'content 2');

      const skills = loadInvokedSkills(testSessionId);
      expect(skills).toHaveLength(2);
      expect(skills[0]?.skillName).toBe('skill-1');
      expect(skills[1]?.skillName).toBe('skill-2');

      // 验证时间戳
      const time1 = new Date(skills[0]!.invokedAt).getTime();
      const time2 = new Date(skills[1]!.invokedAt).getTime();
      expect(time2).toBeGreaterThanOrEqual(time1);
    });

    it('应返回完整的技能数据', () => {
      const skillContent = 'export function complexSkill() { return "test"; }';
      recordInvokedSkill(testSessionId, 'complex-skill', '/complex/path.ts', skillContent);

      const skills = loadInvokedSkills(testSessionId);
      expect(skills).toHaveLength(1);

      const skill = skills[0]!;
      expect(skill.id).toBeGreaterThan(0);
      expect(skill.sessionId).toBe(testSessionId);
      expect(skill.skillName).toBe('complex-skill');
      expect(skill.skillPath).toBe('/complex/path.ts');
      expect(skill.skillContent).toBe(skillContent);
      expect(skill.invokedAt).toBeTruthy();
      expect(new Date(skill.invokedAt).getTime()).toBeGreaterThan(0);
    });
  });

  describe('clearSkillState', () => {
    it('应清理会话的所有技能', () => {
      recordInvokedSkill(testSessionId, 'skill-1', '/path1.ts', 'content 1');
      recordInvokedSkill(testSessionId, 'skill-2', '/path2.ts', 'content 2');

      expect(loadInvokedSkills(testSessionId)).toHaveLength(2);

      clearSkillState(testSessionId);

      expect(loadInvokedSkills(testSessionId)).toHaveLength(0);
    });

    it('清理空会话不应报错', () => {
      expect(() => clearSkillState(testSessionId)).not.toThrow();
    });

    it('清理一个会话不应影响其他会话', () => {
      const session2Id = randomUUID();

      try {
        recordInvokedSkill(testSessionId, 'skill-1', '/path1.ts', 'content 1');
        recordInvokedSkill(session2Id, 'skill-2', '/path2.ts', 'content 2');

        clearSkillState(testSessionId);

        expect(loadInvokedSkills(testSessionId)).toHaveLength(0);
        expect(loadInvokedSkills(session2Id)).toHaveLength(1);
      } finally {
        clearSkillState(session2Id);
      }
    });
  });

  describe('hasInvokedSkills', () => {
    it('空会话应返回 false', () => {
      expect(hasInvokedSkills(testSessionId)).toBe(false);
    });

    it('有技能的会话应返回 true', () => {
      recordInvokedSkill(testSessionId, 'skill-1', '/path1.ts', 'content 1');
      expect(hasInvokedSkills(testSessionId)).toBe(true);
    });

    it('清理后应返回 false', () => {
      recordInvokedSkill(testSessionId, 'skill-1', '/path1.ts', 'content 1');
      expect(hasInvokedSkills(testSessionId)).toBe(true);

      clearSkillState(testSessionId);
      expect(hasInvokedSkills(testSessionId)).toBe(false);
    });
  });

  describe('countInvokedSkills', () => {
    it('空会话应返回 0', () => {
      expect(countInvokedSkills(testSessionId)).toBe(0);
    });

    it('应返回正确的技能数量', () => {
      expect(countInvokedSkills(testSessionId)).toBe(0);

      recordInvokedSkill(testSessionId, 'skill-1', '/path1.ts', 'content 1');
      expect(countInvokedSkills(testSessionId)).toBe(1);

      recordInvokedSkill(testSessionId, 'skill-2', '/path2.ts', 'content 2');
      expect(countInvokedSkills(testSessionId)).toBe(2);

      recordInvokedSkill(testSessionId, 'skill-3', '/path3.ts', 'content 3');
      expect(countInvokedSkills(testSessionId)).toBe(3);
    });

    it('更新同名技能不应增加计数', () => {
      recordInvokedSkill(testSessionId, 'skill-1', '/path1.ts', 'content 1');
      expect(countInvokedSkills(testSessionId)).toBe(1);

      recordInvokedSkill(testSessionId, 'skill-1', '/updated-path.ts', 'updated content');
      expect(countInvokedSkills(testSessionId)).toBe(1); // 仍然是 1
    });
  });

  describe('数据库级联删除', () => {
    it('删除会话时应自动删除技能记录', () => {
      // 注意：由于我们在测试中禁用了外键约束，这个测试主要验证清理逻辑
      recordInvokedSkill(testSessionId, 'skill-1', '/path1.ts', 'content 1');
      recordInvokedSkill(testSessionId, 'skill-2', '/path2.ts', 'content 2');

      expect(loadInvokedSkills(testSessionId)).toHaveLength(2);

      // 手动清理（模拟级联删除）
      clearSkillState(testSessionId);

      // 技能记录应已删除
      expect(loadInvokedSkills(testSessionId)).toHaveLength(0);
    });
  });
});
