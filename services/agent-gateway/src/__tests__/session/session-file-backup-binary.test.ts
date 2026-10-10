/**
 * 回归:`captureBeforeWriteBackup` 遇到二进制内容必须**跳过**而非抛错。
 *
 * 背景:一个写/改二进制文件(如图片)的工具调用会在写入前捕获备份,而
 * `persistSessionFileBackup` 对 binary 内容显式抛 `FileBackupUnsupportedContentError`;
 * 默认 `block` 策略下旧实现会把它 rethrow 到 `executeToolCalls`,导致整个工具回合 /
 * 子代理以 `state=error` 中止。二进制属于「不适用」而非「捕获失败」,应一律跳过。
 *
 * 该路径在触碰数据库之前就已完成分类,因此本测试无需 DB。
 */

import { describe, expect, it } from 'vitest';
import {
  captureBeforeWriteBackup,
  classifyBackupContent,
  FileBackupUnsupportedContentError,
  persistSessionFileBackup,
} from '../../session/session-file-backup-store.js';

const base = {
  sessionId: 'session-binary-1',
  userId: 'user-binary-1',
  kind: 'before_write' as const,
  toolName: 'write',
};

describe('captureBeforeWriteBackup · 二进制内容跳过', () => {
  it('按扩展名判定为二进制时不抛错、返回 undefined', async () => {
    await expect(
      captureBeforeWriteBackup({ ...base, filePath: 'assets/logo.png', content: 'PNGDATA' }),
    ).resolves.toBeUndefined();
  });

  it('内容含 NUL 字节时同样跳过', async () => {
    await expect(
      captureBeforeWriteBackup({ ...base, filePath: 'data.bin.txt', content: 'a\u0000b' }),
    ).resolves.toBeUndefined();
  });

  it('底层 persistSessionFileBackup 仍显式拒绝二进制(既有语义不变)', async () => {
    await expect(
      persistSessionFileBackup({ ...base, filePath: 'x.zip', content: 'PK' }),
    ).rejects.toBeInstanceOf(FileBackupUnsupportedContentError);
  });

  it('classifyBackupContent 把 .png 判为 binary 档位', () => {
    expect(classifyBackupContent('a/b.png', 'x').contentTier).toBe('binary');
  });
});
