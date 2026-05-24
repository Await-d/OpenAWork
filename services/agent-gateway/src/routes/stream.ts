import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { join, relative } from 'node:path';
import type {
  DialogueMode,
  FileDiffContent,
  InputImageContent,
  StreamCancellationSummary,
  ManagedAgentRecord,
  MessageContent,
  RunEvent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import {
  COMPACTION_SETTINGS_KEY,
  readCompactionSettings,
} from '../compaction/compaction-policy.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { writeAuditLog } from '../infra/audit-log.js';
import {
  modelRequestSchema,
  type ModelRouteConfig,
  resolveModelRoute,
  resolveModelRouteFromProvider,
} from '../provider/model-router.js';
import { getFastProvider, getProviderForSelection } from '../provider/provider-catalog.js';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import {
  appendSessionMessageV2,
  deleteSessionMessagesByRequestScope,
  getSessionMessageByRequestId,
  listSessionMessagesByRequestScope,
  listSessionMessagesV2,
} from '../message/message-v2-adapter.js';
import { resolveEffectiveContextWindow } from '../compaction/context-window-resolver.js';
import {
  triggerProactiveCompaction,
  triggerOverflowCompaction,
} from '../compaction/auto-compaction-trigger.js';
import { persistStreamUserMessage } from '../session/stream-session-title.js';
import { buildCapabilityContext } from './capabilities.js';
import {
  CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  DIALOGUE_MODE_SYSTEM_PROMPTS,
  LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  YOLO_MODE_SYSTEM_PROMPT,
  detectThinkingLanguageHintFromText,
} from './stream-system-prompts.js';
import { KeywordDetectorImpl } from '@openAwork/agent-core';
import {
  deleteSessionRunEventsByRequest,
  hasPersistedRunEvent,
  listSessionRunEventsByRequest,
  publishSessionRunEvent,
  subscribeSessionRunEvents,
} from '../session/session-run-events.js';
import { deriveRunEventBookend } from '../session/run-event-envelope.js';
import {
  collectFileDiffsFromToolOutput,
  mergeFileDiffs,
  traceFileDiffs,
} from '../tools/modified-files-summary.js';
import { persistSessionFileDiffs } from '../session/session-file-diff-store.js';
import { buildToolResultContent, buildToolResultRunEvent } from '../tools/tool-result-contract.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import type { SandboxExecutionContext } from '../tools/tool-sandbox.js';
import { cancelDescendantSessionStreams } from '../session/cancel-descendant-streams.js';
import { buildGatewayToolDefinitions } from '../tools/tool-definitions.js';
import { buildFlatMcpToolDefinitions } from '../mcp/mcp-flat-tool-defs.js';
import { listMcpToolsForSession } from '../mcp/mcp-runtime.js';
import { isFlatMcpToolsDisabled } from '../mcp/mcp-tool-naming.js';
import { getEffectiveSkillsFromSessionContext } from '../skill/skill-selection-context.js';
import type { EffectiveSkill } from '../skill/skill-selection.js';
import {
  applyPinnedSnapshot,
  buildPinnedSkillsPromptSection,
  snapshotFromEffective,
  type PinnedSkillsSnapshot,
} from '../skill/pinned-skills-prompt.js';
import {
  loadDynamicToolsForWorkspace,
  buildDynamicGatewayToolDefinitions,
  type DynamicToolEntry,
} from '../tools/dynamic-tool-loader.js';
import { buildStreamUsageChunk } from './stream-usage-event.js';
import { isEnabledToolName } from './tool-name-compat.js';
import { sanitizeSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { filterEnabledGatewayToolsForSession } from '../session/session-tool-visibility.js';
import { resolveCanonicalName } from '../claude-code/claude-code-tool-surface.js';
import {
  clearInFlightStreamRequest,
  getAnyInFlightStreamRequestForSession,
  getInFlightStreamRequest,
  readPendingCancelReason,
  registerInFlightStreamRequest,
} from './stream-cancellation.js';
import {
  isTaskParentAutoResumeClientRequestId,
  MAX_CONSECUTIVE_TASK_PARENT_AUTO_RESUMES,
  noteManualSessionInteraction,
} from '../task/task-parent-auto-resume.js';
import { listSessionTodos } from '../tools/todo-tools.js';
import {
  detectRecoveryErrorType,
  recoverToolResultMissing,
  recoverThinkingDisabledViolation,
  recoverThinkingBlockOrder,
  type RecoveryResult,
} from '../session/session-recovery.js';
import { detectDelegateTaskError, buildRetryGuidance } from '../task/delegate-task-retry.js';
import { truncateToolOutputUniversal } from '../tools/tool-output-truncator.js';
import { normalizeToolArgumentsForStorage } from '../tools/tool-result-contract.js';
import { detectEmptyTaskResponse } from '../task/empty-task-response-detector.js';
import { buildDynamicOrchestratorPrompt } from '../agent/dynamic-agent-prompt-builder.js';
import { appendTaskResumeInfo } from '../task/task-resume-info.js';
import { checkAiComments } from '../tools/comment-checker.js';
import {
  checkNonInteractiveBash,
  buildBannedCommandWarning,
} from '../workspace/non-interactive-env.js';
import {
  checkAtlasGuard,
  buildAtlasPostProcessReminder,
  SINGLE_TASK_DIRECTIVE,
} from '../session/atlas-guard.js';
import { checkRalphLoopContinuation } from '../session/ralph-loop.js';
import {
  detectStartWorkKeyword as detectUltraworkKeyword,
  processStartWork,
} from '../workspace/start-work.js';
import { detectActiveCommandContext } from '../tools/command-templates.js';
import {
  checkPrometheusToolGuard,
  PLANNING_CONSULT_WARNING,
  PROMETHEUS_WORKFLOW_REMINDER,
} from '../app/prometheus-md-only.js';
import {
  shouldInjectNotepadDirective,
  NOTEPAD_DIRECTIVE,
} from '../session/sisyphus-junior-notepad.js';
import { runModelRound } from './stream-model-round.js';
import { dispatchChatMessage } from '../runtime/plugin-host.js';
import {
  clearSessionRuntimeThread,
  SESSION_RUNTIME_THREAD_HEARTBEAT_MS,
  touchSessionRuntimeThread,
  upsertSessionRuntimeThread,
} from '../session/session-runtime-thread-store.js';
import { resolveSessionInteractionStateUpdate } from '../session/session-runtime-state.js';
import { persistMonthlyUsageRecord } from '../session/usage-records-store.js';
import { listManagedAgentsForUser } from '../agent/agent-catalog.js';
import { selectDelegatedModelForUser } from '../task/task-model-selection.js';
import {
  DEFAULT_UPSTREAM_RETRY_MAX_RETRIES,
  readUpstreamRetrySettings,
  UPSTREAM_RETRY_MAX_RETRIES_KEY,
  UPSTREAM_RETRY_SETTINGS_KEY,
  upstreamRetryMaxRetriesSchema,
} from '../provider/upstream-retry-policy.js';
import {
  autoExtractMemoriesForRequest,
  buildMemoryBlockForSession,
} from '../memory/memory-runtime.js';
import {
  buildCompanionPrompt,
  loadCompanionSettingsForUser,
} from '../workspace/companion-settings.js';
import {
  peekDoomLoop,
  recordDoomLoopEntry,
  resetDoomLoopHistory,
} from '../session/doom-loop-detector.js';
import { buildTeamInstructionStack } from '../team/team-instruction-stack.js';
import { mapAgentToTeamRoleLayer } from '../team/team-role-layer-mapping.js';
import { toStreamStopReason } from './stream-types.js';
import type { HandleStreamResult } from './stream-types.js';

type PersistedSessionStateStatus = 'idle' | 'running' | 'paused';

export function setPersistedSessionStateStatus(input: {
  sessionId: string;
  status: PersistedSessionStateStatus;
  userId: string;
}): void {
  sqliteRun(
    "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [input.status, input.sessionId, input.userId],
  );
}

export async function buildWorkspaceContext(metadataJson: string): Promise<string | null> {
  let wd: string | null = null;
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    wd = typeof meta['workingDirectory'] === 'string' ? meta['workingDirectory'] : null;
  } catch {
    return null;
  }
  if (!wd) return null;

  const safeWorkingDirectory = validateWorkspacePath(wd);
  if (!safeWorkingDirectory) return null;

  try {
    const entries = await fsp.readdir(safeWorkingDirectory, { withFileTypes: true });
    const IGNORED = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.DS_Store']);
    // Sort entries by name for deterministic output. `fsp.readdir` does
    // not guarantee a stable order across calls (filesystem-dependent),
    // and any reshuffle invalidates the workspace context byte prefix —
    // which is the very first segment of the stable system message that
    // upstream prompt-caching keys on. Mirrors opencode `directoryListing`
    // which also sorts before rendering. Directories first, then files,
    // each alphabetically — this gives a tree-like grouping that is
    // both human-readable and prompt-cache-stable across rounds.
    const sortedEntries = entries.slice().sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1;
      const bDir = b.isDirectory() ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name);
    });
    const lines: string[] = [];
    for (const e of sortedEntries.slice(0, 100)) {
      if (IGNORED.has(e.name)) continue;
      lines.push((e.isDirectory() ? '📁 ' : '📄 ') + e.name);
    }

    // Read project rule files, AGENTS.md, and README.md
    // (integrating oh-my-opencode's rulesInjector, directoryAgentsInjector,
    //  and directoryReadmeInjector patterns into workspace context)
    const contextSections: string[] = [];

    // 1. Rule files (.cursor/rules, .github/instructions, .claude/rules, .github/copilot-instructions.md)
    const ruleFiles = await collectRuleFiles(safeWorkingDirectory);
    if (ruleFiles.length > 0) {
      contextSections.push('<project_rules>');
      for (const rule of ruleFiles) {
        contextSections.push(`[Rule: ${rule.relativePath}]\n${rule.content}`);
      }
      contextSections.push('</project_rules>');
    }

    // 2. AGENTS.md files (oh-my-opencode directoryAgentsInjector pattern)
    const agentsFiles = await collectAgentsFiles(safeWorkingDirectory);
    if (agentsFiles.length > 0) {
      contextSections.push('<directory_agents>');
      for (const entry of agentsFiles) {
        contextSections.push(`[Context: ${entry.relativePath}]\n${entry.content}`);
      }
      contextSections.push('</directory_agents>');
    }

    // 3. Root README.md (oh-my-opencode directoryReadmeInjector pattern)
    const readmeContent = await readRootReadme(safeWorkingDirectory);
    if (readmeContent) {
      contextSections.push(`<project_readme>\n${readmeContent}\n</project_readme>`);
    }

    const contextBlock = contextSections.length > 0 ? '\n' + contextSections.join('\n\n') : '';

    return `<workspace path="${safeWorkingDirectory}">\n<file_tree>\n${lines.join('\n')}\n</file_tree>${contextBlock}\n</workspace>`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Project rule file collection (oh-my-opencode rulesInjector pattern)
// ---------------------------------------------------------------------------

const RULE_EXTENSIONS = ['.md', '.mdc'];
const PROJECT_RULE_SUBDIRS: [string, string][] = [
  ['.cursor', 'rules'],
  ['.github', 'instructions'],
  ['.claude', 'rules'],
];
const PROJECT_RULE_FILES = ['.github/copilot-instructions.md'];

interface RuleFileEntry {
  relativePath: string;
  content: string;
}

