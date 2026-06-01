/**
 * team-init-runner · 执行单个初始化步骤
 *
 * 每步都在用户确认后由路由层调用（scan-shared-record 例外——它在 planner 阶段就
 * 已经执行）。runner 的执行原则与 reception-orchestrator 一致：失败不抛错，写入
 * step.error 并返回 ok=false，让上层决定如何反馈给前端。
 *
 * AI 优先：除 scan-shared-record（纯空/非空探测，无需 AI）外，所有分析类步骤都先
 * 走辅助 LLM（runInitLlm，复用用户配置的 fast/active provider），由 AI 解读结构、
 * 提炼记忆、生成架构摘要、按项目挑选工具、定制记忆骨架。当用户未配置辅助 LLM 或
 * 调用失败 / 输出无法解析时，每步都回落到确定性的启发式兜底，保证流程零异常跑通。
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

// ─── 项目证据采集（深度上下文）─────────────────────────────────────────────

/** 遍历时忽略的目录（噪声 / 体积大 / 与项目意图无关）。 */
const EVIDENCE_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.shadow-git',
  '.DS_Store',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
]);

/**
 * 关键标识 / 配置文件清单——读到即作为「技术栈硬证据」喂给 AI，
 * 远比靠目录名猜测可靠。顺序无所谓，存在才读。
 */
const MANIFEST_CANDIDATES: Array<{ label: string; rel: string; maxChars: number }> = [
  { label: 'package.json', rel: 'package.json', maxChars: 2000 },
  { label: 'pnpm-workspace.yaml', rel: 'pnpm-workspace.yaml', maxChars: 600 },
  { label: 'tsconfig.json', rel: 'tsconfig.json', maxChars: 800 },
  { label: 'pyproject.toml', rel: 'pyproject.toml', maxChars: 1500 },
  { label: 'requirements.txt', rel: 'requirements.txt', maxChars: 1200 },
  { label: 'setup.py', rel: 'setup.py', maxChars: 1000 },
  { label: 'go.mod', rel: 'go.mod', maxChars: 1000 },
  { label: 'Cargo.toml', rel: 'Cargo.toml', maxChars: 1200 },
  { label: 'pom.xml', rel: 'pom.xml', maxChars: 1500 },
  { label: 'build.gradle', rel: 'build.gradle', maxChars: 1200 },
  { label: 'build.gradle.kts', rel: 'build.gradle.kts', maxChars: 1200 },
  { label: 'composer.json', rel: 'composer.json', maxChars: 1200 },
  { label: 'Gemfile', rel: 'Gemfile', maxChars: 1000 },
  { label: 'docker-compose.yml', rel: 'docker-compose.yml', maxChars: 1500 },
  { label: 'Dockerfile', rel: 'Dockerfile', maxChars: 1000 },
  { label: 'Makefile', rel: 'Makefile', maxChars: 1000 },
];

const README_CANDIDATES = ['README.md', 'README.rst', 'README.txt', 'README'];

export interface ProjectEvidence {
  directories: string[];
  files: string[];
  /** 深度 2：每个顶层目录的直接子项（截断），让 AI 看到真实层次。 */
  subtree: Array<{ dir: string; children: string[] }>;
  /** 文件扩展名直方图（top N），用于推断主力语言。 */
  languageHistogram: Array<{ ext: string; count: number }>;
  /** 命中的清单 / 配置文件（含摘录）——技术栈硬证据。 */
  manifests: Array<{ label: string; excerpt: string }>;
  /** README 摘录。 */
  readme: string | null;
  /** 实际遍历到的文件总数（护栏内）。 */
  totalFilesScanned: number;
}

/** 列出某目录的直接子项名（目录加 `/` 后缀），剔除噪声 + 数量护栏。 */
async function listImmediateChildren(dir: string, limit: number): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (EVIDENCE_IGNORED_DIRS.has(entry.name)) continue;
    out.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
    if (out.length >= limit) break;
  }
  out.sort();
  return out;
}

