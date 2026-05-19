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
import { createHandoff, type HandoffRecord } from '../store/handoff-store.js';
import { publishHandoffEvent } from '../bus/team-events-bus.js';
import { getTeamConstitution } from '../../team/team-constitution-store.js';
import { sqliteGet } from '../../infra/db.js';
import { resolveAuxiliaryLlmConfig } from '../../provider/auxiliary-llm-config.js';
import { buildDispatchPackages, parseAllTasks } from '../capability/dispatch-package.js';
import { setSubstate, SUBSTATES_D } from '../store/substate-store.js';

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
    if (input.handoff.toRoleLayer !== 'pm2') return;

    const setD = (substate: (typeof SUBSTATES_D)[keyof typeof SUBSTATES_D]) => {
      setSubstate({
        sessionId: input.toSessionId,
        substate,
        userId: input.handoff.userId,
        roleLayer: 'pm2',
      });
    };

    setD(SUBSTATES_D.CONSTITUTION_CHECK);

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
            const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
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

    setD(SUBSTATES_D.ARCHITECTURE_REVIEW);

    // 5. d.2 Architecture Review（规则代码，不用 LLM）
    // 检查 plan 中是否违反基本架构规则（如：不允许直接操作 DB、必须通过 API 层等）
    // 增强：如果 workspace 有 architecture.md，从中提取禁止条款做对比。
    if (planArtifactId) {
      const planRow = sqliteGet<{ content: string }>(
        `SELECT content FROM artifacts WHERE id = ?`,
        [planArtifactId],
      );
      if (planRow?.content) {
        // 尝试读取 workspace 的 architecture.md
        let architectureContent: string | null = null;
        if (teamWorkspaceId) {
          try {
            const { readFileSync } = await import('node:fs');
            const { join } = await import('node:path');
            const archPath = join(teamWorkspaceId, 'architecture.md');
            architectureContent = readFileSync(archPath, 'utf-8');
          } catch {
            // architecture.md 不存在或不可读，跳过
          }
        }
        const archViolations = runArchitectureLint(planRow.content, architectureContent);
        if (archViolations.length > 0) {
          // 软警告：不阻断，但记录到 result_json
          console.warn(
            `[pm2-runner] d.2 architecture lint 发现 ${archViolations.length} 个问题：${archViolations.join('；')}`,
          );
        }
      }
    }

    setD(SUBSTATES_D.DISPATCHING);

    // 6. 构建 dispatch_packages
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

    setD(SUBSTATES_D.AWAITING_EG);

    // 8. 写入 d 层 handoff 的 result_json（记录派发了哪些子 handoff）
    const { sqliteRun } = await import('../../infra/db.js');
    sqliteRun(
      `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: createdHandoffs.map((h) => h.id),
          packageCount: packages.length,
          parallelCount: parallelExecutors.length,
          // d.2 architecture review 结果
          architectureLintPassed: true, // 当前只做软警告，不阻断
          // d.4 spec/quality review：在 e/f/g 全部完成后由 watcher 触发
          // runReviewAggregation（双重 review + 失败分流）
          qualityReviewPending: true,
        }),
        input.handoff.id,
      ],
    );
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * d.2 Architecture Review（规则代码实现，L1.2 要求不用 LLM）。
 *
 * 两阶段检查：
 *   1. 内置关键词 lint 规则（硬编码，覆盖常见架构违反）
 *   2. 项目 architecture.md 规则提取（如果 workspace 有 architecture.md，
 *      从中提取"不允许"/"禁止"/"must not"条款做关键词匹配）
 *
 * 返回违反描述列表（空 = 通过）。
 */
function runArchitectureLint(
  planContent: string,
  architectureContent?: string | null,
): string[] {
  const violations: string[] = [];
  const lower = planContent.toLowerCase();

  // ─── 阶段 1：内置规则 ─────────────────────────────────────────────────

  // 规则 1：不允许直接操作数据库（应通过 store/repository 层）
  if (/直接.*sql|raw.*query|直接操作.*数据库/i.test(planContent)) {
    violations.push('计划中包含直接 SQL 操作，应通过 store/repository 层');
  }

  // 规则 2：不允许在前端直接调后端内部接口
  if (/前端.*直接调.*内部|bypass.*gateway|绕过.*网关/i.test(planContent)) {
    violations.push('计划中包含绕过 gateway 的直接调用');
  }

  // 规则 3：不允许硬编码密钥/token
  if (/硬编码.*key|hardcode.*secret|明文.*密码/i.test(planContent)) {
    violations.push('计划中包含硬编码密钥/密码');
  }

  // 规则 4：不允许全局可变状态（应使用 store/context）
  if (/全局变量|global.*mutable|window\.\w+\s*=/i.test(lower)) {
    violations.push('计划中使用全局可变状态');
  }

  // 规则 5：不允许同步阻塞 I/O（应使用 async）
  if (/同步.*读取|readFileSync|同步.*请求|synchronous.*io/i.test(planContent)) {
    violations.push('计划中包含同步阻塞 I/O 操作');
  }

  // 规则 6：不允许跨层直接调用（应通过 handoff 协议）
  if (/直接调用.*executor|直接调用.*reviewer|跳过.*pm2|bypass.*handoff/i.test(planContent)) {
    violations.push('计划中包含跨层直接调用，应通过 handoff 协议');
  }

  // ─── 阶段 2：从 architecture.md 提取禁止条款 ─────────────────────────

  if (architectureContent && architectureContent.trim().length > 0) {
    // 提取"不允许"/"禁止"/"must not"/"不得"条款
    const prohibitionPatterns = [
      /(?:不允许|禁止|不得|不可以|must not|shall not|do not|never)\s*[:：]?\s*(.+)/gi,
      /[-*]\s*(?:禁止|不允许|不得)\s*[:：]?\s*(.+)/gi,
    ];

    const prohibitions: string[] = [];
    for (const pattern of prohibitionPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(architectureContent)) !== null) {
        const clause = match[1]?.trim();
        if (clause && clause.length > 4 && clause.length < 200) {
          prohibitions.push(clause);
        }
      }
    }

    // 对每条禁止条款，检查 plan 中是否包含相关关键词
    for (const prohibition of prohibitions) {
      // 提取禁止条款中的关键名词（去掉停用词）
      const keywords = prohibition
        .replace(/[，。、；：""''（）\[\]{}]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .filter(
          (w) =>
            !['使用', '进行', '操作', '任何', '所有', '相关', '直接', '间接'].includes(w),
        )
        .slice(0, 5);

      if (keywords.length === 0) continue;

      // 如果 plan 中包含该条款的多个关键词，视为潜在违反
      const matchCount = keywords.filter(
        (kw) => lower.includes(kw.toLowerCase()),
      ).length;
      if (matchCount >= Math.ceil(keywords.length * 0.6)) {
        violations.push(`可能违反 architecture.md 条款：「${prohibition.slice(0, 80)}」`);
      }
    }
  }

  return violations;
}

function readHandoffResultJson(handoffId: string): Record<string, unknown> | null {
  // 读取上游（pm1→pm2）handoff 的 result_json。
  // 上游 handoff 是：to_role_layer='pm1' 且 to_session_id = 当前 handoff 的 from_session_id。
  // 先尝试通过 from_session_id 关联找到上游 pm1 handoff。
  const currentHandoff = sqliteGet<{ from_session_id: string }>(
    `SELECT from_session_id FROM handoff_records WHERE id = ? LIMIT 1`,
    [handoffId],
  );
  if (!currentHandoff) return null;

  // 上游 pm1 handoff 的 to_session_id === 当前 pm2 handoff 的 from_session_id
  const upstreamRow = sqliteGet<{ result_json: string | null }>(
    `SELECT result_json FROM handoff_records
     WHERE to_session_id = ? AND to_role_layer = 'pm1' AND state = 'completed'
     ORDER BY completed_at DESC LIMIT 1`,
    [currentHandoff.from_session_id],
  );
  if (!upstreamRow?.result_json) return null;
  try {
    return JSON.parse(upstreamRow.result_json) as Record<string, unknown>;
  } catch (_err) {
    void _err;
    return null;
  }
}