async function collectRuleFiles(workspaceRoot: string): Promise<RuleFileEntry[]> {
  const results: RuleFileEntry[] = [];
  const seen = new Set<string>();

  // Read rule subdirectories
  for (const [parent, subdir] of PROJECT_RULE_SUBDIRS) {
    const ruleDir = join(workspaceRoot, parent, subdir);
    await collectRuleFilesRecursive(ruleDir, workspaceRoot, seen, results);
  }

  // Read single-file rules at project root
  for (const ruleFile of PROJECT_RULE_FILES) {
    const filePath = join(workspaceRoot, ruleFile);
    const content = await readFileIfExists(filePath);
    if (content) {
      const relativePath = relative(workspaceRoot, filePath);
      if (!seen.has(relativePath)) {
        seen.add(relativePath);
        results.push({ relativePath, content });
      }
    }
  }

  return results;
}

async function collectRuleFilesRecursive(
  dir: string,
  workspaceRoot: string,
  seen: Set<string>,
  results: RuleFileEntry[],
): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort by name for deterministic recursion order. Same rationale as
  // `buildWorkspaceContext`: rule files are concatenated into the stable
  // system prompt, and any reshuffle invalidates the upstream prompt-cache
  // prefix (Anthropic / OpenAI). Recurse directories before files so the
  // resulting <project_rules> block has a depth-first stable ordering.
  const sortedEntries = entries.slice().sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sortedEntries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectRuleFilesRecursive(fullPath, workspaceRoot, seen, results);
    } else if (entry.isFile() && RULE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      const relativePath = relative(workspaceRoot, fullPath);
      if (seen.has(relativePath)) continue;
      seen.add(relativePath);
      const content = await fsp.readFile(fullPath, 'utf-8');
      // Strip frontmatter (YAML between --- delimiters)
      const stripped = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
      if (stripped.length > 0) {
        results.push({ relativePath, content: stripped });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AGENTS.md collection (oh-my-opencode directoryAgentsInjector pattern)
// ---------------------------------------------------------------------------

const AGENTS_FILE_NAMES = ['AGENTS.md', 'CRUSH.md', 'CLAUDE.md', 'GEMINI.md'];

interface AgentsFileEntry {
  relativePath: string;
  content: string;
}

async function collectAgentsFiles(workspaceRoot: string): Promise<AgentsFileEntry[]> {
  const results: AgentsFileEntry[] = [];
  for (const fileName of AGENTS_FILE_NAMES) {
    const filePath = join(workspaceRoot, fileName);
    const content = await readFileIfExists(filePath);
    if (content) {
      results.push({ relativePath: fileName, content });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Root README.md (oh-my-opencode directoryReadmeInjector pattern)
// ---------------------------------------------------------------------------

async function readRootReadme(workspaceRoot: string): Promise<string | null> {
  for (const name of ['README.md', 'README.MD', 'readme.md']) {
    const content = await readFileIfExists(join(workspaceRoot, name));
    if (content) return content;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

export function isWebSearchEnabled(metadataJson: string): boolean {
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    if (meta['webSearchEnabled'] === true) {
      return true;
    }

    const channel = meta['channel'];
    if (typeof channel === 'object' && channel !== null) {
      const tools = (channel as Record<string, unknown>)['tools'];
      if (typeof tools === 'object' && tools !== null) {
        return (tools as Record<string, unknown>)['web_search'] === true;
      }
    }

    return meta['webSearchEnabled'] === true;
  } catch {
    return false;
  }
}

const reasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']);

const inputImagePartSchema = z
  .object({
    type: z.literal('input_image'),
    artifactId: z.string().trim().min(1).max(200).optional(),
    detail: z.enum(['auto', 'high', 'low', 'original']).optional(),
    fileId: z.string().trim().min(1).max(200).optional(),
    fileName: z.string().trim().min(1).max(255).optional(),
    imageUrl: z.string().trim().min(1).max(500_000).optional(),
    mimeType: z.string().trim().min(1).max(255).optional(),
  })
  .superRefine((value, context) => {
    if (!value.artifactId && !value.fileId && !value.imageUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'input_image part must include artifactId, fileId, or imageUrl',
        path: ['artifactId'],
      });
    }
  });

export const streamRequestSchema = modelRequestSchema.omit({ model: true }).extend({
  agentId: z.string().trim().min(1).max(120).optional(),
  displayMessage: z.string().min(1).max(32768).optional(),
  dialogueMode: z.enum(['clarify', 'coding', 'programmer']).optional(),
  inputParts: z
    .preprocess((value) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value;
        }
      }
      return value;
    }, z.array(inputImagePartSchema))
    .optional(),
  message: z.string().max(32768),
  model: z.string().min(1).max(200).optional(),
  providerId: z.string().min(1).max(200).optional(),
  clientRequestId: z.string().min(1).max(128),
  thinkingEnabled: z
    .preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (value === '1' || value === 'true') return true;
      if (value === '0' || value === 'false') return false;
      return value;
    }, z.boolean())
    .optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  webSearchEnabled: z
    .preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (value === '1' || value === 'true') return true;
      if (value === '0' || value === 'false') return false;
      return value;
    }, z.boolean())
    .optional(),
  upstreamRetryMaxRetries: z
    .preprocess((value) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : value;
      }

      return value;
    }, upstreamRetryMaxRetriesSchema)
    .optional(),
  yoloMode: z
    .preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (value === '1' || value === 'true') return true;
      if (value === '0' || value === 'false') return false;
      return value;
    }, z.boolean())
    .optional(),
});

export const stopStreamSchema = z.object({
  clientRequestId: z.string().min(1).max(128),
});

export type StreamRequest = z.infer<typeof streamRequestSchema>;

export function buildStreamUserContent(input: {
  inputParts?: InputImageContent[];
  message: string;
}): MessageContent[] {
  return [
    ...(input.message.trim().length > 0
      ? [{ type: 'text', text: input.message } satisfies MessageContent]
      : []),
    ...((input.inputParts ?? []).map((part) => ({
      type: 'input_image' as const,
      ...(part.artifactId ? { artifactId: part.artifactId } : {}),
      ...(part.detail ? { detail: part.detail } : {}),
      ...(part.fileId ? { fileId: part.fileId } : {}),
      ...(part.fileName ? { fileName: part.fileName } : {}),
      ...(part.imageUrl ? { imageUrl: part.imageUrl } : {}),
      ...(part.mimeType ? { mimeType: part.mimeType } : {}),
    })) as InputImageContent[]),
  ];
}

export function resolveStreamRequestUpstreamRetry(input: {
  metadataJson: string;
  requestData: StreamRequest;
  userId: string;
}): StreamRequest {
  const requestRetry = input.requestData.upstreamRetryMaxRetries;
  if (requestRetry !== undefined) {
    return input.requestData;
  }

  const metadata = parseSessionMetadataJson(input.metadataJson);
  const metadataRetry = metadata[UPSTREAM_RETRY_MAX_RETRIES_KEY];
  if (typeof metadataRetry === 'number') {
    return {
      ...input.requestData,
      upstreamRetryMaxRetries: metadataRetry,
    };
  }

  const row = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [input.userId, UPSTREAM_RETRY_SETTINGS_KEY],
  );
  const settings = readUpstreamRetrySettings(parseStoredJson(row?.value));

  return {
    ...input.requestData,
    upstreamRetryMaxRetries: settings.maxRetries ?? DEFAULT_UPSTREAM_RETRY_MAX_RETRIES,
  };
}

export interface ApprovedPermissionResumePayload {
  clientRequestId: string;
  nextRound: number;
  requestData: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
  rawInput: Record<string, unknown>;
  observability?: ToolCallObservabilityAnnotation;
}

export function buildStreamToolObservability(input: {
  metadataJson: string;
  presentedToolName: string;
}): ToolCallObservabilityAnnotation {
  try {
    JSON.parse(input.metadataJson) as Record<string, unknown>;
  } catch {
    // Ignore malformed metadata and fall back to canonical observability only.
  }

  return {
    presentedToolName: input.presentedToolName,
    canonicalToolName: resolveCanonicalName(input.presentedToolName),
    adapterVersion: '1.0.0',
  };
}

export interface SessionStreamContext {
  metadataJson: string;
  roleLayer?: string | null;
}

interface SessionUserRow {
  email: string;
}

interface SessionProviderSelection {
  delegatedSystemPrompt?: string;
  modelId?: string;
  providerId?: string;
  variant?: string;
  systemPrompt?: string;
}

interface StreamInteractionModes {
  dialogueMode?: DialogueMode;
  yoloMode: boolean;
}

type StreamAgentDowngradeReason = 'agent_disabled' | 'agent_model_unavailable' | 'agent_not_found';

interface StreamAgentSelection {
  deferToolLoading?: boolean;
  downgradeReason?: StreamAgentDowngradeReason;
  effectiveAgentId?: string;
  modelId?: string;
  providerId?: string;
  requestedAgentId?: string;
  systemPrompt?: string;
  variant?: string;
}

type ResolvedStreamModelRoute = ModelRouteConfig & StreamAgentSelection;

interface StreamAccumulationState {
  toolCalls: Map<string, { toolName: string; inputText: string }>;
}

export interface TaskRuntimeGuardContext {
  lastToolSignature: string | null;
  maxConsecutiveRepeatedToolCalls: number;
  repeatedToolSignatureCount: number;
}

export function createTaskRuntimeGuardContext(
  metadataJson: string,
): TaskRuntimeGuardContext | null {
  void metadataJson;
  return null;
}

export function recordTaskToolCallOrThrow(
  guardContext: TaskRuntimeGuardContext | null | undefined,
  toolName: string,
  inputText: string,
): void {
  if (!guardContext) {
    return;
  }

  const normalizedSignature = `${toolName}:${inputText.trim()}`;
  if (guardContext.lastToolSignature === normalizedSignature) {
    guardContext.repeatedToolSignatureCount += 1;
  } else {
    guardContext.lastToolSignature = normalizedSignature;
    guardContext.repeatedToolSignatureCount = 1;
  }

  if (guardContext.repeatedToolSignatureCount > guardContext.maxConsecutiveRepeatedToolCalls) {
    throw new Error(
      `子代理连续重复调用同一工具已达到上限（${guardContext.maxConsecutiveRepeatedToolCalls}）。`,
    );
  }
}

/**
 * Determine whether the given model string should use `apply_patch` (the
 * OpenAI v1 Responses-API patch tool) instead of the generic
 * `edit / multi_edit / write` triplet for code mutations.
 *
 * Mirrors opencode's `tool/registry.ts` filter logic
 * (@/temp/opencode/packages/opencode/src/tool/registry.ts:309-312):
 *
 * ```ts
 * const usePatch =
 *   input.modelID.includes("gpt-") &&
 *   !input.modelID.includes("oss") &&
 *   !input.modelID.includes("gpt-4")
 * ```
 *
 * Rationale: GPT-5 generation models are trained to emit unified-diff
 * patches via `apply_patch` and degrade noticeably when handed
 * `edit/write`. GPT-4 / open-source forks (`*oss*`) still expect
 * `edit/write`. Anthropic and other providers always use `edit/write`
 * here because they have their own tool-call shape and don't ship
 * `apply_patch` training data.
 *
 * Returns:
 * - `true`  → emit `apply_patch`, hide `edit/multi_edit/write`
 * - `false` → emit `edit/multi_edit/write`, hide `apply_patch`
 * - `null`  → "I don't know" (model id missing) — caller should fall
 *             back to the legacy expose-everything surface so that
 *             dev fixtures / tests / callers that haven't plumbed the
 *             model selection in keep working unchanged.
 */
