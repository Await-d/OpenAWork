/**
 * verify-session-extension-interrupt-recovery — T-22 剩余验收：**真实跨进程**中断恢复。
 *
 * 覆盖单测覆盖不到的那一层：`failInterruptedSessionExtensionOperations` 写对了，
 * 不等于重启后进程真的会调用它。本脚本用真实子进程 + 真实 `SIGKILL`，配合**共享
 * 文件数据库**，验证「安装执行到一半被杀」之后新进程的行为：
 *
 *   ① 子进程 A 建提案 → 批准 → 置 `applying`，打印标记后挂起；
 *   ② 父进程看到标记即 `SIGKILL`（精确命中 applying 中途）；
 *   ③ 全新子进程 B 跑启动路径：必须把该操作**改判失败**（`gateway_restart`，
 *      不自动重放），**且**为它补上渠道回执记录（否则这次安装的结果永远没有回音）；
 *   ④ 再跑一次 B：结果必须一致（幂等，不重复入队）。
 *
 * 覆盖边界：崩溃的是执行所在的进程，不是真实 gateway HTTP 服务端；渠道实际投递
 * 仍由 `session-extension-delivery` 的存储/派发单测覆盖。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runVerificationChild } from './verification-child-process.js';

const FIXTURE = resolve(process.cwd(), 'src/verification/_fixture-session-extension-interrupt.ts');
/** fixture 运行时；可用 `OPENAWORK_VERIFY_CHILD_RUNTIME` 覆盖（例如 CI 用绝对路径）。 */
const CHILD_RUNTIME = process.env['OPENAWORK_VERIFY_CHILD_RUNTIME'] ?? 'bun';

const SESSION_ID = 's-xproc-ext';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`会话扩展中断恢复断言失败：${message}`);
}

function spawnFixture(
  args: string[],
  env: Record<string, string>,
  options: { killOnStdout?: string; timeoutMs?: number } = {},
) {
  return runVerificationChild({
    runtime: CHILD_RUNTIME,
    args: [FIXTURE, ...args],
    env: { ...process.env, ...env },
    timeoutMs: options.timeoutMs ?? 60_000,
    ...(options.killOnStdout ? { killOnStdout: options.killOnStdout } : {}),
  });
}

function recoverySummary(stdout: string): { status: string; errorCode: string; delivery: string } {
  const match = /FIXTURE_RECOVER status=(\S+) errorCode=(\S+) delivery=(\S+)/.exec(stdout);
  assert(match, `恢复进程未打印可解析状态，输出：${stdout.slice(0, 400)}`);
  return { status: match[1] ?? '', errorCode: match[2] ?? '', delivery: match[3] ?? '' };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'openawork-ext-interrupt-'));
  const env = {
    DATABASE_URL: join(dir, 'gateway.db'),
    NODE_ENV: 'test',
    OPENAWORK_APP_VERSION: '0.0.0-test',
    OPENAWORK_DATA_DIR: join(dir, 'data'),
  };

  try {
    // ── ① 执行到一半被杀 ────────────────────────────────────────────────
    const killed = await spawnFixture(['apply-and-hang', SESSION_ID], env, {
      killOnStdout: 'FIXTURE_APPLYING',
    });
    assert(
      killed.stdout.includes('FIXTURE_APPLYING'),
      `子进程应打印 applying 标记，输出：${killed.stdout.slice(0, 300)}`,
    );
    assert(
      killed.stdout.includes('status=applying'),
      `被杀前应处于 applying，输出：${killed.stdout.slice(0, 300)}`,
    );

    // ── ② 新进程恢复：改判失败 + 补回执 ────────────────────────────────
    const first = recoverySummary((await spawnFixture(['recover', SESSION_ID], env)).stdout);
    assert(
      first.status === 'failed',
      `重启后 applying 必须改判 failed（不自动重放），实际 ${first.status}`,
    );
    assert(
      first.errorCode === 'gateway_restart',
      `中断原因应为 gateway_restart，实际 ${first.errorCode}`,
    );
    assert(first.delivery === 'pending', `失败终态也要有回执，实际 delivery=${first.delivery}`);

    // ── ③ 重复恢复必须幂等（不得重复入队，也不得再次改判）─────────────
    const second = recoverySummary((await spawnFixture(['recover', SESSION_ID], env)).stdout);
    assert(
      second.status === first.status &&
        second.errorCode === first.errorCode &&
        second.delivery === first.delivery,
      `重复恢复结果必须一致，实际 ${JSON.stringify(second)} vs ${JSON.stringify(first)}`,
    );

    process.stdout.write(
      `✅ 会话扩展中断恢复通过：status=${first.status} errorCode=${first.errorCode} delivery=${first.delivery}\n`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
