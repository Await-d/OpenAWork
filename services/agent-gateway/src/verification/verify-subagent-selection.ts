/**
 * 子代理选型契约验收（`Agent` = `call_omo_agent`，模型实际使用的委派入口）。
 *
 * 背景：历史上「联网新闻检索」被全部派给 `scout`。根因不是模型乱选，而是
 * ① 白名单里没有正确的委派对象；② `Agent` 工具的参数说明为空；③ scout 定义无边界。
 * 本脚本锁定修复后的**机制与契约**（保证后续不退化）：
 *
 *   1) 正确选项存在：`web-researcher` 通过白名单，子会话拿到它自己的系统提示词；
 *   2) 错误选择会被纠正：未知 agent 被拒，错误信息列出可用名单（模型据此自纠）；
 *   3) 模型读到的选型指引：`Agent` 工具描述 + schema 参数说明写明
 *      「联网资讯检索派 web-researcher，不要派 scout」；
 *   4) 委派解析：`web-researcher` / `scout` 各自命中内置描述符，提示词边界不丢失。
 *
 * 不在覆盖范围：真模型「选型质量」属模型行为，需真实 LLM 手工验收（用一句
 * 「查一下今天的最新新闻」驱动会话，观察 tool call 的 `subagent_type`）。
 *
 * 运行：`bun run --filter @openAwork/agent-gateway test:subagent-selection`
 */
import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import { resolveDelegatedAgent } from '../task/task-agent-resolution.js';
import { buildGatewayToolDefinitions } from '../tools/tool-definitions.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import {
  assert,
  createProtocolAwareStream,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

function readOutputText(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

async function main(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
    },
    async () => {
      await withMockFetch(
        async (url) => createProtocolAwareStream(url, '子代理已经执行完成。'),
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `subagent-selection-${userId}@openawork.local`,
              'hash',
            ]);
            // 父会话标记 `paused`：隔离单通道交付的同步唤醒（唤醒由
            // verify-task-job-wake.ts 专门验收），让本脚本只关注选举/解析契约。
            sqliteRun(
              // yolo 档位：本脚本关注子代理选型契约，委派免审批（权限门控由
              // verify-task-tool-permission-gate.ts 专门验收）。
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{"permissionMode":"yolo"}', 'paused')`,
              [parentSessionId, userId],
            );

            const sandbox = createDefaultSandbox();
            const executionContext = {
              clientRequestId: 'subagent-selection-req-1',
              nextRound: 2,
              requestData: {
                clientRequestId: 'subagent-selection-req-1',
                message: '请委派一个联网检索子代理',
                model: 'o3',
                maxTokens: 512,
                temperature: 1,
                upstreamRetryMaxRetries: 1,
                webSearchEnabled: false,
              },
            };

            // ── 1) 正确选项存在：web-researcher 通过白名单并落到正确 agent ──
            const valid = await sandbox.execute(
              {
                toolCallId: 'call-omo-selection-1',
                toolName: 'call_omo_agent',
                rawInput: {
                  description: '检索最新科技新闻',
                  prompt: '检索今天的最新科技新闻，多来源交叉比对。',
                  subagent_type: 'web-researcher',
                  run_in_background: true,
                },
              },
              new AbortController().signal,
              parentSessionId,
              executionContext,
            );
            const validOutput = readOutputText(valid.output);
            assert(valid.isError === false, 'web-researcher should pass the whitelist gate');
            assert(
              validOutput.includes('web-researcher'),
              'launch output should name the delegated agent (web-researcher)',
            );
            assert(
              validOutput.includes('后台 agent 任务已成功启动。'),
              'call_omo_agent background mode should return the launch message',
            );

            const child = sqliteGet<{ id: string; metadata_json: string }>(
              `SELECT id, metadata_json FROM sessions
               WHERE user_id = ? AND metadata_json LIKE '%"subagentType":"web-researcher"%'
               LIMIT 1`,
              [userId],
            );
            assert(child !== undefined, 'web-researcher child session should be created');
            const childMetadata = JSON.parse(child.metadata_json) as Record<string, unknown>;
            const delegatedSystemPrompt = childMetadata['delegatedSystemPrompt'];
            assert(
              typeof delegatedSystemPrompt === 'string' &&
                delegatedSystemPrompt.includes('你是 Web Researcher'),
              'child session should receive the web-researcher system prompt',
            );
            const childSessionId = child.id;

            // ── 2) 错误选择会被纠正：未知 agent 被拒且错误信息列出可用名单 ──
            const invalid = await sandbox.execute(
              {
                toolCallId: 'call-omo-selection-2',
                toolName: 'call_omo_agent',
                rawInput: {
                  prompt: '随便查点东西',
                  subagent_type: 'web-researcher-typo',
                  run_in_background: true,
                },
              },
              new AbortController().signal,
              parentSessionId,
              executionContext,
            );
            const invalidOutput = readOutputText(invalid.output);
            assert(invalid.isError === true, 'unknown agent type should be rejected');
            assert(
              invalidOutput.includes('Invalid agent type'),
              'rejection output should explain the invalid agent type',
            );
            assert(
              invalidOutput.includes('web-researcher') && invalidOutput.includes('scout'),
              'rejection output should list the allowed agents so the model can self-correct',
            );

            // ── 3) 模型读到的选型指引 ──
            const definitions = buildGatewayToolDefinitions();
            const agentTool = definitions.find(
              (definition) => definition.function.name === 'Agent',
            );
            assert(agentTool !== undefined, 'Agent tool definition should be exposed to the model');
            assert(
              agentTool.function.description.includes('web-researcher') &&
                agentTool.function.description.includes('不要派 scout'),
              'Agent tool description should route 联网资讯检索 to web-researcher (not scout)',
            );
            const subagentTypeProperty = agentTool.function.parameters.properties[
              'subagent_type'
            ] as { description?: unknown } | undefined;
            assert(
              typeof subagentTypeProperty?.description === 'string' &&
                subagentTypeProperty.description.includes('web-researcher') &&
                subagentTypeProperty.description.includes('不要派 scout'),
              'Agent tool subagent_type parameter should carry the selection guidance',
            );

            // ── 4) 委派解析：两个 agent 各自命中内置描述符，边界不丢失 ──
            const resolvedWebResearcher = resolveDelegatedAgent(userId, {
              subagent_type: 'web-researcher',
            });
            assert(
              resolvedWebResearcher.agentId === 'web-researcher' &&
                (resolvedWebResearcher.systemPrompt ?? '').includes('你是 Web Researcher'),
              'web-researcher should resolve to its builtin descriptor',
            );
            const resolvedScout = resolveDelegatedAgent(userId, { subagent_type: 'scout' });
            assert(
              resolvedScout.agentId === 'scout' &&
                (resolvedScout.systemPrompt ?? '').includes('不承接'),
              'scout should resolve to its bounded descriptor (联网资讯检索不承接)',
            );

            // ── 收尾：等子会话跑完，避免脚本关库竞态 ──
            const taskManager = new AgentTaskManagerImpl();
            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return Object.values(graph.tasks).some(
                (task) => task.sessionId === childSessionId && task.status === 'completed',
              );
            }, 'web-researcher child task should complete');

            console.log(
              ': ok  子代理选型契约（web-researcher 放行 / 错误选择被纠正 / 指引可见 / 边界不丢失）',
            );
            console.log('[verify-subagent-selection] all assertions passed');
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

await main();
