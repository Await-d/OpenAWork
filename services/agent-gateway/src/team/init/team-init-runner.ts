/**
 * team-init-runner · 执行单个初始化步骤
 *
 * 每步都在用户确认后由路由层调用（scan-shared-record 例外——它在 planner 阶段就
 * 已经执行）。runner 的执行原则与 reception-orchestrator 一致：失败不抛错，写入
 * step.error 并返回 ok=false，让上层决定如何反馈给前端。
 *
 * 产物落点：
 *   - 读类结果（一级结构 / 记忆摘要 / 架构摘要）写入对应 step.result 与 bindings。
 *   - 工具绑定写入 bindings.perLayer，并同步进 teamDefinition.memberSlots[].skillIds/
 *     mcpServerIds（让运行时的 MCP 白名单 / pinned skills 快照可以直接消费）。
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  type TeamInitLayerBinding,
  type TeamInitState,
  type TeamInitStepKey,
  type TeamRuntimeLayer,
  deriveTeamInitPhase,
} from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../../infra/db.js';
import { validateWorkspacePath } from '../../workspace/workspace-paths.js';
import { resolveAuxiliaryLlmConfig } from '../../provider/auxiliary-llm-config.js';
import {
  loadTeamInitSessionContext,
  updateTeamInitStep,
  writeTeamInitState,
  type TeamInitSessionContext,
} from './team-init-store.js';
import {
  parseSessionMetadataJson,
  mergeSessionMetadataForUpdate,
} from '../../session/session-workspace-metadata.js';

export interface RunTeamInitStepResult {
  ok: boolean;
  reason?: string;
  state?: TeamInitState | null;
}

const MAX_FILE_BYTES = 256 * 1024;

async function readWorkspaceFileSafe(
  workingRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const full = path.join(workingRoot, relativePath);
    const stat = await fs.stat(full);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const content = (await fs.readFile(full, 'utf8')).trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/** 列出工作目录的一级目录与文件（剔除噪声 + 数量护栏）。 */
