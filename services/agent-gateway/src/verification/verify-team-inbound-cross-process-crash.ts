/**
 * verify-team-inbound-cross-process-crash — T-19 剩余验收：**真实跨进程**崩溃恢复。
 *
 * 与 `verify-team-inbound-fault-injection.ts`（状态级注入）互补：本脚本用真实子进程 +
 * 真实 `SIGKILL`，配合**共享文件数据库**，验证两种崩溃时刻：
 *
 *   ① 入库后、编排前进程退出：子进程 A 提交入站输入后直接退出（不投递）；父进程起
 *      全新子进程 B 跑投递扫描，必须把这条输入投递完成（责任只存在于磁盘）。
 *   ② 人工运行状态恢复：子进程 C 写入 `running` 与新鲜心跳后提交输入，挂起等待
 *      父进程 `SIGKILL`（没有真实 stream/worker）。全新进程 D 用超出心跳陈旧窗口的时间
 *      运行扫描，必须先把残留 `running` 收敛掉、再完成投递。
 *
 * 判据（计划 T-19）：脚本连续两次运行结果一致——两次都会新建独立临时库，断言只依赖
 * 确定性状态转移。
 *
 * 覆盖边界：
 *   - 崩溃的是**投递/流式执行所在的进程**，不是真实 gateway HTTP 服务端；HTTP 层
 *     事务与幂等已由 `team-inbound-routes` 测试覆盖。
 *   - 仍不覆盖真实模型调用（用确定性澄清路径），端到端效果属 T-20。
 */

import { runVerificationChild } from './verification-child-process.js';
import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FIXTURE = resolve(process.cwd(), 'src/verification/_fixture-team-inbound-crash.ts');
/** fixture 运行时；可用 `OPENAWORK_VERIFY_CHILD_RUNTIME` 覆盖（例如 CI 用绝对路径）。 */
const CHILD_RUNTIME = process.env['OPENAWORK_VERIFY_CHILD_RUNTIME'] ?? 'bun';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`跨进程崩溃断言失败：${message}`);
}

function spawnFixture(
  args: string[],
  env: Record<string, string>,
  options: { killAfterMs?: number; killOnStdout?: string; killWhen?: Promise<unknown> } = {},
) {
  return runVerificationChild({
    runtime: CHILD_RUNTIME,
    args: [FIXTURE, ...args],
    env: { ...process.env, ...env },
    timeoutMs: options.killAfterMs ?? 60_000,
    // 每个场景的「已进入待杀状态」标记不同：等错标记会把正常挂起误判成超时。
    // 场景⑤用外部条件（假上游已收到连接）代替输出标记。
    ...(options.killWhen
      ? { killWhen: options.killWhen }
      : options.killAfterMs !== undefined
        ? { killOnStdout: options.killOnStdout ?? 'FIXTURE_SUBMITTED' }
        : {}),
  });
}

function submittedId(stdout: string): string {
  const match = /FIXTURE_SUBMITTED (\S+)/.exec(stdout);
  assert(match?.[1], `fixture 未打印提交标记，输出：${stdout.slice(0, 400)}`);
  return match[1];
}

