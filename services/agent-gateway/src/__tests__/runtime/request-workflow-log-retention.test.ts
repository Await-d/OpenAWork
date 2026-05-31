import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as WorkflowLogStoreModule from '../../runtime/request-workflow-log-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let logStore: typeof WorkflowLogStoreModule;

function countWorkflowLogRows(): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    `SELECT COUNT(1) AS count FROM request_workflow_logs`,
    [],
  );
  return row?.count ?? 0;
}

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function persistOne(index: number): void {
  logStore.persistRequestWorkflowLog({
    context: {
      requestId: `req-${index}`,
      method: 'GET',
      path: `/health?i=${index}`,
      startTime: Date.now(),
    },
    steps: [{ name: 'request.handle', status: 'success' }],
    statusCode: 200,
    // user_id 故意留空：未认证流量是该表无界增长的主要来源，按全局上限裁剪。
    userId: null,
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  logStore = await import('../../runtime/request-workflow-log-store.js');
});

beforeEach(() => {
  logStore.resetRequestWorkflowLogStoreStateForTests();
  dbModule.sqliteRun('DELETE FROM request_workflow_logs', []);
  seedUser('user-1', 'wf-user-1@example.com');
});

afterEach(() => {
  logStore.resetRequestWorkflowLogStoreStateForTests();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('request-workflow-log-store 保留裁剪', () => {
  it('全局行数被裁剪到保留上限附近（不会无界增长）', () => {
    const limit = 20;
    logStore.__setRequestWorkflowLogRetentionForTesting(limit);

    const total = logStore.REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL * 3 + 17;
    for (let i = 0; i < total; i += 1) {
      persistOne(i);
    }

    const count = countWorkflowLogRows();
    // 摊销裁剪：行数最多比上限多出一个检查间隔的过冲，但绝不随插入次数线性增长。
    expect(count).toBeLessThanOrEqual(limit + logStore.REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL);
    expect(count).toBeLessThan(total);

    // 保留的是最新的若干行：最后一条 request_id 必须仍在。
    const newest = dbModule.sqliteGet<{ request_id: string }>(
      `SELECT request_id FROM request_workflow_logs ORDER BY id DESC LIMIT 1`,
      [],
    );
    expect(newest?.request_id).toBe(`req-${total - 1}`);
  });

  it('连续触发多轮后稳定收敛到保留上限附近', () => {
    const limit = 50;
    logStore.__setRequestWorkflowLogRetentionForTesting(limit);

    for (let i = 0; i < logStore.REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL * 5; i += 1) {
      persistOne(i);
    }

    expect(countWorkflowLogRows()).toBeLessThanOrEqual(
      limit + logStore.REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL,
    );
  });

  it('保留上限设为非正数时关闭裁剪（行数随插入线性增长）', () => {
    logStore.__setRequestWorkflowLogRetentionForTesting(0);

    const total = logStore.REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL * 2 + 11;
    for (let i = 0; i < total; i += 1) {
      persistOne(i);
    }

    expect(countWorkflowLogRows()).toBe(total);
  });

  it('裁剪不影响 listRequestWorkflowLogs 对最新行的查询', () => {
    const limit = 10;
    logStore.__setRequestWorkflowLogRetentionForTesting(limit);

    for (let i = 0; i < logStore.REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL + 5; i += 1) {
      logStore.persistRequestWorkflowLog({
        context: {
          requestId: `req-u-${i}`,
          method: 'POST',
          path: `/usage?page=1`,
          startTime: Date.now(),
        },
        steps: [{ name: 'request.handle', status: 'success' }],
        statusCode: 200,
        userId: 'user-1',
      });
    }

    const rows = logStore.listRequestWorkflowLogs('user-1', 5);
    expect(rows.length).toBeLessThanOrEqual(5);
    // 最新一条仍可查到。
    expect(rows[0]?.request_id).toBe(
      `req-u-${logStore.REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL + 5 - 1}`,
    );
  });
});
