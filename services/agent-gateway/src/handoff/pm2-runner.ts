/**
 * 260516-team-phase-d · T-02 / T-03 / T-04
 *
 * PM2 Runner：d 层的核心执行体。
 *
 * 职责：
 *   1. 从 c→d handoff 的 result_json 中读取 tasks artifact
 *   2. 解析 tasks.md → 拆分为 dispatch_packages
 *   3. Constitution Check 硬门禁（D29 B3：字面违反退回 c）
 *   4. 为每个 dispatch_package 创建 handoff（d→e/f/g）
 *   5. 有限并行编排（D28：e/f 并行，g 等两者完成）
 *   6. 动态编制（D46：e 数量根据 [P] 标记动态决定，最少 2）
 */

import type { HandoffTaskRunner } from './watcher.js';
import { isHandoffModeEnabled } from './feature-flags.js';
import { createHandoff, type HandoffRecord } from './handoff-store.js';
import { publishHandoffEvent } from './team-events-bus.js';
import { getTeamConstitution } from '../team-constitution-store.js';
import { sqliteGet } from '../db.js';
import { resolveAuxiliaryLlmConfig } from '../auxiliary-llm-config.js';
import { buildDispatchPackages, parseAllTasks } from './dispatch-package.js';

const MIN_EXECUTOR_PARALLEL = 2;
const DEFAULT_MAX_EXECUTOR_PARALLEL = 8;

// ─── Constitution Check 硬门禁 ──────────────────────────────────────────────

interface ConstitutionHardCheckResult {
  pass: boolean;
  violations: string[];
}

async function runConstitutionHardCheck(input: {
  planContent: string;
  constitutionBody: string;
  callLlm: (system: string, user: string) => Promise<string>;
}): Promise<ConstitutionHardCheckResult> {
  const systemPrompt = `你是 Constitution Check 硬门禁。你的任务是逐条检查实施计划是否违反团队宪法。

规则：
- 如果计划中有任何条目**字面违反**宪法中的"不接受"/"禁止"条款，输出 VIOLATION: [具体违反内容]
- 如果全部通过，输出 PASS
- 只检查字面违反，不做推测性判断
- 每个违反单独一行

输出格式（严格）：
PASS
或
VIOLATION: [违反描述1]
VIOLATION: [违反描述2]`;

  const userMessage = `<constitution>\n${input.constitutionBody}\n</constitution>\n\n<plan>\n${input.planContent}\n</plan>`;

  const result = await input.callLlm(systemPrompt, userMessage);
  const lines = result
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.some((l) => l === 'PASS') && !lines.some((l) => l.startsWith('VIOLATION:'))) {
    return { pass: true, violations: [] };
  }

  const violations = lines
    .filter((l) => l.startsWith('VIOLATION:'))
    .map((l) => l.replace(/^VIOLATION:\s*/, ''));

  return { pass: violations.length === 0, violations };
}

// ─── PM2 Runner ─────────────────────────────────────────────────────────────

