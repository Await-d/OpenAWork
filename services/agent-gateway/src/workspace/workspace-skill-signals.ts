/**
 * Workspace signal sampler for skill recommendation (PR4 of the skill-
 * workspace-selection spec). Walks a workspace path bounded by both depth
 * and total byte budget so a giant repo cannot DoS the LLM call.
 *
 * Returns a stable shape suitable for hashing into a `signalDigest` and
 * for stuffing directly into the recommendation prompt. Signal collection
 * is best-effort: missing files / permission errors are silently dropped,
 * the call never throws.
 */

import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024;
const README_BUDGET = 4 * 1024;
const MANIFEST_BUDGET = 1500;
const MANIFEST_MAX_COUNT = 3;
const AGENTDOCS_BUDGET = 2 * 1024;
const TREE_MAX_DEPTH = 2;
const TREE_MAX_ENTRIES = 200;

const README_NAMES = ['README.md', 'README.en.md', 'readme.md'];
const MANIFEST_NAMES_PRIORITY = [
  'package.json',
  'pnpm-workspace.yaml',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'composer.json',
  'Gemfile',
  'build.gradle',
  'pom.xml',
];
const TREE_IGNORED = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  '.pnpm-store',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  '.idea',
  '.vscode',
  'coverage',
]);

export interface ManifestSignalEntry {
  path: string;
  bytes: number;
  content: string;
}

export interface WorkspaceSignals {
  workspacePath: string;
  readme: { path: string; content: string } | null;
  manifests: ManifestSignalEntry[];
  agentdocsIndex: { content: string } | null;
  topLevelTree: string[];
  fileExtensionHistogram: Record<string, number>;
  /** Total bytes consumed across the bag (used to enforce DEFAULT_MAX_TOTAL_BYTES). */
  approximateBytes: number;
}

async function readFirstNBytes(filePath: string, limit: number): Promise<string | null> {
  try {
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) return null;
    if (fileStat.size <= limit) {
      return await readFile(filePath, 'utf8');
    }
    return await new Promise<string>((resolveContent, reject) => {
      const stream = createReadStream(filePath, { encoding: 'utf8', end: limit - 1 });
      const chunks: string[] = [];
      stream.on('data', (chunk: string | Buffer) => {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      });
      stream.on('end', () => resolveContent(chunks.join('')));
      stream.on('error', reject);
    });
  } catch {
    return null;
  }
}

async function findReadme(
  workspacePath: string,
): Promise<{ path: string; content: string } | null> {
  for (const name of README_NAMES) {
    const candidate = join(workspacePath, name);
    const content = await readFirstNBytes(candidate, README_BUDGET);
    if (content !== null) {
      return { path: name, content: content.slice(0, README_BUDGET) };
    }
  }
  return null;
}

async function collectManifests(
  workspacePath: string,
  budgetBytes: number,
): Promise<{ entries: ManifestSignalEntry[]; consumed: number }> {
  const entries: ManifestSignalEntry[] = [];
  let consumed = 0;
  for (const name of MANIFEST_NAMES_PRIORITY) {
    if (entries.length >= MANIFEST_MAX_COUNT) break;
    if (consumed >= budgetBytes) break;
    const candidate = join(workspacePath, name);
    const content = await readFirstNBytes(candidate, MANIFEST_BUDGET);
    if (content === null) continue;
    const sliced = content.slice(0, MANIFEST_BUDGET);
    entries.push({ path: name, bytes: sliced.length, content: sliced });
    consumed += sliced.length;
  }

  // CSProj search: scan top-level for first one. Spec says `*.csproj` head.
  if (entries.length < MANIFEST_MAX_COUNT && consumed < budgetBytes) {
    try {
      const top = await readdir(workspacePath, { withFileTypes: true });
      const csproj = top.find((entry) => entry.isFile() && entry.name.endsWith('.csproj'));
      if (csproj) {
        const content = await readFirstNBytes(join(workspacePath, csproj.name), MANIFEST_BUDGET);
        if (content !== null) {
          const sliced = content.slice(0, MANIFEST_BUDGET);
          entries.push({ path: csproj.name, bytes: sliced.length, content: sliced });
          consumed += sliced.length;
        }
      }
    } catch {
      // ignore
    }
  }
  return { entries, consumed };
}

