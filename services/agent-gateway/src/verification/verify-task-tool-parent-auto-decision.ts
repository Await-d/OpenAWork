import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import { subscribeSessionRunEvents } from '../session/session-run-events.js';
import { hasPendingSessionInteraction } from '../session/session-runtime-state.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import { tryResolveTaskPendingInteractionWithParent } from '../task/task-parent-auto-decision.js';
import {
  assert,
  createProtocolAwareStream,
  readFetchBody,
  readLastUserMessage,
  seedPendingToolCallConversation,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

interface PendingQuestionRow {
  status: string;
}

const DECISION_MARKER = '下级开发 agent 因实现细节选择题暂停';
const RESUMED_RESULT = '父级已自动选择 workspace，子代理继续完成。';

async function verifyParentDecisionErrorFallback(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
    },
    async () => {
      await withMockFetch(
        async () => {
          throw new Error('simulated parent decision transport failure');
        },
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `parent-decision-error-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'idle')`,
              [parentSessionId, userId],
            );
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  questionToolEnabled: true,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-parent-error',
                  taskParentToolRequestId: 'parent-error-req-1',
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '父级决策异常时回退',
              description: '父级自动决策异常回退链路',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'parent-auto-decision-error-fallback'],
            });
            await taskManager.save(graph);
            sqliteRun(
              `INSERT INTO task_parent_auto_resume_contexts
                (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                childSessionId,
                parentSessionId,
                userId,
                task.id,
                JSON.stringify({
                  clientRequestId: 'parent-error-req-1',
                  message: '请委派子代理并在开发层问题出现时自行决策',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                }),
              ],
            );

            const sandbox = createDefaultSandbox();
            const questionResult = await sandbox.execute(
              {
                toolCallId: 'question-call-parent-error',
                toolName: 'question',
                rawInput: {
                  questions: [
                    {
                      header: '选择目录',
                      question: '请选择要查看的目录',
                      options: [
                        { label: 'workspace', description: '查看工作目录' },
                        { label: 'home', description: '查看主目录' },
                      ],
                    },
                  ],
                },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-parent-error-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-parent-error-req-1',
                  message: '请先问一个开发层选择题再继续',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );
            assert(
              typeof questionResult.pendingPermissionRequestId === 'string',
              'question tool should create pending request before parent decision error',
            );

            const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
              childSessionId,
              userId,
            });
            assert(resolvedByParent === false, 'parent decision errors should fall back');

            const questionRow = sqliteGet<PendingQuestionRow>(
              'SELECT status FROM question_requests WHERE id = ? AND session_id = ? LIMIT 1',
              [questionResult.pendingPermissionRequestId, childSessionId],
            );
            assert(
              questionRow?.status === 'pending',
              'parent decision error should release question request back to pending',
            );
            const sessionRow = sqliteGet<{ state_status: string }>(
              'SELECT state_status FROM sessions WHERE id = ? LIMIT 1',
              [childSessionId],
            );
            assert(
              sessionRow?.state_status === 'paused',
              'parent decision error should preserve child session paused state for manual fallback',
            );
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

async function verifyInvalidQuestionDecisionFallback(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
    },
    async () => {
      await withMockFetch(
        async (_url) =>
          createProtocolAwareStream(
            _url,
            JSON.stringify({ kind: 'question', answers: [['not-an-option']] }),
          ),
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `invalid-parent-decision-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'idle')`,
              [parentSessionId, userId],
            );
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  questionToolEnabled: true,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-invalid-decision',
                  taskParentToolRequestId: 'parent-invalid-decision-req-1',
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '父级返回无效问题决策时回退',
              description: '父级自动决策回退链路',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'parent-auto-decision-fallback'],
            });
            await taskManager.save(graph);
            sqliteRun(
              `INSERT INTO task_parent_auto_resume_contexts
                (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                childSessionId,
                parentSessionId,
                userId,
                task.id,
                JSON.stringify({
                  clientRequestId: 'parent-invalid-decision-req-1',
                  message: '请委派子代理并在开发层问题出现时自行决策',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                }),
              ],
            );

            const sandbox = createDefaultSandbox();
            const questionResult = await sandbox.execute(
              {
                toolCallId: 'question-call-invalid-decision',
                toolName: 'question',
                rawInput: {
                  questions: [
                    {
                      header: '选择目录',
                      question: '请选择要查看的目录',
                      options: [
                        { label: 'workspace', description: '查看工作目录' },
                        { label: 'home', description: '查看主目录' },
                      ],
                    },
                  ],
                },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-invalid-decision-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-invalid-decision-req-1',
                  message: '请先问一个开发层选择题再继续',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(
              typeof questionResult.pendingPermissionRequestId === 'string',
              'question tool should create a pending question request before invalid parent decision',
            );
            const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
              childSessionId,
              userId,
            });
            assert(
              resolvedByParent === false,
              'invalid option parent question decision should fall back',
            );
            const questionRow = sqliteGet<PendingQuestionRow>(
              'SELECT status FROM question_requests WHERE session_id = ? LIMIT 1',
              [childSessionId],
            );
            assert(
              questionRow?.status === 'pending',
              'invalid option parent question decision should leave the request pending',
            );
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