async function readProjectLevel1(workingRoot: string): Promise<{
  directories: string[];
  files: string[];
}> {
  const IGNORED = new Set(['.git', 'node_modules', '.shadow-git', '.DS_Store']);
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
  try {
    entries = await fs.readdir(workingRoot, { withFileTypes: true });
  } catch {
    return { directories: [], files: [] };
  }
  const directories: string[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    if (entry.isDirectory()) {
      directories.push(entry.name);
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
    if (directories.length + files.length >= 200) break;
  }
  directories.sort();
  files.sort();
  return { directories, files };
}

// ─── 各步骤执行体 ──────────────────────────────────────────────────────────

async function execReadProjectLevel1(
  ctx: TeamInitSessionContext,
): Promise<{ result: Record<string, unknown> }> {
  const safeRoot = ctx.workingDirectory ? validateWorkspacePath(ctx.workingDirectory) : null;
  if (!safeRoot) {
    return { result: { directories: [], files: [], note: '工作目录不可用' } };
  }
  const level1 = await readProjectLevel1(safeRoot);
  return {
    result: {
      directories: level1.directories,
      files: level1.files,
      directoryCount: level1.directories.length,
      fileCount: level1.files.length,
    },
  };
}

async function execExtractProjectMemory(
  ctx: TeamInitSessionContext,
): Promise<{ result: Record<string, unknown>; projectMemoryDigest: string | null }> {
  const safeRoot = ctx.workingDirectory ? validateWorkspacePath(ctx.workingDirectory) : null;
  if (!safeRoot) {
    return { result: { sources: [], note: '工作目录不可用' }, projectMemoryDigest: null };
  }
  const candidates: Array<{ label: string; rel: string }> = [
    { label: 'AGENTS.md', rel: 'AGENTS.md' },
    { label: 'architecture.md', rel: 'architecture.md' },
    { label: 'project-memory', rel: '.agentdocs/project-memory.md' },
    { label: 'lessons-learned', rel: '.agentdocs/lessons-learned.md' },
  ];
  const found: Array<{ label: string; chars: number; excerpt: string }> = [];
  for (const candidate of candidates) {
    const content = await readWorkspaceFileSafe(safeRoot, candidate.rel);
    if (content) {
      found.push({
        label: candidate.label,
        chars: content.length,
        excerpt: content.slice(0, 1200),
      });
    }
  }
  const digest =
    found.length > 0 ? found.map((f) => `### ${f.label}\n${f.excerpt}`).join('\n\n') : null;
  return {
    result: {
      sources: found.map((f) => ({ label: f.label, chars: f.chars })),
      // 预览用：保留每个来源的摘录文本（前端展开渲染为 markdown）。
      excerpts: found.map((f) => ({ label: f.label, excerpt: f.excerpt })),
      foundCount: found.length,
    },
    projectMemoryDigest: digest,
  };
}

async function execUnderstandArchitecture(
  ctx: TeamInitSessionContext,
): Promise<{ result: Record<string, unknown>; architectureSummary: string | null }> {
  const safeRoot = ctx.workingDirectory ? validateWorkspacePath(ctx.workingDirectory) : null;
  if (!safeRoot) {
    return { result: { note: '工作目录不可用' }, architectureSummary: null };
  }
  const level1 = await readProjectLevel1(safeRoot);
  const architectureMd = await readWorkspaceFileSafe(safeRoot, 'architecture.md');
  const packageJson = await readWorkspaceFileSafe(safeRoot, 'package.json');

  // 启发式摘要（无 LLM 时的兜底）。
  const heuristicSummary = [
    `项目顶层目录：${level1.directories.join(', ') || '（无）'}`,
    `顶层文件：${level1.files.slice(0, 20).join(', ') || '（无）'}`,
    architectureMd ? '存在 architecture.md（已读取要点）。' : '未发现 architecture.md。',
  ].join('\n');

  const llmConfig = await resolveAuxiliaryLlmConfig(ctx.userId, undefined);
  if (!llmConfig) {
    return {
      result: { mode: 'heuristic', usedLlm: false, summary: heuristicSummary },
      architectureSummary: heuristicSummary,
    };
  }

  try {
    const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
    const contextBlock = [
      `顶层目录：${level1.directories.join(', ')}`,
      `顶层文件：${level1.files.slice(0, 30).join(', ')}`,
      architectureMd ? `architecture.md 摘录：\n${architectureMd.slice(0, 2000)}` : '',
      packageJson ? `package.json 摘录：\n${packageJson.slice(0, 1500)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const prompt = `你是一个资深架构师。基于以下项目结构信息，用中文给出一段不超过 300 字的「项目架构摘要」，描述项目类型、主要技术栈、关键目录职责。只输出摘要正文，不要标题、不要寒暄。\n\n${contextBlock}`;
    const summary = await requestWorkflowLlmCompletion({
      apiBaseUrl: llmConfig.apiBaseUrl,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
      ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
      prompt,
      temperature: 0.2,
    });
    const trimmed = summary.trim();
    const finalSummary = trimmed.length > 0 ? trimmed : heuristicSummary;
    return {
      result: { mode: 'llm', usedLlm: true, summary: finalSummary },
      architectureSummary: finalSummary,
    };
  } catch (err) {
    console.warn(
      `[team-init-runner] understand-architecture LLM 失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      result: { mode: 'heuristic-fallback', usedLlm: false, summary: heuristicSummary },
      architectureSummary: heuristicSummary,
    };
  }
}

/**
 * 按层绑定工具：启发式从已发现 skill + 已配置 MCP 中为各执行/规划层挑选。
 * 这里走保守策略——把可用 skill / mcp 绑定到执行层（executor）与规划层（pm1/pm2），
 * 让链路一开始就带着工具。后续用户可在治理面板细调。
 */
async function execBindToolsPerLayer(ctx: TeamInitSessionContext): Promise<{
  result: Record<string, unknown>;
  perLayer: Partial<Record<TeamRuntimeLayer, TeamInitLayerBinding>>;
}> {
  let skillIds: string[] = [];
  try {
    const { discoverLocalSkills } = await import('../../skill/local-skills.js');
    const discovered = await discoverLocalSkills(new Set());
    skillIds = discovered.slice(0, 20).map((s) => s.id);
  } catch (err) {
    console.warn(
      `[team-init-runner] discoverLocalSkills 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let mcpServerIds: string[] = [];
  try {
    const { loadConfiguredMcpServersForUser } = await import('../../mcp/mcp-runtime.js');
    const servers = loadConfiguredMcpServersForUser(ctx.userId);
    mcpServerIds = servers
      .filter((server) => server.enabled !== false)
      .slice(0, 20)
      .map((server) => server.id);
  } catch (err) {
    console.warn(
      `[team-init-runner] loadConfiguredMcpServersForUser 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const boundAt = new Date().toISOString();
  // 执行层拿全量工具；规划/管控层拿 MCP（便于查文档/检索）但不必拿全部 skill。
  const perLayer: Partial<Record<TeamRuntimeLayer, TeamInitLayerBinding>> = {
    executor: {
      skillIds,
      mcpServerIds,
      rationale: '执行层负责实际产出，绑定全部可用 skill 与 MCP。',
      boundAt,
    },
    pm1: {
      skillIds: [],
      mcpServerIds,
      rationale: '规划层绑定 MCP 以便检索资料与查文档。',
      boundAt,
    },
    pm2: {
      skillIds: [],
      mcpServerIds,
      rationale: '管控层绑定 MCP 以便核对依赖与上下文。',
      boundAt,
    },
  };

  // 同步进 teamDefinition.memberSlots，让运行时直接消费。
  syncBindingsIntoMemberSlots(ctx, perLayer);

  return {
    result: {
      skillCount: skillIds.length,
      mcpCount: mcpServerIds.length,
      boundLayers: Object.keys(perLayer),
      skillIds,
      mcpServerIds,
      // 预览用：每层绑定明细（前端展开渲染）。
      perLayer: Object.fromEntries(
        Object.entries(perLayer).map(([layer, binding]) => [
          layer,
          {
            skillIds: binding?.skillIds ?? [],
            mcpServerIds: binding?.mcpServerIds ?? [],
            rationale: binding?.rationale ?? null,
          },
        ]),
      ),
    },
    perLayer,
  };
}

/** 把 per-layer 绑定回写进 sessions.metadata_json.teamDefinition.memberSlots。 */
function syncBindingsIntoMemberSlots(
  ctx: TeamInitSessionContext,
  perLayer: Partial<Record<TeamRuntimeLayer, TeamInitLayerBinding>>,
): void {
  const row = sqliteGet<{ metadata_json: string | null }>(
    `SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [ctx.sessionId, ctx.userId],
  );
  if (!row) return;
  const metadata = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const teamDefinition = metadata['teamDefinition'];
  if (!teamDefinition || typeof teamDefinition !== 'object') return;

  const def = teamDefinition as Record<string, unknown>;
  const memberSlots = Array.isArray(def['memberSlots'])
    ? (def['memberSlots'] as Array<Record<string, unknown>>)
    : [];
  if (memberSlots.length === 0) return;

  const nextSlots = memberSlots.map((slot) => {
    const layer = slot['layer'];
    if (typeof layer !== 'string') return slot;
    const binding = perLayer[layer as TeamRuntimeLayer];
    if (!binding) return slot;
    return {
      ...slot,
      ...(binding.skillIds.length > 0 ? { skillIds: binding.skillIds } : {}),
      ...(binding.mcpServerIds.length > 0 ? { mcpServerIds: binding.mcpServerIds } : {}),
    };
  });

  const nextMetadata = {
    ...metadata,
    teamDefinition: { ...def, memberSlots: nextSlots },
  };
  const { metadata: merged } = mergeSessionMetadataForUpdate(metadata, {
    teamDefinition: nextMetadata['teamDefinition'] as Record<string, unknown>,
  });
  sqliteRun(`UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?`, [
    JSON.stringify(merged),
    ctx.sessionId,
    ctx.userId,
  ]);
}

async function execScaffoldMemory(): Promise<{ result: Record<string, unknown> }> {
  // 空项目：只在会话内记录骨架摘要，不落盘（保持可逆，低风险）。
  const scaffold = [
    '# 项目记忆（初始骨架）',
    '- 目标：待用户在首条需求中明确',
    '- 技术栈：待定',
    '- 关键约束：待补充',
  ].join('\n');
  return { result: { scaffold, note: '空项目记忆骨架（仅会话内，未落盘）' } };
}

/**
 * In-process guard against concurrent execution of the SAME init step.
 *
 * The confirm route (`POST /team/sessions/:id/init/steps/:key/confirm`) has no
 * re-entrancy protection: a double-click, an impatient client retry, or two
 * tabs can fire two confirms for the same step before the first settles. The
 * pure DB-status check below only rejects `done` / `not_applicable`; a second
 * call that arrives while the first is still `running` (these steps await up to
 * a 60s LLM call) would pass the check, flip the step to `running` again, and
 * RE-EXECUTE — duplicate LLM spend (`understand-architecture`) and duplicate
 * side-effecting writes (`bind-tools-per-layer` / `scaffold-memory`). A status
 * read can't close this window because the two reads interleave before either
 * write. An in-process in-flight Set keyed by (userId, sessionId, stepKey) makes
 * the second caller a no-op deterministically (mirrors the gateway's
 * `inFlightPm2QualityReviews` / `inFlightStreamRequests` singletons). It's
 * cleared in `finally`, so a process crash naturally releases the key rather
 * than wedging the step forever the way a persisted lock would.
 */
const inFlightTeamInitSteps = new Set<string>();

function teamInitStepKey(userId: string, sessionId: string, stepKey: TeamInitStepKey): string {
  return `${userId}::${sessionId}::${stepKey}`;
}

// ─── 主入口 ────────────────────────────────────────────────────────────────

/**
 * 执行单个初始化步骤并回写状态。step 必须存在且当前不是 done/not_applicable。
 */
export async function runTeamInitStep(input: {
  sessionId: string;
  userId: string;
  stepKey: TeamInitStepKey;
}): Promise<RunTeamInitStepResult> {
  const ctx = loadTeamInitSessionContext(input.sessionId, input.userId);
  if (!ctx?.teamInit) {
    return { ok: false, reason: 'team-init-not-found' };
  }
  const step = ctx.teamInit.steps.find((s) => s.key === input.stepKey);
  if (!step) {
    return { ok: false, reason: 'step-not-found' };
  }
  if (step.status === 'not_applicable') {
    return { ok: false, reason: 'step-not-applicable' };
  }
  if (step.status === 'done') {
    return { ok: true, state: ctx.teamInit };
  }

  // Concurrent-execution guard: a second confirm for the same step that lands
  // while the first is still in-flight must NOT re-run side effects / LLM calls.
  const inFlightKey = teamInitStepKey(input.userId, input.sessionId, input.stepKey);
  if (inFlightTeamInitSteps.has(inFlightKey)) {
    return { ok: false, reason: 'step-already-running', state: ctx.teamInit };
  }
  inFlightTeamInitSteps.add(inFlightKey);

  // 标记 running。
  updateTeamInitStep(input.sessionId, input.userId, input.stepKey, (s) => ({
    ...s,
    status: 'running',
    confirmedAt: s.confirmedAt ?? new Date().toISOString(),
    error: null,
  }));

  try {
    let result: Record<string, unknown> = {};
    let architectureSummary: string | null | undefined;
    let projectMemoryDigest: string | null | undefined;
    let perLayer: Partial<Record<TeamRuntimeLayer, TeamInitLayerBinding>> | undefined;

    switch (input.stepKey) {
      case 'read-project-level1': {
        ({ result } = await execReadProjectLevel1(ctx));
        break;
      }
      case 'extract-project-memory': {
        const out = await execExtractProjectMemory(ctx);
        result = out.result;
        projectMemoryDigest = out.projectMemoryDigest;
        break;
      }
      case 'understand-architecture': {
        const out = await execUnderstandArchitecture(ctx);
        result = out.result;
        architectureSummary = out.architectureSummary;
        break;
      }
      case 'bind-tools-per-layer': {
        const out = await execBindToolsPerLayer(ctx);
        result = out.result;
        perLayer = out.perLayer;
        break;
      }
      case 'scaffold-memory': {
        ({ result } = await execScaffoldMemory());
        break;
      }
      case 'scan-shared-record': {
        // scan 已在 planner 阶段执行；这里只是幂等地标记完成。
        result = ctx.teamInit.steps.find((s) => s.key === 'scan-shared-record')?.result ?? {};
        break;
      }
      default: {
        return { ok: false, reason: 'unknown-step' };
      }
    }

    // 合并 bindings 后整块写回（避免与 step 更新竞态）。
    const fresh = loadTeamInitSessionContext(input.sessionId, input.userId);
    if (!fresh?.teamInit) {
      return { ok: false, reason: 'team-init-vanished' };
    }
    const nowIso = new Date().toISOString();
    const nextSteps = fresh.teamInit.steps.map((s) =>
      s.key === input.stepKey
        ? { ...s, status: 'done' as const, result, error: null, completedAt: nowIso }
        : s,
    );
    const nextBindings = {
      ...fresh.teamInit.bindings,
      ...(perLayer ? { perLayer: { ...fresh.teamInit.bindings.perLayer, ...perLayer } } : {}),
      ...(architectureSummary !== undefined ? { architectureSummary } : {}),
      ...(projectMemoryDigest !== undefined ? { projectMemoryDigest } : {}),
    };
    const nextState: TeamInitState = {
      ...fresh.teamInit,
      steps: nextSteps,
      bindings: nextBindings,
      phase: fresh.teamInit.phase === 'skipped' ? 'skipped' : deriveTeamInitPhase(nextSteps),
    };
    writeTeamInitState(input.sessionId, input.userId, nextState);
    return { ok: true, state: nextState };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'run-step-failed';
    const state = updateTeamInitStep(input.sessionId, input.userId, input.stepKey, (s) => ({
      ...s,
      status: 'failed',
      error: reason,
    }));
    return { ok: false, reason, state };
  } finally {
    // Release the in-flight key whether the step succeeded, failed, or threw —
    // a crash before this point clears it via process exit, never a stuck lock.
    inFlightTeamInitSteps.delete(inFlightKey);
  }
}
