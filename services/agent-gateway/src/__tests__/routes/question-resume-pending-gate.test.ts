import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessagesModule from '../../message/message-v2-adapter.js';
import type { ApprovedPermissionResumePayload } from '../../routes/stream.js';
import type * as RuntimeModule from '../../routes/stream-runtime.js';
import type { runModelRound } from '../../routes/stream-model-round.js';
import { ToolSandbox } from '../../tools/tool-sandbox.js';

// 模型边界完全离线；恢复函数、续跑门禁、消息写入和状态持久化均使用真实实现。
const mocks = vi.hoisted(() => ({
  modelRound: vi.fn<typeof runModelRound>(),
}));

vi.mock('../../routes/stream-model-round.js', () => ({
  runModelRound: mocks.modelRound,
  MAX_CONTINUATION_ROUNDS: 10,
}));

// 能力目录与团队入站调度不属于交互门禁，避免扫描安装资源或启动后台任务。
vi.mock('../../routes/capabilities.js', () => ({
  buildCapabilityContext: () => null,
}));
vi.mock('../../handoff/workflow/inbound-delivery-dispatcher.js', () => ({
  dispatchInboundDeliveries: vi.fn(async () => undefined),
}));

let db: typeof DbModule;
let runtime: typeof RuntimeModule;
let messages: typeof MessagesModule;

const USER_ID = 'question-resume-gate-user';
const SESSION_ID = 'question-resume-gate-session';
const OTHER_SESSION_ID = 'question-resume-gate-other';
const CLIENT_REQUEST_ID = 'question-resume-gate-turn';
const ANSWER_CALL_ID = 'question-resume-gate-call';
const ANSWER = '使用当前目录';

function payload(): ApprovedPermissionResumePayload {
  return {
    clientRequestId: CLIENT_REQUEST_ID,
    nextRound: 2,
    toolCallId: ANSWER_CALL_ID,
    toolName: 'question',
    rawInput: { questions: [{ question: '选择目录？' }] },
    requestData: {
      clientRequestId: CLIENT_REQUEST_ID,
      message: '确认目录后继续',
      model: 'gpt-4o',
      webSearchEnabled: false,
    },
  };
}

type QuestionStatus = 'pending' | 'deciding' | 'answered' | 'dismissed';
type PermissionStatus = 'pending' | 'deciding' | 'approved' | 'rejected';

function insertQuestion(
  status: QuestionStatus,
  sessionId = SESSION_ID,
  id = 'sibling-question',
): void {
  db.sqliteRun(
    `INSERT INTO question_requests
       (id, session_id, user_id, tool_name, title, questions_json, answer_json,
        request_payload_json, status)
     VALUES (?, ?, ?, 'question', '选择目录', ?, ?, ?, ?)`,
    [
      id,
      sessionId,
      USER_ID,
      JSON.stringify([{ question: '选择目录？', options: [{ label: '当前目录' }] }]),
      status === 'answered' ? JSON.stringify([ANSWER]) : null,
      JSON.stringify(payload()),
      status,
    ],
  );
}

function insertPermission(status: PermissionStatus, sessionId = SESSION_ID): void {
  db.sqliteRun(
    `INSERT INTO permission_requests
       (id, session_id, tool_name, scope, reason, risk_level, status, request_payload_json)
     VALUES ('sibling-permission', ?, 'bash', '*', '需要批准', 'medium', ?, ?)`,
    [sessionId, status, JSON.stringify(payload())],
  );
}

function readState(): string | undefined {
  return db.sqliteGet<{ state_status: string }>('SELECT state_status FROM sessions WHERE id = ?', [
    SESSION_ID,
  ])?.state_status;
}

async function resumeAnswer(): Promise<void> {
  await runtime.resumeAnsweredQuestionRequest({
    payload: payload(),
    answerOutput: ANSWER,
    sessionId: SESSION_ID,
    userId: USER_ID,
  });
}

