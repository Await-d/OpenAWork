import { describe, expect, it } from 'vitest';

import { execFileWithEscalation } from '../../infra/exec-file-escalation.js';

describe('execFileWithEscalation', () => {
  it('正常退出时返回 stdout / stderr', async () => {
    const result = await execFileWithEscalation(
      process.execPath,
      ['-e', 'process.stdout.write("ok"); process.stderr.write("warn");'],
      { timeoutMs: 5_000 },
    );

    expect(result).toEqual({ stdout: 'ok', stderr: 'warn' });
  });

  it('子进程忽略 SIGTERM 时会在宽限期后强制结束并 reject', async () => {
    const startedAt = Date.now();
    // 安装一个空 SIGTERM handler，模拟 formatter / tmux / ast-grep 卡死的情况。
    const script = "process.on('SIGTERM', () => {}); setTimeout(() => {}, 10_000);";

    await expect(
      execFileWithEscalation(process.execPath, ['-e', script], {
        timeoutMs: 500,
        graceMs: 200,
      }),
    ).rejects.toMatchObject({ killed: true });

    // 没有 SIGKILL 兜底时这里会一直等到子进程自然结束（10s）或测试超时。
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  }, 10_000);
});
