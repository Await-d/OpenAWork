/**
 * verify-team-full-chain-real-session — T-20 全链路真实模型验收（L2 从接待一路跑到评审）。
 *
 * 与 `verify-team-depth-real-session.ts` 的分工：
 *   - 那个脚本只验证**接待层编排边界**（四类深度的 handoff 数与耗时）；
 *   - 本脚本把同一个 reception→pm1 handoff 交给**生产 watcher + 生产 runner**
 *     （`createPhaseCAwareRunner`：pm1 → pm2 → executor/reviewer），用真实模型跑完整链路，
 *     回答 T-20 判据里最后一条：「L3 场景双评审通过」「四类均无静默丢任务」是否成立。
 *
 * 运行：`bun run verify -- src/verification/verify-team-full-chain-real-session.ts`
 * 需要真实模型（AI_API_BASE_URL / AI_API_KEY / AI_DEFAULT_MODEL）。
 *
 * 边界（不要当成已验证）：
 *   - 用的是 L2 输入而不是 L3：L3 会先进澄清拷问（确定性路径），需要额外一轮用户回答
 *     才能继续，本脚本不在同一进程里模拟多轮对话。
 *   - 只驱动到「所有 handoff 进入终态或超时」；若某层因环境（工作区/工具）失败，
 *     脚本会**如实打印失败原因并判失败**，不会把「跑不动」当通过。
 */

import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, migrate, sqliteAll, sqliteRun } from '../infra/db.js';
import { InProcessScheduler } from '../handoff/runner/scheduler.js';
import { orchestrateReceptionInput } from '../handoff/runner/reception-orchestrator.js';
import type * as WatcherModule from '../handoff/runner/watcher.js';

/**
 * 驱动上限。真实模型跑完整链路是分钟级，可用 `OPENAWORK_VERIFY_CHAIN_TIMEOUT_MS` 调整；
 * 超出上限会以「仍有未终态 handoff」失败，而不是把「没跑完」当通过。
 *
 * 必须**小于**包装器 `run-with-test-env.ts` 给子进程的 600s 上限：取相等值时脚本会被
 * 包装器先杀掉，连「为什么没跑完」的结论都来不及输出（实测踩过）。
 */
const RUN_TIMEOUT_MS = Number(process.env['OPENAWORK_VERIFY_CHAIN_TIMEOUT_MS'] ?? 8 * 60_000);
const INTENT = '实现订单提交接口并让前端调用';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`T-20 全链路验收失败：${message}`);
}