/**
 * 有界递归统计文件扩展名直方图（推断主力语言）。
 * 深度 / 文件数都有护栏，避免在大仓库里跑飞。
 */
async function buildLanguageHistogram(
  root: string,
  maxFiles: number,
  maxDepth: number,
): Promise<{ histogram: Array<{ ext: string; count: number }>; totalFilesScanned: number }> {
  const counts = new Map<string, number>();
  let scanned = 0;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0 && scanned < maxFiles) {
    const current = queue.shift();
    if (!current) break;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (EVIDENCE_IGNORED_DIRS.has(entry.name)) continue;
      if (entry.isFile()) {
        scanned += 1;
        const dot = entry.name.lastIndexOf('.');
        const ext = dot > 0 ? entry.name.slice(dot).toLowerCase() : '(无扩展名)';
        counts.set(ext, (counts.get(ext) ?? 0) + 1);
        if (scanned >= maxFiles) break;
      } else if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
  }
  const histogram = Array.from(counts.entries())
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  return { histogram, totalFilesScanned: scanned };
}

/**
 * 采集项目「深度证据」：一级结构 + 深度 2 子树 + 语言直方图 + 清单/配置摘录 + README。
 *
 * 这是改造的核心——把「靠目录名猜」升级为「拿着真实技术栈证据分析」。所有 IO 都
 * best-effort（失败跳过），并有遍历护栏，保证不在大仓库里失控。
 */
async function collectProjectEvidence(safeRoot: string): Promise<ProjectEvidence> {
  const level1 = await readProjectLevel1(safeRoot);

  // 深度 2 子树：只对前若干个顶层目录展开，避免过长。
  const subtree: Array<{ dir: string; children: string[] }> = [];
  for (const dir of level1.directories.slice(0, 12)) {
    const children = await listImmediateChildren(path.join(safeRoot, dir), 25);
    if (children.length > 0) subtree.push({ dir, children });
  }

  const { histogram, totalFilesScanned } = await buildLanguageHistogram(safeRoot, 4000, 4);

  const manifests: Array<{ label: string; excerpt: string }> = [];
  for (const candidate of MANIFEST_CANDIDATES) {
    const content = await readWorkspaceFileSafe(safeRoot, candidate.rel);
    if (content) {
      manifests.push({ label: candidate.label, excerpt: content.slice(0, candidate.maxChars) });
    }
  }

  let readme: string | null = null;
  for (const rel of README_CANDIDATES) {
    const content = await readWorkspaceFileSafe(safeRoot, rel);
    if (content) {
      readme = content.slice(0, 2500);
      break;
    }
  }

  return {
    directories: level1.directories,
    files: level1.files,
    subtree,
    languageHistogram: histogram,
    manifests,
    readme,
    totalFilesScanned,
  };
}