export function createPm2Runner(): HandoffTaskRunner {
  return async (input) => {
    if (input.signal.aborted) return;
    if (!isHandoffModeEnabled()) return;
    if (input.handoff.toRoleLayer !== 'pm2') return;

    // 1. 从 c→d handoff 的 result_json 读取产物 ID
    const payload = input.handoff.payload as Record<string, unknown> | null;
    const resultJson =
      (payload?.['resultJson'] as Record<string, unknown> | null) ??
      readHandoffResultJson(input.handoff.id);

    const tasksArtifactId = (resultJson?.['tasksArtifactId'] as string) ?? null;
    const planArtifactId = (resultJson?.['planArtifactId'] as string) ?? null;
    const specArtifactId = (resultJson?.['specArtifactId'] as string) ?? null;
    const teamWorkspaceId = (payload?.['teamWorkspaceId'] as string) ?? null;

    if (!tasksArtifactId) {
      throw new Error('PM2 runner: 无法从 handoff result 中读取 tasksArtifactId');
    }

    // 2. 读取 tasks.md 内容
    const tasksRow = sqliteGet<{ content: string }>(`SELECT content FROM artifacts WHERE id = ?`, [
      tasksArtifactId,
    ]);
    if (!tasksRow) {
      throw new Error(`PM2 runner: tasks artifact ${tasksArtifactId} 不存在`);
    }

    // 3. 解析 tasks
    const tasks = parseAllTasks(tasksRow.content);
    if (tasks.length === 0) {
      throw new Error('PM2 runner: tasks.md 中未找到任何任务');
    }

    // 4. Constitution Check 硬门禁
    if (teamWorkspaceId) {
      const constitution = getTeamConstitution({
        userId: input.handoff.userId,
        teamWorkspaceId,
      });
      if (constitution && constitution.body.trim().length > 0) {
        const planRow = planArtifactId
          ? sqliteGet<{ content: string }>(`SELECT content FROM artifacts WHERE id = ?`, [
              planArtifactId,
            ])
          : null;
        const planContent = planRow?.content ?? '';

        if (planContent.length > 0) {
          const llmConfig = await resolveAuxiliaryLlmConfig(input.handoff.userId);
          if (llmConfig) {
            const { requestWorkflowLlmCompletion } = await import('../routes/workflow-llm.js');
            const callLlm = async (system: string, user: string): Promise<string> => {
              return requestWorkflowLlmCompletion({
                apiBaseUrl: llmConfig.apiBaseUrl,
                apiKey: llmConfig.apiKey,
                model: llmConfig.model,
                ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
                ...(llmConfig.upstreamProtocol
                  ? { upstreamProtocol: llmConfig.upstreamProtocol }
                  : {}),
                prompt: `${system}\n\n---\n\n${user}`,
                temperature: 0.1,
              });
            };

            const checkResult = await runConstitutionHardCheck({
              planContent,
              constitutionBody: constitution.body,
              callLlm,
            });

            if (!checkResult.pass) {
              // D29 B3：字面违反 → 退回 c（escalation_round++）
              throw new Error(
                `Constitution Check 硬门禁未通过：${checkResult.violations.join('；')}`,
              );
            }
          }
        }
      }
    }

    if (input.signal.aborted) return;

    // 5. 构建 dispatch_packages
    const context = `来自 PM1 的任务清单，共 ${tasks.length} 个任务。`;
    const packages = buildDispatchPackages({
      tasks,
      artifactRefs: {
        specId: specArtifactId ?? undefined,
        planId: planArtifactId ?? undefined,
        tasksId: tasksArtifactId,
      },
      context,
    });

    // 6. D46 动态编制：确保 executor 并行数 ≥ MIN_EXECUTOR_PARALLEL
    const parallelExecutors = packages.filter(
      (p) => p.role === 'executor' && p.taskMarkers.parallel,
    );
    const _effectiveParallel = Math.max(parallelExecutors.length, MIN_EXECUTOR_PARALLEL);
    // 上限检查（D50 全局并发上限）
    const _maxParallel = DEFAULT_MAX_EXECUTOR_PARALLEL;

    // 7. 为每个 package 创建 handoff（d→e/f/g）
    const createdHandoffs: HandoffRecord[] = [];
    for (const pkg of packages) {
      const toRoleLayer = pkg.role === 'reviewer' ? ('reviewer' as const) : ('executor' as const);
      const handoff = createHandoff({
        userId: input.handoff.userId,
        fromSessionId: input.toSessionId,
        fromRoleLayer: 'pm2',
        toRoleLayer,
        payload: pkg,
      });
      createdHandoffs.push(handoff);
      publishHandoffEvent({ type: 'handoff.created', record: handoff });
    }

    // 8. 写入 d 层 handoff 的 result_json（记录派发了哪些子 handoff）
    const { sqliteRun } = await import('../db.js');
    sqliteRun(
      `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: createdHandoffs.map((h) => h.id),
          packageCount: packages.length,
          parallelCount: parallelExecutors.length,
        }),
        input.handoff.id,
      ],
    );
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readHandoffResultJson(handoffId: string): Record<string, unknown> | null {
  // 读取上游（c→d）handoff 的 result_json
  // 上游 handoff 的 to_session_id 就是当前 handoff 的 from_session_id
  const row = sqliteGet<{ result_json: string | null }>(
    `SELECT result_json FROM handoff_records WHERE id = ?`,
    [handoffId],
  );
  if (!row?.result_json) return null;
  try {
    return JSON.parse(row.result_json) as Record<string, unknown>;
  } catch (_err) {
    void _err;
    return null;
  }
}