async function readAgentdocsIndex(workspacePath: string): Promise<{ content: string } | null> {
  const candidate = join(workspacePath, '.agentdocs', 'index.md');
  const content = await readFirstNBytes(candidate, AGENTDOCS_BUDGET);
  if (content === null) return null;
  return { content: content.slice(0, AGENTDOCS_BUDGET) };
}

async function collectTopTree(workspacePath: string): Promise<{
  tree: string[];
  histogram: Record<string, number>;
}> {
  const tree: string[] = [];
  const histogram: Record<string, number> = {};

  async function walk(dirPath: string, depth: number, prefix: string): Promise<void> {
    if (depth > TREE_MAX_DEPTH) return;
    if (tree.length >= TREE_MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (tree.length >= TREE_MAX_ENTRIES) return;
      if (entry.name.startsWith('.') && entry.name !== '.agentdocs') continue;
      if (TREE_IGNORED.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        tree.push(`${relative}/`);
        await walk(join(dirPath, entry.name), depth + 1, relative);
      } else if (entry.isFile()) {
        tree.push(relative);
        const dotIdx = entry.name.lastIndexOf('.');
        if (dotIdx > 0 && dotIdx < entry.name.length - 1) {
          const ext = entry.name.slice(dotIdx + 1).toLowerCase();
          if (ext.length <= 8) {
            histogram[ext] = (histogram[ext] ?? 0) + 1;
          }
        }
      }
    }
  }

  await walk(workspacePath, 0, '');
  return { tree, histogram };
}

export interface CollectWorkspaceSignalsOptions {
  /** Override total byte budget. Mostly for tests. */
  maxTotalBytes?: number;
}

/**
 * Sample workspace signals for skill recommendation. Resolves the path
 * before reading; caller is responsible for ensuring the path is allowed.
 */
export async function collectWorkspaceSignals(
  workspacePath: string,
  options: CollectWorkspaceSignalsOptions = {},
): Promise<WorkspaceSignals> {
  const root = resolve(workspacePath);
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

  const result: WorkspaceSignals = {
    workspacePath: root,
    readme: null,
    manifests: [],
    agentdocsIndex: null,
    topLevelTree: [],
    fileExtensionHistogram: {},
    approximateBytes: 0,
  };

  const exists = await stat(root).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!exists) {
    return result;
  }

  const readme = await findReadme(root);
  if (readme) {
    result.readme = readme;
    result.approximateBytes += readme.content.length;
  }

  const manifestBudget = Math.max(0, maxTotalBytes - result.approximateBytes);
  const { entries: manifests, consumed } = await collectManifests(root, manifestBudget);
  result.manifests = manifests;
  result.approximateBytes += consumed;

  if (result.approximateBytes < maxTotalBytes) {
    const agentdocs = await readAgentdocsIndex(root);
    if (agentdocs) {
      const remaining = Math.max(0, maxTotalBytes - result.approximateBytes);
      const trimmed = agentdocs.content.slice(0, Math.min(AGENTDOCS_BUDGET, remaining));
      result.agentdocsIndex = { content: trimmed };
      result.approximateBytes += trimmed.length;
    }
  }

  const { tree, histogram } = await collectTopTree(root);
  result.topLevelTree = tree;
  result.fileExtensionHistogram = histogram;

  return result;
}

/**
 * Stable JSON-canonical hash of (signals, candidateIds). Used to short-circuit
 * the LLM call when nothing material has changed about the project.
 */
export function computeSignalDigest(signals: WorkspaceSignals, candidateIds: string[]): string {
  const stable = stableStringify({
    workspacePath: signals.workspacePath,
    readme: signals.readme?.content ?? null,
    manifests: signals.manifests.map((entry) => ({ path: entry.path, content: entry.content })),
    agentdocsIndex: signals.agentdocsIndex?.content ?? null,
    topLevelTree: signals.topLevelTree,
    fileExtensionHistogram: signals.fileExtensionHistogram,
    candidateIds: [...candidateIds].sort(),
  });
  return createHash('sha1').update(stable).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map(
      (key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}
