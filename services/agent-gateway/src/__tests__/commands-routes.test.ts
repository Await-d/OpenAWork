import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { buildCommandDescriptors } from '../routes/command-descriptors.js';

let app: FastifyInstance | null = null;
let closeDb: (() => Promise<void>) | null = null;

describe('buildCommandDescriptors', () => {
  it('exposes the server-backed composer and palette commands', () => {
    const commands = buildCommandDescriptors();

    expect(commands.some((command) => command.id === 'slash-compact')).toBe(true);
    expect(commands.some((command) => command.id === 'slash-handoff')).toBe(true);
    expect(commands.some((command) => command.id === 'nav-chat')).toBe(true);
    expect(commands.some((command) => command.id === 'nav-settings')).toBe(true);
    expect(commands.some((command) => command.id === 'slash-init-deep')).toBe(true);
    expect(commands.some((command) => command.id === 'slash-ralph-loop')).toBe(true);
    expect(commands.some((command) => command.id === 'slash-ulw-loop')).toBe(true);
    expect(commands.some((command) => command.id === 'slash-ulw-verify')).toBe(true);
    expect(commands.some((command) => command.id === 'slash-cancel-ralph')).toBe(true);
    expect(commands.some((command) => command.id === 'slash-stop-continuation')).toBe(true);
    expect(commands.some((command) => command.id === 'slash-refactor')).toBe(true);
    expect(commands.some((command) => command.id === 'slash-start-work')).toBe(true);
  });

  it('tags commands with their intended UI surfaces', () => {
    const commands = buildCommandDescriptors();
    const composerOnly = commands.filter((command) => command.contexts.includes('composer'));
    const paletteOnly = commands.filter((command) => command.contexts.includes('palette'));

    expect(composerOnly.length).toBeGreaterThan(0);
    expect(paletteOnly.length).toBeGreaterThan(0);
    expect(composerOnly.some((command) => command.execution === 'server')).toBe(true);
  });
});

