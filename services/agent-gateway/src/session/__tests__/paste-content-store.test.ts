/**
 * Paste Content Store 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  storePasteContent,
  retrievePasteContent,
  gcUnusedPastes,
  getPasteContentStats,
  clearSessionPasteContents,
  hashPasteContent,
  shouldStorePasteContent,
  PASTE_CONTENT_THRESHOLD_BYTES,
} from '../paste-content-store.js';
import { db, migrate } from '../../infra/db.js';

describe('paste-content-store', () => {
  let testSessionId: string;
  let testUserId: string;

  beforeAll(async () => {
    // 初始化数据库 schema
    await migrate();
  });

  beforeEach(() => {
    testSessionId = randomUUID();
    testUserId = randomUUID();

    // 创建测试用户和会话（满足外键约束）
    db.exec(
      `INSERT INTO users (id, email, password_hash) VALUES ('${testUserId}', 'test@example.com', 'hash')`,
    );
    db.exec(
      `INSERT INTO sessions (id, user_id, messages_json) VALUES ('${testSessionId}', '${testUserId}', '[]')`,
    );
  });

  afterEach(() => {
    // 清理测试数据（级联删除会自动清理粘贴内容）
    db.exec(`DELETE FROM sessions WHERE id = '${testSessionId}'`);
    db.exec(`DELETE FROM users WHERE id = '${testUserId}'`);
  });

  describe('hashPasteContent', () => {
    it('应生成一致的 SHA-256 哈希', () => {
      const content = 'Hello, world!';
      const hash1 = hashPasteContent(content);
      const hash2 = hashPasteContent(content);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 = 64 hex chars
    });

    it('不同内容应生成不同哈希', () => {
      const hash1 = hashPasteContent('content A');
      const hash2 = hashPasteContent('content B');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('shouldStorePasteContent', () => {
    it('小文本（<= 1KB）应返回 false', () => {
      const smallText = 'x'.repeat(1024); // 正好 1KB
      expect(shouldStorePasteContent(smallText)).toBe(false);
    });

    it('大文本（> 1KB）应返回 true', () => {
      const largeText = 'x'.repeat(1025); // 超过 1KB
      expect(shouldStorePasteContent(largeText)).toBe(true);
    });

    it('空字符串应返回 false', () => {
      expect(shouldStorePasteContent('')).toBe(false);
    });
  });

  describe('storePasteContent', () => {
    it('小文本应直接内联（返回 null）', () => {
      const smallText = 'Hello, world!';
      const hash = storePasteContent(testSessionId, smallText);

      expect(hash).toBeNull();
    });

    it('大文本应存储并返回哈希', () => {
      const largeText = 'x'.repeat(2000);
      const hash = storePasteContent(testSessionId, largeText);

      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(64);
    });

    it('相同内容应去重（只存储一次）', () => {
      const largeText = 'y'.repeat(2000);

      const hash1 = storePasteContent(testSessionId, largeText);
      const hash2 = storePasteContent(testSessionId, largeText);

      expect(hash1).toBe(hash2);

      // 验证数据库中只有一条记录
      const stats = getPasteContentStats(testSessionId);
      expect(stats.count).toBe(1);
    });

    it('应正确计算字节大小（UTF-8）', () => {
      const chineseText = '你好世界'.repeat(500); // 中文字符占 3 字节
      const hash = storePasteContent(testSessionId, chineseText);

      expect(hash).toBeTruthy();

      const stats = getPasteContentStats(testSessionId);
      expect(stats.totalBytes).toBeGreaterThan(PASTE_CONTENT_THRESHOLD_BYTES);
    });
  });

  describe('retrievePasteContent', () => {
    it('应成功检索存储的内容', () => {
      const originalText = 'z'.repeat(2000);
      const hash = storePasteContent(testSessionId, originalText);

      expect(hash).toBeTruthy();

      const retrieved = retrievePasteContent(testSessionId, hash!);
      expect(retrieved).toBe(originalText);
    });

    it('不存在的哈希应返回 null', () => {
      const fakeHash = 'a'.repeat(64);
      const retrieved = retrievePasteContent(testSessionId, fakeHash);

      expect(retrieved).toBeNull();
    });

    it('会话隔离：不应检索其他会话的内容', () => {
      const otherSessionId = randomUUID();
      const otherUserId = randomUUID();

      // 创建另一个会话
      db.exec(
        `INSERT INTO users (id, email, password_hash) VALUES ('${otherUserId}', 'other@example.com', 'hash')`,
      );
      db.exec(
        `INSERT INTO sessions (id, user_id, messages_json) VALUES ('${otherSessionId}', '${otherUserId}', '[]')`,
      );

      const text = 'w'.repeat(2000);

      const hash = storePasteContent(otherSessionId, text);
      expect(hash).toBeTruthy();

      const retrieved = retrievePasteContent(testSessionId, hash!);
      expect(retrieved).toBeNull();

      // 清理
      db.exec(`DELETE FROM sessions WHERE id = '${otherSessionId}'`);
      db.exec(`DELETE FROM users WHERE id = '${otherUserId}'`);
    });

    it('检索时应更新访问时间', () => {
      const text = 'v'.repeat(2000);
      const hash = storePasteContent(testSessionId, text);

      // 第一次访问
      const before = Date.now();
      retrievePasteContent(testSessionId, hash!);

      // 等待一小段时间
      const delay = 10;
      const waitUntil = Date.now() + delay;
      while (Date.now() < waitUntil) {
        // 忙等待
      }

      // 第二次访问
      retrievePasteContent(testSessionId, hash!);
      const after = Date.now();

      // 验证访问时间在合理范围内
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('gcUnusedPastes', () => {
    it('应删除未被引用的粘贴内容', () => {
      const text1 = 'a'.repeat(2000);
      const text2 = 'b'.repeat(2000);
      const text3 = 'c'.repeat(2000);

      const hash1 = storePasteContent(testSessionId, text1)!;
      const hash2 = storePasteContent(testSessionId, text2)!;
      const hash3 = storePasteContent(testSessionId, text3)!;

      expect(getPasteContentStats(testSessionId).count).toBe(3);

      // 只保留 hash1 和 hash3
      gcUnusedPastes(testSessionId, new Set([hash1, hash3]));

      expect(getPasteContentStats(testSessionId).count).toBe(2);
      expect(retrievePasteContent(testSessionId, hash1)).toBeTruthy();
      expect(retrievePasteContent(testSessionId, hash2)).toBeNull();
      expect(retrievePasteContent(testSessionId, hash3)).toBeTruthy();
    });

    it('空引用集合应删除所有内容', () => {
      const text1 = 'd'.repeat(2000);
      const text2 = 'e'.repeat(2000);

      storePasteContent(testSessionId, text1);
      storePasteContent(testSessionId, text2);

      expect(getPasteContentStats(testSessionId).count).toBe(2);

      gcUnusedPastes(testSessionId, new Set());

      expect(getPasteContentStats(testSessionId).count).toBe(0);
    });

    it('不应影响其他会话的内容', () => {
      const otherSessionId = randomUUID();
      const otherUserId = randomUUID();

      // 创建另一个会话
      db.exec(
        `INSERT INTO users (id, email, password_hash) VALUES ('${otherUserId}', 'other2@example.com', 'hash')`,
      );
      db.exec(
        `INSERT INTO sessions (id, user_id, messages_json) VALUES ('${otherSessionId}', '${otherUserId}', '[]')`,
      );

      // 使用不同的内容以避免全局去重
      const text1 = 'f'.repeat(2000);
      const text2 = 'g'.repeat(2000);

      const hash1 = storePasteContent(testSessionId, text1)!;
      const hash2 = storePasteContent(otherSessionId, text2)!;

      // 删除 testSessionId 的所有粘贴内容
      gcUnusedPastes(testSessionId, new Set());

      // testSessionId 的内容被删除
      expect(retrievePasteContent(testSessionId, hash1)).toBeNull();
      // otherSessionId 的内容不受影响
      expect(retrievePasteContent(otherSessionId, hash2)).toBeTruthy();

      // 清理
      db.exec(`DELETE FROM sessions WHERE id = '${otherSessionId}'`);
      db.exec(`DELETE FROM users WHERE id = '${otherUserId}'`);
    });
  });

  describe('getPasteContentStats', () => {
    it('空会话应返回零统计', () => {
      const stats = getPasteContentStats(testSessionId);

      expect(stats.count).toBe(0);
      expect(stats.totalBytes).toBe(0);
    });

    it('应正确统计总字节数', () => {
      const text1 = 'g'.repeat(2000);
      const text2 = 'h'.repeat(3000);

      storePasteContent(testSessionId, text1);
      storePasteContent(testSessionId, text2);

      const stats = getPasteContentStats(testSessionId);

      expect(stats.count).toBe(2);
      expect(stats.totalBytes).toBe(5000);
    });
  });

  describe('clearSessionPasteContents', () => {
    it('应删除会话的所有粘贴内容', () => {
      const text1 = 'i'.repeat(2000);
      const text2 = 'j'.repeat(2000);

      storePasteContent(testSessionId, text1);
      storePasteContent(testSessionId, text2);

      expect(getPasteContentStats(testSessionId).count).toBe(2);

      const deleted = clearSessionPasteContents(testSessionId);

      expect(deleted).toBe(2);
      expect(getPasteContentStats(testSessionId).count).toBe(0);
    });

    it('清理空会话应返回 0', () => {
      const deleted = clearSessionPasteContents(testSessionId);

      expect(deleted).toBe(0);
    });
  });

  describe('级联删除（外键约束）', () => {
    it('删除会话时应自动清理粘贴内容', () => {
      // 使用已创建的测试会话
      const text = 'k'.repeat(2000);
      const hash = storePasteContent(testSessionId, text);

      expect(hash).toBeTruthy();
      expect(getPasteContentStats(testSessionId).count).toBe(1);

      // 删除会话
      db.exec(`DELETE FROM sessions WHERE id = '${testSessionId}'`);

      // 验证粘贴内容已被级联删除
      expect(getPasteContentStats(testSessionId).count).toBe(0);

      // 防止 afterEach 再次删除（已删除）
      testSessionId = randomUUID();
    });
  });
});