function expectAnswerPersisted(): void {
  const transcript = messages.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
  expect(JSON.stringify(transcript)).toContain(ANSWER);
  expect(
    db.sqliteGet<{ count: number }>(
      'SELECT COUNT(*) AS count FROM session_runtime_threads WHERE session_id = ?',
      [SESSION_ID],
    )?.count,
  ).toBe(0);
}

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', ':memory:');
  vi.stubEnv('OPENAWORK_DATABASE_PATH', ':memory:');
  vi.stubEnv('OPENAWORK_ENABLE_SESSION_MEMORY_EXTRACTION', '0');
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  runtime = await import('../../routes/stream-runtime.js');
  messages = await import('../../message/message-v2-adapter.js');
}, 60_000);

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.modelRound.mockReset().mockResolvedValue({
    overflow: false,
    shouldContinue: false,
    shouldStop: true,
    stopReason: 'end_turn',
    statusCode: 200,
    state: {
      assistantThinkingBlocks: [],
      assistantText: '已继续',
      toolCalls: new Map(),
      contentSegments: [],
    },
  });
  db.sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  db.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'test-hash')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  for (const sessionId of [SESSION_ID, OTHER_SESSION_ID]) {
    db.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, '交互门禁回归', '{}', 'paused')`,
      [sessionId, USER_ID],
    );
  }
  // 沿用 verification 的真实 Provider 配置；模型调用本身由上面的 mock 截断。
  db.sqliteRun("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)", [
    USER_ID,
    JSON.stringify([
      {
        id: 'openai',
        type: 'openai',
        name: '离线测试',
        enabled: true,
        baseUrl: 'https://unit-test.invalid/v1',
        apiKey: 'test-key',
        upstreamProtocol: 'chat_completions',
        defaultModels: [{ id: 'gpt-4o', label: 'GPT-4o', enabled: true }],
      },
    ]),
  ]);
  messages.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'user',
    clientRequestId: CLIENT_REQUEST_ID,
    content: [{ type: 'text', text: '确认目录后继续' }],
  });
  messages.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'assistant',
    clientRequestId: `${CLIENT_REQUEST_ID}:assistant:1`,
    content: [
      {
        type: 'tool_call',
        toolCallId: ANSWER_CALL_ID,
        toolName: 'question',
        input: payload().rawInput,
      },
    ],
  });
  // 模拟 reply 已将当前请求结算，但同轮其他交互尚未结束。
  insertQuestion('answered', SESSION_ID, 'answered-question');
});

const WRITE_CALL = { toolCallId: 'downstream-write', toolName: 'write', rawInput: { path: 'a' } };
const NEXT_CALL = { toolCallId: 'next-question', toolName: 'question', rawInput: {} };

function appendSiblingCalls(
  prefix: Array<{ toolCallId: string; toolName: string; rawInput: Record<string, unknown> }> = [],
): void {
  messages.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'assistant',
    clientRequestId: `${CLIENT_REQUEST_ID}:assistant:1`,
    replaceExisting: true,
    content: [...prefix, payload(), NEXT_CALL, WRITE_CALL].map((call) => ({
      type: 'tool_call' as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.rawInput,
    })),
  });
}

describe('阻塞兄弟调用的真实恢复入口', () => {
  it.each([
    ['pending', 'question'],
    ['deciding', 'question'],
    ['pending', 'permission'],
    ['deciding', 'permission'],
  ] as const)('回答先落库，%s %s 阻止写入并保留尾部锚点', async (status, kind) => {
    appendSiblingCalls();
    if (kind === 'question') insertQuestion(status);
    else insertPermission(status);
    const table = kind === 'question' ? 'question_requests' : 'permission_requests';
    const id = kind === 'question' ? 'sibling-question' : 'sibling-permission';
    const sibling = { ...payload(), ...NEXT_CALL };
    db.sqliteRun(`UPDATE ${table} SET request_payload_json = ? WHERE id = ?`, [
      JSON.stringify(sibling),
      id,
    ]);
    const execute = vi.spyOn(ToolSandbox.prototype, 'execute');
    await runtime.resumeAnsweredQuestionRequest({
      payload: { ...payload(), blockedToolCalls: [payload(), WRITE_CALL] },
      answerOutput: ANSWER,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(execute).not.toHaveBeenCalled();
    expectAnswerPersisted();
    const row = db.sqliteGet<{ request_payload_json: string }>(
      `SELECT request_payload_json FROM ${table} WHERE id = ?`,
      [id],
    );
    const retained = JSON.parse(row!.request_payload_json) as ApprovedPermissionResumePayload;
    expect(retained.toolCallId).toBe(NEXT_CALL.toolCallId);
    expect(retained.blockedToolCalls?.map((call) => call.toolCallId)).toEqual([
      NEXT_CALL.toolCallId,
      WRITE_CALL.toolCallId,
    ]);
  });

  it('拒绝结果不会跳过批准后的重试', async () => {
    appendSiblingCalls();
    messages.rejectToolPermission({
      sessionId: SESSION_ID,
      userId: USER_ID,
      callID: WRITE_CALL.toolCallId,
      error: '权限已拒绝',
    });
    const execute = vi.spyOn(ToolSandbox.prototype, 'execute').mockImplementation(async (call) => ({
      ...call,
      durationMs: 0,
      isError: false,
      output: '重试成功',
    }));
    await runtime.resumeApprovedPermissionRequest({
      payload: { ...payload(), ...WRITE_CALL },
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('A 成功立即落库，B 抛错不覆盖 A 或拒绝未开始的尾部', async () => {
    appendSiblingCalls();
    const execute = vi.spyOn(ToolSandbox.prototype, 'execute').mockImplementation(async (call) => {
      if (call.toolCallId === NEXT_CALL.toolCallId) {
        expect(
          JSON.stringify(
            messages.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID }),
          ),
        ).toContain('A 已写入');
        throw new Error('B 失败');
      }
      return { ...call, durationMs: 0, isError: false, output: 'A 已写入' };
    });
    await expect(
      runtime.resumeApprovedPermissionRequest({
        payload: {
          ...payload(),
          ...WRITE_CALL,
          blockedToolCalls: [WRITE_CALL, NEXT_CALL, payload()],
        },
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow('B 失败');
    const parts = messages
      .listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID })
      .flatMap((message) => message.content);
    expect(
      parts.some(
        (part) =>
          part.type === 'tool_result' && part.toolCallId === WRITE_CALL.toolCallId && !part.isError,
      ),
    ).toBe(true);
    expect(
      parts.some(
        (part) => part.type === 'tool_result' && part.toolCallId === ANSWER_CALL_ID && part.isError,
      ),
    ).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('回答释放的长工具执行时运行线程可见，且答案已落库', async () => {
    appendSiblingCalls();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: (() => void) | undefined;
    const executing = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(ToolSandbox.prototype, 'execute').mockImplementation(async (call) => {
      started?.();
      await blocked;
      return { ...call, durationMs: 0, isError: false, output: '完成' };
    });
    const resume = runtime.resumeAnsweredQuestionRequest({
      payload: { ...payload(), blockedToolCalls: [payload(), WRITE_CALL] },
      answerOutput: ANSWER,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    await executing;
    try {
      expect(
        db.sqliteGet<{ count: number }>(
          'SELECT COUNT(*) AS count FROM session_runtime_threads WHERE session_id = ?',
          [SESSION_ID],
        )?.count,
      ).toBe(1);
      expect(
        JSON.stringify(messages.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID })),
      ).toContain(ANSWER);
    } finally {
      release?.();
      await resume;
    }
    expectAnswerPersisted();
  });

  it('批准工具遇到问题先暂停，回答后只执行下游一次并调用模型一次', async () => {
    const approvedCall = { toolCallId: 'approved-read', toolName: 'read', rawInput: {} };
    appendSiblingCalls([approvedCall]);
    const execute = vi.spyOn(ToolSandbox.prototype, 'execute').mockImplementation(async (call) => {
      if (call.toolCallId === ANSWER_CALL_ID) {
        insertQuestion('pending', SESSION_ID, 'new-question');
        return {
          ...call,
          durationMs: 0,
          isError: false,
          output: '等待回答',
          pendingPermissionRequestId: 'new-question',
        };
      }
      return { ...call, durationMs: 0, isError: false, output: '完成' };
    });
    await runtime.resumeApprovedPermissionRequest({
      payload: {
        ...payload(),
        ...approvedCall,
        blockedToolCalls: [approvedCall, payload(), WRITE_CALL],
      },
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(execute.mock.calls.map(([call]) => call.toolCallId)).toEqual([
      approvedCall.toolCallId,
      ANSWER_CALL_ID,
    ]);
    expect(mocks.modelRound).not.toHaveBeenCalled();
    expect(readState()).toBe('paused');
    const row = db.sqliteGet<{ request_payload_json: string }>(
      'SELECT request_payload_json FROM question_requests WHERE id = ?',
      ['new-question'],
    );
    const transferred = JSON.parse(row!.request_payload_json) as ApprovedPermissionResumePayload;
    expect(transferred.blockedToolCalls?.map((call) => call.toolCallId)).toEqual([
      ANSWER_CALL_ID,
      WRITE_CALL.toolCallId,
    ]);
    db.sqliteRun("UPDATE question_requests SET status = 'answered' WHERE id = 'new-question'");
    await runtime.resumeAnsweredQuestionRequest({
      payload: transferred,
      answerOutput: ANSWER,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(execute.mock.calls.map(([call]) => call.toolCallId)).toEqual([
      approvedCall.toolCallId,
      ANSWER_CALL_ID,
      WRITE_CALL.toolCallId,
    ]);
    expect(mocks.modelRound).toHaveBeenCalledTimes(1);
    expectAnswerPersisted();
  });

  it.each(['question', 'permission'] as const)(
    '回答遇到下一个 %s 时转移尾部并保持暂停',
    async (kind) => {
      appendSiblingCalls();
      const execute = vi
        .spyOn(ToolSandbox.prototype, 'execute')
        .mockImplementation(async (call) => {
          if (kind === 'question') insertQuestion('pending', SESSION_ID, 'next-pending');
          else insertPermission('pending');
          return {
            ...call,
            durationMs: 0,
            isError: false,
            output: '等待',
            pendingPermissionRequestId: kind === 'question' ? 'next-pending' : 'sibling-permission',
          };
        });
      await runtime.resumeAnsweredQuestionRequest({
        payload: { ...payload(), blockedToolCalls: [payload(), NEXT_CALL, WRITE_CALL] },
        answerOutput: ANSWER,
        sessionId: SESSION_ID,
        userId: USER_ID,
      });
      expect(execute.mock.calls.map(([call]) => call.toolCallId)).toEqual([NEXT_CALL.toolCallId]);
      const row = db.sqliteGet<{ request_payload_json: string }>(
        `SELECT request_payload_json FROM ${kind === 'question' ? 'question_requests' : 'permission_requests'} WHERE id = ?`,
        [kind === 'question' ? 'next-pending' : 'sibling-permission'],
      );
      expect(
        (JSON.parse(row!.request_payload_json) as ApprovedPermissionResumePayload).blockedToolCalls,
      ).toEqual([NEXT_CALL, WRITE_CALL]);
      expect(mocks.modelRound).not.toHaveBeenCalled();
      expect(readState()).toBe('paused');
      expectAnswerPersisted();
    },
  );

  it('迟到回答写入结果，但不执行旧兄弟调用或模型', async () => {
    messages.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'user',
      clientRequestId: 'later-turn',
      content: [{ type: 'text', text: '新的指令' }],
    });
    const execute = vi.spyOn(ToolSandbox.prototype, 'execute');
    await runtime.resumeAnsweredQuestionRequest({
      payload: { ...payload(), blockedToolCalls: [payload(), WRITE_CALL] },
      answerOutput: ANSWER,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(mocks.modelRound).not.toHaveBeenCalled();
    expectAnswerPersisted();
  });

  it('A 的迟到回答不污染新轮 B 的待审批载荷，批准 B 只执行 B', async () => {
    appendSiblingCalls();
    const bCall = { toolCallId: 'round-b-write', toolName: 'write', rawInput: { path: 'b' } };
    const bPayload: ApprovedPermissionResumePayload = {
      ...payload(),
      ...bCall,
      clientRequestId: 'round-b',
      blockedToolCalls: [bCall],
    };
    messages.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'user',
      clientRequestId: bPayload.clientRequestId,
      content: [{ type: 'text', text: '改为执行 B' }],
    });
    messages.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      clientRequestId: 'round-b:assistant:1',
      content: [
        {
          type: 'tool_call',
          toolCallId: bCall.toolCallId,
          toolName: bCall.toolName,
          input: bCall.rawInput,
        },
      ],
    });
    insertPermission('pending');
    db.sqliteRun(
      "UPDATE permission_requests SET request_payload_json = ? WHERE id = 'sibling-permission'",
      [JSON.stringify(bPayload)],
    );
    const execute = vi.spyOn(ToolSandbox.prototype, 'execute').mockImplementation(async (call) => ({
      ...call,
      durationMs: 0,
      isError: false,
      output: 'B 已执行',
    }));

    await runtime.resumeAnsweredQuestionRequest({
      payload: { ...payload(), blockedToolCalls: [payload(), WRITE_CALL] },
      answerOutput: ANSWER,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expectAnswerPersisted();
    expect(readState()).toBe('paused');
    expect(execute).not.toHaveBeenCalled();
    expect(mocks.modelRound).not.toHaveBeenCalled();
    const row = db.sqliteGet<{ request_payload_json: string }>(
      "SELECT request_payload_json FROM permission_requests WHERE id = 'sibling-permission'",
    );
    const retained = JSON.parse(row!.request_payload_json) as ApprovedPermissionResumePayload;
    expect.soft(retained).toEqual(bPayload);

    db.sqliteRun(
      "UPDATE permission_requests SET status = 'approved' WHERE id = 'sibling-permission'",
    );
    await runtime.resumeApprovedPermissionRequest({
      payload: retained,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(execute.mock.calls.map(([call]) => call.toolCallId)).toEqual([bCall.toolCallId]);
    expect(mocks.modelRound).toHaveBeenCalledTimes(1);
    expect(readState()).toBe('idle');
  });

  it('批准从澄清切换到编码后，首个恢复轮使用编码模式并将旧兄弟调用结算为错误', async () => {
    const savedPayload = payload();
    messages.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      clientRequestId: `${CLIENT_REQUEST_ID}:assistant:1`,
      replaceExisting: true,
      content: [savedPayload, WRITE_CALL].map((call) => ({
        type: 'tool_call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.rawInput,
      })),
    });
    const execute = vi.spyOn(ToolSandbox.prototype, 'execute').mockImplementation(async (call) => ({
      ...call,
      durationMs: 0,
      isError: false,
      output: '旧调用已执行',
    }));
    await runtime.resumeAnsweredQuestionRequest({
      payload: {
        ...savedPayload,
        requestData: { ...savedPayload.requestData, dialogueMode: 'clarify' },
        blockedToolCalls: [savedPayload, WRITE_CALL],
      },
      dialogueModeAfterApproval: 'coding',
      answerOutput: ANSWER,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(mocks.modelRound).toHaveBeenCalledTimes(1);
    expect(mocks.modelRound.mock.calls[0]?.[0]).toMatchObject({
      round: savedPayload.nextRound,
      requestData: { dialogueMode: 'coding' },
    });
    expect(execute).not.toHaveBeenCalled();
    const siblingResults = messages
      .listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID })
      .flatMap((message) => message.content)
      .filter((part) => part.type === 'tool_result' && part.toolCallId === WRITE_CALL.toolCallId);
    expect(siblingResults).toMatchObject([{ isError: true }]);
  });

  it('已完成兄弟调用不重复执行', async () => {
    appendSiblingCalls();
    messages.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'tool',
      clientRequestId: 'completed-sibling',
      content: [
        {
          type: 'tool_result',
          toolCallId: NEXT_CALL.toolCallId,
          toolName: NEXT_CALL.toolName,
          output: '已完成',
          isError: false,
        },
      ],
    });
    const execute = vi.spyOn(ToolSandbox.prototype, 'execute').mockImplementation(async (call) => ({
      ...call,
      durationMs: 0,
      isError: false,
      output: '完成',
    }));
    await runtime.resumeAnsweredQuestionRequest({
      payload: { ...payload(), blockedToolCalls: [payload(), NEXT_CALL, WRITE_CALL] },
      answerOutput: ANSWER,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(execute.mock.calls.map(([call]) => call.toolCallId)).toEqual([WRITE_CALL.toolCallId]);
    expect(mocks.modelRound).toHaveBeenCalledTimes(1);
  });
});

describe('历史自动唤醒的真实入口', () => {
  it('交互已解决时允许历史自动唤醒，不新增用户消息', async () => {
    const before = messages
      .listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID })
      .filter((message) => message.role === 'user').length;
    const result = await runtime.continueSessionFromHistory({
      clientRequestId: 'resolved-wake',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(result).toMatchObject({ statusCode: 200, stopReason: 'end_turn' });
    expect(mocks.modelRound).toHaveBeenCalledTimes(1);
    expect(
      messages
        .listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID })
        .filter((message) => message.role === 'user'),
    ).toHaveLength(before);
  });
  it.each(['pending', 'deciding'] as const)(
    '存在 %s 问题时返回 tool_permission 并保持暂停',
    async (status) => {
      insertQuestion(status);
      const result = await runtime.continueSessionFromHistory({
        clientRequestId: 'automatic-wake',
        sessionId: SESSION_ID,
        userId: USER_ID,
      });
      expect(result).toMatchObject({ statusCode: 200, stopReason: 'tool_permission' });
      expect(mocks.modelRound).not.toHaveBeenCalled();
      expect(readState()).toBe('paused');
    },
  );
});

afterAll(async () => {
  await db?.closeDb();
  vi.unstubAllEnvs();
});

describe('resumeAnsweredQuestionRequest 的真实续跑交互门禁', () => {
  it.each(['pending', 'deciding'] as const)(
    '同会话仍有 %s 问题时，落库回答并保持 paused，不调用模型',
    async (status) => {
      insertQuestion(status);
      await resumeAnswer();

      expectAnswerPersisted();
      expect.soft(mocks.modelRound).not.toHaveBeenCalled();
      expect.soft(readState()).toBe('paused');
      expect(
        db.sqliteGet<{ status: string }>('SELECT status FROM question_requests WHERE id = ?', [
          'sibling-question',
        ])?.status,
      ).toBe(status);
    },
  );

  it.each(['pending', 'deciding'] as const)(
    '同会话仍有 %s 权限时保持等待，不调用模型',
    async (status) => {
      insertPermission(status);
      await resumeAnswer();

      expectAnswerPersisted();
      expect.soft(mocks.modelRound).not.toHaveBeenCalled();
      expect.soft(readState()).toBe('paused');
    },
  );

  it.each(['answered', 'dismissed'] as const)('%s 问题允许模型继续', async (status) => {
    insertQuestion(status);
    await resumeAnswer();

    expectAnswerPersisted();
    expect(mocks.modelRound).toHaveBeenCalledTimes(1);
    expect(mocks.modelRound.mock.calls[0]?.[0]).toMatchObject({ sessionId: SESSION_ID, round: 2 });
    expect(readState()).toBe('idle');
  });

  it.each(['approved', 'rejected'] as const)('%s 权限允许模型继续', async (status) => {
    insertPermission(status);
    await resumeAnswer();

    expectAnswerPersisted();
    expect(mocks.modelRound).toHaveBeenCalledTimes(1);
    expect(readState()).toBe('idle');
  });

  it.each(['pending', 'deciding'] as const)(
    '其他会话的 %s 问题和权限不阻塞本会话',
    async (status) => {
      insertQuestion(status, OTHER_SESSION_ID);
      insertPermission(status, OTHER_SESSION_ID);
      await resumeAnswer();

      expectAnswerPersisted();
      expect(mocks.modelRound).toHaveBeenCalledTimes(1);
      expect(readState()).toBe('idle');
    },
  );
});
