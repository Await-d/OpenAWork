/**
 * 子代理委派权限门控验收（`task_run` 类别）。
 *
 * 契约（2026-09-23 反转自旧的「默认免审批」）：
 *   1) 默认（ask 档位）chat 会话：委派子代理**需要用户批准** —— 产生 pending
 *      permission、子代理不自动运行；
 *   2) `auto-edit` 档位：只覆盖 edit/write，不覆盖委派 —— 仍需批准；
 *   3) `yolo` 档位：免审批（免审批分支在 ask 之前），子代理自动运行；
 *   4) 批准后重试：`session` 决策命中 saved approval（scope = `task:<description>`），
 *      委派直接执行 —— 覆盖「申请 → 批准 → 继续」闭环；
 *   5) team 后台成员（`isBackgroundAutoApprovedTeamSession`）免审批，由既有 team
 *      验收覆盖，不在本脚本范围。
 *
 * 历史：旧脚本 `verify-task-tool-no-permission.ts` 断言「task 默认免审批」；
 * 该契约已按需求反转（chat 非 yolo → 申请；免审批只留 yolo / team 后台），
 * 本脚本取代它。
 *
 * 运行：`bun run --filter @openAwork/agent-gateway test:task-permission`
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import authPlugin from '../infra/auth.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import requestWorkflowPlugin from '../runtime/request-workflow.js';
import { permissionsRoutes } from '../routes/permissions.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import {
  assert,
  createProtocolAwareStream,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

async function main(): Promise<void> {
  let app: FastifyInstance | null = null;

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
    },
    async () => {
      await withMockFetch(
        async (input) => createProtocolAwareStream(input, '子代理已经执行完成。'),
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const email = `task-permission-gate-${userId}@openawork.local`;
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              email,
              'hash',
            ]);

            app = Fastify();
            await app.register(requestWorkflowPlugin);
            await app.register(authPlugin);
            await app.register(permissionsRoutes);
            await app.ready();
            const accessToken = app.jwt.sign({ sub: userId, email });

            const sandbox = createDefaultSandbox();

            // 父会话置为**非空闲**：本脚本关注权限门控，与唤醒无关；
            // 否则空闲父会话在 yolo / 批准场景结算时会同步唤醒，与脚本收尾竞态。
            const insertParentSession = (
              sessionId: string,
              extraMetadata: Record<string, unknown> = {},
            ): void => {
              sqliteRun(
                `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
                [
                  sessionId,
                  userId,
                  JSON.stringify({ workingDirectory: WORKSPACE_ROOT, ...extraMetadata }),
                ],
              );
            };

            const executeTask = (
              parentSessionId: string,
              toolCallId: string,
              description = '让子代理写出结论',
            ) =>
              sandbox.execute(
                {
                  toolCallId,
                  toolName: 'task',
                  rawInput: {
                    description,
                    prompt: '请给出最终结论',
                    subagent_type: 'explore',
                    load_skills: [],
                    run_in_background: true,
                  },
                },
                new AbortController().signal,
                parentSessionId,
                {
                  clientRequestId: `req-${toolCallId}`,
                  nextRound: 2,
                  requestData: {
                    clientRequestId: `req-${toolCallId}`,
                    message: '请委派一个子代理',
                    model: 'gpt-4o',
                    maxTokens: 512,
                    temperature: 1,
                    webSearchEnabled: false,
                  },
                },
              );

            const countPermissionRequests = (parentSessionId: string): number =>
              sqliteGet<{ count: number }>(
                // 写入的 tool_name 是权限**类别**（`task_run`），不是工具名（`task`）。
                `SELECT COUNT(1) AS count FROM permission_requests WHERE session_id = ? AND tool_name = 'task_run'`,
                [parentSessionId],
              )?.count ?? 0;

            const countPendingPermissions = (parentSessionId: string): number =>
              sqliteGet<{ count: number }>(
                `SELECT COUNT(1) AS count FROM permission_requests WHERE session_id = ? AND tool_name = 'task_run' AND status = 'pending'`,
                [parentSessionId],
              )?.count ?? 0;

            const pendingPermissionId = (parentSessionId: string): string | undefined =>
              sqliteGet<{ id: string }>(
                `SELECT id FROM permission_requests WHERE session_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                [parentSessionId],
              )?.id;

            const parentTaskCount = async (parentSessionId: string): Promise<number> => {
              const graph = await new AgentTaskManagerImpl().loadOrCreate(
                WORKSPACE_ROOT,
                parentSessionId,
              );
              return Object.keys(graph.tasks).length;
            };

            const waitTaskCompleted = (parentSessionId: string, label: string) =>
              waitFor(
                async () => {
                  const graph = await new AgentTaskManagerImpl().loadOrCreate(
                    WORKSPACE_ROOT,
                    parentSessionId,
                  );
                  return Object.values(graph.tasks).some((task) => task.status === 'completed');
                },
                label,
                200,
                25,
              );

            // ── 1) 默认（ask 档位）：委派需要批准，子代理不启动 ──
            const askParentSessionId = randomUUID();
            insertParentSession(askParentSessionId);
            const askResult = await executeTask(askParentSessionId, 'task-call-ask');

            assert(
              typeof askResult.pendingPermissionRequestId === 'string' &&
                askResult.pendingPermissionRequestId.length > 0,
              '默认档位下 task 委派应产生 pendingPermissionRequestId（需要用户批准）',
            );
            assert(
              askResult.isError === true,
              '默认档位下 task 委派应返回待批准结果（isError=true，调用未执行）',
            );
            assert(
              typeof askResult.output === 'string' &&
                String(askResult.output).includes('requires approval'),
              '待批准结果应说明需要用户批准后重试',
            );
            assert(
              countPermissionRequests(askParentSessionId) === 1,
              '默认档位下 task 委派应写入一条 permission_requests',
            );
            assert(
              (await parentTaskCount(askParentSessionId)) === 0,
              '委派待批准期间不应创建任何子任务（子代理未启动）',
            );

            const askPendingResponse = await app.inject({
              method: 'GET',
              url: `/sessions/${askParentSessionId}/permissions/pending`,
              headers: { authorization: `Bearer ${accessToken}` },
            });
            assert(
              askPendingResponse.statusCode === 200,
              'pending permissions route should succeed',
            );
            const askPendingBody: { requests?: unknown[] } = askPendingResponse.json();
            assert(
              Array.isArray(askPendingBody.requests) && askPendingBody.requests.length === 1,
              '默认档位下 pending permissions 列表应包含该委派请求',
            );

            // ── 2) auto-edit 档位：只覆盖 edit/write，委派仍需批准 ──
            const autoEditParentSessionId = randomUUID();
            insertParentSession(autoEditParentSessionId, { permissionMode: 'auto-edit' });
            const autoEditResult = await executeTask(
              autoEditParentSessionId,
              'task-call-auto-edit',
            );
            assert(
              typeof autoEditResult.pendingPermissionRequestId === 'string',
              'auto-edit 档位下 task 委派仍需批准（该档位只覆盖 edit/write）',
            );
            assert(
              countPermissionRequests(autoEditParentSessionId) === 1,
              'auto-edit 档位下 task 委派应写入一条 permission_requests',
            );

            // ── 3) yolo 档位：免审批并自动运行 ──
            const yoloParentSessionId = randomUUID();
            insertParentSession(yoloParentSessionId, { permissionMode: 'yolo' });
            const yoloResult = await executeTask(yoloParentSessionId, 'task-call-yolo');
            assert(yoloResult.isError === false, 'yolo 档位下 task 委派应直接执行');
            assert(
              yoloResult.pendingPermissionRequestId === undefined,
              'yolo 档位下 task 委派不应产生 pendingPermissionRequestId',
            );
            assert(
              countPermissionRequests(yoloParentSessionId) === 0,
              'yolo 档位下 task 委派不应写入 permission_requests',
            );
            await waitTaskCompleted(yoloParentSessionId, 'yolo 档位下委派的子任务应自动完成');

            // ── 4) 批准后重试：`session` 决策命中 saved approval，委派直接执行 ──
            const approvedParentSessionId = randomUUID();
            insertParentSession(approvedParentSessionId);
            const firstAttempt = await executeTask(approvedParentSessionId, 'task-call-approve-1');
            assert(
              typeof firstAttempt.pendingPermissionRequestId === 'string',
              '批准场景首次委派应产生待批准请求',
            );
            const requestId = pendingPermissionId(approvedParentSessionId);
            assert(typeof requestId === 'string', '批准场景应能查到 pending 权限请求 id');

            const replyResponse = await app.inject({
              method: 'POST',
              url: `/sessions/${approvedParentSessionId}/permissions/reply`,
              headers: { authorization: `Bearer ${accessToken}` },
              payload: { requestId, decision: 'session' },
            });
            assert(replyResponse.statusCode === 200, '批准权限请求应成功');

            // 同一 description → scope 相同（`task:<description>`）→ 命中 saved approval。
            const retryResult = await executeTask(approvedParentSessionId, 'task-call-approve-2');
            assert(
              retryResult.pendingPermissionRequestId === undefined,
              '批准后重试委派不应再次产生 pending（命中 saved approval）',
            );
            assert(retryResult.isError === false, '批准后重试委派应直接执行成功');
            // 注意：`session` 决策会额外写入一条类别级**合成批准行**
            //（`scope='*'`, status='approved'，见 routes/permissions.ts 的 session 分支），
            // 因此总行数不是 1；这里断言的是「没有新增**待批准**请求」。
            assert(
              countPendingPermissions(approvedParentSessionId) === 0,
              '批准后重试不应留下新的待批准请求',
            );
            await waitTaskCompleted(approvedParentSessionId, '批准后委派的子任务应完成');

            // ── 5) cron 无人会话：委派免审批，写操作保持 ask ──
            const cronParentSessionId = randomUUID();
            insertParentSession(cronParentSessionId, { source: 'cron', cronJobId: 'job-cron-1' });
            const cronResult = await executeTask(cronParentSessionId, 'task-call-cron');
            assert(
              cronResult.pendingPermissionRequestId === undefined,
              'cron 无人会话的委派应免审批（否则定时任务静默停摆）',
            );
            assert(cronResult.isError === false, 'cron 无人会话的委派应直接执行');
            assert(
              countPermissionRequests(cronParentSessionId) === 0,
              'cron 无人会话的委派不应写入 permission_requests',
            );
            await waitTaskCompleted(cronParentSessionId, 'cron 会话委派的子任务应完成');

            // 豁免只覆盖委派类别：cron 会话内的写操作仍走 ask（既有语义）。
            const cronWriteResult = await sandbox.execute(
              {
                toolCallId: 'write-cron-1',
                toolName: 'write',
                rawInput: { path: join(WORKSPACE_ROOT, 'cron-write.txt'), content: 'x' },
              },
              new AbortController().signal,
              cronParentSessionId,
              {
                clientRequestId: 'req-write-cron-1',
                nextRound: 3,
                requestData: {
                  clientRequestId: 'req-write-cron-1',
                  message: '写一个文件',
                  model: 'gpt-4o',
                },
              },
            );
            assert(
              typeof cronWriteResult.pendingPermissionRequestId === 'string',
              'cron 会话的写操作仍应申请审批（豁免只覆盖委派类别）',
            );

            // ── 6) 渠道会话：渠道策略已启用 task 时委派免审批（channel-policy） ──
            const channelParentSessionId = randomUUID();
            insertParentSession(channelParentSessionId, {
              source: 'channel',
              channelLlmToolsEnabled: true,
              channel: {
                tools: { task: true },
                permissions: { allowSubAgents: true },
              },
            });
            const channelResult = await executeTask(channelParentSessionId, 'task-call-channel');
            assert(
              channelResult.pendingPermissionRequestId === undefined,
              '渠道会话（已启用子代理）的委派应免审批（channel-policy 豁免）',
            );
            assert(channelResult.isError === false, '渠道会话的委派应直接执行');
            await waitTaskCompleted(channelParentSessionId, '渠道会话委派的子任务应完成');

            console.log(
              ': ok  子代理委派权限门控（默认 ask 申请 / auto-edit 仍申请 / yolo 免审批 / 批准后重试继续 / cron 无人会话免审批 / 渠道策略免审批）',
            );
            console.log('[verify-task-tool-permission-gate] all assertions passed');
          } finally {
            if (app) {
              await app.close();
            }
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-tool-permission-gate: failed');
  console.error(error);
  process.exitCode = 1;
});
