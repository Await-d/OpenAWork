import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamRoutesModule from '../../routes/team.js';
import type * as LatencyMonitorModule from '../../handoff/bus/latency-monitor.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';
import type * as TeamRuntimeDiagnosticsStoreModule from '../../team/team-runtime-diagnostics-store.js';
import type * as TeamRuntimeAlertStoreModule from '../../team/team-runtime-alert-store.js';
import type * as TeamRuntimeTelemetryModule from '../../team/team-runtime-telemetry.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
  resolveAuxiliaryLlmConfigCandidates: async () => [],
}));

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamRoutes: typeof TeamRoutesModule.teamRoutes;
let latencyMonitor: typeof LatencyMonitorModule;
let teamEventsBus: typeof TeamEventsBusModule;
let diagnosticsStore: typeof TeamRuntimeDiagnosticsStoreModule;
let alertStore: typeof TeamRuntimeAlertStoreModule;
let telemetryModule: typeof TeamRuntimeTelemetryModule;
let sessionRuntimeThreadStaleAfterMs: number;

const USER_ID = 'u-team-runtime';
const SESSION_ACTIVE_ID = 's-team-runtime-active';
const SESSION_STALE_ID = 's-team-runtime-stale';
const TEAM_WORKSPACE_ID = 'tw-team-runtime';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
  return `Bearer ${token}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedTeamSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'team-session', ?, 'idle')`,
    [sessionId, userId, JSON.stringify({ teamWorkspaceId: TEAM_WORKSPACE_ID })],
  );
}

function seedTeamMember(memberId: string, userId: string, name: string, email: string): void {
  dbModule.sqliteRun(
    `INSERT INTO team_members (id, user_id, name, email, role, avatar_url, status)
     VALUES (?, ?, ?, ?, 'member', NULL, 'idle')`,
    [memberId, userId, name, email],
  );
}

