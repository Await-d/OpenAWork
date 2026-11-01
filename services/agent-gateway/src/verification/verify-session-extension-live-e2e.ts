/**
 * 真实模型端到端：会话扩展两个分支（261101）。
 *
 * **手工执行，不进 CI**：需要真实模型凭据，因此不挂在 `test:verification` 下。
 *
 *   PROBE_BASE_URL=https://.../v1 PROBE_KEY=... PROBE_MODEL=... \
 *     bun run test:live-e2e
 *
 * 它补的是单测/桩测试覆盖不到的那一层：真实模型是否会真的调用会话扩展工具、
 * 提案是否真的只落一条待确认、错误确认凭证是否真的被拒、执行时的**会话探活**
 * 是否真的发起了连接。两个分支都跑：
 *
 *   - **MCP**：`mcp_manage_servers(scope=session)` → 提案 → 确认 → 执行 + 探活；
 *   - **技能**：`skill_manage(install, scope=session)` → 提案 → 确认 → 执行。
 *     注册源用**本地桩**：条目只给 `manifestUrl`（不给内联 manifest），让安装器走
 *     真实的「取回 manifest」路径——`parseManifestFromEntry` 在内联 manifest 存在时
 *     会短路，用内联就等于绕开被测代码。安装器没有 tarball/解包步骤（签名校验在
 *     MVP 里是显式的「未实现」），所以「取回 manifest」就是这条链路的全部 I/O，
 *     整条因此可离线跑通；靠内置源（GitHub）是跑不了的。
 *
 * 断言重点（两分支共通）：
 *   1. 提案阶段不写会话条目（提案 ≠ 安装）；
 *   2. 错误 nonce 不能消费提案，正确 nonce 才能推进；
 *   3. MCP 分支的探活真的发起了连接——端点不可达时必须是 `configured_unavailable`
 *      且 `errorCode === 'probe_failed'`（探活已是服务层默认实现，这里不注入端口）。
 *
 * 已知边界：走的是**生产确认接缝函数**（HTTP 确认页用的同一个），不额外启动
 * Fastify 服务；HTTP 层的鉴权/所有权校验由路由测试覆盖。
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb, connectDb, migrate, sqliteAll, sqliteRun } from '../infra/db.js';
import { runSessionInBackground } from '../routes/stream-runtime.js';
import { confirmAndApplySessionExtensionOperations } from '../session-extension/session-extension-route-support.js';
import { getSessionExtensionOperation } from '../session-extension/session-extension-operation-store.js';
import { withTempEnv } from './task-verification-helpers.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`端到端断言失败：${message}`);
}

const PROBE_BASE_URL = process.env['PROBE_BASE_URL'] ?? '';
const PROBE_KEY = process.env['PROBE_KEY'] ?? '';
const PROBE_MODEL = process.env['PROBE_MODEL'] ?? '';

if (!PROBE_BASE_URL || !PROBE_KEY || !PROBE_MODEL) {
  throw new Error(
    '缺少 PROBE_BASE_URL / PROBE_KEY / PROBE_MODEL；本脚本需要真实模型凭据，不会在 CI 中运行。',
  );
}

const STUB_PORT = 3477;
const STUB_BASE = `http://127.0.0.1:${STUB_PORT}`;
/** MCP 探活目标：桩服务对非注册源路径一律 404，保证「连上了但不是 MCP」。 */
const UNREACHABLE_MCP_URL = `${STUB_BASE}/mcp`;
const SKILL_ID = 'e2e-skill';
const REGISTRY_SOURCE_ID = 'e2e-local';

const MCP_TOOL_ARGS = {
  action: 'add',
  scope: 'session',
  server: {
    id: 'e2e-session-mcp',
    name: 'E2E 会话 MCP',
    transport: 'sse',
    url: UNREACHABLE_MCP_URL,
  },
};

const SKILL_TOOL_ARGS = { action: 'install', scope: 'session', skillId: SKILL_ID };

/**
 * 桩命中计数。
 *
 * - `manifest`：证明「manifest 真的是从 URL 取回的」，不是链路被短路；
 * - `registryAuth`：证明**带鉴权**的注册源确实把凭据发给了注册源。
 *
 * 关于注册源类型：`SkillRegistryClient.fetchSkillDetailFromSource` **不看
 * `source.type`**，所有类型一律走 `${source.url}/skills/<id>.json` 的 HTTP 取回，
 * 唯一的分支是 `buildHeaders`（auth: none / bearer / 自定义 header）。包里的
 * `LocalInstaller.installFromLocalDir` 是另一条独立 API，本功能路径根本不会调到它
 * ——所以「按类型分派取回」这个说法本身就不成立，真正没被覆盖的是鉴权分支。
 */