async function verifyLateQuestionDecisionFallback(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
    },
    async () => {
      await withMockFetch(
        async (_url) =>
          createProtocolAwareStream(
            _url,
            JSON.stringify({
              kind: 'question',
              answers: [['Start implementation']],
              rationale: '晚到的父级决策不应覆盖已处理问题。',
            }),
          ),
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `late-question-decision-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'idle')`,
              [parentSessionId, userId],
            );
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  planMode: true,
                  questionToolEnabled: true,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-late-question',
                  taskParentToolRequestId: 'parent-late-question-req-1',
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '父级问题决策晚到时回退',
              description: '晚到问题决策不应覆盖已处理状态',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'parent-auto-decision-late-question'],
            });
            await taskManager.save(graph);
            sqliteRun(
              `INSERT INTO task_parent_auto_resume_contexts
                (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                childSessionId,
                parentSessionId,
                userId,
                task.id,
                JSON.stringify({
                  clientRequestId: 'parent-late-question-req-1',
                  message: '请委派子代理并在开发层问题出现时自行决策',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                }),
              ],
            );

            const sandbox = createDefaultSandbox();
            const questionResult = await sandbox.execute(
              {
                toolCallId: 'late-question-call',
                toolName: 'question',
                rawInput: {
                  questions: [
                    {
                      header: '计划审批',
                      question: '是否批准当前计划并立即开始实现？',
                      options: [
                        { label: 'Start implementation', description: '批准计划。' },
                        { label: 'Continue planning', description: '继续规划。' },
                      ],
                    },
                  ],
                },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-late-question-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-late-question-req-1',
                  message: '请提交计划审批',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );
            assert(
              typeof questionResult.pendingPermissionRequestId === 'string',
              'late question scenario should create pending request first',
            );
            sqliteRun(
              `UPDATE question_requests
               SET tool_name = 'ExitPlanMode', status = 'deciding'
               WHERE id = ? AND session_id = ?`,
              [questionResult.pendingPermissionRequestId, childSessionId],
            );
            assert(
              hasPendingSessionInteraction(childSessionId),
              'deciding question request should block session deletion/reconciliation as pending interaction',
            );
            sqliteRun(
              `UPDATE question_requests
               SET updated_at = datetime('now', '-11 minutes')
               WHERE id = ? AND session_id = ?`,
              [questionResult.pendingPermissionRequestId, childSessionId],
            );
            assert(
              hasPendingSessionInteraction(childSessionId),
              'stale deciding question should be released to pending and still block as pending interaction',
            );
            const staleQuestionRow = sqliteGet<PendingQuestionRow>(
              'SELECT status FROM question_requests WHERE id = ? AND session_id = ? LIMIT 1',
              [questionResult.pendingPermissionRequestId, childSessionId],
            );
            assert(
              staleQuestionRow?.status === 'pending',
              'stale deciding question should return to pending for manual fallback',
            );
            sqliteRun(
              `UPDATE question_requests
               SET status = 'answered', answer_json = ?
               WHERE id = ? AND session_id = ?`,
              [
                JSON.stringify([['Continue planning']]),
                questionResult.pendingPermissionRequestId,
                childSessionId,
              ],
            );

            const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
              childSessionId,
              userId,
            });
            assert(resolvedByParent === false, 'late parent question decision should fall back');

            const session = sqliteGet<{ metadata_json: string }>(
              'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
              [childSessionId],
            );
            const metadata = JSON.parse(session?.metadata_json ?? '{}') as Record<string, unknown>;
            assert(
              metadata['planMode'] === true,
              'late ExitPlanMode decision should not mutate planMode after stale update miss',
            );
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

async function verifyExitPlanModeAutoDecision(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
    },
    async () => {
      await withMockFetch(
        async (_url, init) => {
          const body = await readFetchBody(_url, init);
          const lastUserMessage = readLastUserMessage(body);
          if (lastUserMessage.includes(DECISION_MARKER)) {
            return createProtocolAwareStream(
              _url,
              JSON.stringify({
                kind: 'question',
                answers: [['Start implementation']],
                rationale: '父级批准退出计划模式。',
              }),
            );
          }
          return createProtocolAwareStream(_url, RESUMED_RESULT);
        },
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `exit-plan-parent-decision-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'idle')`,
              [parentSessionId, userId],
            );
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  planMode: true,
                  questionToolEnabled: true,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-exit-plan-decision',
                  taskParentToolRequestId: 'parent-exit-plan-decision-req-1',
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '父级自动批准退出计划模式',
              description: '父级自动决策 ExitPlanMode 链路',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'parent-auto-exit-plan'],
            });
            await taskManager.save(graph);
            sqliteRun(
              `INSERT INTO task_parent_auto_resume_contexts
                (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                childSessionId,
                parentSessionId,
                userId,
                task.id,
                JSON.stringify({
                  clientRequestId: 'parent-exit-plan-decision-req-1',
                  message: '请委派子代理并在开发层问题出现时自行决策',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                }),
              ],
            );

            const sandbox = createDefaultSandbox();
            const questionResult = await sandbox.execute(
              {
                toolCallId: 'exit-plan-call-parent-decision',
                toolName: 'question',
                rawInput: {
                  questions: [
                    {
                      header: '计划审批',
                      question: '是否批准当前计划并立即开始实现？',
                      options: [
                        {
                          label: 'Start implementation',
                          description: '批准计划并让会话退出 plan 模式。',
                        },
                        {
                          label: 'Continue planning',
                          description: '保持 plan 模式激活并继续调优计划。',
                        },
                      ],
                    },
                  ],
                },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-exit-plan-decision-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-exit-plan-decision-req-1',
                  message: '请提交退出计划模式审批',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(
              typeof questionResult.pendingPermissionRequestId === 'string',
              'ExitPlanMode-compatible question should be pending before parent auto-decision',
            );
            sqliteRun(
              `UPDATE question_requests
               SET tool_name = 'ExitPlanMode', title = 'Exit plan mode'
               WHERE id = ? AND session_id = ?`,
              [questionResult.pendingPermissionRequestId, childSessionId],
            );
            const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
              childSessionId,
              userId,
            });
            assert(resolvedByParent, 'parent AI should resolve ExitPlanMode question');

            await waitFor(() => {
              const session = sqliteGet<{ metadata_json: string }>(
                'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
                [childSessionId],
              );
              const metadata = JSON.parse(session?.metadata_json ?? '{}') as Record<
                string,
                unknown
              >;
              return metadata['planMode'] === false;
            }, 'parent ExitPlanMode decision should clear child planMode');
            await waitFor(async () => {
              const nextGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return nextGraph.tasks[task.id]?.status === 'completed';
            }, 'ExitPlanMode parent decision should resume child task before cleanup');
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