function seedTeamMessage(
  messageId: string,
  userId: string,
  input: {
    content: string;
    recipientMemberId?: string | null;
    replyToMessageId?: string | null;
    sessionId?: string | null;
    senderId?: string | null;
    type: string;
  },
): void {
  dbModule.sqliteRun(
    `INSERT INTO team_messages
      (id, user_id, session_id, sender_id, recipient_member_id, reply_to_message_id, content, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      messageId,
      userId,
      input.sessionId ?? null,
      input.senderId ?? null,
      input.recipientMemberId ?? null,
      input.replyToMessageId ?? null,
      input.content,
      input.type,
    ],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  const sessionRuntimeThreadStore = await import('../../session/session-runtime-thread-store.js');
  sessionRuntimeThreadStaleAfterMs =
    sessionRuntimeThreadStore.SESSION_RUNTIME_THREAD_STALE_AFTER_MS;
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../../runtime/request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  const team = await import('../../routes/team.js');
  teamRoutes = team.teamRoutes;
  latencyMonitor = await import('../../handoff/bus/latency-monitor.js');
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
  diagnosticsStore = await import('../../team/team-runtime-diagnostics-store.js');
  alertStore = await import('../../team/team-runtime-alert-store.js');
  telemetryModule = await import('../../team/team-runtime-telemetry.js');
});

beforeEach(() => {
  latencyMonitor.__resetLatencyMonitorForTesting();
  teamEventsBus.__clearTeamEventsBusForTesting();
  diagnosticsStore.__resetTeamRuntimeDiagnosticsForTesting();
  alertStore.__resetTeamRuntimeAlertStoreForTesting();
  telemetryModule.__resetTeamRuntimeTelemetryForTesting();
  dbModule.sqliteRun('DELETE FROM team_tool_call_records', []);
  dbModule.sqliteRun('DELETE FROM question_requests', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM session_runtime_threads', []);
  dbModule.sqliteRun('DELETE FROM team_runtime_alert_controls', []);
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM team_messages', []);
  dbModule.sqliteRun('DELETE FROM team_tasks', []);
  dbModule.sqliteRun('DELETE FROM team_members', []);
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedTeamSession(SESSION_ACTIVE_ID, USER_ID);
  seedTeamSession(SESSION_STALE_ID, USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /team/runtime', () => {
  it('返回 runtime handoffs 与 sessions.roleLayer，供前端断线恢复对齐', async () => {
    const store = await import('../../handoff/store/handoff-store.js');
    dbModule.sqliteRun(`UPDATE sessions SET role_layer = 'reception' WHERE id = ?`, [
      SESSION_ACTIVE_ID,
    ]);
    dbModule.sqliteRun(`UPDATE sessions SET role_layer = 'pm1', metadata_json = ? WHERE id = ?`, [
      JSON.stringify({
        teamWorkspaceId: TEAM_WORKSPACE_ID,
        teamRoleInstance: {
          rootSessionId: SESSION_ACTIVE_ID,
          roleLayer: 'pm1',
          personaKey: 'pm1:default',
          displayName: '规划负责人',
        },
      }),
      SESSION_STALE_ID,
    ]);

    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { sourceIntent: '恢复链路测试' },
    });
    store.claimHandoff({ handoffId: handoff.id, claimToken: 'tok-runtime-snapshot' });
    store.startHandoff({
      handoffId: handoff.id,
      claimToken: 'tok-runtime-snapshot',
      toSessionId: SESSION_STALE_ID,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        handoffs?: Array<{
          fromRoleLayer: string;
          fromSessionId: string;
          id: string;
          payload: Record<string, unknown> | null;
          state: string;
          toRoleLayer: string;
          toSessionId: string | null;
        }>;
        sessions?: Array<{
          id: string;
          parentSessionId: string | null;
          roleInstance?: {
            rootSessionId: string;
            roleLayer: string;
            personaKey: string | null;
            displayName: string | null;
          };
          roleLayer: string | null;
        }>;
      };

      expect(data.handoffs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromRoleLayer: 'reception',
            fromSessionId: SESSION_ACTIVE_ID,
            id: handoff.id,
            payload: expect.objectContaining({
              sourceIntent: '恢复链路测试',
            }),
            state: 'running',
            toRoleLayer: 'pm1',
            toSessionId: SESSION_STALE_ID,
          }),
        ]),
      );
      expect(data.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: SESSION_ACTIVE_ID,
            parentSessionId: null,
            roleLayer: 'reception',
          }),
          expect.objectContaining({
            id: SESSION_STALE_ID,
            parentSessionId: null,
            roleInstance: {
              rootSessionId: SESSION_ACTIVE_ID,
              roleLayer: 'pm1',
              personaKey: 'pm1:default',
              displayName: '规划负责人',
            },
            roleLayer: 'pm1',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('从 PM2 派发 handoff 投影 runtime task，不依赖人工任务表或 session todo', async () => {
    const store = await import('../../handoff/store/handoff-store.js');
    dbModule.sqliteRun(`UPDATE sessions SET role_layer = 'pm2' WHERE id = ?`, [SESSION_ACTIVE_ID]);
    dbModule.sqliteRun(
      `UPDATE sessions
          SET role_layer = 'executor',
              team_parent_session_id = ?
        WHERE id = ?`,
      [SESSION_ACTIVE_ID, SESSION_STALE_ID],
    );

    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      payload: {
        goal: '实现 /api/chat-widget/init 端点',
        role: 'executor',
        taskMarkers: {
          taskId: 'T007',
          priority: 'high',
        },
        assignedMember: {
          id: 'executor-backend',
          displayName: '后端开发者',
          specialty: 'backend',
        },
        dependsOn: ['T003'],
      },
    });
    store.claimHandoff({ handoffId: handoff.id, claimToken: 'tok-dispatch-task' });
    store.startHandoff({
      handoffId: handoff.id,
      claimToken: 'tok-dispatch-task',
      toSessionId: SESSION_STALE_ID,
    });
    store.failHandoff({
      handoffId: handoff.id,
      claimToken: 'tok-dispatch-task',
      reason: 'executor 层执行失败：模型服务内部错误，请稍后重试',
    });
    const duplicateMarkerHandoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      payload: {
        goal: '实现 /api/chat-widget/status 端点',
        role: 'executor',
        taskMarkers: {
          taskId: 'T007',
          priority: 'medium',
        },
        assignedMember: {
          id: 'executor-backend',
          displayName: '后端开发者',
          specialty: 'backend',
        },
      },
    });
    store.claimHandoff({
      handoffId: duplicateMarkerHandoff.id,
      claimToken: 'tok-dispatch-task-duplicate',
    });
    store.startHandoff({
      handoffId: duplicateMarkerHandoff.id,
      claimToken: 'tok-dispatch-task-duplicate',
      toSessionId: SESSION_STALE_ID,
    });

    expect(
      dbModule.sqliteGet<{ count: number }>('SELECT COUNT(*) AS count FROM team_tasks', []),
    ).toMatchObject({ count: 0 });
    expect(
      dbModule.sqliteGet<{ count: number }>('SELECT COUNT(*) AS count FROM session_todos', []),
    ).toMatchObject({ count: 0 });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        runtimeTaskGroups?: Array<{
          sessionIds: string[];
          tasks: Array<{
            blockedBy: string[];
            assignedAgent?: string;
            errorMessage?: string;
            id: string;
            priority: string;
            sessionId?: string;
            status: string;
            tags: string[];
            taskThreadId?: string;
            title: string;
          }>;
        }>;
      };
      const projectedTasks = (data.runtimeTaskGroups ?? []).flatMap((group) => group.tasks);

      expect(projectedTasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            blockedBy: [`handoff:${SESSION_ACTIVE_ID}:T003`],
            assignedAgent: '后端开发者',
            errorMessage: 'executor 层执行失败：模型服务内部错误，请稍后重试',
            id: `handoff:${handoff.id}:T007`,
            priority: 'high',
            sessionId: SESSION_STALE_ID,
            status: 'failed',
            tags: expect.arrayContaining(['T007', 'executor', 'backend']),
            taskThreadId: `handoff:${handoff.id}`,
            title: '实现 /api/chat-widget/init 端点',
          }),
          expect.objectContaining({
            id: `handoff:${duplicateMarkerHandoff.id}:T007`,
            priority: 'medium',
            sessionId: SESSION_STALE_ID,
            status: 'running',
            taskThreadId: `handoff:${duplicateMarkerHandoff.id}`,
            title: '实现 /api/chat-widget/status 端点',
          }),
        ]),
      );
      expect(projectedTasks.filter((task) => task.tags.includes('T007'))).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('返回 clarifications 快照，供前端断线恢复待澄清列表', async () => {
    dbModule.sqliteRun(`UPDATE sessions SET role_layer = 'reception' WHERE id = ?`, [
      SESSION_ACTIVE_ID,
    ]);
    dbModule.sqliteRun(`UPDATE sessions SET role_layer = 'pm1' WHERE id = ?`, [SESSION_STALE_ID]);
    dbModule.sqliteRun(
      `INSERT INTO session_inbound_messages
        (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state)
       VALUES ('clarify-runtime-snapshot', ?, ?, 'pm1', 'escalation_request', ?, 'pending')`,
      [
        USER_ID,
        SESSION_ACTIVE_ID,
        JSON.stringify({
          fromLayer: 'pm1',
          fromSessionId: SESSION_STALE_ID,
          reason: 'needs_clarification',
          escalationRound: 0,
          context: '等待用户补充',
          suggestedActions: [{ label: '回答', action: 'answer' }],
          questions: [
            {
              id: 'clarify-runtime-1',
              question: '认证方式？',
              context: '登录模块',
            },
            {
              id: 'clarify-runtime-2',
              question: '部署方式？',
              context: '运维模块',
              status: 'answered',
              answer: 'Docker Compose',
              answeredAt: 1700000002222,
            },
          ],
        }),
      ],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        clarifications?: Array<{
          answer?: string;
          answeredAt?: number;
          fromSessionId: string;
          id: string;
          question: string;
          sessionId: string;
          status: string;
        }>;
      };

      expect(data.clarifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromSessionId: SESSION_STALE_ID,
            id: 'clarify-runtime-1',
            question: '认证方式？',
            sessionId: SESSION_STALE_ID,
            status: 'pending',
          }),
          expect.objectContaining({
            answer: 'Docker Compose',
            answeredAt: 1700000002222,
            fromSessionId: SESSION_STALE_ID,
            id: 'clarify-runtime-2',
            question: '部署方式？',
            sessionId: SESSION_STALE_ID,
            status: 'answered',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('返回 messages 快照，并保留定向跟进字段供前端恢复上下文', async () => {
    seedTeamSession(SESSION_ACTIVE_ID, USER_ID);
    seedTeamMember('member-pm1', USER_ID, 'PM1', 'pm1@example.com');
    seedTeamMember('member-executor', USER_ID, '执行代理', 'executor@example.com');
    seedTeamMessage('msg-parent', USER_ID, {
      sessionId: SESSION_ACTIVE_ID,
      senderId: 'member-pm1',
      content: '同步设计稿调整',
      type: 'update',
    });
    seedTeamMessage('msg-followup', USER_ID, {
      sessionId: SESSION_ACTIVE_ID,
      senderId: 'member-executor',
      recipientMemberId: 'member-pm1',
      replyToMessageId: 'msg-parent',
      content: '接口联调已完成',
      type: 'result',
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        messages?: Array<{
          content: string;
          id: string;
          memberId: string;
          recipientMemberId?: string | null;
          replyToMessageId?: string | null;
          sessionId?: string | null;
          type: string;
        }>;
      };

      expect(data.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'msg-parent',
            memberId: 'member-pm1',
            sessionId: SESSION_ACTIVE_ID,
            content: '同步设计稿调整',
            type: 'update',
          }),
          expect.objectContaining({
            id: 'msg-followup',
            memberId: 'member-executor',
            sessionId: SESSION_ACTIVE_ID,
            recipientMemberId: 'member-pm1',
            replyToMessageId: 'msg-parent',
            content: '接口联调已完成',
            type: 'result',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('runtime 消息快照只返回最近 100 条，并保持时间正序', async () => {
    for (let i = 0; i < 105; i += 1) {
      seedTeamMessage(`msg-${String(i).padStart(3, '0')}`, USER_ID, {
        content: `message-${i}`,
        type: 'update',
      });
    }

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        messages?: Array<{ content: string; id: string }>;
      };

      expect(data.messages).toHaveLength(100);
      expect(data.messages?.[0]).toMatchObject({
        id: 'msg-005',
        content: 'message-5',
      });
      expect(data.messages?.at(-1)).toMatchObject({
        id: 'msg-104',
        content: 'message-104',
      });
    } finally {
      await app.close();
    }
  });

  it('返回 toolCallRecords 快照，供前端刷新后恢复工具明细排行', async () => {
    dbModule.sqliteRun(
      `INSERT INTO team_tool_call_records
        (user_id, session_id, layer, agent_id, tool_name, duration_ms, success, error_type)
       VALUES
        (?, ?, 'pm1', 'agent-reader', 'read', 110, 0, 'timeout'),
        (?, ?, 'pm1', 'agent-reader', 'read', 90, 1, NULL),
        (?, ?, 'pm2', 'agent-writer', 'write', 45, 1, NULL)`,
      [USER_ID, SESSION_ACTIVE_ID, USER_ID, SESSION_ACTIVE_ID, USER_ID, SESSION_STALE_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO team_usage_records
        (user_id, session_id, layer, provider, model, tool_call_count, tool_error_count, updated_at)
       VALUES
        (?, ?, 'pm1', '', '', 2, 1, datetime('now')),
        (?, ?, 'pm2', '', '', 1, 0, datetime('now'))`,
      [USER_ID, SESSION_ACTIVE_ID, USER_ID, SESSION_STALE_ID],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        toolCallRecords?: Array<{
          agentId: string | null;
          durations: number[];
          errorSamples: Array<{ count: number; errorType: string }>;
          failures: number;
          invocations: number;
          layer: string | null;
          sessionId: string;
          successes: number;
          toolName: string;
          totalDurationMs: number;
        }>;
      };

      expect(data.toolCallRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: SESSION_ACTIVE_ID,
            layer: 'pm1',
            agentId: 'agent-reader',
            toolName: 'read',
            invocations: 2,
            successes: 1,
            failures: 1,
            totalDurationMs: 200,
            durations: [90, 110],
            errorSamples: [{ errorType: 'timeout', count: 1 }],
          }),
          expect.objectContaining({
            sessionId: SESSION_STALE_ID,
            layer: 'pm2',
            agentId: 'agent-writer',
            toolName: 'write',
            invocations: 1,
            successes: 1,
            failures: 0,
            totalDurationMs: 45,
            durations: [45],
            errorSamples: [],
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('返回 notifications 快照，供前端断线恢复升级与进度提示', async () => {
    dbModule.sqliteRun(`UPDATE sessions SET role_layer = 'reception' WHERE id = ?`, [
      SESSION_ACTIVE_ID,
    ]);
    dbModule.sqliteRun(`UPDATE sessions SET role_layer = 'pm2' WHERE id = ?`, [SESSION_STALE_ID]);
    dbModule.sqliteRun(
      `INSERT INTO session_inbound_messages
        (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state)
       VALUES
        ('notif-escalation', ?, ?, 'pm2', 'escalation_request', ?, 'pending'),
        ('notif-progress', ?, ?, 'executor', 'progress_report', ?, 'pending')`,
      [
        USER_ID,
        SESSION_ACTIVE_ID,
        JSON.stringify({
          fromLayer: 'pm2',
          fromSessionId: SESSION_STALE_ID,
          reason: 'review_failed_threshold',
          context: '评审连续失败，等待用户决策',
          suggestedActions: [
            { label: '修宪法', action: 'edit_constitution' },
            { label: '改需求', action: 'edit_original_request' },
          ],
        }),
        USER_ID,
        SESSION_ACTIVE_ID,
        JSON.stringify({
          fromLayer: 'executor',
          fromSessionId: SESSION_STALE_ID,
          progressText: '执行进度 3/5',
          percent: 60,
        }),
      ],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        notifications?: Array<{
          layer?: string;
          payload: Record<string, unknown>;
          sessionId?: string;
          type: string;
        }>;
      };

      expect(data.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            layer: 'pm2',
            sessionId: SESSION_STALE_ID,
            type: 'escalation_request',
            payload: expect.objectContaining({
              blocking: true,
              summary: '评审连续失败，等待用户决策',
              suggestedActions: [
                { label: '修宪法', action: 'edit_constitution' },
                { label: '改需求', action: 'edit_original_request' },
              ],
            }),
          }),
          expect.objectContaining({
            layer: 'executor',
            sessionId: SESSION_STALE_ID,
            type: 'progress_report',
            payload: expect.objectContaining({
              blocking: false,
              percent: 60,
              summary: '执行进度 3/5',
            }),
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('runtime incident 会写入 audit log，并在去重窗口内避免重复落库', async () => {
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'latency_violation',
      code: 'latency:a_to_b_direct',
      context: {
        durationMs: 3500,
        sessionId: SESSION_ACTIVE_ID,
        thresholdMs: 3000,
        type: 'a_to_b_direct',
      },
      message: 'a→b 直答 延迟 3500ms 超过阈值 3000ms',
      severity: 'warning',
      timestamp: Date.now(),
      userId: USER_ID,
    });
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'latency_violation',
      code: 'latency:a_to_b_direct',
      context: {
        durationMs: 3500,
        sessionId: SESSION_ACTIVE_ID,
        thresholdMs: 3000,
        type: 'a_to_b_direct',
      },
      message: 'a→b 直答 延迟 3500ms 超过阈值 3000ms',
      severity: 'warning',
      timestamp: Date.now() + 1,
      userId: USER_ID,
    });

    const auditCountRow = dbModule.sqliteGet<{ count: number }>(
      `SELECT COUNT(1) AS count
         FROM team_audit_logs
        WHERE user_id = ? AND action = 'runtime_incident'`,
      [USER_ID],
    );
    expect(auditCountRow?.count).toBe(1);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        auditLogs?: Array<{
          action: string;
          detail: string | null;
          entityType: string;
          sessionId: string | null;
          summary: string;
        }>;
      };

      expect(data.auditLogs?.[0]).toMatchObject({
        action: 'runtime_incident',
        entityType: 'runtime_incident',
        sessionId: SESSION_ACTIVE_ID,
        summary: 'runtime incident: latency:a_to_b_direct',
      });
      expect(data.auditLogs?.[0]?.detail ?? '').toContain('latency_violation');
    } finally {
      await app.close();
    }
  });

  it('runtime incident 缺少 sessionId 时会从 reception/from/to 等上下文补 session 归属', () => {
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'reception-awaiting-downstream-deadlock',
      context: {
        receptionSessionId: SESSION_ACTIVE_ID,
        totalHandoffs: 3,
      },
      message: 'reception 停在 awaiting_downstream 但下游链已全部终止',
      severity: 'warning',
      timestamp: Date.now(),
      userId: USER_ID,
    });

    const auditRow = dbModule.sqliteGet<{ session_id: string | null }>(
      `SELECT session_id
         FROM team_audit_logs
        WHERE user_id = ? AND action = 'runtime_incident'
        ORDER BY id DESC
        LIMIT 1`,
      [USER_ID],
    );
    expect(auditRow?.session_id).toBe(SESSION_ACTIVE_ID);
  });

  it('进程内 incident 清空后，/team/runtime 仍可从 audit 恢复 runtime incidents', async () => {
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'handoff-runner-failed',
      context: {
        handoffId: 'handoff-persisted-1',
        sessionId: SESSION_ACTIVE_ID,
      },
      message: 'executor 层执行失败：持久化回放',
      severity: 'error',
      timestamp: Date.now(),
      userId: USER_ID,
    });

    diagnosticsStore.__resetTeamRuntimeDiagnosticsForTesting();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        diagnostics?: {
          incidentSummary: {
            handoff_failure: number;
          };
          incidents: Array<{
            category: string;
            code: string;
            message: string;
          }>;
        };
      };

      expect(data.diagnostics?.incidentSummary.handoff_failure).toBe(1);
      expect(data.diagnostics?.incidents[0]).toMatchObject({
        category: 'handoff_failure',
        code: 'handoff-runner-failed',
        message: 'executor 层执行失败：持久化回放',
      });
    } finally {
      await app.close();
    }
  });

  it('内存 incident 与 audit 持久化 incident 会合并展示，不因新事件遮掉旧记录', async () => {
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'handoff-runner-failed',
      context: {
        handoffId: 'handoff-persisted-2',
        sessionId: SESSION_ACTIVE_ID,
      },
      message: 'pm2 层失败：旧持久化记录',
      severity: 'error',
      timestamp: Date.now() - 10_000,
      userId: USER_ID,
    });

    diagnosticsStore.__resetTeamRuntimeDiagnosticsForTesting();

    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'team_events_connection',
      code: 'team-events:IDLE_TIMEOUT',
      context: {
        closeCode: 1001,
      },
      message: 'TEAM_EVENTS_IDLE_TIMEOUT',
      severity: 'warning',
      timestamp: Date.now(),
      userId: USER_ID,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        diagnostics?: {
          incidentSummary: {
            handoff_failure: number;
            team_events_connection: number;
          };
          incidents: Array<{
            code: string;
            message: string;
          }>;
        };
      };

      expect(data.diagnostics?.incidentSummary.handoff_failure).toBe(1);
      expect(data.diagnostics?.incidentSummary.team_events_connection).toBe(1);
      expect(data.diagnostics?.incidents.map((incident) => incident.code)).toEqual(
        expect.arrayContaining(['handoff-runner-failed', 'team-events:IDLE_TIMEOUT']),
      );
    } finally {
      await app.close();
    }
  });

  it('带 sessionId 查询时，diagnostics incidents 只返回当前会话子树内的异常', async () => {
    const OUTSIDE_SESSION_ID = 's-team-runtime-outside';
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, 'outside-session', ?, 'idle')`,
      [OUTSIDE_SESSION_ID, USER_ID, JSON.stringify({ teamWorkspaceId: 'tw-team-runtime-outside' })],
    );
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'handoff-runner-failed',
      context: {
        sessionId: SESSION_ACTIVE_ID,
      },
      message: 'active session failure',
      severity: 'error',
      timestamp: Date.now(),
      userId: USER_ID,
    });
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'team_events_connection',
      code: 'team-events:IDLE_TIMEOUT',
      context: {
        sessionId: OUTSIDE_SESSION_ID,
      },
      message: 'other session timeout',
      severity: 'warning',
      timestamp: Date.now() + 1,
      userId: USER_ID,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/team/runtime?sessionId=${encodeURIComponent(SESSION_ACTIVE_ID)}`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        diagnostics?: {
          incidentSummary: {
            handoff_failure: number;
            team_events_connection: number;
          };
          incidents: Array<{ code: string; message: string }>;
        };
      };

      expect(data.diagnostics?.incidentSummary.handoff_failure).toBe(1);
      expect(data.diagnostics?.incidentSummary.team_events_connection).toBe(0);
      expect(data.diagnostics?.incidents).toEqual([
        expect.objectContaining({
          code: 'handoff-runner-failed',
          message: 'active session failure',
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('持续 latency 违规（durationMs 每次不同）在去重窗口内只落一条 audit', () => {
    // 复现写风暴回归：latency_violation 的 durationMs/message 每次采样都不同，
    // 早期签名纳入 context/message 会让 60s 去重永不命中，对 team_audit_logs 形成写风暴。
    for (let i = 0; i < 25; i += 1) {
      diagnosticsStore.recordTeamRuntimeIncident({
        category: 'latency_violation',
        code: 'latency:a_to_b_direct',
        context: {
          durationMs: 3001 + i * 17,
          thresholdMs: 3000,
          type: 'a_to_b_direct',
        },
        message: `a→b 直答 延迟 ${3001 + i * 17}ms 超过阈值 3000ms`,
        severity: 'warning',
        timestamp: Date.now() + i,
        userId: USER_ID,
      });
    }

    const auditCountRow = dbModule.sqliteGet<{ count: number }>(
      `SELECT COUNT(1) AS count
         FROM team_audit_logs
        WHERE user_id = ? AND action = 'runtime_incident'`,
      [USER_ID],
    );
    expect(auditCountRow?.count).toBe(1);

    // 内存事件桶仍逐条保留（不受审计去重影响），用于 /team/runtime 聚合观测。
    expect(
      diagnosticsStore.getTeamRuntimeIncidentSummary({ userId: USER_ID }).latency_violation,
    ).toBe(25);
  });

  it('不同实体的 incident 仍按实体分别留痕（去重不会误合并）', () => {
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'handoff-runner-failed',
      context: { handoffId: 'h-storm-1' },
      message: 'runner exploded',
      severity: 'error',
      timestamp: Date.now(),
      userId: USER_ID,
    });
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'handoff-runner-failed',
      context: { handoffId: 'h-storm-2' },
      message: 'runner exploded again',
      severity: 'error',
      timestamp: Date.now() + 1,
      userId: USER_ID,
    });

    const auditCountRow = dbModule.sqliteGet<{ count: number }>(
      `SELECT COUNT(1) AS count
         FROM team_audit_logs
        WHERE user_id = ? AND action = 'runtime_incident'`,
      [USER_ID],
    );
    expect(auditCountRow?.count).toBe(2);
  });

  it('返回 diagnostics 聚合（latency / bus / runtimeThreads / pendingInteractions）', async () => {
    const nowMs = Date.now();
    dbModule.sqliteRun(
      `INSERT INTO session_runtime_threads
        (session_id, user_id, client_request_id, started_at_ms, heartbeat_at_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [SESSION_ACTIVE_ID, USER_ID, 'req-active', nowMs - 1_000, nowMs - 500],
    );
    dbModule.sqliteRun(
      `INSERT INTO session_runtime_threads
        (session_id, user_id, client_request_id, started_at_ms, heartbeat_at_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        SESSION_STALE_ID,
        USER_ID,
        'req-stale',
        nowMs - sessionRuntimeThreadStaleAfterMs - 30_000,
        nowMs - sessionRuntimeThreadStaleAfterMs - 1_000,
      ],
    );
    dbModule.sqliteRun(
      `INSERT INTO permission_requests
        (id, session_id, tool_name, scope, reason, risk_level, status)
       VALUES ('perm-pending', ?, 'bash', 'workspace', 'test', 'medium', 'pending')`,
      [SESSION_ACTIVE_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO permission_requests
        (id, session_id, tool_name, scope, reason, risk_level, status)
       VALUES ('perm-deciding', ?, 'bash', 'workspace', 'test', 'medium', 'deciding')`,
      [SESSION_STALE_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO question_requests
        (id, session_id, user_id, tool_name, title, questions_json, status)
       VALUES ('q-pending', ?, ?, 'ask', '需要回答', '[]', 'pending')`,
      [SESSION_ACTIVE_ID, USER_ID],
    );

    latencyMonitor.recordLatency('a_to_b_ack', 123, USER_ID);
    latencyMonitor.recordLatency('a_to_b_direct', 456, USER_ID);
    teamEventsBus.publishTeamEvent({
      type: 'session.substate.changed',
      sessionId: SESSION_ACTIVE_ID,
      taskId: SESSION_ACTIVE_ID,
      layer: 'pm1',
      timestamp: Date.now(),
      payload: { substate: 'spec_ready' },
      userId: USER_ID,
    });
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'handoff-quality-review-redispatch',
      context: { handoffId: 'h-review-redispatch' },
      message: 'Quality Review 未通过：测试失败',
      severity: 'warning',
      timestamp: Date.now(),
      userId: USER_ID,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string; status: string }>;
          alerts: Array<{
            code: string;
            severity: string;
            suggestedAction: string;
          }>;
          capturedAt: string;
          health: {
            reasons: string[];
            status: string;
          };
          qualityReview: {
            escalateToUserCount: number;
            pendingCount: number;
            redispatchCount: number;
            retryableErrorCount: number;
            returnToCCount: number;
          };
          telemetry: {
            enabled: boolean;
          };
          incidentSummary: {
            handoff_failure: number;
            latency_violation: number;
          };
          incidents: Array<{
            category: string;
            code: string;
            severity: string;
          }>;
          latency: {
            a_to_b_ack: { count: number; avgMs: number };
            a_to_b_direct: { count: number; avgMs: number };
          };
          pendingInteractions: {
            affectedSessionCount: number;
            decidingPermissionCount: number;
            pendingPermissionCount: number;
            pendingQuestionCount: number;
          };
          runtimeThreads: {
            activeCount: number;
            staleCount: number;
            totalCount: number;
          };
          recentResolvedAlerts: Array<{ code: string; status: string }>;
          teamEvents: {
            listenerCount: number;
            publishedCount: number;
            publishedByType: Record<string, number | undefined>;
          };
        };
      };

      expect(data.diagnostics?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(data.diagnostics?.health).toMatchObject({
        status: 'critical',
      });
      expect(data.diagnostics?.activeAlerts[0]).toMatchObject({
        code: 'stale-runtime-threads',
        status: 'open',
      });
      expect(data.diagnostics?.recentResolvedAlerts).toHaveLength(0);
      expect(data.diagnostics?.alerts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'stale-runtime-threads',
            severity: 'critical',
          }),
        ]),
      );
      expect(typeof data.diagnostics?.telemetry.enabled).toBe('boolean');
      expect(
        (data.diagnostics?.health.reasons ?? []).some((item) =>
          item.includes('stale_runtime_threads=1'),
        ),
      ).toBe(true);
      expect(
        (data.diagnostics?.health.reasons ?? []).some((item) =>
          item.includes('quality_review_redispatch=1'),
        ),
      ).toBe(true);
      expect(data.diagnostics?.incidentSummary.handoff_failure).toBe(1);
      expect(data.diagnostics?.incidentSummary.latency_violation).toBe(0);
      expect(data.diagnostics?.incidents[0]).toMatchObject({
        category: 'handoff_failure',
        code: 'handoff-quality-review-redispatch',
      });
      expect(data.diagnostics?.latency.a_to_b_ack).toMatchObject({ count: 1, avgMs: 123 });
      expect(data.diagnostics?.latency.a_to_b_direct).toMatchObject({ count: 1, avgMs: 456 });
      expect(data.diagnostics?.qualityReview).toMatchObject({
        escalateToUserCount: 0,
        pendingCount: 0,
        redispatchCount: 1,
        retryableErrorCount: 0,
        returnToCCount: 0,
      });
      expect(data.diagnostics?.pendingInteractions).toMatchObject({
        affectedSessionCount: 2,
        decidingPermissionCount: 1,
        pendingPermissionCount: 1,
        pendingQuestionCount: 1,
      });
      expect(data.diagnostics?.runtimeThreads).toMatchObject({
        activeCount: 1,
        staleCount: 1,
        totalCount: 2,
      });
      expect(data.diagnostics?.teamEvents.listenerCount).toBe(0);
      expect((data.diagnostics?.teamEvents.publishedCount ?? 0) > 0).toBe(true);
      expect(data.diagnostics?.teamEvents.publishedByType['session.substate.changed']).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('quality review 分流 incident 会暴露专用 alerts', async () => {
    const store = await import('../../handoff/store/handoff-store.js');
    const reviewReturn = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
    });
    store.claimHandoff({ handoffId: reviewReturn.id, claimToken: 'tok-review-return' });
    store.startHandoff({
      handoffId: reviewReturn.id,
      claimToken: 'tok-review-return',
      toSessionId: SESSION_STALE_ID,
    });
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET state = 'failed', failure_reason = 'Spec Review 未通过：遗漏验收场景'
        WHERE id = ?`,
      [reviewReturn.id],
    );

    const reviewEscalate = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
    });
    store.claimHandoff({ handoffId: reviewEscalate.id, claimToken: 'tok-review-escalate' });
    store.startHandoff({
      handoffId: reviewEscalate.id,
      claimToken: 'tok-review-escalate',
      toSessionId: SESSION_STALE_ID,
    });
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET state = 'failed', failure_reason = '已重试 2 轮仍未通过，需要用户介入'
        WHERE id = ?`,
      [reviewEscalate.id],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string; severity: string }>;
          alerts: Array<{ code: string; severity: string }>;
          qualityReview: {
            escalateToUserCount: number;
            pendingCount: number;
            redispatchCount: number;
            retryableErrorCount: number;
            returnToCCount: number;
          };
        };
      };

      expect(data.diagnostics?.qualityReview).toMatchObject({
        escalateToUserCount: 1,
        pendingCount: 0,
        redispatchCount: 0,
        retryableErrorCount: 0,
        returnToCCount: 1,
      });
      expect(data.diagnostics?.alerts.map((alert) => alert.code)).toEqual(
        expect.arrayContaining(['quality-review-return-to-c', 'quality-review-escalate-to-user']),
      );
      expect(
        data.diagnostics?.activeAlerts.find(
          (alert) => alert.code === 'quality-review-escalate-to-user',
        ),
      ).toMatchObject({
        code: 'quality-review-escalate-to-user',
        severity: 'critical',
      });
    } finally {
      await app.close();
    }
  });

  it('超阈值 latency 会出现在 diagnostics incidents 中', async () => {
    latencyMonitor.recordLatency('a_to_b_direct', 3_500, USER_ID);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string; status: string }>;
          alerts: Array<{ code: string; severity: string }>;
          health: {
            status: string;
          };
          incidentSummary: { latency_violation: number };
          recentResolvedAlerts: Array<{ code: string; status: string }>;
          incidents: Array<{ category: string; code: string; severity: string }>;
        };
      };

      expect(data.diagnostics?.health.status).toBe('degraded');
      expect(
        data.diagnostics?.activeAlerts.some((alert) => alert.code === 'latency-violation'),
      ).toBe(true);
      expect(data.diagnostics?.alerts.some((alert) => alert.code === 'latency-violation')).toBe(
        true,
      );
      expect(data.diagnostics?.incidentSummary.latency_violation).toBe(1);
      expect(data.diagnostics?.incidents[0]).toMatchObject({
        category: 'latency_violation',
        code: 'latency:a_to_b_direct',
        severity: 'warning',
      });

      // 清空 latency 窗口，模拟异常条件已恢复。
      latencyMonitor.__resetLatencyMonitorForTesting();
      const recoveryAfterReset = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const recoveryData = recoveryAfterReset.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string; status: string }>;
          recentResolvedAlerts: Array<{ code: string; status: string }>;
        };
      };
      expect(
        recoveryData.diagnostics?.activeAlerts.some((alert) => alert.code === 'latency-violation'),
      ).toBe(false);
      expect(recoveryData.diagnostics?.recentResolvedAlerts[0]).toMatchObject({
        code: 'latency-violation',
        status: 'resolved',
      });
    } finally {
      await app.close();
    }
  });

  it('telemetry sink 异常时 runtime 仍返回 200，并保留诊断数据', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    telemetryModule.__setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: () => {
        throw new Error('telemetry offline');
      },
    });
    latencyMonitor.recordLatency('a_to_b_direct', 3_500, USER_ID);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        diagnostics?: {
          health?: { status?: string };
          incidents?: Array<{ code?: string }>;
          latency?: {
            a_to_b_direct?: { count?: number; violationCount?: number };
          };
          telemetry?: { enabled?: boolean };
        };
      };
      expect(data.diagnostics?.telemetry?.enabled).toBe(true);
      expect(data.diagnostics?.health?.status).toBe('degraded');
      expect(data.diagnostics?.latency?.a_to_b_direct).toMatchObject({
        count: 1,
        violationCount: 1,
      });
      expect(data.diagnostics?.incidents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'latency:a_to_b_direct',
          }),
        ]),
      );
      expect(
        warnSpy.mock.calls.some(
          ([message]) =>
            typeof message === 'string' && message.includes('track team_runtime_health 失败'),
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('alert 控制面支持 acknowledge / suppress / clear', async () => {
    latencyMonitor.recordLatency('a_to_b_direct', 3_500, USER_ID);

    const app = await buildApp();
    try {
      const initial = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(initial.statusCode).toBe(200);

      const acknowledge = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/latency-violation/acknowledge',
        headers: { authorization: bearer(app) },
        payload: { note: '已知问题，先观察' },
      });
      expect(acknowledge.statusCode).toBe(200);
      expect(acknowledge.json()).toMatchObject({
        control: {
          alertCode: 'latency-violation',
          state: 'acknowledged',
        },
        runtime: {
          sessionCount: 2,
          diagnostics: {
            activeAlerts: expect.any(Array),
            health: {
              status: expect.any(String),
            },
          },
        },
      });

      const afterAck = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const ackData = afterAck.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string; status: string; note?: string | null }>;
        };
      };
      expect(
        ackData.diagnostics?.activeAlerts.find((alert) => alert.code === 'latency-violation'),
      ).toMatchObject({
        code: 'latency-violation',
        status: 'acknowledged',
        note: '已知问题，先观察',
      });

      const suppress = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/latency-violation/suppress',
        headers: { authorization: bearer(app) },
        payload: { minutes: 30, note: '临时静音' },
      });
      expect(suppress.statusCode).toBe(200);
      expect(suppress.json()).toMatchObject({
        control: {
          alertCode: 'latency-violation',
          state: 'suppressed',
        },
        runtime: {
          sessionCount: 2,
          diagnostics: {
            activeAlerts: expect.any(Array),
            health: {
              status: expect.any(String),
            },
          },
        },
      });

      const afterSuppress = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const suppressData = afterSuppress.json() as {
        diagnostics?: {
          activeAlerts: Array<{
            code: string;
            status: string;
            note?: string | null;
            suppressedUntilMs?: number | null;
          }>;
        };
      };
      expect(
        suppressData.diagnostics?.activeAlerts.find((alert) => alert.code === 'latency-violation'),
      ).toMatchObject({
        code: 'latency-violation',
        status: 'suppressed',
        note: '临时静音',
      });
      expect(
        (suppressData.diagnostics?.activeAlerts.find((alert) => alert.code === 'latency-violation')
          ?.suppressedUntilMs ?? 0) > Date.now(),
      ).toBe(true);

      dbModule.sqliteRun(
        `UPDATE team_runtime_alert_controls
            SET suppressed_until_ms = ?
          WHERE user_id = ? AND alert_code = ?`,
        [Date.now() - 1_000, USER_ID, 'latency-violation'],
      );
      const expired = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const expiredData = expired.json() as {
        diagnostics?: {
          activeAlerts: Array<{
            code: string;
            note?: string | null;
            status: string;
          }>;
        };
      };
      expect(
        expiredData.diagnostics?.activeAlerts.find((alert) => alert.code === 'latency-violation'),
      ).toMatchObject({
        code: 'latency-violation',
        status: 'reopened',
      });
      expect(
        expiredData.diagnostics?.activeAlerts.find((alert) => alert.code === 'latency-violation')
          ?.note ?? null,
      ).toBeNull();

      const reack = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/latency-violation/acknowledge',
        headers: { authorization: bearer(app) },
        payload: { note: '再次确认' },
      });
      expect(reack.statusCode).toBe(200);

      const clear = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/latency-violation/clear',
        headers: { authorization: bearer(app) },
      });
      expect(clear.statusCode).toBe(200);
      expect(clear.json()).toMatchObject({
        cleared: true,
        runtime: {
          sessionCount: 2,
          diagnostics: {
            activeAlerts: expect.any(Array),
            health: {
              status: expect.any(String),
            },
          },
        },
      });

      const afterClear = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const clearData = afterClear.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string; status: string }>;
        };
      };
      expect(
        clearData.diagnostics?.activeAlerts.find((alert) => alert.code === 'latency-violation'),
      ).toMatchObject({
        code: 'latency-violation',
        status: 'ongoing',
      });
    } finally {
      await app.close();
    }
  });

  it('alert 控制在带 sessionId 查询时，会按当前会话子树收缩 preview 并写入 session 归属', async () => {
    latencyMonitor.recordLatency('a_to_b_direct', 3_500, USER_ID);

    const app = await buildApp();
    try {
      const acknowledge = await app.inject({
        method: 'POST',
        url: `/team/runtime/alerts/latency-violation/acknowledge?sessionId=${encodeURIComponent(
          SESSION_ACTIVE_ID,
        )}`,
        headers: { authorization: bearer(app) },
        payload: { note: '当前会话范围确认' },
      });
      expect(acknowledge.statusCode).toBe(200);
      expect(acknowledge.json()).toMatchObject({
        control: {
          alertCode: 'latency-violation',
          state: 'acknowledged',
        },
        runtime: {
          sessionCount: 1,
        },
      });

      const auditRow = dbModule.sqliteGet<{
        action: string;
        entity_id: string;
        session_id: string | null;
      }>(
        `SELECT action, entity_id, session_id
           FROM team_audit_logs
          WHERE action = 'runtime_alert_control'
          ORDER BY id DESC
          LIMIT 1`,
      );
      expect(auditRow).toMatchObject({
        action: 'runtime_alert_control',
        entity_id: 'latency-violation',
        session_id: SESSION_ACTIVE_ID,
      });
    } finally {
      await app.close();
    }
  });

  it('旧的 acknowledge/suppress 不会覆盖新的 reopened 生命周期', async () => {
    latencyMonitor.recordLatency('a_to_b_direct', 3_500, USER_ID);

    const app = await buildApp();
    try {
      const first = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(first.statusCode).toBe(200);

      const ack = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/latency-violation/acknowledge',
        headers: { authorization: bearer(app) },
        payload: { note: '旧生命周期已确认' },
      });
      expect(ack.statusCode).toBe(200);

      latencyMonitor.__resetLatencyMonitorForTesting();
      const resolved = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(resolved.statusCode).toBe(200);

      latencyMonitor.recordLatency('a_to_b_direct', 3_500, USER_ID);
      const reopened = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const reopenedData = reopened.json() as {
        diagnostics?: {
          activeAlerts: Array<{
            code: string;
            note?: string | null;
            status: string;
          }>;
        };
      };

      expect(
        reopenedData.diagnostics?.activeAlerts.find((alert) => alert.code === 'latency-violation'),
      ).toMatchObject({
        code: 'latency-violation',
        status: 'reopened',
      });
      expect(
        reopenedData.diagnostics?.activeAlerts.find((alert) => alert.code === 'latency-violation')
          ?.note ?? null,
      ).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('stale runtime threads remediation 会清掉过期线程告警', async () => {
    const nowMs = Date.now();
    dbModule.sqliteRun(
      `INSERT INTO session_runtime_threads
        (session_id, user_id, client_request_id, started_at_ms, heartbeat_at_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        SESSION_STALE_ID,
        USER_ID,
        'req-remediation',
        nowMs - sessionRuntimeThreadStaleAfterMs - 30_000,
        nowMs - sessionRuntimeThreadStaleAfterMs - 1_000,
      ],
    );

    const app = await buildApp();
    try {
      const before = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const beforeData = before.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string }>;
        };
      };
      expect(
        beforeData.diagnostics?.activeAlerts.some(
          (alert) => alert.code === 'stale-runtime-threads',
        ),
      ).toBe(true);

      const remediation = await app.inject({
        method: 'POST',
        url: '/team/runtime/remediations/reconcile-stale-threads',
        headers: { authorization: bearer(app) },
      });
      expect(remediation.statusCode).toBe(200);
      expect(remediation.json()).toMatchObject({
        staleCandidateCount: 1,
        runtime: {
          sessionCount: 2,
          diagnostics: {
            activeAlerts: expect.any(Array),
            health: {
              status: expect.any(String),
            },
          },
        },
      });

      const after = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const afterData = after.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string }>;
          recentResolvedAlerts: Array<{ code: string; status: string }>;
        };
      };
      expect(
        afterData.diagnostics?.activeAlerts.some((alert) => alert.code === 'stale-runtime-threads'),
      ).toBe(false);
      expect(
        afterData.diagnostics?.recentResolvedAlerts.some(
          (alert) => alert.code === 'stale-runtime-threads',
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('runtime remediation 在带 sessionId 查询时，会按当前会话子树收缩 preview 并写入 session 归属', async () => {
    const nowMs = Date.now();
    dbModule.sqliteRun(
      `INSERT INTO session_runtime_threads
        (session_id, user_id, client_request_id, started_at_ms, heartbeat_at_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        SESSION_ACTIVE_ID,
        USER_ID,
        'req-remediation-session-scope',
        nowMs - sessionRuntimeThreadStaleAfterMs - 30_000,
        nowMs - sessionRuntimeThreadStaleAfterMs - 1_000,
      ],
    );

    const app = await buildApp();
    try {
      const remediation = await app.inject({
        method: 'POST',
        url: `/team/runtime/remediations/reconcile-stale-threads?sessionId=${encodeURIComponent(
          SESSION_ACTIVE_ID,
        )}`,
        headers: { authorization: bearer(app) },
      });
      expect(remediation.statusCode).toBe(200);
      expect(remediation.json()).toMatchObject({
        staleCandidateCount: 1,
        runtime: {
          sessionCount: 1,
        },
      });

      const auditRow = dbModule.sqliteGet<{
        action: string;
        entity_id: string;
        session_id: string | null;
      }>(
        `SELECT action, entity_id, session_id
           FROM team_audit_logs
          WHERE action = 'runtime_remediation'
          ORDER BY id DESC
          LIMIT 1`,
      );
      expect(auditRow).toMatchObject({
        action: 'runtime_remediation',
        entity_id: 'stale-runtime-threads',
        session_id: SESSION_ACTIVE_ID,
      });
    } finally {
      await app.close();
    }
  });

  it('stale deciding remediation 会释放超时 deciding 并清掉对应告警', async () => {
    dbModule.sqliteRun(
      `INSERT INTO question_requests
        (id, session_id, user_id, tool_name, title, questions_json, status)
       VALUES ('q-stale-deciding', ?, ?, 'ask', '等待回答', '[]', 'deciding')`,
      [SESSION_ACTIVE_ID, USER_ID],
    );
    dbModule.sqliteRun(
      `UPDATE question_requests
          SET updated_at = datetime('now', '-20 minutes')
        WHERE id = 'q-stale-deciding'`,
      [],
    );

    const app = await buildApp();
    try {
      const before = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const beforeData = before.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string }>;
          pendingInteractions: { staleDecidingQuestionCount: number };
        };
      };
      expect(beforeData.diagnostics?.pendingInteractions.staleDecidingQuestionCount).toBe(1);
      expect(
        beforeData.diagnostics?.activeAlerts.some((alert) => alert.code === 'stale-decisions'),
      ).toBe(true);

      const remediation = await app.inject({
        method: 'POST',
        url: '/team/runtime/remediations/release-stale-decisions',
        headers: { authorization: bearer(app) },
      });
      expect(remediation.statusCode).toBe(200);
      expect(remediation.json()).toMatchObject({
        staleCandidateCount: 1,
      });

      const questionRow = dbModule.sqliteGet<{ status: string }>(
        `SELECT status FROM question_requests WHERE id = 'q-stale-deciding'`,
        [],
      );
      expect(questionRow?.status).toBe('pending');

      const after = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const afterData = after.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string }>;
          recentResolvedAlerts: Array<{ code: string; status: string }>;
          pendingInteractions: { staleDecidingQuestionCount: number };
        };
      };
      expect(afterData.diagnostics?.pendingInteractions.staleDecidingQuestionCount).toBe(0);
      expect(
        afterData.diagnostics?.activeAlerts.some((alert) => alert.code === 'stale-decisions'),
      ).toBe(false);
      expect(
        afterData.diagnostics?.recentResolvedAlerts.some(
          (alert) => alert.code === 'stale-decisions',
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('通用 alert remediation 入口可执行 stale thread 修复', async () => {
    const nowMs = Date.now();
    dbModule.sqliteRun(
      `INSERT INTO session_runtime_threads
        (session_id, user_id, client_request_id, started_at_ms, heartbeat_at_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        SESSION_STALE_ID,
        USER_ID,
        'req-generic-remediation',
        nowMs - sessionRuntimeThreadStaleAfterMs - 30_000,
        nowMs - sessionRuntimeThreadStaleAfterMs - 1_000,
      ],
    );

    const app = await buildApp();
    try {
      const before = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(before.statusCode).toBe(200);

      const res = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/stale-runtime-threads/remediate',
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        code: 'stale-runtime-threads',
        staleCandidateCount: 1,
        runtime: {
          sessionCount: 2,
          diagnostics: {
            activeAlerts: expect.any(Array),
            health: {
              status: expect.any(String),
            },
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('通用 alert remediation 入口可重试 recoverable failed handoff', async () => {
    const store = await import('../../handoff/store/handoff-store.js');
    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: handoff.id, claimToken: 'tok-retry-route' });
    store.startHandoff({
      handoffId: handoff.id,
      claimToken: 'tok-retry-route',
      toSessionId: SESSION_STALE_ID,
    });
    store.failHandoff({
      handoffId: handoff.id,
      claimToken: 'tok-retry-route',
      reason: 'runner-fail',
    });

    const app = await buildApp();
    try {
      const before = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      const beforeData = before.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string }>;
        };
      };
      expect(
        beforeData.diagnostics?.activeAlerts.some((alert) => alert.code === 'handoff-failure'),
      ).toBe(true);

      const remediation = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/handoff-failure/remediate',
        headers: { authorization: bearer(app) },
      });
      expect(remediation.statusCode).toBe(200);
      expect(remediation.json()).toMatchObject({
        code: 'handoff-failure',
        resetCount: 1,
        runtime: {
          sessionCount: 2,
          diagnostics: {
            activeAlerts: expect.any(Array),
            health: {
              status: expect.any(String),
            },
          },
        },
      });

      const retried = store.getHandoff({ userId: USER_ID, handoffId: handoff.id });
      expect(retried).toMatchObject({
        state: 'pending',
        failureReason: null,
        toSessionId: null,
      });
    } finally {
      await app.close();
    }
  });

  it('handoff-failure remediation 不会重试 spec review / 用户介入类失败', async () => {
    const store = await import('../../handoff/store/handoff-store.js');
    const specBlocked = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: specBlocked.id, claimToken: 'tok-spec-blocked' });
    store.startHandoff({
      handoffId: specBlocked.id,
      claimToken: 'tok-spec-blocked',
      toSessionId: SESSION_STALE_ID,
    });
    store.failHandoff({
      handoffId: specBlocked.id,
      claimToken: 'tok-spec-blocked',
      reason: 'Spec Review 未通过：遗漏验收场景',
    });

    const escalated = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: escalated.id, claimToken: 'tok-user-blocked' });
    store.startHandoff({
      handoffId: escalated.id,
      claimToken: 'tok-user-blocked',
      toSessionId: SESSION_STALE_ID,
    });
    store.failHandoff({
      handoffId: escalated.id,
      claimToken: 'tok-user-blocked',
      reason: '已重试 2 轮仍未通过，需要用户介入',
    });

    const app = await buildApp();
    try {
      const before = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(before.statusCode).toBe(200);
      const beforeData = before.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string; remediable?: boolean }>;
        };
      };
      expect(
        beforeData.diagnostics?.activeAlerts.find((alert) => alert.code === 'handoff-failure'),
      ).toMatchObject({
        code: 'handoff-failure',
        remediable: false,
      });

      const remediation = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/handoff-failure/remediate',
        headers: { authorization: bearer(app) },
      });
      expect(remediation.statusCode).toBe(200);
      expect(remediation.json()).toMatchObject({
        code: 'handoff-failure',
        resetCount: 0,
        staleCandidateCount: 0,
      });

      expect(store.getHandoff({ userId: USER_ID, handoffId: specBlocked.id })).toMatchObject({
        state: 'failed',
        failureReason: 'Spec Review 未通过：遗漏验收场景',
      });
      expect(store.getHandoff({ userId: USER_ID, handoffId: escalated.id })).toMatchObject({
        state: 'failed',
        failureReason: '已重试 2 轮仍未通过，需要用户介入',
      });
    } finally {
      await app.close();
    }
  });

  it('handoff-failure remediation 支持按 handoffId 只重试指定失败项', async () => {
    const store = await import('../../handoff/store/handoff-store.js');
    const target = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: target.id, claimToken: 'tok-target' });
    store.startHandoff({
      handoffId: target.id,
      claimToken: 'tok-target',
      toSessionId: SESSION_STALE_ID,
    });
    store.failHandoff({
      handoffId: target.id,
      claimToken: 'tok-target',
      reason: 'runner-fail',
    });

    const untouched = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: untouched.id, claimToken: 'tok-untouched' });
    store.startHandoff({
      handoffId: untouched.id,
      claimToken: 'tok-untouched',
      toSessionId: SESSION_STALE_ID,
    });
    store.failHandoff({
      handoffId: untouched.id,
      claimToken: 'tok-untouched',
      reason: 'runner-fail',
    });

    const app = await buildApp();
    try {
      const before = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(before.statusCode).toBe(200);

      const remediation = await app.inject({
        method: 'POST',
        url: `/team/runtime/alerts/handoff-failure/remediate?handoffId=${encodeURIComponent(
          target.id,
        )}`,
        headers: { authorization: bearer(app) },
      });
      expect(remediation.statusCode).toBe(200);
      expect(remediation.json()).toMatchObject({
        code: 'handoff-failure',
        resetCount: 1,
        staleCandidateCount: 1,
      });

      expect(store.getHandoff({ userId: USER_ID, handoffId: target.id })).toMatchObject({
        state: 'pending',
        failureReason: null,
      });
      expect(store.getHandoff({ userId: USER_ID, handoffId: untouched.id })).toMatchObject({
        state: 'failed',
        failureReason: 'runner-fail',
      });
    } finally {
      await app.close();
    }
  });

  it('quality-review-pending alert 可触发手动评审收口', async () => {
    const store = await import('../../handoff/store/handoff-store.js');
    const pm2 = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
    });
    store.claimHandoff({ handoffId: pm2.id, claimToken: 'tok-pm2-pending' });
    store.startHandoff({
      handoffId: pm2.id,
      claimToken: 'tok-pm2-pending',
      toSessionId: SESSION_STALE_ID,
    });

    const child = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_STALE_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: child.id, claimToken: 'tok-child-pending' });
    store.startHandoff({
      handoffId: child.id,
      claimToken: 'tok-child-pending',
      toSessionId: SESSION_ACTIVE_ID,
    });
    store.completeHandoff({ handoffId: child.id, claimToken: 'tok-child-pending' });

    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: [child.id],
          qualityReviewPending: true,
        }),
        pm2.id,
      ],
    );

    const app = await buildApp();
    try {
      const before = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(before.statusCode).toBe(200);
      const beforeData = before.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string }>;
          qualityReview: {
            pendingCount: number;
            retryableErrorCount: number;
          };
        };
      };
      expect(
        beforeData.diagnostics?.activeAlerts.some(
          (alert) => alert.code === 'quality-review-pending',
        ),
      ).toBe(true);
      expect(beforeData.diagnostics?.qualityReview).toMatchObject({
        pendingCount: 1,
        retryableErrorCount: 0,
      });

      const remediation = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/quality-review-pending/remediate',
        headers: { authorization: bearer(app) },
      });
      expect(remediation.statusCode).toBe(200);
      expect(remediation.json()).toMatchObject({
        code: 'quality-review-pending',
        completedCount: 1,
        staleCandidateCount: 1,
      });

      const after = store.getHandoff({ userId: USER_ID, handoffId: pm2.id });
      expect(after).toMatchObject({
        state: 'completed',
      });
    } finally {
      await app.close();
    }
  });

  it('冷却中的 quality review pending handoff 也会暴露，并支持 force 立即重试', async () => {
    const store = await import('../../handoff/store/handoff-store.js');
    const pm2 = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
    });
    store.claimHandoff({ handoffId: pm2.id, claimToken: 'tok-pm2-cooling' });
    store.startHandoff({
      handoffId: pm2.id,
      claimToken: 'tok-pm2-cooling',
      toSessionId: SESSION_STALE_ID,
    });

    const child = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_STALE_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: child.id, claimToken: 'tok-child-cooling' });
    store.startHandoff({
      handoffId: child.id,
      claimToken: 'tok-child-cooling',
      toSessionId: SESSION_ACTIVE_ID,
    });
    store.completeHandoff({ handoffId: child.id, claimToken: 'tok-child-cooling' });

    const lastAttemptAtMs = Date.now() - 5_000;
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: [child.id],
          qualityReviewLastAttemptAt: lastAttemptAtMs,
          qualityReviewPending: true,
        }),
        pm2.id,
      ],
    );

    const app = await buildApp();
    try {
      const before = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(before.statusCode).toBe(200);
      const beforeData = before.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string }>;
          qualityReview: {
            pendingCount: number;
            pendingHandoffs: Array<{
              handoffId: string;
              lastAttemptAtMs: number | null;
              nextAttemptAtMs: number | null;
              readyNow: boolean;
            }>;
          };
        };
      };

      expect(
        beforeData.diagnostics?.activeAlerts.some(
          (alert) => alert.code === 'quality-review-pending',
        ),
      ).toBe(true);
      expect(beforeData.diagnostics?.qualityReview.pendingCount).toBe(1);
      expect(beforeData.diagnostics?.qualityReview.pendingHandoffs).toEqual([
        expect.objectContaining({
          handoffId: pm2.id,
          lastAttemptAtMs,
          readyNow: false,
        }),
      ]);
      expect(
        (beforeData.diagnostics?.qualityReview.pendingHandoffs[0]?.nextAttemptAtMs ?? 0) >
          lastAttemptAtMs,
      ).toBe(true);

      const withoutForce = await app.inject({
        method: 'POST',
        url: `/team/runtime/alerts/quality-review-pending/remediate?handoffId=${encodeURIComponent(pm2.id)}`,
        headers: { authorization: bearer(app) },
      });
      expect(withoutForce.statusCode).toBe(200);
      expect(withoutForce.json()).toMatchObject({
        code: 'quality-review-pending',
        completedCount: 0,
        staleCandidateCount: 0,
      });

      const forceRetry = await app.inject({
        method: 'POST',
        url: `/team/runtime/alerts/quality-review-pending/remediate?handoffId=${encodeURIComponent(pm2.id)}&force=true`,
        headers: { authorization: bearer(app) },
      });
      expect(forceRetry.statusCode).toBe(200);
      expect(forceRetry.json()).toMatchObject({
        code: 'quality-review-pending',
        completedCount: 1,
        staleCandidateCount: 1,
      });

      const after = store.getHandoff({ userId: USER_ID, handoffId: pm2.id });
      expect(after).toMatchObject({
        state: 'completed',
      });
    } finally {
      await app.close();
    }
  });

  it('已 handled 的 pm2 评审失败不会继续计入 failed handoff 告警', async () => {
    const store = await import('../../handoff/store/handoff-store.js');
    const pm2 = store.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ACTIVE_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      payload: {
        reviewDisposition: {
          action: 'return-to-c',
          reason: 'Spec Review 未通过：遗漏验收场景',
          status: 'handled',
          updatedAtMs: Date.now(),
        },
        reviewDispositionHandledAction: 'return-to-c',
        reviewDispositionHandledAt: Date.now(),
      },
    });
    store.claimHandoff({ handoffId: pm2.id, claimToken: 'tok-handled' });
    store.startHandoff({
      handoffId: pm2.id,
      claimToken: 'tok-handled',
      toSessionId: SESSION_STALE_ID,
    });
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET state = 'failed', failure_reason = 'Spec Review 未通过：遗漏验收场景'
        WHERE id = ?`,
      [pm2.id],
    );
    diagnosticsStore.recordTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'handoff-quality-review-return-to-c',
      context: { handoffId: pm2.id },
      message: 'Spec Review 未通过：遗漏验收场景',
      severity: 'warning',
      timestamp: Date.now(),
      userId: USER_ID,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/runtime',
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        diagnostics?: {
          activeAlerts: Array<{ code: string }>;
          health: { reasons: string[] };
        };
      };

      expect(data.diagnostics?.activeAlerts.some((alert) => alert.code === 'handoff-failure')).toBe(
        false,
      );
      expect(
        data.diagnostics?.activeAlerts.some((alert) => alert.code === 'quality-review-return-to-c'),
      ).toBe(false);
      expect(
        (data.diagnostics?.health.reasons ?? []).some((reason) =>
          reason.includes('handoff_failure='),
        ),
      ).toBe(false);
      expect(
        (data.diagnostics?.health.reasons ?? []).some((reason) =>
          reason.includes('quality_review_return_to_c='),
        ),
      ).toBe(false);
    } finally {
      await app.close();
    }
  });
});
