import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageModule from '../../message/message-v2-adapter.js';
import type * as RuntimeModule from '../../routes/stream-runtime.js';
import type { ApprovedPermissionResumePayload } from '../../routes/stream.js';
import type * as DecisionModule from '../../task/task-parent-auto-decision.js';

const mocks = vi.hoisted(() => ({
  runSessionInBackground: vi.fn<typeof RuntimeModule.runSessionInBackground>(),
  resumeAnsweredQuestionRequest: vi.fn<typeof RuntimeModule.resumeAnsweredQuestionRequest>(),
  resumeApprovedPermissionRequest: vi.fn<typeof RuntimeModule.resumeApprovedPermissionRequest>(),
  listSessionMessagesV2: vi.fn(),
}));

vi.mock('../../routes/stream-runtime.js', () => ({
  runSessionInBackground: mocks.runSessionInBackground,
  resumeAnsweredQuestionRequest: mocks.resumeAnsweredQuestionRequest,
  resumeApprovedPermissionRequest: mocks.resumeApprovedPermissionRequest,
}));
vi.mock('../../message/message-v2-adapter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof MessageModule>()),
  listSessionMessagesV2: mocks.listSessionMessagesV2,
}));

process.env['DATABASE_URL'] = ':memory:';

let db: typeof DbModule;
let resolveWithParent: typeof DecisionModule.tryResolveTaskPendingInteractionWithParent;
const USER = 'parent-answer-owner';
const PARENT = 'parent-answer-parent';
const CHILD = 'parent-answer-child';
const QUESTION = 'parent-answer-question';
const blockedCalls = [
  { toolCallId: 'blocked-first', toolName: 'bash', rawInput: { command: 'pwd' } },
  { toolCallId: 'blocked-second', toolName: 'read', rawInput: { path: 'README.md' } },
];
const payload: ApprovedPermissionResumePayload = {
  clientRequestId: 'child-answer-turn',
  nextRound: 2,
  toolCallId: 'question-anchor',
  toolName: 'question',
  rawInput: {
    questions: [{ question: '选择目录', options: [{ label: 'workspace' }] }],
  },
  requestData: {
    clientRequestId: 'child-answer-turn',
    message: '确认后继续',
    webSearchEnabled: false,
  },
};

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.migrate();
  ({ tryResolveTaskPendingInteractionWithParent: resolveWithParent } =
    await import('../../task/task-parent-auto-decision.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resumeAnsweredQuestionRequest.mockResolvedValue(undefined);
  mocks.resumeApprovedPermissionRequest.mockResolvedValue(undefined);
  mocks.runSessionInBackground.mockImplementation(async ({ requestData }) => {
    mocks.listSessionMessagesV2.mockReturnValue([
      {
        role: 'assistant',
        clientRequestId: requestData.clientRequestId,
        content: [{ type: 'text', text: '{"kind":"question","answers":[["workspace"]]}' }],
      },
    ]);
    return { statusCode: 200 };
  });
  db.sqliteRun('DELETE FROM users', []);
  db.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'hash')", [
    USER,
    `${USER}@example.com`,
  ]);
  for (const id of [PARENT, CHILD]) {
    db.sqliteRun(
      `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
       VALUES (?, ?, '[]', ?, 'paused')`,
      [
        id,
        USER,
        JSON.stringify(id === CHILD ? { createdByTool: 'task', parentSessionId: PARENT } : {}),
      ],
    );
  }
  db.sqliteRun(
    `INSERT INTO task_parent_auto_resume_contexts
       (child_session_id, parent_session_id, user_id, task_id, request_data_json)
     VALUES (?, ?, ?, 'parent-task', ?)`,
    [CHILD, PARENT, USER, JSON.stringify({ message: '由父级选择目录', webSearchEnabled: false })],
  );
});

afterAll(async () => {
  await db.closeDb();
});

