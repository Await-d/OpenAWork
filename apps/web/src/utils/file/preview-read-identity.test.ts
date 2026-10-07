import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '@openAwork/web-client';
import { EMPTY_READ_IDENTITY, type WorkspaceReadIdentity } from '../../stores/ui/uiState.js';
import {
  buildPreviewReadAttempts,
  isCrossHostPathError,
  runWithReadIdentityFallback,
} from './preview-read-identity.js';

const CROSS_HOST_MESSAGE =
  '当前网关运行在 Windows，无法访问 POSIX 路径：/home/await/project/OpenAWork。该路径位于其他设备的文件系统上。';

function identity(overrides: Partial<WorkspaceReadIdentity>): WorkspaceReadIdentity {
  return { ...EMPTY_READ_IDENTITY, ...overrides };
}

describe('isCrossHostPathError', () => {
  it('识别网关的跨主机路径错误（400 与裸 Error 都算）', () => {
    expect(isCrossHostPathError(new HttpError(CROSS_HOST_MESSAGE, 400))).toBe(true);
    expect(isCrossHostPathError(new Error(CROSS_HOST_MESSAGE))).toBe(true);
  });

  it('其它 4xx 与不相关错误都不触发回退', () => {
    expect(isCrossHostPathError(new HttpError(CROSS_HOST_MESSAGE, 403))).toBe(false);
    expect(isCrossHostPathError(new HttpError('目标文件不存在。', 404))).toBe(false);
    expect(isCrossHostPathError(new Error('读取超时'))).toBe(false);
    expect(isCrossHostPathError('非 Error 值')).toBe(false);
  });
});

describe('buildPreviewReadAttempts', () => {
  it('身份全空时只产出一次纯本地读取，不追加任何身份参数', () => {
    expect(buildPreviewReadAttempts('/work', EMPTY_READ_IDENTITY)).toEqual([
      { workspaceRoot: '/work' },
    ]);
    expect(buildPreviewReadAttempts(null, null)).toEqual([{}]);
  });

  it('会话身份优先，并把 SSH 连接身份作为回退候选', () => {
    expect(
      buildPreviewReadAttempts(
        '/home/await/project',
        identity({ sessionId: 'sess-1', sshConnectionId: 'conn-1', remote: true }),
      ),
    ).toEqual([
      { workspaceRoot: '/home/await/project', sessionId: 'sess-1' },
      { workspaceRoot: '/home/await/project', sshConnectionId: 'conn-1' },
    ]);
  });

  it('只有连接身份时产出单候选；无根目录时不下发 workspaceRoot', () => {
    expect(buildPreviewReadAttempts('  ', identity({ sshConnectionId: 'conn-1' }))).toEqual([
      { sshConnectionId: 'conn-1' },
    ]);
  });

  it('连接 id 与会话 id 相同时不产生重复候选', () => {
    expect(
      buildPreviewReadAttempts('/work', identity({ sessionId: 'same', sshConnectionId: 'same' })),
    ).toEqual([{ workspaceRoot: '/work', sessionId: 'same' }]);
  });
});

describe('runWithReadIdentityFallback', () => {
  it('首个候选成功时不再尝试后续候选', async () => {
    const run = vi.fn().mockResolvedValue('content');

    await expect(
      runWithReadIdentityFallback([{ sessionId: 'a' }, { sshConnectionId: 'b' }], run),
    ).resolves.toBe('content');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ sessionId: 'a' });
  });

  it('跨主机失败时换用连接身份重试并返回内容', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(CROSS_HOST_MESSAGE, 400))
      .mockResolvedValueOnce('remote content');

    await expect(
      runWithReadIdentityFallback([{ sessionId: 'a' }, { sshConnectionId: 'b' }], run),
    ).resolves.toBe('remote content');
    expect(run).toHaveBeenNthCalledWith(2, { sshConnectionId: 'b' });
  });

  it('404 等确定性失败立即上抛，不做无谓重试', async () => {
    const run = vi.fn().mockRejectedValue(new HttpError('目标文件不存在。', 404));

    await expect(
      runWithReadIdentityFallback([{ sessionId: 'a' }, { sshConnectionId: 'b' }], run),
    ).rejects.toThrow('目标文件不存在。');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('候选全部跨主机失败时上抛首个错误（主路径的真实原因）', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(CROSS_HOST_MESSAGE, 400))
      .mockRejectedValueOnce(new HttpError('SSH 连接当前不可用。', 409));

    await expect(
      runWithReadIdentityFallback([{ sessionId: 'a' }, { sshConnectionId: 'b' }], run),
    ).rejects.toThrow(CROSS_HOST_MESSAGE);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('两个候选都是跨主机失败时同样上抛首个错误', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(CROSS_HOST_MESSAGE, 400))
      .mockRejectedValueOnce(new HttpError('SSH 远程工作区路径必须是绝对 POSIX 路径。', 400));

    await expect(
      runWithReadIdentityFallback([{ sessionId: 'a' }, { sshConnectionId: 'b' }], run),
    ).rejects.toThrow(CROSS_HOST_MESSAGE);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('候选列表为空时上抛 undefined，不静默返回', async () => {
    await expect(runWithReadIdentityFallback([], vi.fn())).rejects.toBeUndefined();
  });
});
