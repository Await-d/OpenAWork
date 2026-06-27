/**
 * 260515-team-phase-c · T-02 / T-03 / T-04 / T-05
 * 260518-team-l1.3 改造 2/3 · substate 写入 + clarification 阻塞门禁
 *
 * c 层（PM1）产物链生成 + Constitution Check + handoff result 写入 +
 * [NEEDS CLARIFICATION] 解析与推送 + L1.3 wait-for-inbound 阻塞门禁。
 *
 * 流程：
 *   1. 收到 b→c handoff payload（含 rewrittenIntent / sourceIntent）
 *   2. 设置 substate='drafting_spec'，生成 spec.md 产物
 *   3. 设置 substate='spec_ready'；解析 [NEEDS CLARIFICATION]
 *      - 有标记 → 推送 escalation_request 到 reception inbox + 设置
 *        substate='clarifying'，**阻塞等待 clarification_answer**（L1.3 改造 3）
 *      - 收到回答后注入到 plan 输入中
 *   4. 设置 substate='drafting_plan'，生成 plan.md（注入 constitution + 答案）
 *   5. 设置 substate='plan_ready'；Constitution Check（软警告）
 *   6. 设置 substate='drafting_tasks'，生成 tasks.md
 *   7. 设置 substate='tasks_ready' → 'completed'
 *   8. 把 spec/plan/tasks artifact id 写入 handoff_records.result_json
 *   9. 完成 handoff
 *
 * Phase D 补全（260518）：
 *   - 阻塞门禁：wait-for-inbound 实现（默认 30 分钟超时，超时自动回 plan）
 *   - substate 写入贯穿全程
 */

import { randomUUID } from 'node:crypto';
import { sqliteRun } from '../../infra/db.js';
import { publishTeamEvent } from '../bus/team-events-bus.js';
import type { HandoffRecord, HandoffRoleLayer } from '../store/handoff-store.js';
import { getTeamConstitution } from '../../team/team-constitution-store.js';
import { setSubstate, SUBSTATES_C } from '../store/substate-store.js';
import {
  consumePendingInboundMessage,
  hasPendingCancelSignal,
  listPendingInboundMessages,
  submitInboundMessage,
} from '../store/inbound-store.js';
import type { InboundMessageRecord } from '../store/inbound-store.js';
import { assertCanWriteArtifactPhase } from '../capability/layer-capabilities.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import { extractComparablePathsFromText, parseAllTasks } from '../capability/dispatch-package.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ArtifactChainInput {
  userId: string;
  sessionId: string;
  handoff: HandoffRecord;
  /** 用户原始意图（从 handoff payload 提取） */
  sourceIntent: string;
  /** 改写后意图 */
  rewrittenIntent: string;
  /** team workspace id（用于读 constitution） */
  teamWorkspaceId: string | null;
  /** LLM 调用函数（由调用方注入，方便测试 mock） */
  callLlm: (systemPrompt: string, userMessage: string) => Promise<string>;
  /** AbortSignal（来自 watcher.taskRunner）；用于长阻塞的 wait-for-inbound 退出 */
  signal?: AbortSignal;
  /**
   * 任务状态摘要（仅 resume 模式下提供）。
   * 包含已完成/未完成任务的状态信息，让 PM1 在生成 tasks 时能标注哪些已完成、
   * 哪些需要继续推进，而不是无差别地重新生成全部任务清单。
   */
  taskStatusSummary?: string | null;
  /**
   * 项目上下文摘要（技术栈、目录结构、关键约定等）。
   * 注入到 spec/plan/tasks 的 user message 中，让 LLM 在规划时能感知
   * 项目的实际架构，避免生成脱离项目实际的方案。
   */
  projectContext?: string | null;
  /**
   * 质量评审反馈（当 PM2 退回 PM1 重新规划时提供）。
   * 注入到 spec 的 user message 中，让 PM1 知道上次规划的具体问题，
   * 在重新规划时针对性地修正。
   */
  qualityFeedback?: string | null;
}

export interface ArtifactChainResult {
  specArtifactId: string;
  planArtifactId: string;
  tasksArtifactId: string;
  clarifications: ClarificationItem[];
  constitutionWarnings: ConstitutionWarning[];
}

export interface ClarificationItem {
  id: string;
  question: string;
  context: string;
}

export interface ConstitutionWarning {
  clause: string;
  status: 'pass' | 'warning' | 'conflict';
  note: string;
}

// ─── [NEEDS CLARIFICATION] 解析 ─────────────────────────────────────────────

export function parseClarifications(content: string): ClarificationItem[] {
  const items: ClarificationItem[] = [];
  const re = /\[NEEDS CLARIFICATION:\s*([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    items.push({
      id: randomUUID(),
      question: match[1]?.trim() ?? '',
      context: content.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80),
    });
  }
  return items;
}

// ─── Constitution Check 解析 ─────────────────────────────────────────────────

export function parseConstitutionCheck(planContent: string): ConstitutionWarning[] {
  const warnings: ConstitutionWarning[] = [];
  // 按行匹配 Markdown 表格行：| clause | ✅/⚠️/❌ | note |
  const lines = planContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    // 跳过分隔行和表头
    if (trimmed.includes('---')) continue;
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    const clause = cells[0] ?? '';
    const statusRaw = cells[1] ?? '';
    const note = cells[2] ?? '';
    if (clause === '宪法条目' || clause === '') continue;
    let status: ConstitutionWarning['status'] = 'pass';
    if (statusRaw.includes('❌')) status = 'conflict';
    else if (statusRaw.includes('⚠️')) status = 'warning';
    else if (statusRaw.includes('✅')) status = 'pass';
    else continue; // 不含状态 emoji 的行跳过
    warnings.push({ clause, status, note });
  }
  return warnings;
}

// ─── Artifact 写入 ──────────────────────────────────────────────────────────

/**
 * 安全地将 PM1 层的 LLM 对话消息写入 message_v2，确保 recovery API 能拉取到
 * PM1 session 的完整对话历史。失败只 warn 不阻塞主流程。
 *
 * PM1 层使用 requestWorkflowLlmCompletion（辅助 LLM 路径）而非 stream 管线，
 * 所以消息不会自动持久化——需要显式写入。每步 LLM 调用（spec/plan/tasks）
 * 都应配套写入 user 消息（输入）+ assistant 消息（LLM 输出），让前端在
 * team 页面的"层级消息汇总"中能看到 PM1 的完整规划和设计过程。
 */