async function main(): Promise<void> {
  await verifyParentDecisionErrorFallback();
  await verifyInvalidQuestionDecisionFallback();
  await verifyLateQuestionDecisionFallback();
  await verifyExitPlanModeAutoDecision();

  const fetchCalls: string[] = [];
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
    },
    async () => {
      await withMockFetch(
        async (_url, init) => {
          const body = await readFetchBody(_url, init);
          fetchCalls.push(body);
          const lastUserMessage = readLastUserMessage(body);
          if (lastUserMessage.includes(DECISION_MARKER)) {
            return createProtocolAwareStream(
              _url,
              JSON.stringify({
                kind: 'question',
                answers: [['workspace']],
                rationale: '开发层目录选择，使用工作区继续推进。',
              }),
            );
          }
          return createProtocolAwareStream(_url, RESUMED_RESULT);
        },
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `parent-decision-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'idle')`,
              [parentSessionId, userId],
            );
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  questionToolEnabled: true,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-parent-decision',
                  taskParentToolRequestId: 'parent-decision-req-1',
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '让父级自动决策子代理问题',
              description: '父级自动决策问题恢复链路',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'parent-auto-decision'],
            });
            await taskManager.save(graph);
            sqliteRun(
              `INSERT INTO task_parent_auto_resume_contexts
                (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                childSessionId,
                parentSessionId,
                userId,
                task.id,
                JSON.stringify({
                  clientRequestId: 'parent-decision-req-1',
                  message: '请委派子代理并在开发层问题出现时自行决策',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                }),
              ],
            );

            const sandbox = createDefaultSandbox();
            const questionRawInput = {
              questions: [
                {
                  header: '选择目录',
                  question: '请选择要查看的目录',
                  options: [
                    { label: 'workspace', description: '查看工作目录' },
                    { label: 'home', description: '查看主目录' },
                  ],
                },
              ],
            };
            const questionResult = await sandbox.execute(
              {
                toolCallId: 'question-call-parent-decision',
                toolName: 'question',
                rawInput: questionRawInput,
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-parent-decision-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-parent-decision-req-1',
                  message: '请先问一个开发层选择题再继续',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );
            await seedPendingToolCallConversation({
              clientRequestId: 'child-parent-decision-req-1',
              rawInput: questionRawInput,
              sessionId: childSessionId,
              toolCallId: 'question-call-parent-decision',
              toolName: 'question',
              userId,
              userMessage: '请先问一个开发层选择题再继续',
            });

            assert(
              typeof questionResult.pendingPermissionRequestId === 'string',
              'question tool should create a pending question request before parent auto-decision',
            );
            const unsubscribeThrowingHandler = subscribeSessionRunEvents(childSessionId, () => {
              throw new Error('intentional verification subscriber failure');
            });
            let resolvedByParent = false;
            try {
              resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
                childSessionId,
                userId,
              });
            } finally {
              unsubscribeThrowingHandler();
            }
            assert(
              resolvedByParent,
              'parent AI should resolve the child development question even when a subscriber throws',
            );

            await waitFor(async () => {
              const nextGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return nextGraph.tasks[task.id]?.status === 'completed';
            }, 'parent auto-decision should answer the child question and complete the task');

            const nextGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            assert(
              nextGraph.tasks[task.id]?.result === RESUMED_RESULT,
              'parent auto-decision should persist resumed child result',
            );
            const questionRow = sqliteGet<PendingQuestionRow>(
              'SELECT status FROM question_requests WHERE session_id = ? LIMIT 1',
              [childSessionId],
            );
            assert(
              questionRow?.status === 'answered',
              'question request should be answered by parent AI',
            );
            assert(
              fetchCalls.some((body) => readLastUserMessage(body).includes(DECISION_MARKER)),
              'parent AI should receive the structured development decision request',
            );

            console.log('verify-task-tool-parent-auto-decision: ok');
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-tool-parent-auto-decision: failed');
  console.error(error);
  process.exitCode = 1;
});