describe.skipIf(process.version.startsWith('v22.') || process.version.startsWith('v24.'))(
  'commands routes integration',
  () => {
    beforeEach(async () => {
      vi.resetModules();
      process.env['DATABASE_URL'] = ':memory:';

      const [
        { default: Fastify },
        { default: authPlugin },
        { sessionsRoutes },
        { commandsRoutes },
        dbModule,
      ] = await Promise.all([
        import('fastify'),
        import('../auth.js'),
        import('../routes/sessions.js'),
        import('../routes/commands.js'),
        import('../db.js'),
      ]);

      closeDb = dbModule.closeDb;
      await dbModule.connectDb();
      await dbModule.migrate();

      const admin = dbModule.sqliteGet<{ id: string }>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        ['admin@openAwork.local'],
      );

      if (!admin) {
        dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          randomUUID(),
          'admin@openAwork.local',
          createHash('sha256').update('admin123456').digest('hex'),
        ]);
      }

      app = Fastify();
      await app.register(authPlugin);
      await app.register(sessionsRoutes);
      await app.register(commandsRoutes);
      await app.ready();
    });

    afterEach(async () => {
      if (app) {
        await app.close();
        app = null;
      }
      if (closeDb) {
        await closeDb();
        closeDb = null;
      }
      delete process.env['DATABASE_URL'];
    });

    it('executes the compact command and persists compaction metadata', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });

      expect(loginRes.statusCode).toBe(200);
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });

      expect(sessionRes.statusCode).toBe(201);
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const executeRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-compact',
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: [{ type: 'text', text: '第一段上下文' }],
              createdAt: Date.now(),
            },
            {
              id: 'm2',
              role: 'assistant',
              content: [{ type: 'text', text: '第二段总结' }],
              createdAt: Date.now(),
            },
          ],
        },
      });

      expect(executeRes.statusCode).toBe(200);
      const { result } = JSON.parse(executeRes.body) as {
        result: {
          events: Array<{ type: string }>;
          card?: { type: string; title: string; summary?: string };
        };
      };

      expect(result.events.some((event) => event.type === 'compaction')).toBe(true);
      expect(result.card).toMatchObject({ type: 'compaction', title: '会话已压缩' });

      const getRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(getRes.statusCode).toBe(200);
      const session = JSON.parse(getRes.body) as {
        session: {
          metadata_json: string;
          messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
        };
      };
      const metadata = JSON.parse(session.session.metadata_json) as Record<string, unknown>;
      expect(typeof metadata['lastCompactionSummary']).toBe('string');
      expect(metadata['lastCompactionTrigger']).toBe('manual');
      expect(String(metadata['lastCompactionSummary'])).toContain(
        'Durable session compaction memory',
      );
      expect(metadata['compactionMemory']).toMatchObject({
        coveredUntilMessageId: 'm2',
        schemaVersion: 1,
      });
      expect(session.session.messages.at(-1)?.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('"type":"compaction"'),
      });
      expect(
        session.session.messages.some((message) =>
          message.content.some(
            (content) =>
              content.type === 'text' &&
              typeof content.text === 'string' &&
              content.text.includes('compaction_marker'),
          ),
        ),
      ).toBe(false);

      const tasksRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/tasks`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(tasksRes.statusCode).toBe(200);
      const tasks = JSON.parse(tasksRes.body) as {
        tasks: Array<{ title: string; status: string; result?: string }>;
      };
      expect(tasks.tasks[0]).toMatchObject({
        title: '压缩会话',
        status: 'completed',
      });
    });

    it('executes the summarize alias as the same compaction path', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });

      expect(loginRes.statusCode).toBe(200);
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const executeRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-summarize',
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: [{ type: 'text', text: '别名压缩上下文' }],
              createdAt: Date.now(),
            },
          ],
        },
      });

      expect(executeRes.statusCode).toBe(200);
      const { result } = JSON.parse(executeRes.body) as {
        result: { events: Array<{ type: string }>; card?: { type: string; title: string } };
      };

      expect(result.events.some((event) => event.type === 'compaction')).toBe(true);
      expect(result.card).toMatchObject({ type: 'compaction', title: '会话已压缩' });
    });

    it('creates real subtasks from workflow checklist items when /start-work selects a plan', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const workflowDir = join(process.cwd(), '.agentdocs', 'workflow');
      mkdirSync(workflowDir, { recursive: true });
      const workflowPath = join(workflowDir, `test-start-work-${randomUUID()}.md`);

      try {
        writeFileSync(
          workflowPath,
          [
            '# 子任务计划',
            '',
            '- [ ] 设计任务树模型',
            '- [x] 旧任务已完成',
            '- [ ] 接通任务面板展示',
            '',
          ].join('\n'),
          'utf8',
        );

        const executeRes = await app!.inject({
          method: 'POST',
          url: `/sessions/${sessionId}/commands/execute`,
          headers: { authorization: `Bearer ${accessToken}` },
          payload: {
            commandId: 'slash-start-work',
            rawInput: '/start-work 子任务计划',
            messages: [],
          },
        });

        expect(executeRes.statusCode).toBe(200);
        const executed = JSON.parse(executeRes.body) as {
          result: {
            card?: { message: string };
            events: Array<{
              taskId: string;
              label: string;
              status: string;
              parentTaskId?: string;
            }>;
          };
        };

        expect(executed.result.card?.message).toContain('已同步子任务：2 项');
        expect(executed.result.events).toHaveLength(3);
        expect(executed.result.events[0]).toMatchObject({
          label: '执行计划：子任务计划',
          status: 'in_progress',
        });
        expect(executed.result.events.slice(1)).toEqual([
          expect.objectContaining({
            label: '设计任务树模型',
            status: 'pending',
            parentTaskId: executed.result.events[0]?.taskId,
          }),
          expect.objectContaining({
            label: '接通任务面板展示',
            status: 'pending',
            parentTaskId: executed.result.events[0]?.taskId,
          }),
        ]);

        const tasksRes = await app!.inject({
          method: 'GET',
          url: `/sessions/${sessionId}/tasks`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

        expect(tasksRes.statusCode).toBe(200);
        const tasksPayload = JSON.parse(tasksRes.body) as {
          tasks: Array<{
            blockedBy: string[];
            id: string;
            title: string;
            parentTaskId?: string;
            depth: number;
            subtaskCount: number;
          }>;
        };

        expect(tasksPayload.tasks[0]).toMatchObject({
          title: '执行计划：子任务计划',
          depth: 0,
          subtaskCount: 2,
        });
        expect(tasksPayload.tasks.slice(1)).toEqual([
          expect.objectContaining({
            title: '设计任务树模型',
            parentTaskId: executed.result.events[0]?.taskId,
            depth: 1,
          }),
          expect.objectContaining({
            title: '接通任务面板展示',
            parentTaskId: executed.result.events[0]?.taskId,
            depth: 1,
          }),
        ]);
        expect(tasksPayload.tasks[1]?.blockedBy).toEqual([]);
        expect(tasksPayload.tasks[2]?.blockedBy).toEqual([tasksPayload.tasks[1]?.id]);
      } finally {
        rmSync(workflowPath, { force: true });
      }
    });

    it('reuses the same start-work root task for the same workflow plan', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const workflowDir = join(process.cwd(), '.agentdocs', 'workflow');
      mkdirSync(workflowDir, { recursive: true });
      const workflowPath = join(workflowDir, `test-start-work-reuse-${randomUUID()}.md`);

      try {
        writeFileSync(
          workflowPath,
          ['# 复用计划', '', '- [ ] 第一步', '- [ ] 第二步', ''].join('\n'),
          'utf8',
        );

        const firstRes = await app!.inject({
          method: 'POST',
          url: `/sessions/${sessionId}/commands/execute`,
          headers: { authorization: `Bearer ${accessToken}` },
          payload: {
            commandId: 'slash-start-work',
            rawInput: '/start-work 复用计划',
            messages: [],
          },
        });
        const secondRes = await app!.inject({
          method: 'POST',
          url: `/sessions/${sessionId}/commands/execute`,
          headers: { authorization: `Bearer ${accessToken}` },
          payload: {
            commandId: 'slash-start-work',
            rawInput: '/start-work 复用计划',
            messages: [],
          },
        });

        expect(firstRes.statusCode).toBe(200);
        expect(secondRes.statusCode).toBe(200);

        const firstPayload = JSON.parse(firstRes.body) as {
          result: {
            events: Array<{ taskId: string; parentTaskId?: string }>;
            card?: { message: string };
          };
        };
        const secondPayload = JSON.parse(secondRes.body) as {
          result: {
            events: Array<{ taskId: string; parentTaskId?: string }>;
            card?: { message: string };
          };
        };

        expect(secondPayload.result.card?.message).toContain('已复用现有计划任务');
        expect(secondPayload.result.events[0]?.taskId).toBe(firstPayload.result.events[0]?.taskId);

        const tasksRes = await app!.inject({
          method: 'GET',
          url: `/sessions/${sessionId}/tasks`,
          headers: { authorization: `Bearer ${accessToken}` },
        });
        const tasksPayload = JSON.parse(tasksRes.body) as {
          tasks: Array<{ title: string; parentTaskId?: string }>;
        };

        expect(
          tasksPayload.tasks.filter((task) => task.title === '执行计划：复用计划'),
        ).toHaveLength(1);
        expect(
          tasksPayload.tasks.filter(
            (task) => task.parentTaskId === firstPayload.result.events[0]?.taskId,
          ),
        ).toHaveLength(2);
      } finally {
        rmSync(workflowPath, { force: true });
      }
    });

    it('returns a warning when /handoff is requested for an empty session', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const executeRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-handoff',
          messages: [],
        },
      });

      expect(executeRes.statusCode).toBe(200);
      const { result } = JSON.parse(executeRes.body) as {
        result: { events: Array<{ type: string }>; card?: { title: string; tone: string } };
      };

      expect(result.events).toHaveLength(0);
      expect(result.card).toMatchObject({
        title: 'Handoff unavailable',
        tone: 'warning',
      });
    });

    it('starts and cancels a ralph loop using raw slash input', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const startRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ralph-loop',
          rawInput: '/ralph-loop "修复认证模块" --max-iterations 7 --strategy reset',
          messages: [],
        },
      });

      expect(startRes.statusCode).toBe(200);
      const started = JSON.parse(startRes.body) as {
        result: { card?: { message: string } };
      };
      expect(started.result.card?.message).toContain('修复认证模块');
      expect(started.result.card?.message).toContain('最大迭代：7');
      expect(started.result.card?.message).toContain('策略：reset');

      const cancelRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-cancel-ralph',
          rawInput: '/cancel-ralph',
          messages: [],
        },
      });

      expect(cancelRes.statusCode).toBe(200);
      const cancelled = JSON.parse(cancelRes.body) as {
        result: {
          events: Array<{ type: string; status?: string }>;
          card?: { title: string; message: string };
        };
      };
      expect(cancelled.result.card?.title).toBe('/cancel-ralph 已执行');
      expect(cancelled.result.card?.message).toContain('已取消当前 Ralph Loop 循环');
      expect(cancelled.result.events[0]).toMatchObject({
        type: 'task_update',
        status: 'cancelled',
      });
    });

    it('runs a background ralph loop and persists iteration output', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const executeRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ralph-loop',
          rawInput: '/ralph-loop "修复认证模块" --max-iterations 1 --strategy continue',
          messages: [],
        },
      });

      expect(executeRes.statusCode).toBe(200);
      await new Promise((resolve) => {
        setTimeout(resolve, 80);
      });

      const tasksRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/tasks`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const tasksPayload = JSON.parse(tasksRes.body) as {
        tasks: Array<{ title: string; status: string; result?: string }>;
      };
      const loopTask = tasksPayload.tasks.find((task) => task.title === 'Ralph Loop');
      expect(loopTask).toMatchObject({ status: 'completed' });
      expect(loopTask?.result).toContain('<promise>DONE</promise>');

      const sessionGetRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const sessionPayload = JSON.parse(sessionGetRes.body) as {
        session: {
          messages: Array<{
            role: string;
            content: Array<{ type: string; text?: string }>;
          }>;
        };
      };
      const assistantTexts = sessionPayload.session.messages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) =>
          message.content
            .filter((content) => content.type === 'text')
            .map((content) => content.text ?? ''),
        );
      expect(assistantTexts.some((text) => text.includes('修复认证模块'))).toBe(true);
      expect(assistantTexts.some((text) => text.includes('<promise>DONE</promise>'))).toBe(true);
    });

    it('clears persisted loop state even when metadata is missing', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const stateDir = join(process.cwd(), '.sisyphus');
      mkdirSync(stateDir, { recursive: true });
      const stateFile = join(stateDir, 'ralph-loop.local.md');
      writeFileSync(
        stateFile,
        [
          '---',
          'active: true',
          'iteration: 1',
          'completion_promise: "DONE"',
          '---',
          '修复认证模块',
          '',
        ].join('\n'),
        'utf8',
      );
      expect(existsSync(stateFile)).toBe(true);

      const cancelRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-cancel-ralph',
          rawInput: '/cancel-ralph',
          messages: [],
        },
      });

      expect(cancelRes.statusCode).toBe(200);
      const cancelled = JSON.parse(cancelRes.body) as {
        result: { events: Array<{ type: string }>; card?: { message: string } };
      };
      expect(cancelled.result.events).toHaveLength(0);
      expect(cancelled.result.card?.message).toContain('已清理残留的 Ralph Loop state file');
      expect(existsSync(stateFile)).toBe(false);
    });

    it('completes a verification-pending ULW task with /ulw-verify --pass', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const startRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      expect(startRes.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 120));

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass looks-good',
          messages: [],
        },
      });
      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { events: Array<{ type: string; status?: string }>; card?: { title: string } };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify 已通过');
      expect(verified.result.events[0]).toMatchObject({ type: 'task_update', status: 'done' });

      const tasksRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/tasks`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const tasksPayload = JSON.parse(tasksRes.body) as {
        tasks: Array<{ title: string; status: string; result?: string }>;
      };
      const ulwTask = tasksPayload.tasks.find((task) => task.title === 'UltraWork Loop');
      expect(ulwTask).toMatchObject({ status: 'completed' });
      expect(ulwTask?.result).toContain('<promise>VERIFIED</promise>');
      expect(existsSync(getLoopStateFilePath(process.cwd(), sessionId))).toBe(false);
    });

    it('fails a verification-pending ULW task with /ulw-verify --fail', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const startRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      expect(startRes.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 120));

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --fail missing-proof',
          messages: [],
        },
      });
      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { events: Array<{ type: string; status?: string }>; card?: { title: string } };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify 未通过');
      expect(verified.result.events[0]).toMatchObject({ type: 'task_update', status: 'failed' });

      const tasksRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/tasks`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const tasksPayload = JSON.parse(tasksRes.body) as {
        tasks: Array<{ title: string; status: string; result?: string }>;
      };
      const ulwTask = tasksPayload.tasks.find((task) => task.title === 'UltraWork Loop');
      expect(ulwTask).toMatchObject({ status: 'failed' });
      expect(ulwTask?.result).toContain('missing-proof');
      expect(existsSync(getLoopStateFilePath(process.cwd(), sessionId))).toBe(false);
    });

    it('warns when /ulw-verify is used without a pending ULW verification state', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass',
          messages: [],
        },
      });
      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { events: Array<{ type: string }>; card?: { title: string; tone: string } };
      };
      expect(verified.result.events).toHaveLength(0);
      expect(verified.result.card).toMatchObject({
        title: '/ulw-verify unavailable',
        tone: 'warning',
      });
    });

    it('accepts a multi-word note for /ulw-verify --pass', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass looks good after review',
          messages: [],
        },
      });
      expect(verifyRes.statusCode).toBe(200);

      const tasksRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/tasks`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const tasksPayload = JSON.parse(tasksRes.body) as {
        tasks: Array<{ title: string; result?: string }>;
      };
      const ulwTask = tasksPayload.tasks.find((task) => task.title === 'UltraWork Loop');
      expect(ulwTask?.result).toContain('Review note: looks good after review');
    });

    it('accepts a multi-word reason for /ulw-verify --fail', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --fail missing evidence from oracle review',
          messages: [],
        },
      });
      expect(verifyRes.statusCode).toBe(200);

      const tasksRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/tasks`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const tasksPayload = JSON.parse(tasksRes.body) as {
        tasks: Array<{ title: string; result?: string }>;
      };
      const ulwTask = tasksPayload.tasks.find((task) => task.title === 'UltraWork Loop');
      expect(ulwTask?.result).toContain('missing evidence from oracle review');
    });

    it('verifies ULW from persisted state even when active loop metadata is missing', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const sessionGetRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const sessionPayload = JSON.parse(sessionGetRes.body) as {
        session: { metadata_json: string };
      };
      const metadata = JSON.parse(sessionPayload.session.metadata_json) as Record<string, unknown>;
      delete metadata['activeLoopKind'];
      delete metadata['activeLoopTaskId'];
      delete metadata['ulwLoopActive'];
      delete metadata['ulwLoopTaskId'];

      const dbModule = await import('../db.js');
      dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        JSON.stringify(metadata),
        sessionId,
      ]);

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass restored from state',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { card?: { title: string }; events: Array<{ type: string; status?: string }> };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify 已通过');
      expect(verified.result.events[0]).toMatchObject({ type: 'task_update', status: 'done' });
      expect(existsSync(getLoopStateFilePath(process.cwd(), sessionId))).toBe(false);

      const postSessionRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const postSessionPayload = JSON.parse(postSessionRes.body) as {
        session: { metadata_json: string };
      };
      const postMetadata = JSON.parse(postSessionPayload.session.metadata_json) as Record<
        string,
        unknown
      >;
      expect(postMetadata['activeLoopKind']).toBeUndefined();
      expect(postMetadata['activeLoopTaskId']).toBeUndefined();
      expect(postMetadata['ulwVerificationPendingTaskId']).toBeUndefined();
      expect(postMetadata['ulwVerificationPendingAt']).toBeUndefined();
    });

    it('fails ULW from persisted state even when active loop metadata is missing', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const sessionGetRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const sessionPayload = JSON.parse(sessionGetRes.body) as {
        session: { metadata_json: string };
      };
      const metadata = JSON.parse(sessionPayload.session.metadata_json) as Record<string, unknown>;
      delete metadata['activeLoopKind'];
      delete metadata['activeLoopTaskId'];
      delete metadata['ulwLoopActive'];
      delete metadata['ulwLoopTaskId'];

      const dbModule = await import('../db.js');
      dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        JSON.stringify(metadata),
        sessionId,
      ]);

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --fail restored fail path',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { card?: { title: string }; events: Array<{ type: string; status?: string }> };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify 未通过');
      expect(verified.result.events[0]).toMatchObject({ type: 'task_update', status: 'failed' });
      expect(existsSync(getLoopStateFilePath(process.cwd(), sessionId))).toBe(false);

      const postSessionRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const postSessionPayload = JSON.parse(postSessionRes.body) as {
        session: { metadata_json: string };
      };
      const postMetadata = JSON.parse(postSessionPayload.session.metadata_json) as Record<
        string,
        unknown
      >;
      expect(postMetadata['activeLoopKind']).toBeUndefined();
      expect(postMetadata['activeLoopTaskId']).toBeUndefined();
      expect(postMetadata['ulwVerificationPendingTaskId']).toBeUndefined();
      expect(postMetadata['ulwVerificationPendingAt']).toBeUndefined();
    });

    it('cleans stale ULW verification state when persisted task is missing', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const stateFile = getLoopStateFilePath(process.cwd(), sessionId);
      writeFileSync(
        stateFile,
        [
          '---',
          'active: true',
          'iteration: 2',
          'completion_promise: "VERIFIED"',
          'verification_pending: true',
          'ultrawork: true',
          `session_id: "${sessionId}"`,
          'task_id: "missing-task"',
          '---',
          '验证发布流程',
          '',
        ].join('\n'),
        'utf8',
      );

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass restored from stale state',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { card?: { title: string; message: string }; events: Array<{ type: string }> };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify unavailable');
      expect(verified.result.card?.message).toContain('关联任务已丢失');
      expect(verified.result.events).toHaveLength(0);
      expect(existsSync(stateFile)).toBe(false);
    });

    it('does not clear active Ralph metadata when stale ULW verification state is missing its task', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const dbModule = await import('../db.js');
      dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        JSON.stringify({ activeLoopKind: 'ralph', activeLoopTaskId: 'ralph-task' }),
        sessionId,
      ]);

      const stateFile = getLoopStateFilePath(process.cwd(), sessionId);
      writeFileSync(
        stateFile,
        [
          '---',
          'active: true',
          'iteration: 2',
          'completion_promise: "VERIFIED"',
          'verification_pending: true',
          'ultrawork: true',
          `session_id: "${sessionId}"`,
          'task_id: "missing-task"',
          '---',
          '验证发布流程',
          '',
        ].join('\n'),
        'utf8',
      );

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass stale-ulw',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const sessionGetRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const sessionPayload = JSON.parse(sessionGetRes.body) as {
        session: { metadata_json: string };
      };
      const metadata = JSON.parse(sessionPayload.session.metadata_json) as Record<string, unknown>;
      expect(metadata['activeLoopKind']).toBe('ralph');
      expect(metadata['activeLoopTaskId']).toBe('ralph-task');
    });

    it('prefers persisted task_id over conflicting activeLoop metadata during /ulw-verify', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const tasksRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/tasks`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const tasksPayload = JSON.parse(tasksRes.body) as {
        tasks: Array<{ id: string; title: string }>;
      };
      const ulwTask = tasksPayload.tasks.find((task) => task.title === 'UltraWork Loop');
      expect(ulwTask).toBeDefined();

      const dbModule = await import('../db.js');
      dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        JSON.stringify({ activeLoopKind: 'ulw', activeLoopTaskId: 'wrong-task-id' }),
        sessionId,
      ]);

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass conflict resolution',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { events: Array<{ taskId?: string; status?: string }>; card?: { title: string } };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify 已通过');
      expect(verified.result.events[0]).toMatchObject({ taskId: ulwTask?.id, status: 'done' });
    });

    it('recovers /ulw-verify from a state file without task_id when there is exactly one running ULW task', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const stateFile = getLoopStateFilePath(process.cwd(), sessionId);
      const stateText = readFileSync(stateFile, 'utf8').replace(/\ntask_id: ".+"/, '');
      writeFileSync(stateFile, stateText, 'utf8');

      const sessionGetRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const sessionPayload = JSON.parse(sessionGetRes.body) as {
        session: { metadata_json: string };
      };
      const metadata = JSON.parse(sessionPayload.session.metadata_json) as Record<string, unknown>;
      delete metadata['activeLoopKind'];
      delete metadata['activeLoopTaskId'];
      delete metadata['ulwLoopActive'];
      delete metadata['ulwLoopTaskId'];

      const dbModule = await import('../db.js');
      dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        JSON.stringify(metadata),
        sessionId,
      ]);

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass fallback recovery',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { card?: { title: string } };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify 已通过');
      expect(existsSync(stateFile)).toBe(false);
    });

    it('does not verify a persisted task_id that points to a non-ULW task', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const dbModule = await import('../db.js');
      dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        JSON.stringify({}),
        sessionId,
      ]);

      const graphModule = await import('../routes/commands.js');
      void graphModule;

      const stateFile = getLoopStateFilePath(process.cwd(), sessionId);
      writeFileSync(
        stateFile,
        [
          '---',
          'active: true',
          'iteration: 2',
          'completion_promise: "VERIFIED"',
          'verification_pending: true',
          'ultrawork: true',
          `session_id: "${sessionId}"`,
          'task_id: "non-ulw-task"',
          '---',
          '验证发布流程',
          '',
        ].join('\n'),
        'utf8',
      );

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass should-not-verify',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { card?: { title: string; message: string } };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify unavailable');
      expect(verified.result.card?.message).toContain('关联任务已丢失');
    });

    it('prefers a running metadata ULW task when persisted task_id points to a completed task', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const tasksRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/tasks`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const tasksPayload = JSON.parse(tasksRes.body) as {
        tasks: Array<{ id: string; title: string; status: string }>;
      };
      const ulwTask = tasksPayload.tasks.find((task) => task.title === 'UltraWork Loop');
      expect(ulwTask).toBeDefined();

      const stateFile = getLoopStateFilePath(process.cwd(), sessionId);
      const stateText = readFileSync(stateFile, 'utf8').replace(
        /task_id: ".+"/,
        'task_id: "completed-old-task"',
      );
      writeFileSync(stateFile, stateText, 'utf8');

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass prefer-running-task',
          messages: [],
        },
      });
      expect(verifyRes.statusCode).toBe(200);

      const verified = JSON.parse(verifyRes.body) as {
        result: { events: Array<{ taskId?: string; status?: string }> };
      };
      expect(verified.result.events[0]).toMatchObject({ taskId: ulwTask?.id, status: 'done' });
    });

    it('returns ambiguous warning instead of clearing state when multiple ULW tasks are running and state lacks task_id', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const taskManager = new AgentTaskManagerImpl();
      const graph = await taskManager.loadOrCreate(process.cwd(), sessionId);
      const taskA = taskManager.addTask(graph, {
        title: 'UltraWork Loop',
        description: 'a',
        status: 'pending',
        blockedBy: [],
        sessionId,
        priority: 'high',
        tags: ['ulw-loop'],
      });
      const taskB = taskManager.addTask(graph, {
        title: 'UltraWork Loop',
        description: 'b',
        status: 'pending',
        blockedBy: [],
        sessionId,
        priority: 'high',
        tags: ['ulw-loop'],
      });
      taskManager.startTask(graph, taskA.id);
      taskManager.startTask(graph, taskB.id);
      await taskManager.save(graph);

      const stateFile = getLoopStateFilePath(process.cwd(), sessionId);
      writeFileSync(
        stateFile,
        [
          '---',
          'active: true',
          'iteration: 2',
          'completion_promise: "VERIFIED"',
          'verification_pending: true',
          'ultrawork: true',
          `session_id: "${sessionId}"`,
          '---',
          '验证发布流程',
          '',
        ].join('\n'),
        'utf8',
      );

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass ambiguous',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { card?: { title: string; message: string } };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify unavailable');
      expect(verified.result.card?.message).toContain('多个可恢复的 ULW 任务');
      expect(existsSync(stateFile)).toBe(true);
    });

    it('still verifies ULW when verification state file is missing but active ULW metadata remains', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程"',
          messages: [],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const stateFile = getLoopStateFilePath(process.cwd(), sessionId);
      expect(existsSync(stateFile)).toBe(true);
      const fs = await import('node:fs');
      fs.unlinkSync(stateFile);

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass recovered after file loss',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { card?: { title: string }; events: Array<{ type: string; status?: string }> };
      };
      expect(verified.result.card?.title).toBe('/ulw-verify 已通过');
      expect(verified.result.events[0]).toMatchObject({ type: 'task_update', status: 'done' });
    });

    it('rejects /ulw-verify when the state file is missing before ULW reaches verification stage', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-loop',
          rawInput: '/ulw-loop "验证发布流程" --max-iterations 5',
          messages: [],
        },
      });

      const stateFile = getLoopStateFilePath(process.cwd(), sessionId);
      expect(existsSync(stateFile)).toBe(true);
      const fs = await import('node:fs');
      fs.unlinkSync(stateFile);

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass too-early',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { card?: { title: string; tone: string } };
      };
      expect(verified.result.card).toMatchObject({
        title: '/ulw-verify unavailable',
        tone: 'warning',
      });
    });

    it('clears stale ULW metadata when both state file and recoverable task are missing', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const dbModule = await import('../db.js');
      dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        JSON.stringify({
          activeLoopKind: 'ulw',
          activeLoopTaskId: 'missing-task',
          ulwLoopActive: true,
        }),
        sessionId,
      ]);

      const verifyRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ulw-verify',
          rawInput: '/ulw-verify --pass stale',
          messages: [],
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verified = JSON.parse(verifyRes.body) as {
        result: { card?: { title: string; tone: string } };
      };
      expect(verified.result.card).toMatchObject({
        title: '/ulw-verify unavailable',
        tone: 'warning',
      });

      const sessionGetRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const sessionPayload = JSON.parse(sessionGetRes.body) as {
        session: { metadata_json: string };
      };
      const metadata = JSON.parse(sessionPayload.session.metadata_json) as Record<string, unknown>;
      expect(metadata['activeLoopKind']).toBeUndefined();
      expect(metadata['ulwLoopActive']).toBeUndefined();
    });

    it('clears legacy root .openawork loop state when metadata is missing', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const stateFile = join(process.cwd(), '.openawork.ralph-loop.local.md');
      writeFileSync(
        stateFile,
        [
          '---',
          'active: true',
          'iteration: 1',
          'completion_promise: "DONE"',
          `session_id: "${sessionId}"`,
          '---',
          '修复认证模块',
          '',
        ].join('\n'),
        'utf8',
      );
      expect(existsSync(stateFile)).toBe(true);

      const cancelRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-cancel-ralph',
          rawInput: '/cancel-ralph',
          messages: [],
        },
      });

      expect(cancelRes.statusCode).toBe(200);
      const cancelled = JSON.parse(cancelRes.body) as {
        result: { events: Array<{ type: string }>; card?: { message: string } };
      };
      expect(cancelled.result.events).toHaveLength(0);
      expect(cancelled.result.card?.message).toContain('已清理残留的 Ralph Loop state file');
      expect(existsSync(stateFile)).toBe(false);
    });

    it('clears legacy root .openawork loop state without session_id when metadata is missing', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const stateFile = join(process.cwd(), '.openawork.ralph-loop.local.md');
      writeFileSync(
        stateFile,
        [
          '---',
          'active: true',
          'iteration: 1',
          'completion_promise: "DONE"',
          '---',
          '修复认证模块',
          '',
        ].join('\n'),
        'utf8',
      );
      expect(existsSync(stateFile)).toBe(true);

      const cancelRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-cancel-ralph',
          rawInput: '/cancel-ralph',
          messages: [],
        },
      });

      expect(cancelRes.statusCode).toBe(200);
      const cancelled = JSON.parse(cancelRes.body) as {
        result: { events: Array<{ type: string }>; card?: { message: string } };
      };
      expect(cancelled.result.events).toHaveLength(0);
      expect(cancelled.result.card?.message).toContain('已清理残留的 Ralph Loop state file');
      expect(existsSync(stateFile)).toBe(false);
    });

    it('stops continuation and clears persisted loop state', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const stateFile = getLoopStateFilePath(process.cwd(), sessionId);
      writeFileSync(
        stateFile,
        [
          '---',
          'active: true',
          'iteration: 1',
          'completion_promise: "DONE"',
          '---',
          '修复认证模块',
          '',
        ].join('\n'),
        'utf8',
      );

      const startRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-ralph-loop',
          rawInput: '/ralph-loop "修复认证模块" --max-iterations 7',
          messages: [],
        },
      });
      expect(startRes.statusCode).toBe(200);

      const stopRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-stop-continuation',
          rawInput: '/stop-continuation',
          messages: [],
        },
      });

      expect(stopRes.statusCode).toBe(200);
      const stopped = JSON.parse(stopRes.body) as {
        result: {
          events: Array<{ type: string; status?: string }>;
          card?: { title: string; message: string };
        };
      };
      expect(stopped.result.card?.title).toBe('/stop-continuation 已执行');
      expect(stopped.result.card?.message).toContain('已停止当前 continuation 机制');
      expect(stopped.result.events[0]).toMatchObject({ type: 'task_update', status: 'cancelled' });
      expect(existsSync(stateFile)).toBe(false);

      const sessionGetRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const sessionPayload = JSON.parse(sessionGetRes.body) as {
        session: { metadata_json: string };
      };
      const metadata = JSON.parse(sessionPayload.session.metadata_json) as Record<string, unknown>;
      expect(metadata['activeLoopKind']).toBeUndefined();
      expect(metadata['activeLoopTaskId']).toBeUndefined();
      expect(metadata['ulwVerificationPendingTaskId']).toBeUndefined();
      expect(metadata['ulwVerificationPendingAt']).toBeUndefined();
    });

    it('returns no task events when stop-continuation has nothing to cancel', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const stopRes = await app!.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/commands/execute`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          commandId: 'slash-stop-continuation',
          rawInput: '/stop-continuation',
          messages: [],
        },
      });

      expect(stopRes.statusCode).toBe(200);
      const stopped = JSON.parse(stopRes.body) as {
        result: { events: Array<{ type: string; status?: string }>; card?: { title: string } };
      };
      expect(stopped.result.card?.title).toBe('/stop-continuation 已执行');
      expect(stopped.result.events).toHaveLength(0);

      const sessionGetRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const sessionPayload = JSON.parse(sessionGetRes.body) as {
        session: { metadata_json: string };
      };
      const metadata = JSON.parse(sessionPayload.session.metadata_json) as Record<string, unknown>;
      expect(metadata['ulwVerificationPendingTaskId']).toBeUndefined();
      expect(metadata['ulwVerificationPendingAt']).toBeUndefined();
    });

    it('lists child sessions created with parentSessionId metadata', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const parentRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId: parentId } = JSON.parse(parentRes.body) as { sessionId: string };

      const childRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { parentSessionId: parentId } },
      });
      const { sessionId: childId } = JSON.parse(childRes.body) as { sessionId: string };

      const listRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${parentId}/children`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listed = JSON.parse(listRes.body) as { sessions: Array<{ id: string }> };
      expect(listed.sessions.some((session) => session.id === childId)).toBe(true);
    });
  },
);

function getLoopStateFilePath(workspaceRoot: string, sessionId: string): string {
  return join(
    workspaceRoot,
    `.openawork.ralph-loop.${sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}.local.md`,
  );
}