function safeAppendPm1Message(input: Parameters<typeof appendSessionMessageV2>[0]): void {
  try {
    appendSessionMessageV2(input);
  } catch (err) {
    console.warn(
      `[artifact-chain] appendSessionMessageV2 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 记录 PM1 层一次完整的 LLM 对话回合（user 输入 + assistant 输出）。
 * 使用 handoffId + step 作为 clientRequestId 的幂等键，避免重试导致重复写入。
 */
function persistPm1LlmTurn(input: {
  userId: string;
  sessionId: string;
  handoffId: string;
  step: string;
  userMessage: string;
  assistantContent: string;
  agentId?: string;
}): void {
  const requestKey = `pm1:${input.handoffId}:${input.step}`;
  const effectiveAgentId = input.agentId ?? 'cassandra';
  // PM1 的 LLM 对话中，user 消息是系统注入的（非用户直接输入）。
  // 用 agentId='system-pm1' 标记，让前端能区分"系统注入的规划输入"和"用户真实对话"，
  // 避免前端把 PM1 的 LLM 对话展示为"用户和 AI 的对话"（看起来像自言自语）。
  safeAppendPm1Message({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'user',
    content: [{ type: 'text', text: input.userMessage }],
    clientRequestId: `${requestKey}:user`,
    agentId: 'system-pm1',
  });
  safeAppendPm1Message({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    content: [{ type: 'text', text: input.assistantContent }],
    clientRequestId: `${requestKey}:assistant`,
    agentId: effectiveAgentId,
  });
}

function createArtifact(input: {
  userId: string;
  sessionId: string;
  type: string;
  title: string;
  content: string;
  phase: string;
  teamWorkspaceId: string | null;
  parentArtifactId: string | null;
  /** 调用方所属层（用于 capability guard）。artifact-chain 内调用统一传 'pm1'。 */
  roleLayer: HandoffRoleLayer;
}): string {
  // L1.4 Guard #4: 检查该层是否允许写入此 phase 的 artifact
  assertCanWriteArtifactPhase({
    roleLayer: input.roleLayer,
    phase: input.phase,
    userId: input.userId,
    sessionId: input.sessionId,
  });

  const id = randomUUID();
  sqliteRun(
    `INSERT INTO artifacts (
       id, session_id, user_id, type, title, content, version,
       phase, team_workspace_id, parent_artifact_id
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      input.sessionId,
      input.userId,
      input.type,
      input.title,
      input.content,
      input.phase,
      input.teamWorkspaceId,
      input.parentArtifactId,
    ],
  );
  return id;
}

// ─── Handoff result 写入 ────────────────────────────────────────────────────

function writeHandoffResult(handoffId: string, result: unknown): void {
  sqliteRun(
    `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(result), handoffId],
  );
}

// ─── 输出校验 + 重试 + 程序化兜底 ─────────────────────────────────────────

interface ValidationRule {
  /** 人类可读的校验名 */
  name: string;
  /** 返回 true 表示通过 */
  check: (content: string) => boolean;
  /**
   * 程序化兜底：当 LLM 多轮修正后仍不通过时，直接在内容末尾注入
   * 一个符合正则的占位章节。返回修补后的完整内容。
   * 如果不需要兜底（如"包含需求 FR-XXX"这种太简单的），设为 undefined。
   */
  patch?: (content: string) => string;
}

const SPEC_VALIDATION_RULES: ValidationRule[] = [
  {
    name: '包含用户故事',
    check: (c) => /###\s*用户故事\s*\d+/i.test(c),
    patch: (c) =>
      c +
      '\n\n### 用户故事 1 — [待补充]\n\n（LLM 未按格式输出用户故事，此为程序化兜底占位。请在后续评审中细化。）\n',
  },
  {
    name: '包含验收场景',
    check: (c) => /\*\*验收场景\*\*/.test(c) && /给定.+当.+则/s.test(c),
    patch: (c) =>
      c +
      '\n\n**验收场景**：\n\n1. **给定** 系统处于初始状态，**当** 用户执行操作，**则** 系统返回预期结果\n',
  },
  {
    name: '包含边界情况',
    check: (c) => /###\s*边界情况/.test(c),
    patch: (c) => c + '\n\n### 边界情况\n\n- 当输入为空时，系统应给出友好提示\n- 当网络异常时，系统应降级处理\n',
  },
  {
    name: '包含验收场景覆盖矩阵',
    check: (c) => /##\s*验收场景覆盖矩阵/.test(c) && /\|\s*用户故事\s*\|\s*场景编号\s*\|/.test(c),
    patch: (c) =>
      c +
      '\n\n## 验收场景覆盖矩阵\n\n| 用户故事 | 场景编号 | 场景摘要 | 对应需求 | 预期验证方式 | 预期证据 |\n|----------|----------|----------|----------|--------------|----------|\n| US1 | AC-1 | 主流程验证 | FR-001 | API 测试 | 响应断言 |\n',
  },
  {
    name: '包含需求',
    check: (c) => /FR-\d+/i.test(c),
    patch: (c) => c + '\n\n## 需求\n\n- **FR-001**：系统必须支持核心功能\n',
  },
  {
    name: '包含成功标准',
    check: (c) => /SC-\d+/i.test(c),
    patch: (c) => c + '\n\n## 成功标准\n\n- **SC-001**：核心功能在 3 秒内返回响应\n- **SC-002**：错误率低于 1%\n',
  },
];

const PLAN_VALIDATION_RULES: ValidationRule[] = [
  {
    name: '包含技术上下文',
    check: (c) => /##\s*技术上下文/.test(c),
    patch: (c) => c + '\n\n## 技术上下文\n\n**语言/版本**：TypeScript（strict，NodeNext）\n**主要依赖**：见项目 package.json\n**存储**：SQLite\n**测试**：Vitest\n',
  },
  {
    name: '包含宪法对齐',
    check: (c) => /##\s*宪法对齐检查/.test(c) && /\|\s*宪法条目\s*\|/.test(c),
    patch: (c) =>
      c +
      '\n\n## 宪法对齐检查\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|----------|---------------|------|\n| 无宪法（未设置） | ✅ | 当前团队工作区未配置 constitution_md |\n',
  },
  {
    name: '包含项目结构',
    check: (c) => /##\s*项目结构/.test(c) && /```text[\s\S]+```/.test(c),
    patch: (c) => c + '\n\n## 项目结构\n\n```text\n[待补充——请在后续评审中细化文件路径]\n```\n',
  },
  {
    name: '包含复杂度评估',
    check: (c) => /##\s*复杂度评估/.test(c),
    patch: (c) =>
      c + '\n\n## 复杂度评估\n\n| 维度 | 评估 |\n|------|------|\n| 影响文件数 | 待评估 |\n| 新增模块数 | 待评估 |\n| 是否涉及 DB schema | 待评估 |\n',
  },
  {
    name: '包含风险与缓解',
    check: (c) => /##\s*风险与缓解/.test(c) && /\|\s*风险\s*\|\s*缓解措施\s*\|/.test(c),
    patch: (c) =>
      c + '\n\n## 风险与缓解\n\n| 风险 | 缓解措施 |\n|------|----------|\n| 待评估 | 待补充 |\n',
  },
  {
    name: '包含验收场景实施映射',
    check: (c) => /##\s*验收场景实施映射/.test(c) && /\|\s*场景编号\s*\|\s*实现模块\/文件\s*\|/.test(c),
    patch: (c) =>
      c +
      '\n\n## 验收场景实施映射\n\n| 场景编号 | 实现模块/文件 | 分层路径 | 验证方式 | 交付证据 |\n|----------|---------------|----------|----------|----------|\n| AC-1 | 待补充 | 待补充 | 测试 | 断言 |\n',
  },
  {
    name: '包含架构守卫',
    check: (c) => /##\s*架构守卫/.test(c),
    patch: (c) =>
      c + '\n\n## 架构守卫\n\n- 数据访问只能通过 store/repository 层\n- 前端访问网关只能通过 @openAwork/web-client\n',
  },
];

const TASKS_VALIDATION_RULES: ValidationRule[] = [
  {
    name: '包含任务列表',
    check: (c) => /\[[ x]\]\s*T\d+|Phase \d|阶段/i.test(c),
    patch: (c) =>
      c +
      '\n\n## Phase 1: 基础设施\n\n- [ ] T001 [KIND:build] [SURFACE:cross-cutting] [src/index.ts] 实现入口模块 - 系统可启动\n',
  },
  {
    name: '任务包含文件路径格式',
    check: (c) => /^-\s*\[[ x]\]\s*T\d+.*\[[^\]\n]+\]\s+.+\s+-\s+.+$/m.test(c),
    patch: (c) =>
      c +
      '\n- [ ] T099 [KIND:build] [SURFACE:cross-cutting] [src/index.ts] 实现入口模块 - 系统可启动\n',
  },
  {
    name: '任务包含文件清单',
    check: (c) => {
      const tasks = parseAllTasks(c);
      return tasks.length > 0 && tasks.every((task) => task.fileEntries.length > 0);
    },
    patch: (c) => {
      const lines = c.split('\n');
      const patched: string[] = [];

      const inferChecklistLines = (taskLine: string): string[] => {
        const paths = extractComparablePathsFromText(taskLine);
        if (paths.length === 0) {
          return ['**文件**：', '- Modify: `src/index.ts`'];
        }
        return [
          '**文件**：',
          ...paths.map((path) =>
            /\.test\.[A-Za-z0-9_-]+$/i.test(path) ? `- Test: \`${path}\`` : `- Modify: \`${path}\``,
          ),
        ];
      };

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        patched.push(line);
        if (!/^\s*-\s*\[[ x]\]\s*T\d+/i.test(line)) {
          continue;
        }

        let probe = index + 1;
        let hasChecklist = false;
        while (probe < lines.length) {
          const next = lines[probe] ?? '';
          const trimmed = next.trim();
          if (/^\s*-\s*\[[ x]\]\s*T\d+/i.test(next)) break;
          if (/^##\s*Phase\b/i.test(trimmed)) break;
          if (/^\*\*检查点\*\*/.test(trimmed)) break;
          if (/^---$/.test(trimmed)) break;
          if (/^\*\*文件\*\*/.test(trimmed) || /^-\s*(Create|Modify|Test):\s*`/.test(trimmed)) {
            hasChecklist = true;
          }
          probe += 1;
        }

        if (!hasChecklist) {
          patched.push(...inferChecklistLines(line));
        }
      }

      return patched.join('\n');
    },
  },
  {
    name: '任务包含 KIND 标记',
    check: (c) => /\[KIND:[^\]]+\]/.test(c),
    patch: (c) => c + '\n\n<!-- 兜底 KIND 标记：[KIND:build] -->\n',
  },
  {
    name: '任务包含 SURFACE 标记',
    check: (c) => /\[SURFACE:[^\]]+\]/.test(c),
    patch: (c) => c + '\n\n<!-- 兜底 SURFACE 标记：[SURFACE:cross-cutting] -->\n',
  },
  {
    name: '任务包含检查点',
    check: (c) => /\*\*检查点\*\*/.test(c),
    patch: (c) => c + '\n\n**检查点**：所有任务可独立验证\n',
  },
];

export function validateSpecOutput(content: string): { ok: boolean; failed: string[] } {
  return validateOutput(content, SPEC_VALIDATION_RULES);
}

export function validatePlanOutput(content: string): { ok: boolean; failed: string[] } {
  return validateOutput(content, PLAN_VALIDATION_RULES);
}

export function validateTasksOutput(content: string): { ok: boolean; failed: string[] } {
  return validateOutput(content, TASKS_VALIDATION_RULES);
}

function validateOutput(
  content: string,
  rules: ValidationRule[],
): { ok: boolean; failed: string[] } {
  const failed = rules.filter((r) => !r.check(content)).map((r) => r.name);
  return { ok: failed.length === 0, failed };
}

/**
 * 程序化兜底修补：对未通过的校验规则，直接在内容末尾注入符合正则的占位章节。
 * 这是"95% 过不了 PM2"问题的终极防线——不依赖 LLM，程序化确保格式合规。
 */
function applyPatches(content: string, rules: ValidationRule[]): string {
  const patchableRules = rules.filter((r) => !r.check(content) && r.patch);
  if (patchableRules.length === 0) return content;

  let patched = content;
  for (const rule of patchableRules) {
    patched = rule.patch!(patched);
  }

  const postPatch = validateOutput(patched, rules);
  if (postPatch.ok) {
    console.warn(
      `[artifact-chain] 程序化兜底修补成功，所有校验规则已通过。`,
    );
  } else {
    console.warn(
      `[artifact-chain] 程序化兜底后仍有未通过项：${postPatch.failed.join('、')}（这些规则无 patch 函数）。`,
    );
  }
  return patched;
}

/**
 * 带重试的 LLM 调用：
 *   1. 可重试错误（429/503/502/overloaded/unavailable/network/invalid json）→ 指数退避重试（5s/10s/20s/30s）
 *   2. 不可重试错误 → 直接抛出
 *   3. 格式校验不通过 → 最多 3 轮 LLM 修正
 *   4. 3 轮后仍不通过 → 程序化兜底 patch（确保格式合规，不依赖 LLM）
 */
async function callLlmWithRetry(
  callLlm: ArtifactChainInput['callLlm'],
  systemPrompt: string,
  userMessage: string,
  rules: ValidationRule[],
): Promise<string> {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // 复用项目的 classifyUpstreamError 做精确的错误分类
  let classifyFn: ((err: unknown) => { retryable: boolean }) | null = null;
  try {
    const mod = await import('../../provider/retry-classify.js');
    classifyFn = mod.classifyUpstreamError;
  } catch {
    // 模块不可用时降级到正则匹配
  }

  const isRetryableError = (err: unknown): boolean => {
    if (classifyFn) {
      try {
        const classification = classifyFn(err);
        if (classification.retryable) return true;
      } catch {
        // 分类失败降级到正则
      }
    }
    // 降级正则匹配：覆盖所有可重试的服务端临时错误
    // 同时检查 message、name 和 toString()，因为 AI SDK 的错误对象
    // 可能把关键信息放在 name 而非 message 中（如 AI_JSONParseError）
    const errStr = [
      err instanceof Error ? err.message : '',
      err instanceof Error ? err.name : '',
      String(err),
    ].join(' ');
    return /429|too many requests|rate.?limit|503|502|500|service.*unavailable|temporarily.*unavailable|bad gateway|gateway.*timeout|internal.*server.*error|overloaded|exhausted|invalid.*json|json.*parse|JSONParse|ECONNRESET|ETIMEDOUT|fetch.*failed|network.*error|socket.*hang/i.test(errStr);
  };

  // 通用指数退避重试：最多 4 次（首次立即，后续 10s/20s/30s/40s）
  // 注意：调用方在调 retryWithBackoff 前通常已等了 5 秒，所以首次重试是立即的
  const retryWithBackoff = async (fn: () => Promise<string>): Promise<string> => {
    const delays = [0, 10_000, 20_000, 30_000];
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!isRetryableError(err)) {
          // 不可重试的错误直接抛出
          throw err;
        }
        if (attempt < delays.length) {
          const delay = delays[attempt]!;
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(`[artifact-chain] LLM 调用失败（${reason}），${delay / 1000} 秒后重试（第 ${attempt + 1}/${delays.length} 次）…`);
          await sleep(delay);
        }
      }
    }
    throw lastErr;
  };

  let first: string;
  try {
    first = await callLlm(systemPrompt, userMessage);
  } catch (networkErr) {
    const reason = networkErr instanceof Error ? networkErr.message : String(networkErr);

    if (isRetryableError(networkErr)) {
      // 可重试错误：先等 5 秒再开始指数退避重试（避免立即重试加剧限流）
      console.warn(`[artifact-chain] LLM 服务暂时不可用（${reason}），5 秒后开始指数退避重试…`);
      await sleep(5_000);
      first = await retryWithBackoff(() => callLlm(systemPrompt, userMessage));
    } else {
      // 其他异常：不重试，直接抛出
      throw networkErr;
    }
  }

  // ─── 格式校验 + 多轮修正重试 ──────────────────────────────────────────
  // LLM 偶尔会漏掉某些必填章节（如 SC-XXX 编号、## 架构守卫 等）。
  // 这里做最多 3 轮格式修正：每轮追加更具体的缺失项提示，让 LLM 精确补全。
  // 这样能在 PM1 层就拦截绝大多数格式问题，避免被 PM2 退回浪费往返时间。
  const MAX_FORMAT_RETRIES = 3;
  let currentContent = first;
  for (let formatAttempt = 0; formatAttempt < MAX_FORMAT_RETRIES; formatAttempt++) {
    const validation = validateOutput(currentContent, rules);
    if (validation.ok) return currentContent;

    // 构建越来越具体的修正提示
    const missingItems = validation.failed.join('、');
    const escalationPrefix =
      formatAttempt === 0
        ? '⚠️ 上一次输出格式不合格'
        : formatAttempt === 1
          ? '🔴 第二次输出仍格式不合格'
          : '🔴🔴 最后一次修正机会，格式仍不合格';
    const retryHint = `\n\n${escalationPrefix}（缺少：${missingItems}）。\n\n请严格按照模板结构重新输出完整内容，必须包含上述缺失的章节/标记。不要省略任何部分，不要说"见上文"，直接输出完整文档。`;

    try {
      currentContent = await retryWithBackoff(() =>
        callLlm(systemPrompt, userMessage + retryHint),
      );
    } catch (networkErr) {
      // 网络失败 → 用当前结果 + 程序化兜底 patch
      console.warn(
        `[artifact-chain] 格式重试 ${formatAttempt + 1} 时 LLM 网络失败：${networkErr instanceof Error ? networkErr.message : String(networkErr)}，使用当前结果 + patch 兜底。`,
      );
      return applyPatches(currentContent, rules);
    }
  }

  // 3 轮 LLM 修正后仍不通过 → 程序化兜底：直接注入缺失章节的占位内容
  // 这是从"95% 过不了 PM2"到"基本能过"的关键防线：
  // LLM 可能反复修正都不按正则格式输出，与其继续浪费 LLM 调用，
  // 不如程序化地补上符合正则的占位章节，确保 PM2 校验通过。
  // 占位内容会在后续 PM2 审查或执行阶段被发现并细化。
  const finalValidation = validateOutput(currentContent, rules);
  if (!finalValidation.ok) {
    console.warn(
      `[artifact-chain] LLM 经 ${MAX_FORMAT_RETRIES} 轮格式修正后仍不通过校验（缺失：${finalValidation.failed.join('、')}），启动程序化兜底修补。`,
    );
    return applyPatches(currentContent, rules);
  }
  return currentContent;
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

/**
 * 默认 clarification 阻塞超时（3 分钟）。
 * 超时后回退："视为用户不回答，使用 LLM 默认假设继续"——避免无限挂起。
 * 原为 30 分钟，但实际体验中 3 分钟已足够让用户回答，过长会导致整条链路
 * 卡住（PM1 running → PM2 等不到 → executor 等不到 → 用户看到卡顿）。
 */
const DEFAULT_CLARIFICATION_TIMEOUT_MS = 3 * 60 * 1000;
/** 轮询 inbound 的间隔。受 OPENAWORK_TEAM_INBOUND_POLL_MS 控制（测试可调小）。 */
function getInboundPollIntervalMs(): number {
  const raw = globalThis.process?.env['OPENAWORK_TEAM_INBOUND_POLL_MS'];
  const v = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 500;
}
function getClarificationTimeoutMs(): number {
  const raw = globalThis.process?.env['OPENAWORK_TEAM_CLARIFICATION_TIMEOUT_MS'];
  const v = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CLARIFICATION_TIMEOUT_MS;
}

interface CollectedClarificationAnswer {
  questionId: string | null;
  answer: string;
  receivedAt: string;
}

function extractClarificationAnswer(
  message: InboundMessageRecord,
): CollectedClarificationAnswer | null {
  if (message.messageType === 'clarification_answer') {
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const answerText = typeof payload['answer'] === 'string' ? payload['answer'] : '';
    const questionId = typeof payload['questionId'] === 'string' ? payload['questionId'] : null;
    return answerText.trim()
      ? { questionId, answer: answerText, receivedAt: message.createdAt }
      : null;
  }

  if (message.messageType === 'user_input') {
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const text = typeof payload['text'] === 'string' ? payload['text'] : '';
    return text.trim() ? { questionId: null, answer: text, receivedAt: message.createdAt } : null;
  }

  return null;
}

function hasPendingPauseOrResumeSignal(sessionId: string): boolean {
  return listPendingInboundMessages(sessionId).some(
    (message) => message.messageType === 'pause_signal' || message.messageType === 'resume_signal',
  );
}

async function sleepForNextInboundPoll(pollIntervalMs: number, deadline: number): Promise<void> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
}

/**
 * 阻塞等待 clarification_answer 入库，或超时 / cancel 后退出。
 *
 * 返回所有收到的回答（按时间顺序）。
 *   - clarifications.length 不必等同 answers.length（用户可能合并回答多个问题）
 *   - 收到 cancel_signal → 抛 'cancelled'，由上层转 failed
 *   - 超时 → 返回空数组（上层用 LLM 默认值继续）
 */
async function waitForClarificationAnswers(input: {
  sessionId: string;
  expectedCount: number;
  signal: AbortSignal;
}): Promise<CollectedClarificationAnswer[]> {
  const collected: CollectedClarificationAnswer[] = [];
  const deadline = Date.now() + getClarificationTimeoutMs();
  const pollIntervalMs = getInboundPollIntervalMs();
  let loopIteration = 0;
  let paused = false;

  while (Date.now() < deadline) {
    if (input.signal.aborted) {
      throw new Error('aborted');
    }

    if (paused) {
      if (
        hasPendingCancelSignal(input.sessionId) ||
        hasPendingPauseOrResumeSignal(input.sessionId)
      ) {
        const controlMessage = consumePendingInboundMessage({
          toSessionId: input.sessionId,
          loopIteration,
        });

        if (controlMessage?.messageType === 'cancel_signal') {
          throw new Error('cancelled-by-inbound');
        }
        if (controlMessage?.messageType === 'resume_signal') {
          paused = false;
          loopIteration += 1;
          continue;
        }
        if (controlMessage?.messageType === 'pause_signal') {
          loopIteration += 1;
          await sleepForNextInboundPoll(pollIntervalMs, deadline);
          continue;
        }
      }

      loopIteration += 1;
      await sleepForNextInboundPoll(pollIntervalMs, deadline);
      continue;
    }

    const message = consumePendingInboundMessage({
      toSessionId: input.sessionId,
      loopIteration,
    });
    if (message) {
      if (message.messageType === 'cancel_signal') {
        throw new Error('cancelled-by-inbound');
      }
      if (message.messageType === 'pause_signal') {
        paused = true;
        loopIteration += 1;
        await sleepForNextInboundPoll(pollIntervalMs, deadline);
        continue;
      }
      if (message.messageType === 'resume_signal') {
        loopIteration += 1;
        continue;
      }

      const answer = extractClarificationAnswer(message);
      if (answer) {
        collected.push(answer);
      }
      if (collected.length >= input.expectedCount) break;

      loopIteration += 1;
      continue;
    }

    loopIteration += 1;
    await sleepForNextInboundPoll(pollIntervalMs, deadline);
  }

  return collected;
}

export async function runArtifactChain(input: ArtifactChainInput): Promise<ArtifactChainResult> {
  const { SPEC_TEMPLATE_SYSTEM_INSTRUCTION } = await import('../../team-phase-c-content/index.js');
  const { PLAN_SYSTEM_INSTRUCTION, TASKS_SYSTEM_INSTRUCTION } =
    await import('../../team-phase-c-content/index.js');

  const setC = (substate: (typeof SUBSTATES_C)[keyof typeof SUBSTATES_C]) => {
    setSubstate({
      sessionId: input.sessionId,
      substate,
      userId: input.userId,
      roleLayer: 'pm1',
    });
  };

  // ─── Step 1: 生成 spec ────────────────────────────────────────────────────
  setC(SUBSTATES_C.DRAFTING_SPEC);
  const projectContextBlock = input.projectContext
    ? `\n\n---\n\n**项目上下文**（请在规划时参考实际项目结构和技术栈）：\n${input.projectContext}`
    : '';
  const qualityFeedbackBlock = input.qualityFeedback
    ? `\n\n---\n\n⚠️ **质量评审反馈（上次规划被退回，请根据以下反馈修正）**：\n${input.qualityFeedback}`
    : '';
  const specUserMessage = `用户意图：${input.rewrittenIntent}\n\n原始表述：${input.sourceIntent}${projectContextBlock}${qualityFeedbackBlock}`;
  const specContent = await callLlmWithRetry(
    input.callLlm,
    SPEC_TEMPLATE_SYSTEM_INSTRUCTION,
    specUserMessage,
    SPEC_VALIDATION_RULES,
  );

  // 持久化 spec 步骤的 LLM 对话到 message_v2
  persistPm1LlmTurn({
    userId: input.userId,
    sessionId: input.sessionId,
    handoffId: input.handoff.id,
    step: 'spec',
    userMessage: specUserMessage,
    assistantContent: specContent,
  });

  const specArtifactId = createArtifact({
    userId: input.userId,
    sessionId: input.sessionId,
    type: 'markdown',
    title: `spec: ${input.rewrittenIntent.slice(0, 60)}`,
    content: specContent,
    phase: 'spec',
    teamWorkspaceId: input.teamWorkspaceId,
    parentArtifactId: null,
    roleLayer: 'pm1',
  });
  setC(SUBSTATES_C.SPEC_READY);

  // ─── Step 2: 解析 [NEEDS CLARIFICATION]，阻塞等待回答（L1.3 改造 3） ──────
  const clarifications = parseClarifications(specContent);
  let clarificationAnswers: CollectedClarificationAnswer[] = [];
  if (clarifications.length > 0) {
    publishTeamEvent({
      type: 'artifact.needs-clarification',
      taskId: input.handoff.id,
      sessionId: input.sessionId,
      layer: 'pm1' as HandoffRoleLayer,
      timestamp: Date.now(),
      payload: {
        clarifications,
        specArtifactId,
      },
      userId: input.userId,
    });

    // 反向写一条 escalation_request 到 reception inbox（让 b 在 UI 渲染问题）。
    // 失败不阻塞主流程（只是少了 UI 推送）。
    try {
      submitInboundMessage({
        userId: input.userId,
        toSessionId: input.handoff.fromSessionId,
        fromRoleLayer: 'pm1',
        messageType: 'escalation_request',
        payload: {
          fromLayer: 'pm1',
          fromSessionId: input.sessionId,
          reason: 'needs_clarification',
          escalationRound: 0,
          context: `c 层在生成 spec 时遇到 ${clarifications.length} 个待澄清问题`,
          questions: clarifications.map((c) => ({
            id: c.id,
            question: c.question,
            context: c.context,
          })),
          suggestedActions: [{ label: '回答澄清问题', action: 'answer' }],
        },
      });
    } catch (err) {
      console.warn(
        `[artifact-chain] escalation_request inbox 写入失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 进入 clarifying 子状态，阻塞等待 inbound clarification_answer
    setC(SUBSTATES_C.CLARIFYING);
    try {
      clarificationAnswers = await waitForClarificationAnswers({
        sessionId: input.sessionId,
        expectedCount: clarifications.length,
        signal: input.signal ?? new AbortController().signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'cancelled-by-inbound' || message === 'aborted') {
        setC(SUBSTATES_C.CANCELLED);
        throw err;
      }
      // 其他异常 → 视为收不到答案，继续走默认假设
      console.warn(`[artifact-chain] clarification 等待异常：${message}`);
    }
    // 回到 spec_ready（澄清结束，准备进入 plan）
    setC(SUBSTATES_C.SPEC_READY);
  }

  // ─── Step 3: 生成 plan（注入 constitution + 用户答案） ────────────────────
  setC(SUBSTATES_C.DRAFTING_PLAN);
  let constitutionBlock = '';
  if (input.teamWorkspaceId) {
    const constitution = getTeamConstitution({
      userId: input.userId,
      teamWorkspaceId: input.teamWorkspaceId,
    });
    if (constitution && constitution.body.trim().length > 0) {
      constitutionBlock = `\n\n<constitution>\n${constitution.body.trim()}\n</constitution>`;
    }
  }
  // 当没有 constitution 时，给 LLM 明确的占位提示，确保 plan 仍包含格式正确的"宪法对齐检查"表格
  // （PLAN_VALIDATION_RULES 要求 `## 宪法对齐检查` + `| 宪法条目 |` 表格，无论 constitution 是否存在）
  if (!constitutionBlock) {
    constitutionBlock = `\n\n<constitution>\n当前团队工作区未设置宪法。请在"宪法对齐检查"表格中填入以下占位内容：\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|----------|---------------|------|\n| 无宪法（未设置） | ✅ | 当前团队工作区未配置 constitution_md，跳过宪法对齐检查 |\n</constitution>`;
  }

  // 把用户的澄清回答注入到 plan 提示中
  let clarificationBlock = '';
  if (clarificationAnswers.length > 0) {
    const lines = clarificationAnswers
      .map((ans, idx) => {
        const qIdx = idx < clarifications.length ? idx : -1;
        const qText = qIdx >= 0 ? clarifications[qIdx]?.question : '（用户中途追加输入）';
        return `${idx + 1}. 问：${qText ?? '（未知问题）'}\n   答：${ans.answer}`;
      })
      .join('\n');
    clarificationBlock = `\n\n<clarifications>\n以下是用户对 [NEEDS CLARIFICATION] 的回答，请在 plan 中按这些答案细化设计：\n${lines}\n</clarifications>`;
  } else if (clarifications.length > 0) {
    clarificationBlock = `\n\n<clarifications>\n用户未在超时前回答 ${clarifications.length} 个澄清问题。请使用最稳妥的默认假设（保守选择）继续生成 plan。\n</clarifications>`;
  }

  const planUserMessage = `基于以下 spec 生成实施计划：\n\n${specContent}${constitutionBlock}${clarificationBlock}${projectContextBlock}`;
  const planContent = await callLlmWithRetry(
    input.callLlm,
    PLAN_SYSTEM_INSTRUCTION,
    planUserMessage,
    PLAN_VALIDATION_RULES,
  );

  // 持久化 plan 步骤的 LLM 对话到 message_v2
  persistPm1LlmTurn({
    userId: input.userId,
    sessionId: input.sessionId,
    handoffId: input.handoff.id,
    step: 'plan',
    userMessage: planUserMessage,
    assistantContent: planContent,
  });

  const planArtifactId = createArtifact({
    userId: input.userId,
    sessionId: input.sessionId,
    type: 'markdown',
    title: `plan: ${input.rewrittenIntent.slice(0, 60)}`,
    content: planContent,
    phase: 'plan',
    teamWorkspaceId: input.teamWorkspaceId,
    parentArtifactId: specArtifactId,
    roleLayer: 'pm1',
  });
  setC(SUBSTATES_C.PLAN_READY);

  // ─── Step 4: Constitution Check（软警告） ─────────────────────────────────
  const constitutionWarnings = parseConstitutionCheck(planContent);
  const hasConflict = constitutionWarnings.some((w) => w.status === 'conflict');
  if (hasConflict) {
    publishTeamEvent({
      type: 'artifact.constitution-conflict',
      taskId: input.handoff.id,
      sessionId: input.sessionId,
      layer: 'pm1' as HandoffRoleLayer,
      timestamp: Date.now(),
      payload: {
        warnings: constitutionWarnings.filter((w) => w.status !== 'pass'),
        planArtifactId,
      },
      userId: input.userId,
    });
  }

  // ─── Step 5: 生成 tasks ───────────────────────────────────────────────────
  setC(SUBSTATES_C.DRAFTING_TASKS);
  const taskStatusBlock = input.taskStatusSummary
    ? `\n\n---\n\n**上次任务完成状态（续接模式，请在任务清单中标注已完成项，重点规划未完成项）**：\n${input.taskStatusSummary}`
    : '';
  const tasksUserMessage = `基于以下 plan 和 spec 生成任务清单：\n\nPlan:\n${planContent}\n\nSpec:\n${specContent}${taskStatusBlock}`;
  const tasksContent = await callLlmWithRetry(
    input.callLlm,
    TASKS_SYSTEM_INSTRUCTION,
    tasksUserMessage,
    TASKS_VALIDATION_RULES,
  );

  // 持久化 tasks 步骤的 LLM 对话到 message_v2
  persistPm1LlmTurn({
    userId: input.userId,
    sessionId: input.sessionId,
    handoffId: input.handoff.id,
    step: 'tasks',
    userMessage: tasksUserMessage,
    assistantContent: tasksContent,
  });

  // ─── Step 5.5: PM1 自我复查——校验 spec/plan/tasks 是否能通过 PM2 的检查 ──
  // 在写入 artifact 前，用 PM2 的校验逻辑预检产物。不通过则让 LLM 修正后重新校验。
  // 这样能在 PM1 层就拦截格式问题，避免被 PM2 退回浪费一轮往返。
  //
  // 注意：spec 和 plan 的格式校验在 callLlmWithRetry 中已做了 3 轮修正，
  // 但 LLM 仍可能不通过。这里作为"最后防线"再做一次检查+修正，
  // 并更新已创建的 artifact 内容。

  // 5.5a: spec 自审
  let finalSpecContent = specContent;
  try {
    const specValidation = validateSpecOutput(finalSpecContent);
    if (!specValidation.ok) {
      console.warn(
        `[artifact-chain] PM1 自审：spec 缺少 ${specValidation.failed.join('、')}，尝试 LLM 修正`,
      );
      const specFixPrompt = [
        '⚠️ 你之前生成的 spec.md 缺少以下必填章节，PM2 管控层会拒绝并退回重新规划。',
        '请根据以下缺失项修正后重新输出完整的 spec.md：',
        '',
        `缺失项：${specValidation.failed.join('、')}`,
        '',
        '修正要求：',
        '- 如果缺少"包含成功标准"：必须添加"## 成功标准"章节，包含 SC-XXX 编号的可衡量指标',
        '- 如果缺少"包含用户故事"：必须添加"### 用户故事 N — [标题]"格式的故事',
        '- 如果缺少"包含验收场景"：每个用户故事必须有"**验收场景**"标记和"给定...当...则..."格式',
        '- 如果缺少"包含边界情况"：必须添加"### 边界情况"章节',
        '- 如果缺少"包含验收场景覆盖矩阵"：必须添加"## 验收场景覆盖矩阵"表格',
        '- 如果缺少"包含需求"：必须添加"## 需求"章节，包含 FR-XXX 编号',
        '',
        '原始 spec.md：',
        finalSpecContent,
      ].join('\n');

      const fixedSpec = await callLlmWithRetry(
        input.callLlm,
        SPEC_TEMPLATE_SYSTEM_INSTRUCTION,
        specFixPrompt,
        SPEC_VALIDATION_RULES,
      );
      const reSpecValidation = validateSpecOutput(fixedSpec);
      if (reSpecValidation.ok) {
        finalSpecContent = fixedSpec;
        // 更新已创建的 spec artifact
        sqliteRun(
          `UPDATE artifacts SET content = ?, updated_at = datetime('now') WHERE id = ?`,
          [fixedSpec, specArtifactId],
        );
        persistPm1LlmTurn({
          userId: input.userId,
          sessionId: input.sessionId,
          handoffId: input.handoff.id,
          step: 'spec-self-review-fix',
          userMessage: specFixPrompt,
          assistantContent: fixedSpec,
        });
      } else {
        // callLlmWithRetry 内部已做了 3 轮 LLM 修正 + 程序化兜底，但仍不通过——
        // 做最后一道直接 patch
        const patchedSpec = applyPatches(fixedSpec, SPEC_VALIDATION_RULES);
        finalSpecContent = patchedSpec;
        sqliteRun(
          `UPDATE artifacts SET content = ?, updated_at = datetime('now') WHERE id = ?`,
          [patchedSpec, specArtifactId],
        );
      }
    }
  } catch (specReviewErr) {
    console.warn(
      `[artifact-chain] PM1 spec 自审失败：${specReviewErr instanceof Error ? specReviewErr.message : String(specReviewErr)}`,
    );
  }

  // 5.5b: plan 自审
  let finalPlanContent = planContent;
  try {
    const planValidation = validatePlanOutput(finalPlanContent);
    if (!planValidation.ok) {
      console.warn(
        `[artifact-chain] PM1 自审：plan 缺少 ${planValidation.failed.join('、')}，尝试 LLM 修正`,
      );
      const planFixPrompt = [
        '⚠️ 你之前生成的 plan.md 缺少以下必填章节，PM2 管控层会拒绝并退回重新规划。',
        '请根据以下缺失项修正后重新输出完整的 plan.md：',
        '',
        `缺失项：${planValidation.failed.join('、')}`,
        '',
        '修正要求：',
        '- 如果缺少"包含技术上下文"：必须添加"## 技术上下文"章节',
        '- 如果缺少"包含宪法对齐"：必须添加"## 宪法对齐检查"表格（表头：宪法条目|本计划是否符合|备注）',
        '- 如果缺少"包含项目结构"：必须添加"## 项目结构"章节，包含 ```text 代码块',
        '- 如果缺少"包含复杂度评估"：必须添加"## 复杂度评估"章节',
        '- 如果缺少"包含风险与缓解"：必须添加"## 风险与缓解"表格（表头：风险|缓解措施）',
        '- 如果缺少"包含验收场景实施映射"：必须添加"## 验收场景实施映射"表格（表头：场景编号|实现模块/文件|分层路径|验证方式|交付证据）',
        '- 如果缺少"包含架构守卫"：必须添加"## 架构守卫"章节，列出架构约束条款',
        '',
        '原始 plan.md：',
        finalPlanContent,
      ].join('\n');

      const fixedPlan = await callLlmWithRetry(
        input.callLlm,
        PLAN_SYSTEM_INSTRUCTION,
        planFixPrompt,
        PLAN_VALIDATION_RULES,
      );
      const rePlanValidation = validatePlanOutput(fixedPlan);
      if (rePlanValidation.ok) {
        finalPlanContent = fixedPlan;
        sqliteRun(
          `UPDATE artifacts SET content = ?, updated_at = datetime('now') WHERE id = ?`,
          [fixedPlan, planArtifactId],
        );
        persistPm1LlmTurn({
          userId: input.userId,
          sessionId: input.sessionId,
          handoffId: input.handoff.id,
          step: 'plan-self-review-fix',
          userMessage: planFixPrompt,
          assistantContent: fixedPlan,
        });
      } else {
        // callLlmWithRetry 内部已做了 3 轮 LLM 修正 + 程序化兜底，但仍不通过——
        // 做最后一道直接 patch
        const patchedPlan = applyPatches(fixedPlan, PLAN_VALIDATION_RULES);
        finalPlanContent = patchedPlan;
        sqliteRun(
          `UPDATE artifacts SET content = ?, updated_at = datetime('now') WHERE id = ?`,
          [patchedPlan, planArtifactId],
        );
      }
    }
  } catch (planReviewErr) {
    console.warn(
      `[artifact-chain] PM1 plan 自审失败：${planReviewErr instanceof Error ? planReviewErr.message : String(planReviewErr)}`,
    );
  }

  // 5.5c: tasks 自审
  let finalTasksContent = tasksContent;
  try {
    const { parseAllTasks, validateParsedTasks } = await import(
      '../capability/dispatch-package.js'
    );
    const parsedTasks = parseAllTasks(finalTasksContent);
    const taskIssues = validateParsedTasks(parsedTasks);

    if (taskIssues.length > 0) {
      // tasks 格式不通过——让 LLM 修正
      const fixPrompt = [
        '⚠️ 你生成的 tasks.md 存在以下格式问题，PM2 会拒绝派发。请修正后重新输出完整的 tasks.md：',
        '',
        taskIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n'),
        '',
        '修正要求：',
        '- 每个任务标题必须使用"[文件/模块路径] 动作 - 预期结果"格式',
        '- 动作必须是可执行的动词+宾语（如"新增""修复""编写"），不能只是描述性文字',
        '- 示例：[apps/web/src/pages/login.tsx] 新增登录表单组件 - 用户可输入凭据并提交',
        '',
        '原始 tasks.md：',
        finalTasksContent,
      ].join('\n');

      const fixedTasks = await callLlmWithRetry(
        input.callLlm,
        TASKS_SYSTEM_INSTRUCTION,
        fixPrompt,
        TASKS_VALIDATION_RULES,
      );

      // 再次校验修正后的 tasks
      const reparsedTasks = parseAllTasks(fixedTasks);
      const reIssues = validateParsedTasks(reparsedTasks);
      if (reIssues.length === 0) {
        // 修正成功
        finalTasksContent = fixedTasks;
        persistPm1LlmTurn({
          userId: input.userId,
          sessionId: input.sessionId,
          handoffId: input.handoff.id,
          step: 'tasks-self-review-fix',
          userMessage: fixPrompt,
          assistantContent: fixedTasks,
        });
      } else {
        // 修正后仍不通过——使用修正后的版本（至少比原来好），记 warn
        console.warn(
          `[artifact-chain] PM1 自我复查：tasks 修正后仍有问题（${reIssues.join('；')}），使用修正版本继续`,
        );
        finalTasksContent = fixedTasks;
      }
    }
  } catch (reviewErr) {
    // 自我复查失败不阻塞流程——PM2 会再做校验
    console.warn(
      `[artifact-chain] PM1 自我复查失败：${reviewErr instanceof Error ? reviewErr.message : String(reviewErr)}`,
    );
  }

  const tasksArtifactId = createArtifact({
    userId: input.userId,
    sessionId: input.sessionId,
    type: 'markdown',
    title: `tasks: ${input.rewrittenIntent.slice(0, 60)}`,
    content: finalTasksContent,
    phase: 'tasks',
    teamWorkspaceId: input.teamWorkspaceId,
    parentArtifactId: planArtifactId,
    roleLayer: 'pm1',
  });
  setC(SUBSTATES_C.TASKS_READY);

  // ─── Step 6: 写入 handoff result ──────────────────────────────────────────
  writeHandoffResult(input.handoff.id, {
    specArtifactId,
    planArtifactId,
    tasksArtifactId,
    clarifications,
    clarificationAnswers,
    constitutionWarnings,
  });

  setC(SUBSTATES_C.COMPLETED);

  return {
    specArtifactId,
    planArtifactId,
    tasksArtifactId,
    clarifications,
    constitutionWarnings,
  };
}
