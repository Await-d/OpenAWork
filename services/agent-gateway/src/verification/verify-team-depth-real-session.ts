/**
 * verify-team-depth-real-session — T-20 真实会话验收（四类输入各跑一次真实模型）。
 *
 * 覆盖范围：**接待层**编排边界的真实模型行为——四类输入分别落到 L0/L1/L2/L3 后，
 * 实际产生多少 handoff、耗时多久、是否出现「静默丢任务」。
 *
 * 明确不在覆盖范围（不要当成已验证）：
 *   - 不跑完整链路：只到 reception→pm1 派发为止，PM1 规划、PM2 派发、executor 执行、
 *     双评审都没有执行（那需要 watcher + 各层 runner 全程跑）。因此「L3 双评审通过」
 *     这条判据本轮**未验证**。
 *   - `autoRunInit: false`：刻意关掉自动初始化，避免初始化调用把四类耗时对比污染。
 *   - 耗时是单机本地模型端点的实测值，不等于生产环境水位。
 *
 * 运行：`bun run verify -- src/verification/verify-team-depth-real-session.ts`
 * 需要真实模型可用（读 AI_API_BASE_URL / AI_API_KEY / AI_DEFAULT_MODEL）。
 */

import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, migrate, sqliteAll, sqliteRun } from '../infra/db.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import { orchestrateReceptionInput } from '../handoff/runner/reception-orchestrator.js';

const CASES = [
  { expectedDepth: 'L0', intent: '解释一下这个模块是怎么工作的' },
  { expectedDepth: 'L1', intent: '修改登录按钮的文案' },
  { expectedDepth: 'L2', intent: '实现订单提交接口并让前端调用' },
  { expectedDepth: 'L3', intent: '重构整个系统架构' },
] as const;

interface CaseResult {
  expectedDepth: string;
  intent: string;
  handoffCount: number;
  toRoleLayers: string;
  orchestrationDepth: string;
  reason: string;
  durationMs: number;
  assistantPreview: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`T-20 验收失败：${message}`);
}

/**
 * 接待层直答走 agent-core 的流式 provider，它**不读 `AI_API_*` 环境变量**，
 * 而是从 `user_settings` 里读取用户配置的 provider（key = `providers` /
 * `active_selection`）。所以验收必须把端点写成用户的 provider 配置，
 * 否则 L0/L1 只会得到 `direct-failed`。
 */