export function shouldUseApplyPatch(modelId: string | undefined): boolean | null {
  if (typeof modelId !== 'string' || modelId.length === 0) return null;
  const lower = modelId.toLowerCase();
  return lower.includes('gpt-') && !lower.includes('oss') && !lower.includes('gpt-4');
}

const MODEL_AWARE_TOOL_FILTER_DISABLED =
  globalThis.process?.env?.['OPENAWORK_DISABLE_MODEL_AWARE_TOOL_FILTER'] === '1';

export function getEnabledTools(
  webSearchEnabled: boolean,
  ctx: {
    effectiveSkills?: EffectiveSkill[];
    modelId?: string;
  } = {},
) {
  // When the operator opts out we fall back to the pre-PR-A behaviour:
  // every model sees both `apply_patch` and `edit/write`, leaving tool
  // selection up to the model. This is the escape hatch for sites that
  // depend on a homogeneous tool surface across providers — set
  // `OPENAWORK_DISABLE_MODEL_AWARE_TOOL_FILTER=1` to enable.
  const usePatch = MODEL_AWARE_TOOL_FILTER_DISABLED ? null : shouldUseApplyPatch(ctx.modelId);

  return buildGatewayToolDefinitions(ctx).filter((tool) => {
    const name = tool.function.name;
    if (name === 'websearch' || name === 'webfetch') {
      return webSearchEnabled;
    }
    // Three-state: null means "no model-aware decision available" →
    // legacy expose-everything; true/false drive the patch-vs-edit
    // mutual exclusion.
    if (usePatch === null) return true;
    if (name === 'apply_patch') return usePatch;
    if (name === 'edit' || name === 'multi_edit' || name === 'write') {
      return !usePatch;
    }
    return true;
  });
}

function createAbortError(): Error {
  const error = new Error('Stream cancelled');
  error.name = 'AbortError';
  return error;
}

export function createRunEventMeta(runId: string, sequence: { value: number }) {
  const eventId = `${runId}:evt:${sequence.value}`;
  sequence.value += 1;
  return {
    eventId,
    runId,
    occurredAt: Date.now(),
  };
}

function buildMissingToolArgumentsMessage(toolName: string, workingDirectory?: string): string {
  const examplePath = workingDirectory ?? '/absolute/workspace/path';

  if (toolName === 'list') {
    return `Tool "list" was called without arguments. Retry with JSON like {"path":"${examplePath}","depth":2}.`;
  }

  if (toolName === 'bash') {
    return `Tool "bash" was called without arguments. Retry with JSON like {"command":"pwd","workdir":"${examplePath}"}.`;
  }

  return `Tool "${toolName}" was called without arguments. Retry with a non-empty JSON object that matches the tool schema.`;
}

function isMissingRequiredToolArguments(
  toolName: string,
  normalizedInputText: string,
  rawInput: Record<string, unknown>,
): boolean {
  if (normalizedInputText.length === 0) {
    return true;
  }

  if (toolName !== 'list' && toolName !== 'bash') {
    return false;
  }

  return Object.keys(rawInput).length === 0;
}

export function replayPersistedAssistantResponse(input: {
  clientRequestId: string;
  runId: string;
  sessionId: string;
  userId: string;
  writeChunk: (chunk: RunEvent) => void;
}): boolean {
  const durableEvents = listSessionRunEventsByRequest({
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
  });
  if (durableEvents.length > 0) {
    const latestBookend = deriveRunEventBookend(durableEvents.at(-1)!);
    if (latestBookend?.kind === 'run_failed') {
      return false;
    }

    if (latestBookend?.replayable === true) {
      durableEvents.forEach((event) => {
        input.writeChunk(event);
      });
      return true;
    }

    if (latestBookend?.replayable === false) {
      return false;
    }
  }

  const stored = getSessionMessageByRequestId({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    role: 'assistant',
  });
  if (!stored) return false;

  const scopedMessages = listSessionMessagesByRequestScope({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
  });
  const toolNames = new Map<string, string>();
  const replayedToolResultIds = new Set<string>();
  scopedMessages.forEach((message) => {
    message.content.forEach((content) => {
      if (content.type === 'tool_call') {
        toolNames.set(content.toolCallId, content.toolName);
      }
    });
  });
  let sequence = 1;
  scopedMessages.forEach((message) => {
    message.content.forEach((content) => {
      const meta = {
        eventId: `${input.runId}:replay:${sequence++}`,
        runId: input.runId,
        occurredAt: Date.now(),
      };

      if (message.role === 'assistant' && content.type === 'text' && content.text.length > 0) {
        input.writeChunk({ type: 'text_delta', delta: content.text, ...meta });
        return;
      }

      if (message.role === 'assistant' && content.type === 'tool_call') {
        input.writeChunk({
          type: 'tool_call_delta',
          toolCallId: content.toolCallId,
          toolName: content.toolName,
          inputDelta: normalizeToolArgumentsForStorage(content.rawArguments ?? content.input),
          ...meta,
        });
        return;
      }

      if (content.type === 'tool_result' && !replayedToolResultIds.has(content.toolCallId)) {
        replayedToolResultIds.add(content.toolCallId);
        input.writeChunk(
          buildToolResultRunEvent({
            toolCallId: content.toolCallId,
            toolName: content.toolName ?? toolNames.get(content.toolCallId) ?? 'tool',
            clientRequestId: content.clientRequestId ?? input.clientRequestId,
            output: content.output,
            isError: content.isError,
            fileDiffs: content.fileDiffs,
            pendingPermissionRequestId: content.pendingPermissionRequestId,
            observability: content.observability,
            ...(content.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
            eventMeta: meta,
          }),
        );
      }
    });
  });

  if (stored.status === 'error') {
    return false;
  }

  input.writeChunk({
    type: 'done',
    stopReason: 'end_turn',
    eventId: `${input.runId}:replay:${sequence}`,
    runId: input.runId,
    occurredAt: Date.now(),
  });
  return true;
}

function clearRetryableFailedRequestArtifacts(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): void {
  const durableEvents = listSessionRunEventsByRequest({
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
  });
  const latestEvent = durableEvents.at(-1);
  const latestBookend = latestEvent ? deriveRunEventBookend(latestEvent) : undefined;
  const stored = getSessionMessageByRequestId({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    role: 'assistant',
  });

  const shouldClearRunEvents = latestBookend?.kind === 'run_failed';
  const shouldAllowRetry = shouldClearRunEvents || stored?.status === 'error';
  if (!shouldAllowRetry) {
    return;
  }

  if (shouldClearRunEvents) {
    deleteSessionRunEventsByRequest({
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId,
    });
  }

  deleteSessionMessagesByRequestScope({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    roles: ['assistant', 'tool'],
  });
}

function parseToolInput(raw: string): Record<string, unknown> {
  const normalized = raw.trim();
  if (normalized.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { raw: normalized };
  }

  return { raw: normalized };
}

function buildErrorContent(code: string, message: string): MessageContent[] {
  return [{ type: 'text', text: `[错误: ${code}] ${message}`.trim() }];
}

export function loadSessionContext(sessionId: string, userId: string): SessionStreamContext | null {
  const session = sqliteGet<{ metadata_json: string; role_layer: string | null }>(
    'SELECT metadata_json, role_layer FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  if (!session) return null;
  return {
    metadataJson: sanitizeSessionMetadataJson(session.metadata_json),
    roleLayer: session.role_layer,
  };
}

export function loadSessionUser(sessionId: string, userId: string): JwtPayload | null {
  const user = sqliteGet<SessionUserRow>(
    `SELECT u.email
     FROM users u
     JOIN sessions s ON s.user_id = u.id
     WHERE s.id = ? AND u.id = ?
     LIMIT 1`,
    [sessionId, userId],
  );

  if (!user) {
    return null;
  }

  return {
    sub: userId,
    email: user.email,
  };
}

function parseSessionProviderSelection(metadataJson: string): SessionProviderSelection {
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    const channel = parsed['channel'];
    const channelRecord =
      typeof channel === 'object' && channel !== null ? (channel as Record<string, unknown>) : null;
    return {
      providerId:
        typeof parsed['providerId'] === 'string'
          ? parsed['providerId']
          : typeof channelRecord?.['providerId'] === 'string'
            ? channelRecord['providerId']
            : undefined,
      modelId:
        typeof parsed['modelId'] === 'string'
          ? parsed['modelId']
          : typeof channelRecord?.['model'] === 'string'
            ? channelRecord['model']
            : undefined,
      variant:
        typeof parsed['variant'] === 'string'
          ? parsed['variant']
          : typeof channelRecord?.['variant'] === 'string'
            ? channelRecord['variant']
            : undefined,
      delegatedSystemPrompt:
        typeof parsed['delegatedSystemPrompt'] === 'string'
          ? parsed['delegatedSystemPrompt']
          : undefined,
      systemPrompt: typeof parsed['systemPrompt'] === 'string' ? parsed['systemPrompt'] : undefined,
    };
  } catch {
    return {};
  }
}

function parseStoredJson<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function normalizeRequestedAgentId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeManagedAgentIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function findManagedStreamAgent(
  agents: ManagedAgentRecord[],
  requestedAgentId: string,
): ManagedAgentRecord | undefined {
  const normalizedRequestedAgentId = normalizeManagedAgentIdentifier(requestedAgentId);
  return agents.find((agent) => {
    if (normalizeManagedAgentIdentifier(agent.id) === normalizedRequestedAgentId) {
      return true;
    }

    if (normalizeManagedAgentIdentifier(agent.label) === normalizedRequestedAgentId) {
      return true;
    }

    return agent.aliases.some(
      (alias) => normalizeManagedAgentIdentifier(alias) === normalizedRequestedAgentId,
    );
  });
}

function normalizeAgentModelCandidate(modelId: string): string {
  const normalized = modelId.trim();
  return normalized.includes('/') ? (normalized.split('/').at(-1) ?? normalized) : normalized;
}

function getManagedAgentModelCandidates(agent: ManagedAgentRecord): string[] {
  return Array.from(
    new Set(
      [agent.model, ...(agent.fallbackModels ?? [])]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => normalizeAgentModelCandidate(value)),
    ),
  );
}

function resolveStreamAgentSelection(input: {
  requestedAgentId: string | undefined;
  userId: string;
}): StreamAgentSelection {
  const requestedAgentId = normalizeRequestedAgentId(input.requestedAgentId);
  if (!requestedAgentId) {
    return {};
  }

  const agents = listManagedAgentsForUser(input.userId);
  const matchedAgent = findManagedStreamAgent(agents, requestedAgentId);
  if (!matchedAgent) {
    return {
      downgradeReason: 'agent_not_found',
      requestedAgentId,
    };
  }

  if (!matchedAgent.enabled) {
    return {
      downgradeReason: 'agent_disabled',
      requestedAgentId,
    };
  }

  const modelCandidates = getManagedAgentModelCandidates(matchedAgent);
  const delegatedModel =
    modelCandidates.length > 0
      ? selectDelegatedModelForUser(input.userId, modelCandidates)
      : undefined;

  return {
    ...(modelCandidates.length > 0 && !delegatedModel?.providerId
      ? { downgradeReason: 'agent_model_unavailable' as const }
      : {}),
    deferToolLoading: matchedAgent.deferToolLoading === true ? true : undefined,
    effectiveAgentId: matchedAgent.id,
    modelId: delegatedModel?.modelId,
    providerId: delegatedModel?.providerId,
    requestedAgentId,
    systemPrompt: matchedAgent.systemPrompt,
    variant: delegatedModel?.variant ?? matchedAgent.variant,
  };
}

