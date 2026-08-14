/**
 * Paste Content Expander 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Message } from '@openAwork/shared';
import {
  expandPasteReferences,
  expandPasteReferencesInMessages,
  extractPasteReferencesFromMessages,
  isPasteReference,
  type PasteReference,
} from '../paste-content-expander.js';
import { storePasteContent } from '../paste-content-store.js';
import { db, migrate } from '../../infra/db.js';

describe('paste-content-expander', () => {
  let testSessionId: string;
  let testUserId: string;

  beforeAll(async () => {
    // 初始化数据库 schema
    await migrate();
  });

  beforeEach(() => {
    testSessionId = randomUUID();
    testUserId = randomUUID();

    // 创建测试用户和会话
    db.exec(
      `INSERT INTO users (id, email, password_hash) VALUES ('${testUserId}', 'test@example.com', 'hash')`,
    );
    db.exec(
      `INSERT INTO sessions (id, user_id, messages_json) VALUES ('${testSessionId}', '${testUserId}', '[]')`,
    );
  });

  afterEach(() => {
    // 清理测试数据
    db.exec(`DELETE FROM sessions WHERE id = '${testSessionId}'`);
    db.exec(`DELETE FROM users WHERE id = '${testUserId}'`);
  });

  describe('isPasteReference', () => {
    it('应识别有效的 PasteReference', () => {
      const ref: PasteReference = {
        type: 'paste_reference',
        hash: 'a'.repeat(64),
        size: 2000,
      };

      expect(isPasteReference(ref)).toBe(true);
    });

    it('应拒绝无效对象', () => {
      expect(isPasteReference(null)).toBe(false);
      expect(isPasteReference(undefined)).toBe(false);
      expect(isPasteReference('string')).toBe(false);
      expect(isPasteReference(123)).toBe(false);
      expect(isPasteReference({})).toBe(false);
      expect(isPasteReference({ type: 'text' })).toBe(false);
    });

    it('应拒绝缺少必要字段的对象', () => {
      expect(isPasteReference({ type: 'paste_reference' })).toBe(false);
      expect(isPasteReference({ type: 'paste_reference', hash: 'abc' })).toBe(false);
      expect(isPasteReference({ hash: 'abc', size: 100 })).toBe(false);
    });
  });

  describe('expandPasteReferences', () => {
    it('普通文本消息应保持不变', () => {
      const message: Message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: 'Hello, world!' }],
        createdAt: Date.now(),
      };

      const expanded = expandPasteReferences(testSessionId, message);

      expect(expanded).toBe(message); // 引用相等
      expect(expanded.content[0]).toEqual({ type: 'text', text: 'Hello, world!' });
    });

    it('应展开 text content 中的 PasteReference 对象', () => {
      const originalText = 'x'.repeat(2000);
      const hash = storePasteContent(testSessionId, originalText)!;

      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash,
        size: 2000,
      };

      const message: Message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: pasteRef as unknown as string }],
        createdAt: Date.now(),
      };

      const expanded = expandPasteReferences(testSessionId, message);

      expect(expanded.content[0]).toEqual({ type: 'text', text: originalText });
    });

    it('应展开 text content 中的 JSON 字符串 PasteReference', () => {
      const originalText = 'y'.repeat(2000);
      const hash = storePasteContent(testSessionId, originalText)!;

      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash,
        size: 2000,
      };

      const message: Message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: JSON.stringify(pasteRef) }],
        createdAt: Date.now(),
      };

      const expanded = expandPasteReferences(testSessionId, message);

      expect(expanded.content[0]).toEqual({ type: 'text', text: originalText });
    });

    it('展开失败时应使用预览文本', () => {
      const fakeHash = 'z'.repeat(64);
      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash: fakeHash,
        size: 2000,
        preview: 'Preview text...',
      };

      const message: Message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: pasteRef as unknown as string }],
        createdAt: Date.now(),
      };

      const expanded = expandPasteReferences(testSessionId, message);
      const expandedContent = expanded.content[0] as { type: string; text: string };

      expect(expandedContent.text).toBe('Preview text...');
    });

    it('展开失败且无预览时应使用占位符', () => {
      const fakeHash = 'a'.repeat(64);
      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash: fakeHash,
        size: 2000,
      };

      const message: Message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: pasteRef as unknown as string }],
        createdAt: Date.now(),
      };

      const expanded = expandPasteReferences(testSessionId, message);
      const expandedContent = expanded.content[0] as { type: string; text: string };

      expect(expandedContent.text).toContain('Paste content not found');
      expect(expandedContent.text).toContain(fakeHash.slice(0, 8));
    });

    it('应展开 tool_call input 中的嵌套 PasteReference', () => {
      const originalText = 'b'.repeat(2000);
      const hash = storePasteContent(testSessionId, originalText)!;

      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash,
        size: 2000,
      };

      const message: Message = {
        id: randomUUID(),
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCallId: 'call_123',
            toolName: 'test_tool',
            input: { content: pasteRef },
          },
        ],
        createdAt: Date.now(),
      };

      const expanded = expandPasteReferences(testSessionId, message);
      const expandedContent = expanded.content[0] as {
        type: string;
        input: { content: string };
      };

      expect(expandedContent.input.content).toBe(originalText);
    });

    it('应展开 tool_result output 中的 PasteReference', () => {
      const originalText = 'c'.repeat(2000);
      const hash = storePasteContent(testSessionId, originalText)!;

      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash,
        size: 2000,
      };

      const message: Message = {
        id: randomUUID(),
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call_123',
            output: pasteRef,
            isError: false,
          },
        ],
        createdAt: Date.now(),
      };

      const expanded = expandPasteReferences(testSessionId, message);
      const expandedContent = expanded.content[0] as { type: string; output: string };

      expect(expandedContent.output).toBe(originalText);
    });

    it('应处理多个 content 块', () => {
      const text1 = 'd'.repeat(2000);
      const text2 = 'e'.repeat(2000);
      const hash1 = storePasteContent(testSessionId, text1)!;
      const hash2 = storePasteContent(testSessionId, text2)!;

      const message: Message = {
        id: randomUUID(),
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({ type: 'paste_reference', hash: hash1, size: 2000 }),
          },
          { type: 'text', text: 'Normal text' },
          {
            type: 'text',
            text: JSON.stringify({ type: 'paste_reference', hash: hash2, size: 2000 }),
          },
        ],
        createdAt: Date.now(),
      };

      const expanded = expandPasteReferences(testSessionId, message);

      expect((expanded.content[0] as { type: string; text: string }).text).toBe(text1);
      expect((expanded.content[1] as { type: string; text: string }).text).toBe('Normal text');
      expect((expanded.content[2] as { type: string; text: string }).text).toBe(text2);
    });
  });

  describe('expandPasteReferencesInMessages', () => {
    it('应批量展开多条消息', () => {
      const text1 = 'f'.repeat(2000);
      const text2 = 'g'.repeat(2000);
      const hash1 = storePasteContent(testSessionId, text1)!;
      const hash2 = storePasteContent(testSessionId, text2)!;

      const messages: Message[] = [
        {
          id: randomUUID(),
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ type: 'paste_reference', hash: hash1, size: 2000 }),
            },
          ],
          createdAt: Date.now(),
        },
        {
          id: randomUUID(),
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          createdAt: Date.now(),
        },
        {
          id: randomUUID(),
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ type: 'paste_reference', hash: hash2, size: 2000 }),
            },
          ],
          createdAt: Date.now(),
        },
      ];

      const expanded = expandPasteReferencesInMessages(testSessionId, messages);

      expect((expanded[0]!.content[0] as { type: string; text: string }).text).toBe(text1);
      expect((expanded[1]!.content[0] as { type: string; text: string }).text).toBe('Response');
      expect((expanded[2]!.content[0] as { type: string; text: string }).text).toBe(text2);
    });
  });

  describe('extractPasteReferencesFromMessages', () => {
    it('空消息列表应返回空集合', () => {
      const hashes = extractPasteReferencesFromMessages([]);

      expect(hashes.size).toBe(0);
    });

    it('应提取 text content 中的哈希', () => {
      const hash = 'h'.repeat(64);
      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash,
        size: 2000,
      };

      const messages: Message[] = [
        {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(pasteRef) }],
          createdAt: Date.now(),
        },
      ];

      const hashes = extractPasteReferencesFromMessages(messages);

      expect(hashes.size).toBe(1);
      expect(hashes.has(hash)).toBe(true);
    });

    it('应提取 tool_call input 中的哈希', () => {
      const hash = 'i'.repeat(64);
      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash,
        size: 2000,
      };

      const messages: Message[] = [
        {
          id: randomUUID(),
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              toolCallId: 'call_123',
              toolName: 'test_tool',
              input: { data: pasteRef },
            },
          ],
          createdAt: Date.now(),
        },
      ];

      const hashes = extractPasteReferencesFromMessages(messages);

      expect(hashes.size).toBe(1);
      expect(hashes.has(hash)).toBe(true);
    });

    it('应提取 tool_result output 中的哈希', () => {
      const hash = 'j'.repeat(64);
      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash,
        size: 2000,
      };

      const messages: Message[] = [
        {
          id: randomUUID(),
          role: 'assistant',
          content: [
            {
              type: 'tool_result',
              toolCallId: 'call_123',
              output: JSON.stringify(pasteRef),
              isError: false,
            },
          ],
          createdAt: Date.now(),
        },
      ];

      const hashes = extractPasteReferencesFromMessages(messages);

      expect(hashes.size).toBe(1);
      expect(hashes.has(hash)).toBe(true);
    });

    it('应去重相同的哈希', () => {
      const hash = 'k'.repeat(64);
      const pasteRef: PasteReference = {
        type: 'paste_reference',
        hash,
        size: 2000,
      };

      const messages: Message[] = [
        {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(pasteRef) }],
          createdAt: Date.now(),
        },
        {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(pasteRef) }],
          createdAt: Date.now(),
        },
      ];

      const hashes = extractPasteReferencesFromMessages(messages);

      expect(hashes.size).toBe(1);
      expect(hashes.has(hash)).toBe(true);
    });

    it('应提取多个不同的哈希', () => {
      const hash1 = 'l'.repeat(64);
      const hash2 = 'm'.repeat(64);
      const hash3 = 'n'.repeat(64);

      const messages: Message[] = [
        {
          id: randomUUID(),
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ type: 'paste_reference', hash: hash1, size: 2000 }),
            },
          ],
          createdAt: Date.now(),
        },
        {
          id: randomUUID(),
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ type: 'paste_reference', hash: hash2, size: 2000 }),
            },
            {
              type: 'text',
              text: JSON.stringify({ type: 'paste_reference', hash: hash3, size: 2000 }),
            },
          ],
          createdAt: Date.now(),
        },
      ];

      const hashes = extractPasteReferencesFromMessages(messages);

      expect(hashes.size).toBe(3);
      expect(hashes.has(hash1)).toBe(true);
      expect(hashes.has(hash2)).toBe(true);
      expect(hashes.has(hash3)).toBe(true);
    });
  });
});
