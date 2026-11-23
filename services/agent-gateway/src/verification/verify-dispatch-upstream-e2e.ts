/**
 * 派工真实上游链路端到端验收。
 *
 * 与 `__tests__/routes/dispatches.test.ts` 的区别：那里 mock 掉 `planDispatch` /
 * `generateDispatchResult`，只验证路由与队列；这里**不 mock 任何派工代码**，
 * 让请求真实穿过
 *
 *   getChatProvider → getProviderForSelection → resolveModelRouteFromProvider
 *     → runUpstreamGenerate → fetch（被本脚本拦截）→ 结算
 *
 * 只有最底层的 `fetch` 被替换成固定响应，因此可以验证派工真正发出的上游请求体：
 * 规划只带目标不带摘录、执行带摘录与历史、两阶段都不声明工具。
 *
 * 用法：bun services/agent-gateway/src/verification/verify-dispatch-upstream-e2e.ts
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import authPlugin from '../infra/auth.js';
import { connectDb, migrate, sqliteRun } from '../infra/db.js';
import { registerErrorHandler } from '../infra/error-handler.js';
import requestWorkflowPlugin from '../runtime/request-workflow.js';
import { registerDispatchRoutes } from '../routes/dispatches.js';
import { settingsRoutes } from '../routes/settings.js';
import { DispatchScheduler } from '../dispatch/dispatch-scheduler.js';
import type { DispatchDetail } from '@openAwork/shared';
import {
  assert,
  createChatCompletionsStream,
  readFetchBody,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

const PROVIDER_ID = 'dispatch-e2e-provider';
const MODEL_ID = 'dispatch-e2e-model';
const PLAN = {
  title: '季度合同要点',
  items: [
    {
      title: '合同摘要',
      objective: '用三句话概括核心条款',
      acceptance: '覆盖付款与违约',
      role: 'summarize',
    },
  ],
};
const PLANNING_ANSWER = JSON.stringify(PLAN);
const EXECUTION_ANSWER = '上游模型返回：验收后 30 日内付款，违约金为总额 5%。';
const REQUEST = '把合同拆成摘要';
const EXCERPT = '第三条 付款周期为验收后 30 日内。';

interface CapturedRequest {
  url: string;
  body: string;
}

function isPlanningRequest(body: string): boolean {
  return body.includes('拆分个人文档分析任务');
}

function isExecutionRequest(body: string): boolean {
  return body.includes('摘要、信息提取或文本审阅');
}

async function main(): Promise<void> {
  const captured: CapturedRequest[] = [];

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      OPENAWORK_ENABLE_DISPATCH: '1',
      // 清掉默认 env provider，确保下面的自定义 provider 是唯一来源。
      AI_API_KEY: undefined,
      AI_API_BASE_URL: undefined,
      AI_DEFAULT_MODEL: undefined,
      ADMIN_EMAIL: undefined,
    },
    async () => {
      await withMockFetch(
        async (input, init) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const body = await readFetchBody(input, init);

          // models.dev 目录同步：返回空目录，避免真实外网请求。
          if (url.includes('models.dev')) {
            return Response.json({});
          }

          if (body.length > 0) captured.push({ url, body });

          if (isPlanningRequest(body)) {
            return createChatCompletionsStream(PLANNING_ANSWER);
          }
          if (isExecutionRequest(body)) {
            return createChatCompletionsStream(EXECUTION_ANSWER);
          }
          // 其他上游调用（标题生成等）给一个无害的纯文本响应。
          return createChatCompletionsStream('ok');
        },
        async () => {
          await connectDb();
          await migrate();

          const owner = `u-dispatch-e2e-${randomUUID()}`;
          sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
            owner,
            `${owner}@example.test`,
          ]);

          const app = Fastify();
          registerErrorHandler(app).setSpaIndexHtml('<main>dispatches</main>');
          await app.register(requestWorkflowPlugin);
          await app.register(authPlugin);
          await app.register(settingsRoutes);
          const scheduler = new DispatchScheduler();
          await app.register(registerDispatchRoutes, { enabled: () => true, scheduler });
          await app.ready();
          scheduler.start();

          const auth = { authorization: `Bearer ${app.jwt.sign({ sub: owner })}` };
          const send = async (
            method: 'GET' | 'POST' | 'PATCH' | 'PUT',
            url: string,
            payload?: object,
          ) => app.inject({ method, url, payload, headers: auth });

          try {
            // 1) 走真实设置路由配置一个指向模拟上游的 provider。
            const saved = await send('PUT', '/settings/providers', {
              providers: [
                {
                  id: PROVIDER_ID,
                  type: 'openai',
                  name: 'Dispatch E2E Upstream',
                  enabled: true,
                  baseUrl: 'https://dispatch-e2e.invalid/v1',
                  apiKey: 'e2e-key',
                  upstreamProtocol: 'chat_completions',
                  defaultModels: [{ id: MODEL_ID, label: MODEL_ID, enabled: true }],
                },
              ],
              activeSelection: {
                chat: { providerId: PROVIDER_ID, modelId: MODEL_ID },
                fast: { providerId: PROVIDER_ID, modelId: MODEL_ID },
              },
            });
            assert(
              saved.statusCode === 200,
              `保存 provider 失败：${saved.statusCode} ${saved.body}`,
            );

            // 2) 生成草稿（真实规划调用）。
            const created = await send('POST', '/dispatch-assistant/drafts', {
              request: REQUEST,
              excerpt: EXCERPT,
            });
            assert(
              created.statusCode === 200,
              `生成草稿失败：${created.statusCode} ${created.body}`,
            );
            const draft = created.json<DispatchDetail>();
            assert(draft.status === 'draft', `草稿状态应为 draft，实际 ${draft.status}`);
            assert(draft.items.length === 0, '草稿阶段不应创建事项');

            // 3) 确认派工（真实入队 + 真实调度器 + 真实上游）。
            const confirmed = await send('POST', `/dispatch-assistant/${draft.id}/confirm`, {
              revision: draft.revision,
            });
            assert(
              confirmed.statusCode === 200,
              `确认派工失败：${confirmed.statusCode} ${confirmed.body}`,
            );

            await waitFor(
              async () => (await getDetail(app, auth, draft.id)).status === 'succeeded',
              '派工执行未在超时内完成',
              400,
              50,
            );
            const settled = await getDetail(app, auth, draft.id);
            const item = settled.items[0];
            assert(item !== undefined, '缺少事项');
            assert(
              item.attempts[0]?.result === EXECUTION_ANSWER,
              `结果应来自上游响应，实际 ${JSON.stringify(item.attempts[0]?.result)}`,
            );

            // 4) 追问：沿用同一线程并带上历史。
            const followUp = await send(
              'POST',
              `/dispatch-assistant/${draft.id}/items/${item.id}/follow-up`,
              { expectedAttemptId: item.attempts[0]?.id, question: '再补一句风险' },
            );
            assert(
              followUp.statusCode === 200,
              `追问失败：${followUp.statusCode} ${followUp.body}`,
            );
            await waitFor(
              async () => {
                const detail = await getDetail(app, auth, draft.id);
                const attempts = detail.items[0]?.attempts ?? [];
                return attempts.length === 2 && attempts[0]?.status === 'succeeded';
              },
              '追问未在超时内完成',
              400,
              50,
            );

            // 5) 断言真实上游请求体。
            const planning = captured.filter((entry) => isPlanningRequest(entry.body));
            const execution = captured.filter((entry) => isExecutionRequest(entry.body));
            assert(planning.length === 1, `规划请求应只有 1 次，实际 ${planning.length}`);
            assert(
              execution.length === 2,
              `执行请求应有 2 次（首跑 + 追问），实际 ${execution.length}`,
            );

            const planningBody = planning[0]?.body ?? '';
            assert(planningBody.includes(REQUEST), '规划请求应携带派工目标');
            assert(!planningBody.includes(EXCERPT), '规划请求不得携带粘贴的摘录');
            assert(
              planning[0]?.url.includes('dispatch-e2e.invalid'),
              `规划请求应打到配置的 provider，实际 ${planning[0]?.url}`,
            );

            const firstExecution = execution[0]?.body ?? '';
            assert(firstExecution.includes(EXCERPT), '执行请求应携带摘录');
            assert(firstExecution.includes('概括核心条款'), '执行请求应携带事项目标');

            const followUpBody = execution[1]?.body ?? '';
            assert(followUpBody.includes('再补一句风险'), '追问请求应携带追问内容');
            assert(followUpBody.includes(EXECUTION_ANSWER), '追问请求应携带同一线程的历史结果');

            // 无工具时上游请求**省略 tools 字段**（而非发空数组），两种形态都不算声明工具。
            for (const entry of [...planning, ...execution]) {
              const parsed: unknown = JSON.parse(entry.body);
              const tools =
                typeof parsed === 'object' && parsed !== null && 'tools' in parsed
                  ? (parsed as { tools?: unknown[] }).tools
                  : undefined;
              assert(
                (tools ?? []).length === 0,
                `派工上游请求不得声明工具：${entry.body.slice(0, 120)}`,
              );
            }

            console.log('PASS 真实 provider 配置 → 规划 → 排队 → 上游调用 → 结算');
            console.log('PASS 规划请求只带目标、不带摘录；执行请求带摘录与历史');
            console.log('PASS 两阶段上游请求均未声明工具');
            console.log('PASS 追问沿用同一线程并携带前次结果');
          } finally {
            await scheduler.stop();
            await app.close();
          }
        },
      );
    },
  );
}

async function getDetail(
  app: FastifyInstance,
  auth: { authorization: string },
  id: string,
): Promise<DispatchDetail> {
  const response = await app.inject({
    method: 'GET',
    url: `/dispatch-assistant/${id}`,
    headers: auth,
  });
  assert(response.statusCode === 200, `读取详情失败：${response.statusCode} ${response.body}`);
  return response.json<DispatchDetail>();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