function reportedState(stdout: string): { state: string; attempt: number } {
  const match = /FIXTURE_STATE (\S+) attempt=(-?\d+)/.exec(stdout);
  assert(match?.[1], `恢复进程未打印状态，输出：${stdout.slice(0, 400)}`);
  return { attempt: Number(match[2]), state: match[1] };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'openawork-xproc-crash-'));
  const dbPath = join(dir, 'gateway.db');
  const env = {
    DATABASE_URL: dbPath,
    NODE_ENV: 'test',
    OPENAWORK_APP_VERSION: '0.0.0-test',
    OPENAWORK_DATA_DIR: join(dir, 'data'),
  };
  try {
    // ── ① 入库后、编排前进程退出 → 新进程续派 ──────────────────────────────
    const pendingSession = 's-xproc-pending';
    const writer = await spawnFixture(['submit-pending', pendingSession, 'xproc-key-1'], env);
    assert(
      writer.code === 0 && submittedId(writer.stdout).length > 0,
      `写入进程应正常提交后退出，实际 code=${writer.code} ${writer.stderr.slice(0, 200)}`,
    );

    const recover = await spawnFixture(['recover', pendingSession, '', '0'], env);
    const firstState = reportedState(recover.stdout);
    assert(firstState.state === 'delivered', `新进程必须续派这条输入，实际 ${firstState.state}`);
    assert(firstState.attempt === 1, `应恰好尝试一次，实际 ${firstState.attempt}`);

    // 再跑一次：已投递的行不得被第二次处理（跨进程幂等）。
    const secondRecover = await spawnFixture(['recover', pendingSession, '', '0'], env);
    const secondState = reportedState(secondRecover.stdout);
    assert(
      secondState.state === 'delivered' && secondState.attempt === 1,
      `重复恢复不得重复投递，实际 ${secondState.state}/${secondState.attempt}`,
    );

    // ── ② 流式执行中被 SIGKILL → 新进程收敛残留 running 并续派 ────────────
    const streamingSession = 's-xproc-streaming';
    const victim = await spawnFixture(
      ['submit-while-streaming', streamingSession, 'xproc-key-2'],
      env,
      { killAfterMs: 20_000 },
    );
    submittedId(victim.stdout);
    assert(
      victim.signal === 'SIGKILL',
      `流式中进程必须被真实 SIGKILL 终止，实际 signal=${victim.signal} code=${victim.code}`,
    );

    const revived = await spawnFixture(['recover', streamingSession, '', 'stale'], env);
    const revivedState = reportedState(revived.stdout);
    assert(
      revivedState.state === 'delivered',
      `被杀的流式输入必须收敛并被续派，实际 ${revivedState.state}`,
    );

    // ── ③ 真实消费租约持有者被 SIGKILL → 过期后重投，旧令牌失效 ──────────
    const leaseSession = 's-xproc-lease';
    const leaseHolder = await spawnFixture(
      ['claim-lease-and-hang', leaseSession, 'xproc-lease-q1'],
      env,
      { killAfterMs: 20_000, killOnStdout: 'FIXTURE_LEASE' },
    );
    assert(
      leaseHolder.signal === 'SIGKILL',
      `持有租约的进程必须被真实 SIGKILL 终止，实际 signal=${leaseHolder.signal}`,
    );
    const lease = /FIXTURE_LEASE (\S+) (\S+) (\d+)/.exec(leaseHolder.stdout);
    assert(lease?.[1] && lease[2], `未从被杀进程读到租约信息：${leaseHolder.stdout.slice(0, 300)}`);
    const [leaseMessageId, leaseToken, leaseAttempt] = [lease[1], lease[2], Number(lease[3])];

    // 租约有效期内不得被抢走。
    const probe = await spawnFixture(
      ['recover-lease', leaseSession, '', leaseMessageId, leaseToken, 'before-expiry'],
      env,
    );
    assert(
      probe.stdout.includes('stolen=none'),
      `租约有效期内不得被他人领取，实际输出：${probe.stdout.slice(0, 300)}`,
    );

    // 过期后必须能重投同一条消息，且崩溃进程的旧令牌不再可用。
    const takeover = await spawnFixture(
      ['recover-lease', leaseSession, '', leaseMessageId, leaseToken, 'after-expiry'],
      env,
    );
    const reclaimed =
      /FIXTURE_LEASE_RECLAIMED (\S+) attempt=(-?\d+) staleAck=(\w+) freshAck=(\w+)/.exec(
        takeover.stdout,
      );
    assert(
      reclaimed?.[1] === leaseMessageId,
      `过期后必须重投同一条消息，实际：${takeover.stdout.slice(0, 300)}`,
    );
    assert(
      Number(reclaimed?.[2]) === leaseAttempt + 1,
      `重投必须累加尝试次数（原 ${leaseAttempt}），实际 ${reclaimed?.[2]}`,
    );
    assert(reclaimed?.[3] === 'false', `崩溃进程的旧令牌必须失效，实际 staleAck=${reclaimed?.[3]}`);
    assert(reclaimed?.[4] === 'true', `新持有者必须能确认，实际 freshAck=${reclaimed?.[4]}`);

    // ── ④ 投递执行中被 SIGKILL → 投递租约过期后重新投递 ────────────────────
    // 与场景③（消费租约）互补：这里持有的是**投递租约**，且被杀进程已由真实
    // dispatcher 启动了真实 worker（worker 任务已创建）。
    // 边界：真实 stream 的模型端点来自 agent-core 的 provider 配置而非环境变量，
    // 因此本场景**不能**证明「模型请求已在途」——它证明的是「已领取且 worker 已启动」，
    // worker 是否已进入编排函数体不作断言（被杀时刻在任务创建后约 20–40ms）。
    const deliverySession = 's-xproc-delivering';
    const liveVictim = await spawnFixture(
      ['deliver-and-hang', deliverySession, 'xproc-live-key'],
      env,
      { killAfterMs: 25_000, killOnStdout: 'FIXTURE_DELIVERING' },
    );
    assert(
      liveVictim.signal === 'SIGKILL',
      `执行中的进程必须被真实 SIGKILL 终止，实际 signal=${liveVictim.signal}`,
    );
    assert(
      /FIXTURE_DELIVERING processing attempt=1/.test(liveVictim.stdout),
      `被杀前必须已真实领取投递并启动 worker，实际输出：${liveVictim.stdout.slice(0, 300)}`,
    );

    // 崩溃进程留下的投递租约过期后，新进程必须重新投递而不是把它搁置。
    const deliveryRecovery = await spawnFixture(
      ['recover-delivery-lease', deliverySession, ''],
      env,
    );
    const before = /FIXTURE_BEFORE state=(\S+) attempt=(-?\d+)/.exec(deliveryRecovery.stdout);
    const after = /FIXTURE_AFTER state=(\S+) attempt=(-?\d+)/.exec(deliveryRecovery.stdout);
    assert(
      before?.[1] === 'processing',
      `被杀进程应留下 processing 投递责任，实际 ${before?.[1] ?? '未读到'}`,
    );
    assert(
      Number(after?.[2]) > Number(before?.[2]),
      `租约过期后必须重新投递（原 attempt ${before?.[2]}），实际 ${after?.[2]}`,
    );

    // ── ⑤ 模型请求**在途**时被 SIGKILL → 投递租约过期后重新投递 ────────────
    // 假上游只接受连接、永不响应；用户 provider 在 fixture 内被写库指向它，
    // 因此子进程会真的卡在模型请求里。父进程确认「上游已收到连接」后才杀，
    // 这才证明「请求在途时被杀」而不是「还没发起请求就被杀」。
    let upstreamAccepted: () => void = () => undefined;
    const upstreamReached = new Promise<void>((resolveAccepted) => {
      upstreamAccepted = resolveAccepted;
    });
    const upstreamSockets = new Set<Socket>();
    const upstream = createServer((socket) => {
      upstreamSockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => upstreamSockets.delete(socket));
      upstreamAccepted();
    });
    /** 关掉上游并断开已建连接：让后续投递快速失败，而不是一直挂着。 */
    const closeUpstream = (): void => {
      upstream.close();
      for (const socket of upstreamSockets) socket.destroy();
      upstreamSockets.clear();
    };
    await new Promise<void>((resolveListening) =>
      upstream.listen(0, '127.0.0.1', resolveListening),
    );
    const upstreamBaseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;

    try {
      const inflightSession = 's-xproc-inflight';
      const inflightVictim = await spawnFixture(
        ['stream-to-upstream-and-hang', inflightSession, 'xproc-inflight-key', upstreamBaseUrl],
        env,
        { killAfterMs: 30_000, killWhen: upstreamReached },
      );
      assert(
        inflightVictim.signal === 'SIGKILL',
        `模型请求在途的进程必须被真实 SIGKILL 终止，实际 signal=${inflightVictim.signal}`,
      );
      assert(
        inflightVictim.stdout.includes('FIXTURE_STREAMING_REQUEST'),
        `被杀前必须已进入真实流式执行，实际输出：${inflightVictim.stdout.slice(0, 300)}`,
      );

      // 必须先关掉假上游：否则恢复进程重新投递时会再次挂到这个永不响应的上游上，
      // 永远跑不完（实测 60s 超时）。关掉后连接立即失败，投递得以推进。
      closeUpstream();

      const inflightRecovery = await spawnFixture(
        ['recover-delivery-lease', inflightSession, ''],
        env,
      );
      const inflightBefore = /FIXTURE_BEFORE state=(\S+) attempt=(-?\d+)/.exec(
        inflightRecovery.stdout,
      );
      const inflightAfter = /FIXTURE_AFTER state=(\S+) attempt=(-?\d+)/.exec(
        inflightRecovery.stdout,
      );
      assert(
        inflightBefore?.[1] === 'processing',
        `请求在途被杀应留下 processing 投递责任，实际 ${inflightBefore?.[1] ?? '未读到'}`,
      );
      assert(
        Number(inflightAfter?.[2]) > Number(inflightBefore?.[2]),
        `租约过期后必须重新投递（原 attempt ${inflightBefore?.[2]}），实际 ${inflightAfter?.[2]}`,
      );
    } finally {
      closeUpstream();
    }

    console.log('verify-team-inbound-cross-process-crash: ok');
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

void main().catch((error) => {
  console.error('verify-team-inbound-cross-process-crash: failed');
  console.error(error);
  process.exitCode = 1;
});
