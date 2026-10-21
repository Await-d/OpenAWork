/**
 * SSH 工作区预览的错误分类回归。
 *
 * 背景（2026-10-16 排障包）：远端 sshd 未启用 SFTP 子系统时，`/ssh/files` 已按
 * 「远端能力缺失、不可重试、非网关故障」映射成 501，但 `/workspace/tree` 与
 * `/workspace/file` 走的是 `classifySshPreviewError` 的第二套分类器，没有这个分支，
 * 于是同一条 SSH 连接、同一个根因在 19 秒内给出了互相矛盾的
 * `GET /workspace/tree → 500` 与 `GET /ssh/files → 501`。
 */
import { describe, expect, it } from 'vitest';
import { SshSftpUnavailableError } from '@openAwork/agent-core';
import { classifySshPreviewError } from '../../workspace/ssh-workspace-preview.js';

describe('classifySshPreviewError：远端未启用 SFTP 子系统', () => {
  it('归一类型 → 501 + 与 /ssh/files 同源的可操作文案', () => {
    const classified = classifySshPreviewError(new SshSftpUnavailableError());

    expect(classified.statusCode).toBe(501);
    expect(classified.message).toContain('远端服务器未启用 SFTP 子系统');
    expect(classified.message).toContain('Subsystem sftp');
    // 不得泄漏 ssh2 的英文裸串（模型从中推不出「该换条路」）。
    expect(classified.message).not.toContain('did not start the sftp subsystem');
  });

  it('未归一的 ssh2 裸文案同样识别（注入实现 / 旧链路）', () => {
    const classified = classifySshPreviewError(new Error('Unable to start subsystem: sftp'));

    expect(classified.statusCode).toBe(501);
    expect(classified.message).toContain('远端服务器未启用 SFTP 子系统');
  });

  it('其它远端错误仍按既有口径分类，不误判成 501', () => {
    expect(classifySshPreviewError(new Error('no such file')).statusCode).toBe(404);
    expect(classifySshPreviewError(new Error('permission denied')).statusCode).toBe(500);
    expect(classifySshPreviewError(new Error('SSH SFTP read timed out')).statusCode).toBe(500);
  });
});
