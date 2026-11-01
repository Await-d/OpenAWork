/**
 * 会话扩展中断恢复的跨进程 fixture（261101 / T-22）。
 *
 * 只走生产 seam：`createSessionExtensionOperation` → `approve…` → `mark…Applying`，
 * 然后**挂起**等父进程 `SIGKILL`——模拟「安装执行到一半网关被杀」。恢复进程再跑
 * 真实的启动路径（`failInterruptedSessionExtensionOperations` + 过期收敛 + 回执补偿），
 * 断言改判失败**并且**补上了渠道回执。
 *
 * 为什么不写单测：单测只能证明函数本身正确，证明不了「重启后进程真的会调它」，
 * 而那恰恰是 T-22 要验的东西。
 */

import { connectDb, migrate, sqliteGet, sqliteRun } from '../infra/db.js';
import {
  createSessionExtensionOperation,
  markSessionExtensionOperationApplying,
  approveSessionExtensionOperation,
  getSessionExtensionOperation,
  failInterruptedSessionExtensionOperations,
  expireStaleSessionExtensionOperations,
} from '../session-extension/session-extension-operation-store.js';
import {
  reconcileSessionExtensionDeliveries,
  getSessionExtensionDelivery,
} from '../session-extension/session-extension-delivery-store.js';

const USER_ID = 'u-xproc-ext';
const MARKER_APPLYING = 'FIXTURE_APPLYING';
const MARKER_RECOVER = 'FIXTURE_RECOVER';

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function seed(): void {
  sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function seedSession(sessionId: string): void {
  sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'demo', '{}', 'idle')`,
    [sessionId, USER_ID],
  );
}

/** 建一条已批准、已置 `applying` 的操作——这就是「执行到一半」的现场。 */
function startApplying(sessionId: string): string {
  const operation = createSessionExtensionOperation({
    sessionId,
    ownerUserId: USER_ID,
    kind: 'skill',
    action: 'install',
    resourceRef: 'skill:session:xproc',
    payload: { skillId: 'xproc', displayName: '跨进程用例技能' },
    configDigest: null,
    expectedRevision: null,
  });
  approveSessionExtensionOperation({
    sessionId,
    operationId: operation.id,
    approverUserId: USER_ID,
    nonce: operation.nonce,
  });
  markSessionExtensionOperationApplying({ sessionId, operationId: operation.id });
  return operation.id;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '';
  const sessionId = process.argv[3] ?? 's-xproc-ext';

  await connectDb();
  await migrate();
  seed();
  seedSession(sessionId);

  if (mode === 'apply-and-hang') {
    const operationId = startApplying(sessionId);
    const operation = getSessionExtensionOperation(sessionId, operationId);
    log(`${MARKER_APPLYING} ${operationId} status=${operation?.status ?? 'missing'}`);
    // 挂住不退出：父进程看到标记后 SIGKILL，精确命中「applying 中途被杀」。
    setInterval(() => undefined, 1_000);
    return;
  }

  if (mode === 'recover') {
    // 与 `index.ts` 的启动顺序一致：先改判中断、再收敛过期、最后补回执。
    failInterruptedSessionExtensionOperations();
    expireStaleSessionExtensionOperations();
    reconcileSessionExtensionDeliveries();

    const row = sqliteGet<{ id: string; status: string; error_code: string | null }>(
      `SELECT id, status, error_code FROM session_extension_operations
        WHERE session_id = ? ORDER BY created_at ASC LIMIT 1`,
      [sessionId],
    );
    const delivery = row ? getSessionExtensionDelivery(row.id) : undefined;
    log(
      `${MARKER_RECOVER} status=${row?.status ?? 'missing'} errorCode=${
        row?.error_code ?? 'none'
      } delivery=${delivery?.state ?? 'none'}`,
    );
    return;
  }

  throw new Error(`unknown fixture mode: ${mode}`);
}

await main();
process.exit(0);