function normalizeRequestedModelId(modelId: string | undefined): string | undefined {
  if (!modelId || modelId === 'default') {
    return undefined;
  }

  return modelId;
}

function isDialogueMode(value: unknown): value is DialogueMode {
  return value === 'clarify' || value === 'coding' || value === 'programmer';
}

function resolveStreamInteractionModes(input: {
  metadataJson: string;
  requestData: StreamRequest;
}): StreamInteractionModes {
  const metadata = parseSessionMetadataJson(input.metadataJson);
  const metadataDialogueMode = isDialogueMode(metadata['dialogueMode'])
    ? metadata['dialogueMode']
    : undefined;

  return {
    dialogueMode: input.requestData.dialogueMode ?? metadataDialogueMode,
    yoloMode: input.requestData.yoloMode ?? metadata['yoloMode'] === true,
  };
}

export async function resolveStreamModelRoute(input: {
  metadataJson: string;
  requestData: StreamRequest;
  userId: string;
}): Promise<ResolvedStreamModelRoute> {
  const sessionSelection = parseSessionProviderSelection(input.metadataJson);
  const agentSelection = resolveStreamAgentSelection({
    requestedAgentId: input.requestData.agentId,
    userId: input.userId,
  });
  const requestedModelId = normalizeRequestedModelId(input.requestData.model);
  const resolvedRequestData: StreamRequest = {
    ...input.requestData,
    model:
      requestedModelId ??
      agentSelection.modelId ??
      sessionSelection.modelId ??
      input.requestData.model,
    providerId:
      input.requestData.providerId ?? agentSelection.providerId ?? sessionSelection.providerId,
    variant: input.requestData.variant ?? agentSelection.variant ?? sessionSelection.variant,
    systemPrompt:
      sessionSelection.delegatedSystemPrompt ??
      input.requestData.systemPrompt ??
      agentSelection.systemPrompt ??
      sessionSelection.systemPrompt,
  };
  const providerConfig = await getProviderForSelection(input.userId, {
    providerId: resolvedRequestData.providerId,
    modelId: resolvedRequestData.model,
  });

  if (providerConfig) {
    return {
      ...agentSelection,
      ...resolveModelRouteFromProvider(
        providerConfig.provider,
        providerConfig.modelId,
        resolvedRequestData,
      ),
    };
  }

  return {
    ...agentSelection,
    ...resolveModelRoute({
      ...resolvedRequestData,
      model: resolvedRequestData.model ?? 'default',
    }),
  };
}

export function createToolResultRequestId(clientRequestId: string, toolCallId: string): string {
  return `${clientRequestId}:tool:${toolCallId}`;
}

// ---------------------------------------------------------------------------
// Agent usage reminder (oh-my-opencode agentUsageReminder pattern)
// ---------------------------------------------------------------------------

const SEARCH_READ_TOOLS = new Set([
  'grep',
  'glob',
  'read',
  'list',
  'websearch',
  'web_fetch',
  'webfetch',
  'codesearch',
  'codebase_search',
  'ast_grep_search',
  'ast-grep-search',
]);

const AGENT_DELEGATION_TOOLS = new Set(['task_create', 'task', 'call_omo_agent', 'delegate_task']);

const ORCHESTRATOR_AGENT_IDS = new Set(['sisyphus', 'atlas', 'zeus']);

const AGENT_USAGE_REMINDER_SUFFIX = `

[Agent Usage Reminder]
You called a search/read tool directly. For complex multi-file exploration, consider using the task tool to delegate work:
- task_create: Create a sub-agent task for parallel exploration
- Multiple parallel tasks can run simultaneously while you continue working
- Sub-agents can perform deeper, more thorough searches
ALWAYS prefer: Multiple parallel task_create calls > Direct search tool calls`;