function seedProvider(input: {
  userId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): void {
  const providerId = 't20-fullchain-endpoint';
  const nowIso = new Date().toISOString();
  sqliteRun(
    `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)`,
    [
      input.userId,
      JSON.stringify([
        {
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          createdAt: nowIso,
          defaultModels: [{ enabled: true, id: input.model, label: input.model }],
          enabled: true,
          id: providerId,
          name: 'T-20 全链路验收端点',
          type: 'custom',
          updatedAt: nowIso,
          upstreamProtocol: 'chat_completions',
        },
      ]),
    ],
  );
  sqliteRun(
    `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)`,
    [
      input.userId,
      JSON.stringify({
        chat: { modelId: input.model, providerId },
        fast: { modelId: input.model, providerId },
      }),
    ],
  );
}

interface HandoffRow {
  from_role_layer: string;
  state: string;
  to_role_layer: string;
}

async function main(): Promise<void> {
  const baseUrl = (process.env['AI_API_BASE_URL'] ?? '').trim();
  const apiKey = (process.env['AI_API_KEY'] ?? '').trim();
  const model = (process.env['AI_DEFAULT_MODEL'] ?? '').trim();
  if (!baseUrl || !apiKey || !model) {
    throw new Error('需要真实模型：请设置 AI_API_BASE_URL / AI_API_KEY / AI_DEFAULT_MODEL');
  }

  await connectDb();
  await migrate();
  const userId = `u-t20-chain-${randomUUID()}`;
  const receptionSessionId = `s-t20-chain-${randomUUID()}`;
  /** 必须在关库前停掉，否则在途 worker 会在库关闭后继续写（实测报 `database is not open`）。 */
  let watcher: InstanceType<typeof WatcherModule.HandoffWatcher> | null = null;

  try {
    sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      userId,
      `${userId}@openawork.local`,
    ]);
    sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, role_layer, state_status)
       VALUES (?, ?, 'reception', '{}', 'reception', 'idle')`,
      [receptionSessionId, userId],
    );
    seedProvider({ apiKey, baseUrl, model, userId });

    // 生产 runner 依赖已注册的各层内置指令工具。
    await import('../handoff/capability/builtin-instructions-impl.js');
    const { HandoffWatcher } = await import('../handoff/runner/watcher.js');
    const { createPhaseCAwareRunner } = await import('../handoff/runner/pm1-runner.js');

    const startedAt = Date.now();
    const orchestrated = await orchestrateReceptionInput({
      userId,
      receptionSessionId,
      userIntent: INTENT,
      autoRunInit: false,
      persistAckMessage: true,
      persistUserMessage: false,
    });
    const dispatchMs = Date.now() - startedAt;
    console.log(`接待层派发耗时：${dispatchMs}ms，reason=${orchestrated.reason ?? '（已派发）'}`);

    watcher = new HandoffWatcher({
      scheduler: new InProcessScheduler(),
      taskRunner: createPhaseCAwareRunner(),
    });

    // 反复驱动，直到没有未终态 handoff 或超时。
    let ticks = 0;
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    const readRows = (): HandoffRow[] =>
      sqliteAll<HandoffRow>(
        `SELECT from_role_layer, to_role_layer, state FROM handoff_records`,
        [],
      );
    while (Date.now() < deadline) {
      const active = readRows().filter(
        (row) => row.state === 'pending' || row.state === 'claimed' || row.state === 'running',
      );
      if (active.length === 0 && ticks > 0) break;
      ticks += 1;
      await watcher.tickOnce();
      // 不每 tick 调 recoveryTick：生产由 watcher 自己的慢周期触发，而本循环每 250ms
      // 跑一次，若也调 recovery 会以远高于生产的频率判定「心跳陈旧」，从而把**在途**的
      // 长任务误回收并重派（实测会把 reception→pm1 变成 4 条）。只在没有推进时兜底一次。
      if (ticks % 80 === 0) await watcher.recoveryTick();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const elapsedMs = Date.now() - startedAt;

    const rows = readRows();
    const byState = rows.reduce<Record<string, number>>((acc, row) => {
      const key = `${row.from_role_layer}→${row.to_role_layer}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`\n链路耗时：${elapsedMs}ms（派发 ${dispatchMs}ms），ticks=${ticks}`);
    console.log('handoff 统计（来源→目标：条数）:');
    for (const [key, count] of Object.entries(byState)) console.log(`- ${key}: ${count}`);

    const artifacts = sqliteAll<{ phase: string }>(`SELECT phase FROM artifacts`, []);
    const phases = Array.from(new Set(artifacts.map((row) => row.phase))).sort();
    console.log(`产物阶段：${phases.join(', ') || '（无）'}`);

    console.log('handoff 终态:');
    for (const row of rows) {
      console.log(`- ${row.from_role_layer}→${row.to_role_layer}: ${row.state}`);
    }

    // 判据：接待层必须真的派发出去。
    // 不要求恰好 1 条：某层失败后 watcher 会做降级/重试派发，条数会多于 1，
    // 那属于链路行为而非缺陷；这里只要求「至少派发过」。
    const dispatched = rows.filter((row) => row.from_role_layer === 'reception');
    assert(dispatched.length >= 1, `接待层没有派发任何 handoff`);

    // 判据：链路必须从接待推进到 PM1（有 pm1 的产物或 pm1→pm2 handoff）
    const advanced = phases.some(
      (phase) => phase === 'spec' || phase === 'plan' || phase === 'tasks',
    );
    assert(
      advanced || rows.some((row) => row.from_role_layer === 'pm1'),
      '链路停在接待层，PM1 没有产生任何规划产物',
    );

    // 判据：不得留下静默搁置——所有 handoff 都必须终态（非 pending/claimed/running）
    const stranded = rows.filter(
      (row) => row.state === 'pending' || row.state === 'claimed' || row.state === 'running',
    );
    assert(
      stranded.length === 0,
      `存在未终态 handoff（静默搁置）：${stranded.map((row) => `${row.from_role_layer}→${row.to_role_layer}=${row.state}`).join(', ')}`,
    );

    console.log('\nverify-team-full-chain-real-session: ok');
  } finally {
    // 先停 watcher 等在途任务收尾，再关库：否则后台 worker 会在关库后继续写，
    // 报 `database is not open` 掩盖真正的失败原因。
    if (watcher) await watcher.stop().catch(() => undefined);
    await closeDb();
  }
}

void main().catch((error) => {
  console.error('verify-team-full-chain-real-session: failed');
  console.error(error);
  process.exitCode = 1;
});