/** 把证据压成紧凑的 prompt 文本块（控制长度，避免超 token）。 */
function formatEvidenceForPrompt(evidence: ProjectEvidence): string {
  const parts: string[] = [];
  parts.push(`顶层目录：${evidence.directories.join(', ') || '（无）'}`);
  parts.push(`顶层文件：${evidence.files.slice(0, 40).join(', ') || '（无）'}`);
  if (evidence.subtree.length > 0) {
    parts.push(
      `二级结构：\n${evidence.subtree
        .map((node) => `  ${node.dir}/ → ${node.children.join(', ')}`)
        .join('\n')}`,
    );
  }
  if (evidence.languageHistogram.length > 0) {
    parts.push(
      `文件类型分布（${evidence.totalFilesScanned} 个文件）：${evidence.languageHistogram
        .map((h) => `${h.ext}×${h.count}`)
        .join(', ')}`,
    );
  }
  if (evidence.manifests.length > 0) {
    parts.push(
      `配置 / 清单文件：\n${evidence.manifests
        .map((m) => `### ${m.label}\n${m.excerpt}`)
        .join('\n\n')}`,
    );
  }
  if (evidence.readme) {
    parts.push(`README 摘录：\n${evidence.readme}`);
  }
  return parts.join('\n\n');
}

// ─── 共享 LLM 调用 ─────────────────────────────────────────────────────────

/**
 * 初始化步骤的统一 LLM 调用入口。
 *
 * 解析用户的辅助 LLM（fast / active / env 优先级链，见 auxiliary-llm-config），
 * 命中则调 workflow 非流式补全；未配置或调用失败一律返回 null，由调用方回落到
 * 启发式兜底——保证「没配 AI 的用户 / 测试环境」初始化流程依旧能跑通、零异常。
 */
async function runInitLlm(
  userId: string,
  prompt: string,
  opts?: { temperature?: number; maxOutputTokens?: number },
): Promise<string | null> {
  const llmConfig = await resolveAuxiliaryLlmConfig(userId, undefined);
  if (!llmConfig) return null;
  try {
    const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
    const text = await requestWorkflowLlmCompletion({
      apiBaseUrl: llmConfig.apiBaseUrl,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
      ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
      prompt,
      temperature: opts?.temperature ?? 0.2,
      ...(opts?.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
    });
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    console.warn(
      `[team-init-runner] init LLM 调用失败，回落启发式：${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** 解析一个 ```json ... ``` 代码块或裸 JSON 文本，失败返回 null（不抛错）。 */
function parseLlmJson<T>(text: string | null): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text)?.trim();
  if (!candidate) return null;
  // 容错：从首个 { 到末个 } 截取，规避模型偶发的前后寒暄。
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/**
 * 调 LLM 并解析为 JSON 对象，失败时自动重试一次（追加「只输出合法 JSON」的强约束）。
 * 两次都拿不到可解析对象时返回 null，由调用方走启发式兜底。
 */
async function runInitLlmJson<T>(
  userId: string,
  prompt: string,
  opts?: { temperature?: number; maxOutputTokens?: number },
): Promise<T | null> {
  const first = await runInitLlm(userId, prompt, opts);
  const parsedFirst = parseLlmJson<T>(first);
  if (parsedFirst !== null) return parsedFirst;

  // 重试：把上一次（可能带寒暄/截断）的输出回灌，要求只输出严格 JSON。
  const retryPrompt = [
    prompt,
    '',
    '⚠️ 上一次输出无法被解析为 JSON。请只输出一个合法的 JSON 对象，',
    '不要任何解释、标题、代码块标记或多余文字。',
  ].join('\n');
  const second = await runInitLlm(userId, retryPrompt, opts);
  return parseLlmJson<T>(second);
}

/** 从 ctx 已完成的步骤里取某步的 result（供后续步骤复用前序产物）。 */
function priorStepResult(
  ctx: TeamInitSessionContext,
  key: TeamInitStepKey,
): Record<string, unknown> | null {
  const step = ctx.teamInit?.steps.find((s) => s.key === key);
  return (step?.result as Record<string, unknown> | undefined) ?? null;
}

// ─── 各步骤执行体 ──────────────────────────────────────────────────────────

async function execReadProjectLevel1(
  ctx: TeamInitSessionContext,
): Promise<{ result: Record<string, unknown> }> {
  const safeRoot = ctx.workingDirectory ? validateWorkspacePath(ctx.workingDirectory) : null;
  if (!safeRoot) {
    return { result: { directories: [], files: [], note: '工作目录不可用' } };
  }

  // 深度证据采集：一级结构 + 二级子树 + 语言直方图 + 清单 / README。
  const evidence = await collectProjectEvidence(safeRoot);
  const base = {
    directories: evidence.directories,
    files: evidence.files,
    directoryCount: evidence.directories.length,
    fileCount: evidence.files.length,
    // 结构化证据落入 result，供后续步骤与前端复用（避免重复 IO）。
    subtree: evidence.subtree,
    languageHistogram: evidence.languageHistogram,
    detectedManifests: evidence.manifests.map((m) => m.label),
  };
  if (evidence.directories.length === 0 && evidence.files.length === 0) {
    return { result: { ...base, usedLlm: false } };
  }

  // AI 解读：基于深度证据推断项目类型 / 技术栈 / 各目录职责。要求结构化 JSON
  // 以便前端分区展示；解析失败回落为纯文本解读，再失败只回结构数据。
  const evidenceBlock = formatEvidenceForPrompt(evidence);
  const jsonPrompt = [
    '你是一名资深工程师，正在快速但扎实地了解一个项目。',
    '请基于下面的「项目证据」（目录结构 / 二级子树 / 文件类型分布 / 配置文件 / README）',
    '推断结论，不要只看目录名臆测——要结合配置文件与文件类型分布做判断。',
    '严格只输出如下 JSON（不要代码块外的任何文字）：',
    '{"projectType":"一句话项目类型","techStack":["技术栈关键词"],' +
      '"keyDirectories":[{"name":"目录名","role":"职责"}],"summary":"不超过150字的整体解读"}',
    '',
    evidenceBlock,
  ].join('\n');

  interface Level1Ai {
    projectType?: unknown;
    techStack?: unknown;
    keyDirectories?: unknown;
    summary?: unknown;
  }
  const ai = await runInitLlmJson<Level1Ai>(ctx.userId, jsonPrompt, {
    temperature: 0.2,
    maxOutputTokens: 1024,
  });
  if (ai) {
    const techStack = Array.isArray(ai.techStack)
      ? ai.techStack.filter((t): t is string => typeof t === 'string').slice(0, 20)
      : [];
    const keyDirectories = Array.isArray(ai.keyDirectories)
      ? ai.keyDirectories
          .filter(
            (d): d is Record<string, unknown> =>
              !!d &&
              typeof d === 'object' &&
              typeof (d as Record<string, unknown>)['name'] === 'string',
          )
          .map((d) => ({
            name: String(d['name']),
            role: typeof d['role'] === 'string' ? d['role'] : '',
          }))
          .slice(0, 30)
      : [];
    const projectType = typeof ai.projectType === 'string' ? ai.projectType : '';
    const summary = typeof ai.summary === 'string' ? ai.summary : '';
    // interpretation：拼成 markdown，前端预览直接渲染；同时保留结构化字段。
    const interpretation = [
      projectType ? `**项目类型**：${projectType}` : '',
      techStack.length > 0 ? `**技术栈**：${techStack.join(' / ')}` : '',
      summary,
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      result: {
        ...base,
        usedLlm: true,
        projectType,
        techStack,
        keyDirectories,
        interpretation,
      },
    };
  }

  // JSON 失败兜底：退化为纯文本解读。
  const textPrompt = [
    '你是一名资深工程师，正在快速了解一个项目。根据下面的项目证据，',
    '用中文输出一段不超过 200 字的解读：推断项目类型 / 技术栈，并简述主要目录的职责。',
    '结合配置文件与文件类型分布判断，不要只看目录名臆测。只输出解读正文，不要标题或寒暄。',
    '',
    evidenceBlock,
  ].join('\n');
  const interpretation = await runInitLlm(ctx.userId, textPrompt, { temperature: 0.2 });
  return {
    result: {
      ...base,
      usedLlm: interpretation !== null,
      ...(interpretation ? { interpretation } : {}),
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
    { label: 'CLAUDE.md', rel: 'CLAUDE.md' },
    { label: '.cursorrules', rel: '.cursorrules' },
    { label: 'architecture.md', rel: 'architecture.md' },
    { label: 'ARCHITECTURE.md', rel: 'ARCHITECTURE.md' },
    { label: 'CONTRIBUTING.md', rel: 'CONTRIBUTING.md' },
    { label: 'CONVENTIONS.md', rel: 'CONVENTIONS.md' },
    { label: 'project-memory', rel: '.agentdocs/project-memory.md' },
    { label: 'lessons-learned', rel: '.agentdocs/lessons-learned.md' },
    { label: 'docs/architecture.md', rel: 'docs/architecture.md' },
    { label: 'docs/CONVENTIONS.md', rel: 'docs/CONVENTIONS.md' },
    { label: '.github/copilot-instructions.md', rel: '.github/copilot-instructions.md' },
  ];
  const found: Array<{ label: string; chars: number; excerpt: string }> = [];
  for (const candidate of candidates) {
    const content = await readWorkspaceFileSafe(safeRoot, candidate.rel);
    if (content) {
      found.push({
        label: candidate.label,
        chars: content.length,
        excerpt: content.slice(0, 1600),
      });
    }
  }

  if (found.length === 0) {
    return {
      result: { sources: [], excerpts: [], foundCount: 0, usedLlm: false },
      projectMemoryDigest: null,
    };
  }

  // 原始摘录拼接——作为 AI 失败时的兜底 digest。
  const rawDigest = found.map((f) => `### ${f.label}\n${f.excerpt}`).join('\n\n');

  // 复用前序步骤的项目类型 / 技术栈，让提炼更有针对性。
  const level1 = priorStepResult(ctx, 'read-project-level1');
  const projectTypeHint =
    level1 && typeof level1['projectType'] === 'string' && level1['projectType']
      ? `已知项目类型：${level1['projectType']}\n`
      : '';

  // AI 提炼：把多份记忆文件压成结构化的「关键约束 / 技术栈 / 注意事项」要点。
  const prompt = [
    '你是一名资深工程师，正在为团队提炼一个项目的「记忆要点」。',
    projectTypeHint,
    '下面是该项目记忆 / 约定 / 文档文件的摘录。请用中文输出一份不超过 400 字的要点清单，',
    '分三个小节：「核心约束」「技术栈与工具链」「易踩的坑 / 注意事项」，每节用简洁 markdown 列表。',
    '只保留对后续协作真正重要的信息，去重、合并同类项。只输出要点正文，不要寒暄。',
    '',
    found.map((f) => `### ${f.label}\n${f.excerpt}`).join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n');
  const distilled = await runInitLlm(ctx.userId, prompt, {
    temperature: 0.2,
    maxOutputTokens: 1280,
  });
  const digest = distilled ?? rawDigest;
  return {
    result: {
      sources: found.map((f) => ({ label: f.label, chars: f.chars })),
      // 预览用：保留每个来源的摘录文本（前端展开渲染为 markdown）。
      excerpts: found.map((f) => ({ label: f.label, excerpt: f.excerpt })),
      foundCount: found.length,
      usedLlm: distilled !== null,
      ...(distilled ? { digest: distilled } : {}),
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

  // 深度证据：优先复用 read-project-level1 已采集的，否则现采（autorun/单跑顺序无关）。
  const evidence = await collectProjectEvidence(safeRoot);
  const evidenceBlock = formatEvidenceForPrompt(evidence);

  // 复用前序步骤产物：项目类型 / 技术栈 + 一级结构解读 + 项目记忆要点。
  const level1 = priorStepResult(ctx, 'read-project-level1');
  const projectType =
    level1 && typeof level1['projectType'] === 'string' ? level1['projectType'] : '';
  const techStack =
    level1 && Array.isArray(level1['techStack']) ? (level1['techStack'] as string[]) : [];
  const level1Interpretation = level1?.['interpretation'];
  const memoryDigest = ctx.teamInit?.bindings.projectMemoryDigest ?? null;

  // 启发式摘要（无 LLM 时的兜底）。
  const heuristicSummary = [
    `项目顶层目录：${evidence.directories.join(', ') || '（无）'}`,
    `顶层文件：${evidence.files.slice(0, 20).join(', ') || '（无）'}`,
    evidence.manifests.length > 0
      ? `检测到配置文件：${evidence.manifests.map((m) => m.label).join(', ')}。`
      : '未检测到常见配置文件。',
    evidence.languageHistogram.length > 0
      ? `主要文件类型：${evidence.languageHistogram
          .slice(0, 5)
          .map((h) => h.ext)
          .join(', ')}。`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const contextBlock = [
    projectType ? `已判定项目类型：${projectType}` : '',
    techStack.length > 0 ? `已识别技术栈：${techStack.join(' / ')}` : '',
    typeof level1Interpretation === 'string' && level1Interpretation
      ? `一级结构解读：\n${level1Interpretation}`
      : '',
    typeof memoryDigest === 'string' && memoryDigest
      ? `项目记忆要点：\n${memoryDigest.slice(0, 1500)}`
      : '',
    evidenceBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
  const prompt = [
    '你是一名资深架构师。基于以下项目证据与已有判定，用中文给出一段「项目架构摘要」（不超过 350 字），',
    '需覆盖：项目类型与定位、主要技术栈、关键模块/目录的职责与协作关系、明显的架构约束或风险。',
    '结论必须有证据支撑（配置文件 / 目录结构 / 文件类型分布），不要泛泛而谈。只输出摘要正文，不要标题、不要寒暄。',
    '',
    contextBlock,
  ].join('\n');
  const summary = await runInitLlm(ctx.userId, prompt, { temperature: 0.2, maxOutputTokens: 1280 });
  if (summary === null) {
    return {
      result: { mode: 'heuristic', usedLlm: false, summary: heuristicSummary },
      architectureSummary: heuristicSummary,
    };
  }
  return {
    result: { mode: 'llm', usedLlm: true, summary },
    architectureSummary: summary,
  };
}

/**
 * 按层绑定工具：先发现可用 skill + 已配置 MCP，再让 AI 结合项目上下文
 * （架构摘要 / 一级结构 / 记忆要点）为各执行/规划层挑选合适的子集并给出理由。
 *
 * AI 不可用 / 解析失败时回落到保守的启发式策略：执行层拿全量工具、规划/管控层
 * 拿 MCP（便于查文档/检索），与改造前行为一致，保证链路一开始就带着工具。
 */
async function execBindToolsPerLayer(ctx: TeamInitSessionContext): Promise<{
  result: Record<string, unknown>;
  perLayer: Partial<Record<TeamRuntimeLayer, TeamInitLayerBinding>>;
}> {
  let skills: Array<{ id: string; name: string; description: string; tags: string[] }> = [];
  try {
    const { discoverLocalSkills } = await import('../../skill/local-skills.js');
    const discovered = await discoverLocalSkills(new Set());
    skills = discovered.slice(0, 40).map((s) => ({
      id: s.id,
      name: s.displayName || s.name,
      description: s.description,
      tags: s.tags,
    }));
  } catch (err) {
    console.warn(
      `[team-init-runner] discoverLocalSkills 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const skillIds = skills.map((s) => s.id);

  let mcps: Array<{ id: string; name: string }> = [];
  try {
    const { loadConfiguredMcpServersForUser } = await import('../../mcp/mcp-runtime.js');
    const servers = loadConfiguredMcpServersForUser(ctx.userId);
    mcps = servers
      .filter((server) => server.enabled !== false)
      .slice(0, 40)
      .map((server) => ({ id: server.id, name: server.name }));
  } catch (err) {
    console.warn(
      `[team-init-runner] loadConfiguredMcpServersForUser 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const mcpServerIds = mcps.map((m) => m.id);

  const boundAt = new Date().toISOString();

  // AI 选择：把项目上下文 + 可用工具清单交给模型，按层挑选 skillIds / mcpServerIds。
  const aiPerLayer = await selectToolBindingsWithAi(ctx, { skills, mcps, boundAt });
  const usedLlm = aiPerLayer !== null;

  // 兜底：执行层拿全量工具；规划/管控层拿 MCP（便于查文档/检索）。
  const perLayer: Partial<Record<TeamRuntimeLayer, TeamInitLayerBinding>> = aiPerLayer ?? {
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

  // 汇总实际绑定的工具数（去重所有层）。
  const allSkillIds = new Set<string>();
  const allMcpIds = new Set<string>();
  for (const binding of Object.values(perLayer)) {
    binding?.skillIds.forEach((id) => allSkillIds.add(id));
    binding?.mcpServerIds.forEach((id) => allMcpIds.add(id));
  }

  return {
    result: {
      skillCount: allSkillIds.size,
      mcpCount: allMcpIds.size,
      boundLayers: Object.keys(perLayer),
      usedLlm,
      skillIds: Array.from(allSkillIds),
      mcpServerIds: Array.from(allMcpIds),
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

/** AI 选择各层工具绑定。无 LLM / 解析失败 / 工具池为空时返回 null（调用方走启发式）。 */
async function selectToolBindingsWithAi(
  ctx: TeamInitSessionContext,
  pool: {
    skills: Array<{ id: string; name: string; description: string; tags: string[] }>;
    mcps: Array<{ id: string; name: string }>;
    boundAt: string;
  },
): Promise<Partial<Record<TeamRuntimeLayer, TeamInitLayerBinding>> | null> {
  // 工具池为空时 AI 无从选择，直接交给启发式（结果一致：空绑定）。
  if (pool.skills.length === 0 && pool.mcps.length === 0) return null;

  const architectureSummary = ctx.teamInit?.bindings.architectureSummary ?? null;
  const memoryDigest = ctx.teamInit?.bindings.projectMemoryDigest ?? null;
  const level1 = priorStepResult(ctx, 'read-project-level1');
  const projectType =
    level1 && typeof level1['projectType'] === 'string' ? level1['projectType'] : '';
  const techStack =
    level1 && Array.isArray(level1['techStack']) ? (level1['techStack'] as string[]) : [];

  const validSkillIds = new Set(pool.skills.map((s) => s.id));
  const validMcpIds = new Set(pool.mcps.map((m) => m.id));

  const contextBlock = [
    projectType ? `项目类型：${projectType}` : '',
    techStack.length > 0 ? `技术栈：${techStack.join(' / ')}` : '',
    architectureSummary ? `项目架构摘要：\n${architectureSummary}` : '',
    memoryDigest ? `项目记忆要点：\n${memoryDigest.slice(0, 1000)}` : '',
    level1
      ? `项目一级结构：目录 ${JSON.stringify(level1['directories'] ?? [])}，文件 ${JSON.stringify(
          (level1['files'] as string[] | undefined)?.slice(0, 30) ?? [],
        )}`
      : '',
    `可用 skill（id · 名称 · 标签 · 说明）：\n${
      pool.skills
        .map((s) => `- ${s.id} · ${s.name} · [${s.tags.slice(0, 6).join(', ')}] · ${s.description}`)
        .join('\n') || '（无）'
    }`,
    `可用 MCP（id · 名称）：\n${
      pool.mcps.map((m) => `- ${m.id} · ${m.name}`).join('\n') || '（无）'
    }`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const prompt = [
    '你是一名团队工具配置专家。一个多角色协作团队分为三层：',
    '- executor（执行层）：实际产出代码 / 文档，需要最贴合项目技术栈的 skill 与 MCP；',
    '- pm1（规划层）：拆解需求、检索资料，通常只需 MCP；',
    '- pm2（管控层）：核对依赖与上下文，通常只需 MCP。',
    '请根据下面的项目上下文与可用工具池，为每一层挑选最合适的工具子集——',
    '优先选与项目技术栈 / 架构高度相关的工具，宁缺毋滥，不要把不相关的 skill 也塞给执行层。',
    '只能从给定的 id 中选择，不要编造 id。无合适项时给空数组。',
    'rationale 要结合项目特征说明为什么选这些工具。',
    '严格只输出如下 JSON（不要代码块标记以外的任何文字）：',
    '{"executor":{"skillIds":[],"mcpServerIds":[],"rationale":"理由"},' +
      '"pm1":{"skillIds":[],"mcpServerIds":[],"rationale":"理由"},' +
      '"pm2":{"skillIds":[],"mcpServerIds":[],"rationale":"理由"}}',
    '',
    contextBlock,
  ].join('\n');

  type LayerPick = { skillIds?: unknown; mcpServerIds?: unknown; rationale?: unknown };
  const parsed = await runInitLlmJson<Record<string, LayerPick>>(ctx.userId, prompt, {
    temperature: 0.2,
    maxOutputTokens: 1536,
  });
  if (!parsed) return null;

  const sanitizeIds = (value: unknown, valid: Set<string>): string[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(value.filter((id): id is string => typeof id === 'string' && valid.has(id))),
    );
  };

  const perLayer: Partial<Record<TeamRuntimeLayer, TeamInitLayerBinding>> = {};
  for (const layer of ['executor', 'pm1', 'pm2'] as const) {
    const pick = parsed[layer];
    if (!pick || typeof pick !== 'object') continue;
    perLayer[layer] = {
      skillIds: sanitizeIds(pick.skillIds, validSkillIds),
      mcpServerIds: sanitizeIds(pick.mcpServerIds, validMcpIds),
      rationale: typeof pick.rationale === 'string' ? pick.rationale : null,
      boundAt: pool.boundAt,
    };
  }

  // 解析出来但一层都没有 → 视为失败，回落启发式。
  return Object.keys(perLayer).length > 0 ? perLayer : null;
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

async function execScaffoldMemory(
  ctx: TeamInitSessionContext,
): Promise<{ result: Record<string, unknown> }> {
  // 空项目：只在会话内记录骨架摘要，不落盘（保持可逆，低风险）。
  const fallbackScaffold = [
    '# 项目记忆（初始骨架）',
    '- 目标：待用户在首条需求中明确',
    '- 技术栈：待定',
    '- 关键约束：待补充',
  ].join('\n');

  // AI 定制：结合工作区线索（目录名 / 残留种子文件 / README）生成更贴合的初始骨架。
  const safeRoot = ctx.workingDirectory ? validateWorkspacePath(ctx.workingDirectory) : null;
  const dirHint = safeRoot ? path.basename(safeRoot) : (ctx.teamWorkspaceId ?? '');
  let seedHint = '';
  if (safeRoot) {
    const level1 = await readProjectLevel1(safeRoot);
    const readme =
      (await readWorkspaceFileSafe(safeRoot, 'README.md')) ??
      (await readWorkspaceFileSafe(safeRoot, 'README'));
    const seeds = [...level1.directories.map((d) => `${d}/`), ...level1.files];
    seedHint = [
      seeds.length > 0 ? `已有的零星条目：${seeds.slice(0, 30).join(', ')}` : '',
      readme ? `README 摘录：\n${readme.slice(0, 1000)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  const prompt = [
    '你正在为一个全新的（近乎空白的）项目搭建「初始项目记忆骨架」，作为团队后续协作的起点。',
    dirHint ? `工作目录线索：${dirHint}` : '',
    seedHint,
    '请用中文输出一份简洁的 markdown 骨架，包含这些小节：项目目标、技术栈、关键约束、',
    '初始里程碑。若上面有 README / 零星条目透露了线索，请据此给出更具体的占位提示；',
    '否则给出 1-2 条引导用户在首条需求中补全的占位提示，不要凭空臆造具体技术选型。',
    '只输出 markdown 正文，不要寒暄。',
  ]
    .filter(Boolean)
    .join('\n');
  const scaffold = await runInitLlm(ctx.userId, prompt, {
    temperature: 0.3,
    maxOutputTokens: 1024,
  });
  return {
    result: {
      scaffold: scaffold ?? fallbackScaffold,
      usedLlm: scaffold !== null,
      note: '空项目记忆骨架（仅会话内，未落盘）',
    },
  };
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
        ({ result } = await execScaffoldMemory(ctx));
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