const stubHits = { manifest: 0, registryAuth: '' };

const REGISTRY_AUTH_TOKEN = 'e2e-registry-token';

/**
 * 注册源桩。
 *
 * - `/skills/<id>.json`：技能条目，**刻意不带内联 `manifest`**，只给 `manifestUrl`
 *   —— 这样才走安装器真实的「取回 manifest」路径（`parseManifestFromEntry` 在
 *   `entry.manifest` 存在时会短路，用它等于绕开被测代码）；
 * - `/skills/<id>.manifest.yaml`：上面那个 URL 指向的 manifest（YAML，与内置 GitHub
 *   源 `skill.yaml` 同形）；
 * - 其余路径一律 404 —— MCP 分支的探活就是靠它确定性失败。
 */
const SKILL_MANIFEST_YAML = [
  'apiVersion: agent-skill/v1',
  `id: ${SKILL_ID}`,
  `name: ${SKILL_ID}`,
  'displayName: E2E 会话技能',
  'version: 1.0.0',
  'description: 端到端用例技能',
  'capabilities: []',
  'permissions: []',
].join('\n');

function startStub(): Promise<Server> {
  const stub = createServer((req, res) => {
    const url = req.url ?? '';
    if (url === `/skills/${SKILL_ID}.manifest.yaml`) stubHits.manifest += 1;
    if (url === `/skills/${SKILL_ID}.json`) {
      stubHits.registryAuth = String(req.headers['authorization'] ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: SKILL_ID,
          name: SKILL_ID,
          displayName: 'E2E 会话技能',
          version: '1.0.0',
          description: '端到端用例技能',
          category: 'other',
          sourceId: REGISTRY_SOURCE_ID,
          tags: ['e2e'],
          // 只给 URL：manifest 由安装器自己取回（内联 manifest 会短路掉这条路径）。
          manifestUrl: `${STUB_BASE}/skills/${SKILL_ID}.manifest.yaml`,
        }),
      );
      return;
    }
    if (url === `/skills/${SKILL_ID}.manifest.yaml`) {
      res.writeHead(200, { 'Content-Type': 'text/yaml' });
      res.end(SKILL_MANIFEST_YAML);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not an mcp endpoint' }));
  });
  return new Promise<Server>((resolve) => stub.listen(STUB_PORT, '127.0.0.1', () => resolve(stub)));
}

function instructionFor(tool: string, args: Record<string, unknown>): string {
  return `必须调用 ${tool} 工具，且参数精确为：${JSON.stringify(args)}。不要解释，不要改写参数。`;
}