export async function executeToolCalls(input: {
  agentId?: string;
  clientRequestId: string;
  executionContext?: SandboxExecutionContext;
  enabledToolNames: Set<string>;
  eventSequence: { value: number };
  runId: string;
  signal: AbortSignal;
  sessionContext: SessionStreamContext;
  sessionId: string;
  state: StreamAccumulationState;
  taskRuntimeGuardContext?: TaskRuntimeGuardContext | null;
  turnFileDiffs?: Map<string, FileDiffContent>;
  userId: string;
  writeChunk: (chunk: RunEvent) => void;
  workspaceRoot?: string;
}): Promise<{ hasPendingPermission: boolean }> {
  const sandbox = createDefaultSandbox([], { userId: input.userId });
  const sessionMetadata = parseSessionMetadataJson(input.sessionContext.metadataJson);
  const workingDirectory =
    typeof sessionMetadata['workingDirectory'] === 'string'
      ? sessionMetadata['workingDirectory']
      : undefined;

  // Dynamic tool loading: scan workspace {tool,tools}/*.{js,ts} for custom tools
  const effectiveWorkspaceRoot = input.workspaceRoot ?? workingDirectory;
  if (effectiveWorkspaceRoot) {
    try {
      const dynamicTools = await loadDynamicToolsForWorkspace(
        effectiveWorkspaceRoot,
        input.sessionId,
      );
      if (dynamicTools.length > 0) {
        sandbox.registerDynamicTools(dynamicTools);
        for (const dt of dynamicTools) {
          input.enabledToolNames.add(dt.name);
        }
      }
    } catch (err) {
      console.warn(
        `[stream] Failed to load dynamic tools for ${effectiveWorkspaceRoot}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let hasPendingPermission = false;

  // Agent usage reminder state (oh-my-opencode agentUsageReminder pattern)
  // Track whether task/delegation tools have been used in this turn's tool call batch.
  // NOTE: this is turn-scoped (resets per executeToolCalls call), not session-scoped.
  let taskToolUsedInTurn = false;
  let agentUsageReminderCount = 0;
  const MAX_AGENT_USAGE_REMINDERS = 3;

  for (const [toolCallId, toolCall] of input.state.toolCalls.entries()) {
    if (input.signal.aborted) {
      throw createAbortError();
    }

    const normalizedInputText = toolCall.inputText.trim();
    recordTaskToolCallOrThrow(
      input.taskRuntimeGuardContext,
      toolCall.toolName,
      normalizedInputText,
    );
    const parsedInput = parseToolInput(toolCall.inputText);
    const request = {
      toolCallId,
      toolName: toolCall.toolName,
      rawInput: parsedInput,
    };

    // Prometheus MD-only guard (oh-my-opencode prometheus-md-only pattern):
    // Block Prometheus from writing outside .sisyphus/*.md, inject read-only
    // warning on task delegation, and workflow reminder on plan writes.
    const currentAgentId = input.agentId ?? '';
    const workspaceRoot = input.workspaceRoot ?? workingDirectory ?? process.cwd();
    const prometheusGuard = checkPrometheusToolGuard({
      agentId: currentAgentId,
      toolName: toolCall.toolName,
      filePath: (parsedInput['filePath'] ??
        parsedInput['path'] ??
        parsedInput['file'] ??
        '') as string,
      prompt: (parsedInput['prompt'] ?? '') as string,
      workspaceRoot,
    });
    if (!prometheusGuard.blocked) {
      // Only inject prompt modifications when the tool call will actually execute
      if (prometheusGuard.injectConsultWarning && typeof parsedInput['prompt'] === 'string') {
        parsedInput['prompt'] = PLANNING_CONSULT_WARNING + parsedInput['prompt'];
      }

      // Atlas guard (oh-my-opencode atlas pattern):
      // Orchestrator agents must delegate, not implement directly.
      const atlasGuard = checkAtlasGuard({
        agentId: currentAgentId,
        toolName: toolCall.toolName,
        filePath: (parsedInput['filePath'] ??
          parsedInput['path'] ??
          parsedInput['file'] ??
          '') as string,
        prompt: (parsedInput['prompt'] ?? '') as string,
      });

      // Inject single-task directive for delegate_task from orchestrators
      if (atlasGuard.injectSingleTaskDirective && typeof parsedInput['prompt'] === 'string') {
        parsedInput['prompt'] = SINGLE_TASK_DIRECTIVE + parsedInput['prompt'];
      }

      // Inject delegation-required warning for write/edit outside .sisyphus/ by orchestrators
      if (atlasGuard.injectDelegationWarning && atlasGuard.delegationWarningFilePath) {
        // This is a soft warning (not a block) — the tool still executes but a reminder is appended post-execution
      }

      // Sisyphus Junior notepad directive (oh-my-opencode sisyphus-junior-notepad pattern):
      // When orchestrator delegates tasks, inject notepad location and plan read-only directive.
      if (
        (toolCall.toolName === 'task' || toolCall.toolName === 'delegate_task') &&
        typeof parsedInput['prompt'] === 'string' &&
        shouldInjectNotepadDirective(currentAgentId, parsedInput['prompt'])
      ) {
        parsedInput['prompt'] = NOTEPAD_DIRECTIVE + parsedInput['prompt'];
      }

      // Non-interactive env (oh-my-opencode non-interactive-env pattern):
      // Prepend env vars to git commands in non-interactive environments.
      if (
        toolCall.toolName.toLowerCase() === 'bash' &&
        typeof parsedInput['command'] === 'string'
      ) {
        const niCheck = checkNonInteractiveBash(parsedInput['command']);
        if (niCheck.modifiedCommand) {
          parsedInput['command'] = niCheck.modifiedCommand;
        }
      }
    }

    // Doom loop detection (mirrors opencode processor.ts):
    // If the same tool is called with the same arguments N consecutive times,
    // emit a synthetic error result to break the loop and warn the LLM.
    //
    // We only record an entry into the loop history once we've confirmed
    // the call would otherwise dispatch normally — schema validation
    // failures, missing-arg short-circuits and Prometheus blocks are
    // *not* recorded. Recording them would inflate the counter on
    // recoverable mistakes (e.g. a model that forgets `description`
    // for `bash` three times in a row would get flagged as a doom loop
    // even though each retry is a different attempt to fix the schema).
    const willDispatch =
      !prometheusGuard.blocked &&
      !isMissingRequiredToolArguments(toolCall.toolName, normalizedInputText, parsedInput) &&
      isEnabledToolName(toolCall.toolName, input.enabledToolNames);
    const isDoomLoop =
      willDispatch && peekDoomLoop(input.sessionId, toolCall.toolName, parsedInput);
    if (willDispatch && !isDoomLoop) {
      recordDoomLoopEntry(input.sessionId, toolCall.toolName, parsedInput);
    }

    const result = isDoomLoop
      ? {
          toolCallId,
          toolName: toolCall.toolName,
          output: `⚠️ Doom loop detected: Tool "${toolCall.toolName}" has been called with identical arguments 3 consecutive times. You may be stuck in a loop. Please try a different approach or different arguments.`,
          isError: true,
          durationMs: 0,
        }
      : prometheusGuard.blocked
        ? {
            toolCallId,
            toolName: toolCall.toolName,
            output: prometheusGuard.blockMessage ?? 'Operation blocked by Prometheus guard.',
            isError: true,
            durationMs: 0,
          }
        : isMissingRequiredToolArguments(toolCall.toolName, normalizedInputText, parsedInput)
          ? {
              toolCallId,
              toolName: toolCall.toolName,
              output: buildMissingToolArgumentsMessage(toolCall.toolName, workingDirectory),
              isError: true,
              durationMs: 0,
            }
          : isEnabledToolName(toolCall.toolName, input.enabledToolNames)
            ? await sandbox.execute(request, input.signal, input.sessionId, {
                ...input.executionContext,
                onBatchProgress: (subTools, completedCount, totalCount) => {
                  input.writeChunk({
                    type: 'tool_progress',
                    toolCallId,
                    toolName: toolCall.toolName,
                    subTools,
                    completedCount,
                    totalCount,
                    clientRequestId: input.clientRequestId,
                    occurredAt: Date.now(),
                  });
                },
              })
            : {
                toolCallId,
                toolName: toolCall.toolName,
                output: `Tool "${toolCall.toolName}" is not enabled for this request`,
                isError: true,
                durationMs: 0,
              };

    // Agent usage reminder (oh-my-opencode agentUsageReminder pattern):
    // When search/read tools are called directly without using task delegation,
    // append a reminder to encourage using task tools for better results.
    const toolLower = toolCall.toolName.toLowerCase();
    if (AGENT_DELEGATION_TOOLS.has(toolLower)) {
      taskToolUsedInTurn = true;
    } else if (
      !result.isError &&
      !taskToolUsedInTurn &&
      agentUsageReminderCount < MAX_AGENT_USAGE_REMINDERS &&
      SEARCH_READ_TOOLS.has(toolLower) &&
      !(typeof result.output === 'string' && /no files? found/i.test(result.output.trim()))
    ) {
      if (typeof result.output === 'string') {
        result.output += AGENT_USAGE_REMINDER_SUFFIX;
      } else if (result.output && typeof result.output === 'object') {
        try {
          const obj = result.output as Record<string, unknown>;
          if (typeof obj['output'] === 'string') {
            obj['output'] += AGENT_USAGE_REMINDER_SUFFIX;
          }
        } catch {
          /* non-string output, skip */
        }
      }
      agentUsageReminderCount++;
    }

    // Delegate task retry (oh-my-opencode delegate-task-retry pattern):
    // When task/delegate_task returns an error, detect the pattern and append
    // retry guidance so the LLM can self-correct on the next turn.
    if (
      typeof result.output === 'string' &&
      (toolCall.toolName === 'task' || toolCall.toolName === 'delegate_task')
    ) {
      const delegateError = detectDelegateTaskError(result.output);
      if (delegateError) {
        result.output += buildRetryGuidance(delegateError);
      }
    }

    // Atlas guard post-processing (oh-my-opencode atlas pattern):
    // Append verification reminder + boulder progress after delegate_task for orchestrators.
    // Append delegation-required warning after write/edit outside .sisyphus/ for orchestrators.
    if (typeof result.output === 'string' && ORCHESTRATOR_AGENT_IDS.has(currentAgentId)) {
      const atlasReminder = await buildAtlasPostProcessReminder({
        agentId: currentAgentId,
        toolName: toolCall.toolName,
        sessionId: input.sessionId,
        workspaceRoot,
      });
      if (atlasReminder) {
        result.output += atlasReminder;
      }
    }

    // Prometheus workflow reminder (oh-my-opencode prometheus-md-only pattern):
    // When Prometheus writes a plan file, append the mandatory workflow reminder.
    if (prometheusGuard.injectWorkflowReminder) {
      if (typeof result.output === 'string') {
        result.output += PROMETHEUS_WORKFLOW_REMINDER;
      } else if (result.output && typeof result.output === 'object') {
        (result.output as Record<string, unknown>)['_workflowReminder'] =
          PROMETHEUS_WORKFLOW_REMINDER.trim();
      }
    }

    // Empty task response detector (oh-my-opencode empty-task-response-detector pattern):
    // When the task tool returns an empty response, append a warning so the
    // LLM knows the task didn't produce output (rather than assuming success).
    if (typeof result.output === 'string') {
      result.output = detectEmptyTaskResponse(toolCall.toolName, result.output);
    }

    // Task resume info (oh-my-opencode task-resume-info pattern):
    // When task/delegate_task output contains a session ID, append a
    // "to continue" hint so the LLM knows how to resume the task later.
    if (typeof result.output === 'string') {
      result.output = appendTaskResumeInfo(toolCall.toolName, result.output);
    }

    // Comment checker (oh-my-opencode comment-checker pattern):
    // Detect AI-generated comments in write/edit tool output and append warning.
    result.output = checkAiComments(toolCall.toolName, result.output);

    // Non-interactive env (oh-my-opencode non-interactive-env pattern):
    // Warn about banned interactive commands in bash tool output.
    if (typeof result.output === 'string' && toolCall.toolName.toLowerCase() === 'bash') {
      const bashInput = toolCall.inputText ?? '';
      const niCheck = checkNonInteractiveBash(bashInput);
      if (niCheck.hasBannedCommand && niCheck.bannedCommand) {
        result.output += '\n' + buildBannedCommandWarning(niCheck.bannedCommand);
      }
    }

    const observability = buildStreamToolObservability({
      metadataJson: input.sessionContext.metadataJson,
      presentedToolName: toolCall.toolName,
    });

    const tracedFileDiffs = input.turnFileDiffs
      ? traceFileDiffs({
          clientRequestId: input.clientRequestId,
          diffs: collectFileDiffsFromToolOutput(result.output),
          observability,
          requestId: createToolResultRequestId(input.clientRequestId, toolCallId),
          toolCallId,
          toolName: toolCall.toolName,
        })
      : [];

    result.output = truncateToolOutputUniversal(toolCall.toolName, result.output);

    appendSessionMessageV2({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'tool',
      content: [
        buildToolResultContent({
          toolCallId,
          toolName: toolCall.toolName,
          clientRequestId: input.clientRequestId,
          output: result.output,
          isError: result.isError,
          fileDiffs: tracedFileDiffs,
          pendingPermissionRequestId: result.pendingPermissionRequestId,
          observability,
        }),
      ],
      clientRequestId: createToolResultRequestId(input.clientRequestId, toolCallId),
      replaceExisting: true,
    });

    if (input.turnFileDiffs) {
      mergeFileDiffs(input.turnFileDiffs, tracedFileDiffs);
      if (tracedFileDiffs.length > 0) {
        await persistSessionFileDiffs({
          sessionId: input.sessionId,
          userId: input.userId,
          clientRequestId: input.clientRequestId,
          requestId: createToolResultRequestId(input.clientRequestId, toolCallId),
          toolName: toolCall.toolName,
          toolCallId,
          observability,
          diffs: tracedFileDiffs,
        });
      }
    }

    input.writeChunk(
      buildToolResultRunEvent({
        toolCallId,
        toolName: toolCall.toolName,
        clientRequestId: input.clientRequestId,
        output: result.output,
        isError: result.isError,
        fileDiffs: tracedFileDiffs,
        pendingPermissionRequestId: result.pendingPermissionRequestId,
        observability,
        eventMeta: createRunEventMeta(input.runId, input.eventSequence),
      }),
    );

    // ─── Team tabs data: tool call event ─────────────────────────────
    if (input.sessionContext.roleLayer) {
      const { publishTeamToolCallEvent } = await import('./stream-team-events.js');
      publishTeamToolCallEvent({
        userId: input.userId,
        sessionId: input.sessionId,
        sessionContext: input.sessionContext,
        toolName: toolCall.toolName,
        durationMs: result.durationMs ?? 0,
        success: !result.isError,
        errorMessage:
          result.isError && typeof result.output === 'string'
            ? result.output.slice(0, 200)
            : undefined,
      });
    }

    if (result.pendingPermissionRequestId) {
      console.log(
        '[PERMISSION_PAUSE] pending permission detected for tool',
        toolCall.toolName,
        'requestId=',
        result.pendingPermissionRequestId,
        'breaking tool call loop',
      );
      hasPendingPermission = true;
      break;
    }
  }

  return { hasPendingPermission };
}

export function createStreamExecutionContext(
  clientRequestId: string,
  nextRound: number,
  requestData: StreamRequest,
  userId?: string,
): SandboxExecutionContext {
  return {
    clientRequestId,
    nextRound,
    requestData,
    ...(userId ? { userId } : {}),
  };
}

export { runModelRound } from './stream-model-round.js';

export async function handleStreamRequest(input: {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  method: string;
  onStarted?: () => void;
  path: string;
  requestData: StreamRequest;
  sessionContext: SessionStreamContext;
  sessionId: string;
  /**
   * Optional external abort signal. When the caller's transport (e.g. an SSE
   * connection) drops, aborting this signal will propagate to the internal
   * abortController and cancel the in-flight model run. This prevents the
   * in-flight slot from being held forever when the client disconnects, which
   * otherwise causes EventSource auto-reconnects to deadlock waiting for the
   * stale execution to finish.
   */
  signal?: AbortSignal;
  transport: 'SSE' | 'WS';
  user: JwtPayload;
  writeChunk: (chunk: RunEvent) => void;
}): Promise<HandleStreamResult> {
  const requestData = resolveStreamRequestUpstreamRetry({
    metadataJson: input.sessionContext.metadataJson,
    requestData: input.requestData,
    userId: input.user.sub,
  });
  const runId = randomUUID();
  const wl = new WorkflowLogger();
  const ctx = createRequestContext(input.method, input.path, input.headers, input.ip);
  if (!isTaskParentAutoResumeClientRequestId(requestData.clientRequestId)) {
    noteManualSessionInteraction({ sessionId: input.sessionId, userId: input.user.sub });
  }
  const stepRoute = wl.start('stream.model-resolve');
  let route: ResolvedStreamModelRoute;
  try {
    route = await resolveStreamModelRoute({
      metadataJson: input.sessionContext.metadataJson,
      requestData,
      userId: input.user.sub,
    });
    wl.succeed(stepRoute, undefined, {
      downgradeReason: route.downgradeReason ?? 'none',
      effectiveAgentId: route.effectiveAgentId ?? 'none',
      model: route.model,
      requestedAgentId: route.requestedAgentId ?? 'none',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    wl.fail(stepRoute, message);
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'route',
      sourceName: 'MODEL_RESOLVE',
      requestId: requestData.clientRequestId,
      input: { agentId: requestData.agentId },
      output: { message, code: 'MODEL_RESOLVE' },
    });
    wl.flush(ctx, 500);
    throw error;
  }

  // PR-D-Plugin: notify `chat.message` plugins that a new user
  // message is being processed. This is the earliest point at which
  // we know both the resolved model and the user's message text;
  // matches opencode's `chat.message` hook
  // (`@/temp/opencode/packages/plugin/src/index.ts:115-130`).
  //
  // The output object is currently advisory — plugins read but should
  // not rely on mutations being honoured. (Future revisions may let
  // plugins rewrite `parts` to inject system context; this MVP keeps
  // the contract narrow because the surrounding stream pipeline
  // doesn't re-read `requestData.message` after this point.)
  await dispatchChatMessage(
    {
      sessionID: input.sessionId,
      modelId: route.model,
      messageID: requestData.clientRequestId,
    },
    {
      message: { role: 'user', content: requestData.message },
      parts: [],
    },
  );

  const workspaceCtx = await buildWorkspaceContext(input.sessionContext.metadataJson);
  const interactionModes = resolveStreamInteractionModes({
    metadataJson: input.sessionContext.metadataJson,
    requestData,
  });
  const companionPrompt = buildCompanionPrompt(
    loadCompanionSettingsForUser(input.user.sub, input.user.email, requestData.agentId),
    requestData.message,
  );
  const capabilityContext = buildCapabilityContext(input.user.sub, input.sessionId);
  // Dynamic agent prompt (oh-my-opencode dynamic-agent-prompt-builder pattern):
  // For orchestrator agents (sisyphus, atlas, zeus), inject delegation table,
  // tool selection table, key triggers, and agent-specific sections.
  const effectiveAgentId = route.effectiveAgentId ?? requestData.agentId ?? '';
  const dynamicAgentPrompt = ORCHESTRATOR_AGENT_IDS.has(effectiveAgentId)
    ? buildDynamicOrchestratorPrompt()
    : null;
  const detector = new KeywordDetectorImpl();
  const detection = detector.detect(requestData.message);
  const injectedPrompt = detection.injectedPrompt ?? null;

  // Start-work (oh-my-opencode start-work pattern):
  // Detect "ultrawork/ulw" keyword and inject plan context + create boulder state.
  let startWorkContext: string | null = null;
  const sessionMeta = parseSessionMetadataJson(input.sessionContext.metadataJson);
  const workspaceRootForStartWork =
    typeof sessionMeta['workingDirectory'] === 'string'
      ? sessionMeta['workingDirectory']
      : process.cwd();
  if (detectUltraworkKeyword(requestData.message)) {
    startWorkContext = await processStartWork(
      workspaceRootForStartWork,
      input.sessionId,
      requestData.message,
    );
  }

  // Command templates (oh-my-opencode builtin-commands pattern):
  // Detect active command context from session metadata and inject workflow instructions.
  const commandContext = detectActiveCommandContext(input.sessionContext.metadataJson);
  const lspGuidance =
    interactionModes.dialogueMode === 'clarify'
      ? CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT
      : LSP_TOOL_GUIDANCE_SYSTEM_PROMPT;
  const hasExplicitAgent = !!route.effectiveAgentId;
  const dialogueModePrompt =
    !hasExplicitAgent && interactionModes.dialogueMode !== undefined
      ? DIALOGUE_MODE_SYSTEM_PROMPTS[interactionModes.dialogueMode]
      : null;
  const yoloModePrompt = interactionModes.yoloMode === true ? YOLO_MODE_SYSTEM_PROMPT : null;
  const webSearchEnabled =
    requestData.webSearchEnabled ?? isWebSearchEnabled(input.sessionContext.metadataJson);

  clearRetryableFailedRequestArtifacts({
    clientRequestId: requestData.clientRequestId,
    sessionId: input.sessionId,
    userId: input.user.sub,
  });

  if (
    replayPersistedAssistantResponse({
      clientRequestId: requestData.clientRequestId,
      runId,
      sessionId: input.sessionId,
      userId: input.user.sub,
      writeChunk: input.writeChunk,
    })
  ) {
    wl.flush(ctx, 200);
    return { statusCode: 200 };
  }

  const inFlight = getInFlightStreamRequest(input.sessionId, requestData.clientRequestId);
  if (inFlight) {
    await inFlight.execution.catch(() => undefined);
    if (
      replayPersistedAssistantResponse({
        clientRequestId: requestData.clientRequestId,
        runId,
        sessionId: input.sessionId,
        userId: input.user.sub,
        writeChunk: input.writeChunk,
      })
    ) {
      wl.flush(ctx, 200);
      return { statusCode: 200 };
    }

    wl.flush(ctx, 409);
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'route',
      sourceName: 'REPLAY_FAILED',
      requestId: requestData.clientRequestId,
      output: { message: 'Request replay failed', code: 'REQUEST_REPLAY_FAILED' },
    });
    input.writeChunk(
      createStreamErrorChunk('REQUEST_REPLAY_FAILED', 'Request replay failed', runId),
    );
    return { statusCode: 409 };
  }

  if (
    getAnyInFlightStreamRequestForSession({
      excludeClientRequestId: requestData.clientRequestId,
      sessionId: input.sessionId,
      userId: input.user.sub,
    })
  ) {
    wl.flush(ctx, 409);
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'route',
      sourceName: 'SESSION_CONFLICT',
      requestId: requestData.clientRequestId,
      output: {
        message: 'Another request is already running for this session.',
        code: 'SESSION_ALREADY_RUNNING',
      },
    });
    input.writeChunk(
      createStreamErrorChunk(
        'SESSION_ALREADY_RUNNING',
        'Another request is already running for this session.',
        runId,
      ),
    );
    return { statusCode: 409 };
  }

  const abortController = new AbortController();
  if (input.signal) {
    if (input.signal.aborted) {
      abortController.abort();
    } else {
      input.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    }
  }
  const eventSequence = { value: 1 };
  const taskRuntimeGuardContext = createTaskRuntimeGuardContext(input.sessionContext.metadataJson);
  // Tracks events emitted by this stream's own emitChunk so the
  // session-run-events subscription below can skip its own broadcasts
  // (which already wrote to the WS/SSE client directly) without echoing
  // them back as duplicates. WeakSet keeps the bookkeeping garbage-collected
  // automatically once the chunk leaves scope.
  const selfEmittedRunEvents = new WeakSet<object>();
  const emitChunk = (chunk: RunEvent) => {
    selfEmittedRunEvents.add(chunk);
    // publishSessionRunEvent persists + broadcasts to all subscribers,
    // including the /sessions/:id/stream/attach endpoint which forwards
    // events to reconnected clients. Previously this used the persist-only
    // helper, so attach-mode SSE replayed historical events but never
    // received the live ones — clients fell back to polling /recovery.
    publishSessionRunEvent(input.sessionId, chunk, {
      clientRequestId: requestData.clientRequestId,
    });
    input.writeChunk(chunk);
  };
  const execution: Promise<HandleStreamResult> = (async () => {
    let shouldKeepPausedState = false;
    const runtimeThreadStartedAt = Date.now();
    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'running',
      userId: input.user.sub,
    });
    upsertSessionRuntimeThread({
      clientRequestId: requestData.clientRequestId,
      heartbeatAtMs: runtimeThreadStartedAt,
      sessionId: input.sessionId,
      startedAtMs: runtimeThreadStartedAt,
      userId: input.user.sub,
    });
    const runtimeThreadHeartbeat = setInterval(() => {
      touchSessionRuntimeThread({
        clientRequestId: requestData.clientRequestId,
        sessionId: input.sessionId,
        userId: input.user.sub,
      });
    }, SESSION_RUNTIME_THREAD_HEARTBEAT_MS);
    const unsubscribeSessionEvents = subscribeSessionRunEvents(input.sessionId, (event) => {
      // Skip events this stream's emitChunk already wrote — those reach the
      // primary WS/SSE client through input.writeChunk() inside emitChunk and
      // are broadcast on this same channel only so the attach endpoint can
      // mirror them to reconnected clients. Without this guard we'd duplicate
      // every live chunk on the original transport.
      if (selfEmittedRunEvents.has(event)) {
        return;
      }

      if (
        event.type === 'question_asked' ||
        event.type === 'permission_asked' ||
        event.type === 'permission_replied' ||
        event.type === 'question_replied'
      ) {
        const stateUpdate = resolveSessionInteractionStateUpdate(event);
        shouldKeepPausedState = stateUpdate.shouldKeepPausedState;
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: stateUpdate.status,
          userId: input.user.sub,
        });
      }

      if (hasPersistedRunEvent(event)) {
        input.writeChunk(event);
        return;
      }
      emitChunk(event);
    });

    try {
      if (abortController.signal.aborted) {
        throw createAbortError();
      }

      input.onStarted?.();

      // Reset doom loop history at the start of each new user message stream
      resetDoomLoopHistory(input.sessionId);

      // Resolve fast model route for LLM title generation (falls back to chat route)
      const fastProviderConfig = await getFastProvider(input.user.sub);
      const titleRoute = fastProviderConfig
        ? resolveModelRouteFromProvider(fastProviderConfig.provider, fastProviderConfig.modelId, {
            maxTokens: 100,
            temperature: 0.5,
          })
        : undefined;

      // Per-turn thinking-language hint snapshot (CJK detector).
      //
      // We compute it here at write-time rather than in `runModelRound`
      // because the legacy in-memory path always appended the hint to
      // *whichever* user message currently happened to be the latest,
      // which mutated earlier user-turn bytes across rounds and broke
      // upstream Anthropic / OpenAI prompt-cache prefixes (the websearch
      // low-cache-hit root cause). Snapshotting at persist time freezes
      // the hint onto the user message that triggered it, so subsequent
      // rounds reload byte-identical content from the DB.
      const thinkingLanguageHint =
        requestData.thinkingEnabled === true
          ? detectThinkingLanguageHintFromText(requestData.message)
          : null;

      persistStreamUserMessage({
        content: buildStreamUserContent({
          inputParts: requestData.inputParts,
          message: requestData.message,
        }),
        clientRequestId: requestData.clientRequestId,
        displayMessage: requestData.displayMessage,
        message: requestData.message,
        sessionId: input.sessionId,
        userId: input.user.sub,
        route,
        titleRoute,
        // Persist the per-request synthetic block as part of the user
        // message so subsequent turns see byte-identical bytes for it
        // (Anthropic / OpenAI prompt-cache prefix stability — was the
        // root cause of the websearch low-cache-hit bug, mirrors
        // opencode's `insertReminders` → `sessions.updatePart()` flow).
        syntheticContext: {
          injectedPrompt,
          capabilityContext,
          companionPrompt,
          thinkingLanguageHint,
        },
      });

      // Dynamic tool loading: scan workspace {tool,tools}/*.{js,ts} for custom tools
      let dynamicToolDefs: DynamicToolEntry[] = [];
      try {
        dynamicToolDefs = await loadDynamicToolsForWorkspace(
          workspaceRootForStartWork,
          input.sessionId,
        );
      } catch (err) {
        console.warn(
          `[stream] Failed to load dynamic tools: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const effectiveSkills = getEffectiveSkillsFromSessionContext({
        userId: input.user.sub,
        sessionId: input.sessionId,
        metadataJson: input.sessionContext.metadataJson,
      });

      // ── Pinned skills snapshot (PR3) ──
      // Capture the pinned skill ids on the first turn we ever render. Once
      // captured, the snapshot lives on `sessions.metadata.pinnedSkillsSnapshot`
      // and is reused for every subsequent turn — UI changes to pinned only
      // take effect for newly-created sessions, matching the toast contract.
      //
      // Persistence is unconditional (even an empty skillIds list is saved)
      // so that mid-session pinning by the user does NOT leak into this
      // session: `applyPinnedSnapshot` reads an empty snapshot as "session
      // started without pinned, suppress any newly pinned entries".
      let pinnedSnapshot: PinnedSkillsSnapshot | null =
        (sessionMeta['pinnedSkillsSnapshot'] as PinnedSkillsSnapshot | undefined) ?? null;
      if (!pinnedSnapshot) {
        const captured = snapshotFromEffective(effectiveSkills);
        pinnedSnapshot = captured;
        // Persist back to sessions.metadata_json so subsequent turns and
        // any replay path reads the same list. Re-read the row first to
        // avoid clobbering metadata mutations made between read and write.
        const sessionRowForSnapshot = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
          [input.sessionId, input.user.sub],
        );
        const currentMetadata = sessionRowForSnapshot
          ? parseSessionMetadataJson(sessionRowForSnapshot.metadata_json)
          : {};
        currentMetadata['pinnedSkillsSnapshot'] = captured;
        sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?', [
          JSON.stringify(currentMetadata),
          input.sessionId,
          input.user.sub,
        ]);
      }

      const pinnedSection = buildPinnedSkillsPromptSection(
        applyPinnedSnapshot(effectiveSkills, pinnedSnapshot),
      );
      const pinnedSkillsPrompt = pinnedSection.section;

      const baseTools = getEnabledTools(webSearchEnabled, {
        effectiveSkills,
        // Per-turn model-aware tool filter (mirrors opencode
        // `tool/registry.ts:303-315`): GPT-5 generation models get
        // `apply_patch` and lose `edit/multi_edit/write`; other models
        // keep `edit/multi_edit/write` and lose `apply_patch`. Falls
        // back to the legacy "expose everything" behaviour when
        // `route.model` is missing or `OPENAWORK_DISABLE_MODEL_AWARE_TOOL_FILTER=1`.
        modelId: route.model,
      });

      // Flatten MCP tools into the LLM tool dictionary (PR-C).
      // Mirrors opencode's `mcp.tools()` injection
      // (`@/temp/opencode/packages/opencode/src/session/prompt.ts:458-525`):
      // each MCP tool becomes its own top-level function under the
      // `mcp__<server>__<tool>` namespace, eliminating the legacy
      // `mcp_list_tools` → `mcp_call` two-step. We `await` the catalog
      // warmup so this turn sees a stable surface; the connection
      // pool keeps subsequent turns hot. Failures degrade gracefully
      // — MCP outages must NOT block the assistant turn.
      let flatMcpDefs: ReturnType<typeof buildFlatMcpToolDefinitions>['definitions'] = [];
      const flatModeOn = !isFlatMcpToolsDisabled();
      if (flatModeOn) {
        try {
          const catalogs = await listMcpToolsForSession(input.sessionId);
          const built = buildFlatMcpToolDefinitions(catalogs);
          flatMcpDefs = built.definitions;
        } catch (err) {
          console.warn(
            `[stream] Failed to build flat MCP tool defs: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // PR-C.4 — compatibility window:
      //   - When flat mode is ON: hide the legacy `mcp_list_tools` /
      //     `mcp_call` wrapper tools from the LLM so the model sees a
      //     single canonical entry point per MCP capability (no
      //     duplicates, smaller prompt, stable cache prefix). The
      //     sandbox keeps both execution paths registered so resumed
      //     sessions whose history contains old `mcp_call` invocations
      //     still replay cleanly.
      //   - When flat mode is OFF: leave the wrappers in place — sites
      //     that opted out via `OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1`
      //     continue with the pre-PR-C contract.
      const baseToolsForTurn = flatModeOn
        ? baseTools.filter(
            (tool) => tool.function.name !== 'mcp_list_tools' && tool.function.name !== 'mcp_call',
          )
        : baseTools;

      const allTools = [
        ...baseToolsForTurn,
        ...flatMcpDefs,
        ...(dynamicToolDefs.length > 0 ? buildDynamicGatewayToolDefinitions(dynamicToolDefs) : []),
      ];
      const filteredTools = filterEnabledGatewayToolsForSession(
        allTools,
        input.sessionContext.metadataJson,
      );

      // ─── L1.2.3 toolset-gate + 内置指令注入 ────────────────────────────
      // 读取 session 的 role_layer，如果属于团队五层之一，则：
      //   1. 用 toolset 白名单过滤通用工具（read/write/shell/lsp 等）
      //   2. 注入该层专属内置指令（route_to_orchestrate / submit_artifact / ...）
      // 这是构思 §2B.7 "不在一个 agent 里塞所有工具" 的代码级落地。
      const sessionRoleLayer = input.sessionContext.roleLayer ?? null;
      let layerFilteredTools = filteredTools;
      if (
        sessionRoleLayer &&
        ['reception', 'pm1', 'pm2', 'executor', 'reviewer'].includes(sessionRoleLayer)
      ) {
        try {
          const { LAYER_CAPABILITIES } =
            await import('../handoff/capability/layer-capabilities.js');
          const { getInstructionsForLayer, toToolDefinition } =
            await import('../handoff/capability/builtin-instructions.js');
          const { filterToolsByAllowedSets } =
            await import('../handoff/capability/toolset-gate.js');
          const layer = sessionRoleLayer as 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';
          const caps = LAYER_CAPABILITIES[layer];
          // 1. 通用工具 toolset 过滤
          if (caps.allowedToolsetCategories.length > 0) {
            layerFilteredTools = filterToolsByAllowedSets(
              filteredTools,
              caps.allowedToolsetCategories as never[],
            );
          }
          // 2. 内置指令注入（每层专属 LLM-facing 函数工具）
          const layerInstructions = getInstructionsForLayer(layer);
          if (layerInstructions.length > 0) {
            const instructionDefs = layerInstructions.map((inst) => toToolDefinition(inst));
            layerFilteredTools = [...layerFilteredTools, ...instructionDefs];
          }
        } catch (err) {
          console.warn(
            `[stream] layer-aware tool filter failed for ${sessionRoleLayer}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const shouldDeferToolLoading =
        route.deferToolLoading === true || sessionMeta['deferToolLoading'] === true;
      const enabledTools = shouldDeferToolLoading
        ? layerFilteredTools.map((tool) => ({
            ...tool,
            function: { ...tool.function, deferLoading: true },
          }))
        : layerFilteredTools;
      const enabledToolNames = new Set(enabledTools.map((tool) => tool.function.name));
      const turnFileDiffs = new Map<string, FileDiffContent>();
      const memoryBlock = buildMemoryBlockForSession(
        input.user.sub,
        input.sessionContext.metadataJson,
      );

      // 260515-team-phase-a · T-06：构建 7 层团队指令栈
      // session metadata 中的 teamWorkspaceId 决定是否注入团队约束；
      // route.effectiveAgentId 映射到 5 层 role_layer（reception/pm1/pm2/executor/reviewer）。
      // 复用前面 line 1728 已经解析过的 sessionMeta（避免重复 JSON.parse）。
      const teamWorkspaceIdForStack =
        typeof sessionMeta['teamWorkspaceId'] === 'string' ? sessionMeta['teamWorkspaceId'] : null;
      const workingDirectoryForStack =
        typeof sessionMeta['workingDirectory'] === 'string'
          ? sessionMeta['workingDirectory']
          : null;
      const roleLayerForStack = mapAgentToTeamRoleLayer(
        route.effectiveAgentId ?? requestData.agentId ?? null,
      );
      const teamInstructionStackResult = await buildTeamInstructionStack({
        userId: input.user.sub,
        workspaceRoot: workingDirectoryForStack,
        teamWorkspaceId: teamWorkspaceIdForStack,
        roleLayer: roleLayerForStack,
      });
      const teamInstructionStack = teamInstructionStackResult.stableBlock;
      const compactionSettingsRow = sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
        [input.user.sub, COMPACTION_SETTINGS_KEY],
      );
      const compactionSettings = readCompactionSettings(
        parseStoredJson(compactionSettingsRow?.value),
      );
      let syntheticContinuationPrompt: string | undefined;
      let lastRoundUsage:
        | { inputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
        | undefined;

      for (let round = 1; ; round += 1) {
        const roundStartedAt = Date.now();
        // Dynamic context window: resolve the effective limit for this user+model,
        // which may be lower than the preset if a provider error previously revealed
        // a smaller actual limit (e.g. relay supports 200K but preset says 1M).
        const _effectiveContextWindow = resolveEffectiveContextWindow(
          input.user.sub,
          route.model,
          route.contextWindow,
        );
        // P0: Proactive compaction — compact before overflow if token usage is near threshold.
        if (round > 1 && lastRoundUsage) {
          const proactiveResult = await triggerProactiveCompaction({
            userId: input.user.sub,
            sessionId: input.sessionId,
            metadataJson: input.sessionContext.metadataJson,
            clientRequestId: requestData.clientRequestId,
            runId,
            route,
            compactionSettings,
            signal: abortController.signal,
            round,
            lastRoundUsage,
          });
          if (proactiveResult.triggered) {
            input.sessionContext.metadataJson = proactiveResult.metadataJson;
          }
        }

        const result = await runModelRound({
          clientRequestId: requestData.clientRequestId,
          enabledTools,
          eventSequence,
          requestData,
          round,
          route,
          runId,
          signal: abortController.signal,
          sessionContext: input.sessionContext,
          sessionId: input.sessionId,
          transport: input.transport,
          turnFileDiffs,
          userId: input.user.sub,
          wl,
          ctx,
          compactionAutoEnabled: compactionSettings.auto,
          compactionReservedTokens: compactionSettings.reserved,
          workspaceCtx,
          injectedPrompt,
          capabilityContext,
          lspGuidance,
          dialogueModePrompt,
          yoloModePrompt,
          companionPrompt,
          dynamicAgentPrompt,
          startWorkContext,
          commandContext: commandContext?.instruction ?? null,
          pinnedSkillsPrompt,
          teamInstructionStack,
          syntheticContinuationPrompt,
          memoryBlock,
          agentId: route.effectiveAgentId ?? requestData.agentId,
          writeChunk: emitChunk,
        });
        syntheticContinuationPrompt = undefined;

        if (result.usage) {
          lastRoundUsage = result.usage;
          emitChunk(
            buildStreamUsageChunk({
              eventSequence,
              round,
              runId,
              usage: result.usage,
            }),
          );
          persistMonthlyUsageRecord({
            occurredAt: result.usageOccurredAt,
            inputPricePerMillion: route.inputPricePerMillion,
            outputPricePerMillion: route.outputPricePerMillion,
            usage: result.usage,
            userId: input.user.sub,
          });

          // ─── Team tabs data: usage + timing events ─────────────────────
          // 只对 team session（roleLayer != null）生效，chat 端不触发。
          if (input.sessionContext.roleLayer) {
            const { publishTeamUsageEvent, publishTeamTimingEvent } =
              await import('./stream-team-events.js');
            publishTeamUsageEvent({
              userId: input.user.sub,
              sessionId: input.sessionId,
              sessionContext: input.sessionContext,
              round,
              agentId: route.effectiveAgentId ?? undefined,
              provider: route.providerType ?? undefined,
              model: route.model ?? undefined,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              reasoningTokens: result.usage.reasoningTokens,
              cacheReadTokens: result.usage.cacheReadTokens,
              cacheWriteTokens: result.usage.cacheWriteTokens,
              costUsd:
                typeof route.inputPricePerMillion === 'number' &&
                typeof route.outputPricePerMillion === 'number'
                  ? (result.usage.inputTokens * route.inputPricePerMillion +
                      result.usage.outputTokens * route.outputPricePerMillion) /
                    1_000_000
                  : undefined,
            });
            publishTeamTimingEvent({
              userId: input.user.sub,
              sessionId: input.sessionId,
              sessionContext: input.sessionContext,
              round,
              totalMs: result.usageOccurredAt
                ? result.usageOccurredAt - roundStartedAt
                : Date.now() - roundStartedAt,
              model: route.model ?? undefined,
              provider: route.providerType ?? undefined,
            });
          }
        }

        let recoveredFromOverflowError = false;
        // Overflow compaction: detect context overflow and trigger recovery.
        // Encapsulates error parsing, Phase 2 truncation, and Phase 3 summarization.
        if (result.overflow === true) {
          const overflowResult = await triggerOverflowCompaction({
            userId: input.user.sub,
            sessionId: input.sessionId,
            metadataJson: input.sessionContext.metadataJson,
            clientRequestId: requestData.clientRequestId,
            runId,
            route,
            compactionSettings,
            signal: abortController.signal,
            round,
            roundResult: {
              overflow: result.overflow,
              stopReason: result.stopReason,
              usage: result.usage,
              upstreamError: result.upstreamError,
            },
          });
          if (overflowResult.triggered) {
            input.sessionContext.metadataJson = overflowResult.metadataJson;
            recoveredFromOverflowError = overflowResult.recovered;
            if (overflowResult.syntheticContinuationPrompt) {
              syntheticContinuationPrompt = overflowResult.syntheticContinuationPrompt;
            }
          }
        }

        if (
          result.stopReason === 'error' &&
          result.overflow === true &&
          recoveredFromOverflowError
        ) {
          continue;
        }

        if (result.stopReason === 'error' || result.shouldStop) {
          // TODO continuation enforcer (oh-my-opencode pattern):
          // When the assistant stops without tool calls but incomplete TODOs remain,
          // inject a continuation prompt to keep working instead of stopping.
          if (result.stopReason !== 'error' && result.shouldStop) {
            const incompleteTodos = listSessionTodos(input.sessionId).filter(
              (t) => t.status !== 'completed' && t.status !== 'cancelled',
            );
            if (incompleteTodos.length > 0 && round < MAX_CONSECUTIVE_TASK_PARENT_AUTO_RESUMES) {
              const total = incompleteTodos.length;
              syntheticContinuationPrompt = `[SYSTEM DIRECTIVE: OPENAWORK - TODO CONTINUATION]\n\nIncomplete tasks remain in your todo list. Continue working on the next pending task.\n\n- Proceed without asking for permission\n- Mark each task complete when finished\n- Do not stop until all tasks are done\n\n[Status: ${total - incompleteTodos.filter((t) => t.status === 'pending').length}/${total} completed, ${incompleteTodos.filter((t) => t.status === 'pending').length} remaining]`;
              continue;
            }
          }

          // Ralph loop continuation (oh-my-opencode ralph-loop pattern):
          // When a Ralph loop is active and the assistant stops without completing
          // the promise, inject a continuation prompt to keep iterating.
          if (result.stopReason !== 'error' && result.shouldStop) {
            const lastAssistantText = result.state?.assistantText ?? '';
            const ralphContinuation = await checkRalphLoopContinuation(
              workspaceRootForStartWork,
              lastAssistantText,
            );
            if (ralphContinuation) {
              syntheticContinuationPrompt = ralphContinuation;
              continue;
            }
          }

          // Session recovery (oh-my-opencode sessionRecovery pattern):
          // When the LLM returns a recoverable error (tool_result_missing,
          // thinking_block_order, thinking_disabled_violation), attempt to
          // fix the message structure and retry.
          if (
            result.stopReason === 'error' &&
            !result.overflow &&
            round < MAX_CONSECUTIVE_TASK_PARENT_AUTO_RESUMES
          ) {
            const errorType = detectRecoveryErrorType(result.upstreamError);
            if (errorType) {
              let recoveryResult: RecoveryResult | null = null;
              const messages = listSessionMessagesV2({
                sessionId: input.sessionId,
                userId: input.user.sub,
              });
              if (errorType === 'tool_result_missing') {
                recoveryResult = recoverToolResultMissing(
                  input.sessionId,
                  input.user.sub,
                  requestData.clientRequestId,
                  messages,
                );
              } else if (errorType === 'thinking_disabled_violation') {
                recoveryResult = recoverThinkingDisabledViolation(
                  input.sessionId,
                  input.user.sub,
                  requestData.clientRequestId,
                );
              } else if (errorType === 'thinking_block_order') {
                recoveryResult = recoverThinkingBlockOrder(
                  input.sessionId,
                  input.user.sub,
                  requestData.clientRequestId,
                );
              }

              if (recoveryResult?.recovered) {
                console.log(
                  `[SESSION_RECOVERY] Recovered from ${errorType}: ${recoveryResult.action}, sessionId=${input.sessionId}`,
                );
                syntheticContinuationPrompt = `[Session Recovery] Fixed ${errorType} error. Continuing from where we left off.`;
                continue;
              }
            }
          }

          if (result.stopReason !== 'error') {
            wl.flush(ctx, 200);
          }
          console.log(
            '[STREAM_DONE] session',
            input.sessionId,
            'stopReason:',
            result.stopReason,
            'keepPaused:',
            shouldKeepPausedState,
          );
          if (!shouldKeepPausedState) {
            setPersistedSessionStateStatus({
              sessionId: input.sessionId,
              status: 'idle',
              userId: input.user.sub,
            });
          }
          try {
            autoExtractMemoriesForRequest({
              userId: input.user.sub,
              sessionId: input.sessionId,
              clientRequestId: requestData.clientRequestId,
              metadataJson: input.sessionContext.metadataJson,
            });
          } catch (error: unknown) {
            console.warn('memory auto extraction failed after stream completion', error);
          }
          return {
            errorSummary:
              result.upstreamError?.message && result.upstreamError.technicalDetail
                ? `${result.upstreamError.message}
${result.upstreamError.technicalDetail}`
                : (result.upstreamError?.message ??
                  result.upstreamError?.technicalDetail ??
                  (result.stopReason === 'error' ? '模型服务内部错误，请稍后重试' : undefined)),
            statusCode: result.statusCode,
            stopReason: toStreamStopReason(result.stopReason),
          };
        }

        const toolCallsResult = await executeToolCalls({
          agentId: route.effectiveAgentId ?? requestData.agentId,
          clientRequestId: requestData.clientRequestId,
          executionContext: createStreamExecutionContext(
            requestData.clientRequestId,
            round + 1,
            requestData,
            input.user.sub,
          ),
          enabledToolNames,
          eventSequence,
          runId,
          signal: abortController.signal,
          sessionContext: input.sessionContext,
          sessionId: input.sessionId,
          state: result.state,
          taskRuntimeGuardContext,
          turnFileDiffs,
          userId: input.user.sub,
          writeChunk: emitChunk,
          workspaceRoot: parseSessionMetadataJson(input.sessionContext.metadataJson)[
            'workingDirectory'
          ] as string | undefined,
        });

        if (toolCallsResult.hasPendingPermission) {
          console.log(
            '[PERMISSION_PAUSE] emitting done with tool_permission, sessionId=',
            input.sessionId,
            'runId=',
            runId,
          );
          emitChunk({
            type: 'done',
            stopReason: 'tool_permission',
            ...createRunEventMeta(runId, eventSequence),
          });
          setPersistedSessionStateStatus({
            sessionId: input.sessionId,
            status: 'paused',
            userId: input.user.sub,
          });
          wl.flush(ctx, 200);
          return { statusCode: 200 };
        }
      }
    } finally {
      clearInterval(runtimeThreadHeartbeat);
      clearSessionRuntimeThread({
        clientRequestId: requestData.clientRequestId,
        sessionId: input.sessionId,
        userId: input.user.sub,
      });
      unsubscribeSessionEvents();
    }
  })().catch(async (err) => {
    if (abortController.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      console.log('[STREAM_ABORT] session', input.sessionId, 'stream aborted —', String(err));
      // Propagate the abort to any in-flight descendant session streams
      // (delegate_task / look_at / call_omo_agent etc. spawn independent
      // streams keyed by `metadata_json.parentSessionId`). Awaiting the
      // cascade before we emit `done` guarantees the descendant streams
      // have finished writing their tool results / run events so the
      // parent's "cancelled" state is consistent across the lineage.
      // Mirrors opencode #25798 (`fix: task cancellation should
      // propagate`). Bounded by the helper's 10s default budget so a
      // hung child cannot block the user's stop UX indefinitely.
      let cascadeSummary: StreamCancellationSummary | undefined;
      try {
        const cascade = await cancelDescendantSessionStreams({
          rootSessionId: input.sessionId,
          userId: input.user.sub,
          reason: 'parent_aborted',
        });
        if (cascade.cancelledStreamCount > 0 || cascade.visitedDescendantSessionIds.length > 0) {
          console.log(
            '[STREAM_ABORT_CASCADE] session',
            input.sessionId,
            'descendants',
            cascade.visitedDescendantSessionIds.length,
            'cancelledStreams',
            cascade.cancelledStreamCount,
            'durationMs',
            cascade.durationMs,
            cascade.timedOut ? '(timed out)' : '',
          );
        }
        // Surface the cascade as a structured payload on the `done`
        // chunk so the UI can render a meaningful toast instead of a
        // bare "cancelled". The reason is read from the in-flight
        // entry the cancellation registry stamped — for the user's
        // own stop it stays `user_aborted`; for streams aborted by
        // an upstream cascade it carries the propagated tag so
        // descendant UIs can show "由父会话中断" (T-CANCEL-08).
        const propagatedReason = readPendingCancelReason(
          input.sessionId,
          requestData.clientRequestId,
        );
        cascadeSummary = {
          reason: propagatedReason,
          descendantSessions: cascade.visitedDescendantSessionIds.length,
          cancelledStreams: cascade.cancelledStreamCount,
          cascadeDurationMs: cascade.durationMs,
          timedOut: cascade.timedOut,
        };
      } catch (cascadeErr) {
        console.warn('[STREAM_ABORT_CASCADE] failed —', input.sessionId, String(cascadeErr));
      }
      emitChunk({
        type: 'done',
        stopReason: 'cancelled',
        ...createRunEventMeta(runId, eventSequence),
        ...(cascadeSummary ? { cancellation: cascadeSummary } : {}),
      });
      wl.flush(ctx, 200);
      setPersistedSessionStateStatus({
        sessionId: input.sessionId,
        status: 'idle',
        userId: input.user.sub,
      });
      return { statusCode: 200, stopReason: 'cancelled' as const };
    }

    console.log('[STREAM_ERROR] session', input.sessionId, 'stream errored —', String(err));
    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'idle',
      userId: input.user.sub,
    });
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'stream',
      sourceName: 'STREAM_ERROR',
      requestId: requestData.clientRequestId,
      output: { message: String(err), code: 'STREAM_ERROR' },
    });
    appendSessionMessageV2({
      sessionId: input.sessionId,
      userId: input.user.sub,
      role: 'assistant',
      content: buildErrorContent('STREAM_ERROR', String(err)),
      clientRequestId: requestData.clientRequestId,
      status: 'error',
      replaceExisting: true,
    });
    emitChunk(createStreamErrorChunk('STREAM_ERROR', String(err), runId));
    wl.flush(ctx, 500);
    throw err;
  });

  registerInFlightStreamRequest({
    abortController,
    clientRequestId: requestData.clientRequestId,
    execution,
    sessionId: input.sessionId,
    userId: input.user.sub,
  });
  try {
    return await execution;
  } finally {
    clearInFlightStreamRequest({
      clientRequestId: requestData.clientRequestId,
      execution,
      sessionId: input.sessionId,
    });
  }
}

export function createStreamErrorChunk(code: string, message: string, runId: string) {
  return {
    type: 'error' as const,
    code,
    message,
    runId,
    eventId: `${runId}:error:${randomUUID()}`,
    occurredAt: Date.now(),
  };
}
