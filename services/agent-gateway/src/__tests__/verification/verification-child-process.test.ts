import { describe, expect, it } from 'vitest';
import { runVerificationChild } from '../../verification/verification-child-process.js';

const runNode = (source: string, options: { timeoutMs?: number; killOnStdout?: string } = {}) =>
  runVerificationChild({
    runtime: process.execPath,
    args: ['-e', source],
    env: process.env,
    timeoutMs: options.timeoutMs ?? 5_000,
    ...(options.killOnStdout ? { killOnStdout: options.killOnStdout } : {}),
  });

describe('verification child process', () => {
  it('正常退出后返回输出', async () => {
    await expect(runNode("console.log('STATE delivered')")).resolves.toMatchObject({
      code: 0,
      signal: null,
      stdout: 'STATE delivered\n',
    });
  });

  it('打印成功后非零退出仍必须失败', async () => {
    await expect(runNode("console.log('STATE delivered'); process.exitCode = 1")).rejects.toThrow(
      'code=1',
    );
  });

  it('意外信号退出不得通过', async () => {
    await expect(runNode("process.kill(process.pid, 'SIGTERM')")).rejects.toThrow('SIGTERM');
  });

  it('等待就绪标记后真的SIGKILL并等待退出', async () => {
    await expect(
      runNode("console.log('READY'); setInterval(() => {}, 1000)", {
        killOnStdout: 'READY',
      }),
    ).resolves.toMatchObject({ code: null, signal: 'SIGKILL' });
  });

  it('就绪前自行退出不能冒充SIGKILL成功', async () => {
    await expect(runNode("console.log('not ready')", { killOnStdout: 'READY' })).rejects.toThrow(
      'code=0',
    );
  });

  it('卡住的普通子进程超时后被终止并判失败', async () => {
    await expect(runNode('setInterval(() => {}, 1000)', { timeoutMs: 100 })).rejects.toThrow(
      'timeout',
    );
  });

  it('始终没有就绪标记时超时必须失败，不当作预期SIGKILL', async () => {
    await expect(
      runNode('setInterval(() => {}, 1000)', {
        killOnStdout: 'READY',
        timeoutMs: 100,
      }),
    ).rejects.toThrow('timeout');
  });

  it('运行时启动失败应立即拒绝且不留计时器', async () => {
    await expect(
      runVerificationChild({
        runtime: '/nonexistent/openawork-verification-runtime',
        args: [],
        env: process.env,
        timeoutMs: 20_000,
      }),
    ).rejects.toThrow('ENOENT');
  });
});