async function main(): Promise<void> {
  const workspaceRoot = path.join(tmpdir(), `openawork-live-e2e-${randomUUID()}`);
  mkdirSync(workspaceRoot, { recursive: true });
  const stub = await startStub();

  try {
    await withTempEnv(
      {
        DATABASE_URL: ':memory:',
        OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER: '1',
        WORKSPACE_ROOT: workspaceRoot,
      },
      async () => {
        await connectDb();
        await migrate();

        const userId = randomUUID();
        sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          userId,
          'live-e2e@openawork.local',
          'x',
        ]);
        sqliteRun(
          `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
           ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [
            userId,
            JSON.stringify([
              {
                id: 'local',
                type: 'openai',
                name: 'Local',
                enabled: true,
                baseUrl: PROBE_BASE_URL,
                apiKey: PROBE_KEY,
                upstreamProtocol: 'chat_completions',
                defaultModels: [{ id: PROBE_MODEL, label: PROBE_MODEL, enabled: true }],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ]),
          ],
        );
        sqliteRun(
          `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
           ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [
            userId,
            JSON.stringify({
              chat: { providerId: 'local', modelId: PROBE_MODEL },
              fast: { providerId: 'local', modelId: PROBE_MODEL },
            }),
          ],
        );
        // 技能分支的注册源：指向本地桩（内置源指向 GitHub，离线跑不通）。
        // 带 bearer 鉴权：`buildHeaders` 是详情取回里唯一的类型无关分支，也是唯一可能
        // 把凭据发错地方的一步，必须真的发出去才算验过。
        sqliteRun(
          `INSERT INTO registry_sources (id, user_id, name, url, type, trust, enabled, priority, auth_json)
           VALUES (?, ?, 'E2E 本地源', ?, 'community', 'trusted', 1, 1, ?)`,
          [
            REGISTRY_SOURCE_ID,
            userId,
            STUB_BASE,
            JSON.stringify({ type: 'bearer', token: REGISTRY_AUTH_TOKEN }),
          ],
        );

        const seedSession = (): string => {
          const sessionId = randomUUID();
          sqliteRun(
            `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', ?)`,
            [
              sessionId,
              userId,
              JSON.stringify({
                workingDirectory: workspaceRoot,
                source: 'channel',
                channelLlmToolsEnabled: true,
                channelExtensionManagementEnabled: true,
                channelId: 'ch-e2e',
                channelChatId: 'chat-e2e',
              }),
            ],
          );
          return sessionId;
        };

        /** 跑一轮真实模型并返回本轮产生的提案。 */
        const proposeViaModel = async (params: {
          sessionId: string;
          tool: string;
          args: Record<string, unknown>;
          clientRequestId: string;
        }): Promise<{ id: string; kind: string; status: string }> => {
          const chunks: unknown[] = [];
          const result = await runSessionInBackground({
            sessionId: params.sessionId,
            userId,
            requestData: {
              clientRequestId: params.clientRequestId,
              message: instructionFor(params.tool, params.args),
              model: PROBE_MODEL,
              providerId: 'local',
              maxTokens: 1024,
              temperature: 0,
              webSearchEnabled: false,
              // 全自动：只验证能力链路，不引入人工审批交互。
              yoloMode: true,
            },
            writeChunk: (chunk) => chunks.push(chunk),
          });
          const toolNames = chunks
            .filter(
              (chunk): chunk is Record<string, unknown> =>
                typeof chunk === 'object' &&
                chunk !== null &&
                (chunk as Record<string, unknown>)['type'] === 'tool_result',
            )
            .map((chunk) => chunk['toolName']);
          const operations = sqliteAll<{ id: string; kind: string; status: string }>(
            `SELECT id, kind, status FROM session_extension_operations
              WHERE session_id = ? ORDER BY created_at ASC`,
            [params.sessionId],
          );
          console.log(
            JSON.stringify({
              stage: 'propose',
              tool: params.tool,
              statusCode: result.statusCode,
              tools: toolNames,
              operations: operations.map((op) => `${op.kind}:${op.status}`),
            }),
          );
          assert(result.statusCode === 200, `${params.tool} 轮应以 200 结束`);
          assert(toolNames.length > 0, `真实模型应调用 ${params.tool}`);
          assert(operations.length === 1, `应恰好产生 1 条提案，实际 ${operations.length}`);
          const operation = operations[0];
          assert(operation, '提案记录缺失');
          assert(
            operation.status === 'pending_approval',
            `提案应为待确认，实际 ${operation.status}`,
          );
          return operation;
        };

        /** 走生产确认入口：错误 nonce 必须被拒且不消费，正确 nonce 才能推进。 */
        const confirmViaProduction = async (params: {
          sessionId: string;
          operationId: string;
        }): Promise<Record<string, unknown>> => {
          const nonce =
            getSessionExtensionOperation(params.sessionId, params.operationId)?.nonce ?? '';
          assert(nonce.length > 0, '落库提案应带一次性 nonce');

          const wrong = await confirmAndApplySessionExtensionOperations({
            sessionId: params.sessionId,
            operationId: params.operationId,
            approverUserId: userId,
            nonce: '00000000-0000-4000-8000-000000000000',
            approve: true,
          });
          assert(
            wrong['decision'] === 'invalid_nonce',
            `错误 nonce 应被拒绝，实际 ${String(wrong['decision'])}`,
          );
          assert(
            getSessionExtensionOperation(params.sessionId, params.operationId)?.status ===
              'pending_approval',
            '错误 nonce 不得消费提案',
          );

          return confirmAndApplySessionExtensionOperations({
            sessionId: params.sessionId,
            operationId: params.operationId,
            approverUserId: userId,
            nonce,
            approve: true,
          });
        };

        // ── 分支一：MCP（含探活）─────────────────────────────────────────
        const mcpSession = seedSession();
        const mcpOperation = await proposeViaModel({
          sessionId: mcpSession,
          tool: 'mcp_manage_servers',
          args: MCP_TOOL_ARGS,
          clientRequestId: 'req-live-e2e-mcp',
        });
        assert(mcpOperation.kind === 'mcp', `提案类型应为 mcp，实际 ${mcpOperation.kind}`);
        assert(
          sqliteAll('SELECT resource_ref FROM session_mcp_servers WHERE session_id = ?', [
            mcpSession,
          ]).length === 0,
          '提案阶段不得写入会话 MCP',
        );

        const mcpApplied = await confirmViaProduction({
          sessionId: mcpSession,
          operationId: mcpOperation.id,
        });
        const mcpApplyResult = (mcpApplied['applied'] ?? {}) as Record<string, unknown>;
        const mcpOperationDto = (mcpApplyResult['operation'] ?? {}) as Record<string, unknown>;
        const mcpServers = sqliteAll<{ resource_ref: string; enabled: number }>(
          'SELECT resource_ref, enabled FROM session_mcp_servers WHERE session_id = ?',
          [mcpSession],
        );
        console.log(
          JSON.stringify({
            stage: 'apply-mcp',
            decision: mcpApplied['decision'],
            applyKind: mcpApplyResult['kind'],
            errorCode: mcpOperationDto['errorCode'],
            servers: mcpServers.map((row) => `${row.resource_ref}#enabled=${row.enabled}`),
          }),
        );
        assert(mcpServers.length === 1, `执行后应有 1 条会话 MCP，实际 ${mcpServers.length}`);
        assert(mcpServers[0]?.enabled === 1, '执行后会话 MCP 应为启用');
        assert(
          mcpApplyResult['kind'] === 'configured_unavailable',
          `不可达端点应判 configured_unavailable，实际 ${String(mcpApplyResult['kind'])}`,
        );
        assert(
          mcpOperationDto['errorCode'] === 'probe_failed',
          `探活应真实执行并失败，实际 errorCode=${String(mcpOperationDto['errorCode'])}`,
        );

        // ── 分支二：技能（注册源为本地桩，全程离线）──────────────────────
        const skillSession = seedSession();
        const skillOperation = await proposeViaModel({
          sessionId: skillSession,
          tool: 'skill_manage',
          args: SKILL_TOOL_ARGS,
          clientRequestId: 'req-live-e2e-skill',
        });
        assert(skillOperation.kind === 'skill', `提案类型应为 skill，实际 ${skillOperation.kind}`);
        assert(
          sqliteAll('SELECT resource_ref FROM session_skill_installations WHERE session_id = ?', [
            skillSession,
          ]).length === 0,
          '提案阶段不得写入会话技能',
        );

        const skillApplied = await confirmViaProduction({
          sessionId: skillSession,
          operationId: skillOperation.id,
        });
        const skillApplyResult = (skillApplied['applied'] ?? {}) as Record<string, unknown>;
        const sessionSkills = sqliteAll<{ resource_ref: string; enabled: number }>(
          'SELECT resource_ref, enabled FROM session_skill_installations WHERE session_id = ?',
          [skillSession],
        );
        console.log(
          JSON.stringify({
            stage: 'apply-skill',
            decision: skillApplied['decision'],
            applyKind: skillApplyResult['kind'],
            manifestFetches: stubHits.manifest,
            registryAuth: stubHits.registryAuth,
            skills: sessionSkills.map((row) => `${row.resource_ref}#enabled=${row.enabled}`),
          }),
        );
        // 条目只给了 manifestUrl，所以安装成功本身就意味着 manifest 被取回过；
        // 这条断言把「确实走了下载路径」从推断变成证据。
        assert(stubHits.manifest >= 1, '技能安装必须从 manifestUrl 取回 manifest');
        // 带鉴权的注册源必须真的把凭据发给注册源，而不是「配置了但没发」。
        assert(
          stubHits.registryAuth === `Bearer ${REGISTRY_AUTH_TOKEN}`,
          `注册源鉴权头应为 Bearer 凭据，实际收到「${stubHits.registryAuth}」`,
        );
        assert(sessionSkills.length === 1, `执行后应有 1 条会话技能，实际 ${sessionSkills.length}`);
        assert(sessionSkills[0]?.enabled === 1, '执行后会话技能应为启用');
        assert(
          skillApplyResult['kind'] === 'succeeded',
          `技能分支应直接成功（无探活步骤），实际 ${String(skillApplyResult['kind'])}`,
        );

        console.log(JSON.stringify({ stage: 'done', ok: true }));
        await closeDb();
      },
    );
  } finally {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await main();