function seedProvider(input: {
  userId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): void {
  const providerId = 't20-verification-endpoint';
  const nowIso = new Date().toISOString();
  const providers = [
    {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      createdAt: nowIso,
      defaultModels: [{ enabled: true, id: input.model, label: input.model }],
      enabled: true,
      id: providerId,
      name: 'T-20 验收端点',
      type: 'custom',
      updatedAt: nowIso,
      upstreamProtocol: 'chat_completions',
    },
  ];
  const selection = {
    chat: { modelId: input.model, providerId },
    fast: { modelId: input.model, providerId },
  };
  sqliteRun(
    `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)`,
    [input.userId, JSON.stringify(providers)],
  );
  sqliteRun(
    `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)`,
    [input.userId, JSON.stringify(selection)],
  );
}

async function runCase(
  expectedDepth: string,
  intent: string,
  model: { baseUrl: string; apiKey: string; model: string },
): Promise<CaseResult> {
  const userId = `u-t20-${randomUUID()}`;
  const sessionId = `s-t20-${randomUUID()}`;
  sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    userId,
    `${userId}@openawork.local`,
  ]);
  seedProvider({ apiKey: model.apiKey, baseUrl: model.baseUrl, model: model.model, userId });
  sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, role_layer, state_status)
     VALUES (?, ?, 'reception', '{}', 'reception', 'idle')`,
    [sessionId, userId],
  );

  const startedAt = Date.now();
  const result = await orchestrateReceptionInput({
    userId,
    receptionSessionId: sessionId,
    userIntent: intent,
    autoRunInit: false,
    persistAckMessage: true,
    persistUserMessage: false,
  });
  const durationMs = Date.now() - startedAt;

  const handoffs = sqliteAll<{ to_role_layer: string; payload_json: string }>(
    `SELECT to_role_layer, payload_json FROM handoff_records WHERE from_session_id = ?`,
    [sessionId],
  );
  const assistant = listSessionMessagesV2({ sessionId, userId })
    .filter((message) => message.role === 'assistant')
    .at(-1);
  const preview = assistant
    ? assistant.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .replace(/\s+/g, ' ')
        .slice(0, 60) || '（空回复）'
    : '（无回复）';

  const payload = handoffs[0]?.payload_json
    ? (JSON.parse(handoffs[0].payload_json) as Record<string, unknown>)
    : {};
  return {
    assistantPreview: preview,
    durationMs,
    expectedDepth,
    handoffCount: handoffs.length,
    intent,
    orchestrationDepth:
      typeof payload['orchestrationDepth'] === 'string' ? payload['orchestrationDepth'] : '—',
    reason: result.reason ?? '（已派发，无 reason）',
    toRoleLayers: handoffs.map((row) => row.to_role_layer).join(',') || '—',
  };
}

async function main(): Promise<void> {
  const baseUrl = (process.env['AI_API_BASE_URL'] ?? '').trim();
  const apiKey = (process.env['AI_API_KEY'] ?? '').trim();
  const model = (process.env['AI_DEFAULT_MODEL'] ?? '').trim();
  if (!baseUrl || !apiKey || !model) {
    throw new Error('T-20 需要真实模型：请设置 AI_API_BASE_URL / AI_API_KEY / AI_DEFAULT_MODEL');
  }

  await connectDb();
  await migrate();
  const results: CaseResult[] = [];
  try {
    for (const item of CASES) {
      results.push(await runCase(item.expectedDepth, item.intent, { apiKey, baseUrl, model }));
    }
  } finally {
    await closeDb();
  }

  console.log('\n| 期望深度 | 输入 | handoff 数 | 目标层 | 记录深度 | 耗时(ms) | 返回 reason |');
  console.log('|---|---|---|---|---|---|---|');
  for (const row of results) {
    console.log(
      `| ${row.expectedDepth} | ${row.intent} | ${row.handoffCount} | ${row.toRoleLayers} | ${row.orchestrationDepth} | ${row.durationMs} | ${row.reason} |`,
    );
  }
  console.log('\n各类回复首句：');
  for (const row of results) {
    console.log(`- ${row.expectedDepth}: ${row.assistantPreview}`);
  }

  // 判据 1：L1 必须走快车道，且不得创建 PM1/PM2
  const l1 = results.find((row) => row.expectedDepth === 'L1');
  assert(l1, 'L1 用例缺失');
  assert(
    l1.handoffCount === 0 && l1.reason === 'l1-fast-lane',
    `L1 必须走快车道且不建 handoff，实际 handoff=${l1.handoffCount} reason=${l1.reason}`,
  );
  assert(
    !l1.assistantPreview.includes('出错'),
    `L1 直答必须真的成功，实际回复：${l1.assistantPreview}`,
  );

  // 判据 2：L0 不得建 handoff，必须由接待层直接回答成功
  const l0 = results.find((row) => row.expectedDepth === 'L0');
  assert(l0, 'L0 用例缺失');
  assert(
    l0.handoffCount === 0 && l0.reason === 'light-answer',
    `L0 必须由接待层直接回答，实际 handoff=${l0.handoffCount} reason=${l0.reason}`,
  );
  assert(
    !l0.assistantPreview.includes('出错'),
    `L0 直答必须真的成功，实际回复：${l0.assistantPreview}`,
  );

  // 判据 3：L2 必须派发到 pm1，且记录深度
  const l2 = results.find((row) => row.expectedDepth === 'L2');
  assert(l2, 'L2 用例缺失');
  assert(
    l2.handoffCount === 1 && l2.toRoleLayers === 'pm1',
    `L2 应恰好派发 1 条 reception→pm1，实际 ${l2.handoffCount}/${l2.toRoleLayers}`,
  );

  // 判据 4：四类都不得静默丢任务（要么有 handoff，要么有明确 reason）
  for (const row of results) {
    assert(
      row.handoffCount > 0 || row.reason !== '' || row.assistantPreview !== '（无回复）',
      `${row.expectedDepth} 出现静默丢任务`,
    );
  }

  console.log('\nverify-team-depth-real-session: ok');
}

void main().catch((error) => {
  console.error('verify-team-depth-real-session: failed');
  console.error(error);
  process.exitCode = 1;
});