describe('父级自动回答的问题恢复载荷', () => {
  it('父级审批期间补入的阻塞尾部从最新权限载荷取回', async () => {
    const permissionPayload = { ...payload, toolName: 'bash', rawInput: { command: 'pwd' } };
    db.sqliteRun(
      `INSERT INTO permission_requests
       (id, session_id, tool_name, scope, reason, risk_level, status, request_payload_json)
       VALUES ('child-permission', ?, 'bash', '*', '确认', 'medium', 'pending', ?)`,
      [CHILD, JSON.stringify(permissionPayload)],
    );
    mocks.runSessionInBackground.mockImplementationOnce(async ({ requestData }) => {
      db.sqliteRun(
        "UPDATE permission_requests SET request_payload_json = ? WHERE id = 'child-permission'",
        [JSON.stringify({ ...permissionPayload, blockedToolCalls: blockedCalls })],
      );
      mocks.listSessionMessagesV2.mockReturnValue([
        {
          role: 'assistant',
          clientRequestId: requestData.clientRequestId,
          content: [{ type: 'text', text: '{"kind":"permission","decision":"once"}' }],
        },
      ]);
      return { statusCode: 200 };
    });
    expect(await resolveWithParent({ childSessionId: CHILD, userId: USER })).toBe(true);
    await vi.waitFor(() => {
      expect(mocks.resumeApprovedPermissionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ blockedToolCalls: blockedCalls }),
        }),
      );
    });
  });

  it('父级决策期间补入的阻塞尾部从最新问题载荷取回', async () => {
    db.sqliteRun(
      `INSERT INTO question_requests
       (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, status)
       VALUES (?, ?, ?, 'question', '选择目录', ?, ?, 'pending')`,
      [
        QUESTION,
        CHILD,
        USER,
        JSON.stringify(payload.rawInput['questions']),
        JSON.stringify(payload),
      ],
    );
    mocks.runSessionInBackground.mockImplementationOnce(async ({ requestData }) => {
      db.sqliteRun('UPDATE question_requests SET request_payload_json = ? WHERE id = ?', [
        JSON.stringify({ ...payload, blockedToolCalls: blockedCalls }),
        QUESTION,
      ]);
      mocks.listSessionMessagesV2.mockReturnValue([
        {
          role: 'assistant',
          clientRequestId: requestData.clientRequestId,
          content: [{ type: 'text', text: '{"kind":"question","answers":[["workspace"]]}' }],
        },
      ]);
      return { statusCode: 200 };
    });
    expect(await resolveWithParent({ childSessionId: CHILD, userId: USER })).toBe(true);
    await vi.waitFor(() => {
      expect(mocks.resumeAnsweredQuestionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ blockedToolCalls: blockedCalls }),
        }),
      );
    });
  });

  it.each([
    ['question', 'pending'],
    ['question', 'deciding'],
    ['permission', 'pending'],
    ['permission', 'deciding'],
  ] as const)('父会话存在 %s %s 时不自动发起决策并归还子问题', async (kind, status) => {
    const storedPayload = JSON.stringify({ ...payload, blockedToolCalls: blockedCalls });
    db.sqliteRun(
      `INSERT INTO question_requests
       (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, status)
       VALUES (?, ?, ?, 'question', '选择目录', ?, ?, 'pending')`,
      [QUESTION, CHILD, USER, JSON.stringify(payload.rawInput['questions']), storedPayload],
    );
    if (kind === 'question') {
      db.sqliteRun(
        `INSERT INTO question_requests
         (id, session_id, user_id, tool_name, title, questions_json, status)
         VALUES ('parent-pending', ?, ?, 'question', '等待用户', '[]', ?)`,
        [PARENT, USER, status],
      );
    } else {
      db.sqliteRun(
        `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, status)
         VALUES ('parent-pending', ?, 'bash', '*', '等待用户', 'medium', ?)`,
        [PARENT, status],
      );
    }

    expect(await resolveWithParent({ childSessionId: CHILD, userId: USER })).toBe(false);
    expect(mocks.runSessionInBackground).not.toHaveBeenCalled();
    expect(mocks.resumeAnsweredQuestionRequest).not.toHaveBeenCalled();
    expect(
      db.sqliteGet<{ status: string; request_payload_json: string }>(
        'SELECT status, request_payload_json FROM question_requests WHERE id = ?',
        [QUESTION],
      ),
    ).toEqual({ status: 'pending', request_payload_json: storedPayload });
  });

  it.each([false, true])(
    '保留问题锚点及合法阻塞调用（含阻塞调用=%s）',
    async (withBlockedCalls) => {
      db.sqliteRun(
        `INSERT INTO question_requests
         (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, status)
       VALUES (?, ?, ?, 'question', '选择目录', ?, ?, 'pending')`,
        [
          QUESTION,
          CHILD,
          USER,
          JSON.stringify(payload.rawInput['questions']),
          JSON.stringify({
            ...payload,
            ...(withBlockedCalls
              ? {
                  blockedToolCalls: [
                    blockedCalls[0],
                    null,
                    { toolCallId: 'broken' },
                    blockedCalls[1],
                  ],
                }
              : {}),
          }),
        ],
      );

      expect(await resolveWithParent({ childSessionId: CHILD, userId: USER })).toBe(true);
      await vi.waitFor(() => {
        expect(mocks.resumeAnsweredQuestionRequest).toHaveBeenCalledExactlyOnceWith({
          sessionId: CHILD,
          userId: USER,
          answerOutput: expect.any(String),
          payload: expect.objectContaining({
            toolCallId: payload.toolCallId,
            rawInput: payload.rawInput,
            clientRequestId: payload.clientRequestId,
            nextRound: payload.nextRound,
            ...(withBlockedCalls ? { blockedToolCalls: blockedCalls } : {}),
          }),
        });
      });
      expect(
        db.sqliteGet<{ status: string; answer_json: string }>(
          'SELECT status, answer_json FROM question_requests WHERE id = ?',
          [QUESTION],
        ),
      ).toEqual({ status: 'answered', answer_json: JSON.stringify([['workspace']]) });
    },
  );
});
