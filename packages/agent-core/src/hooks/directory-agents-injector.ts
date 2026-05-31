import fs from 'fs/promises';
import path from 'path';

export interface AgentsContextEntry {
  filePath: string;
  content: string;
  depth: number;
}

export interface DirectoryAgentsInjector {
  findNearestAgentsFile(filePath: string, stopAt?: string): Promise<AgentsContextEntry | null>;
  collectAllAgentsFiles(filePath: string, stopAt?: string): Promise<AgentsContextEntry[]>;
  buildInjectionBlock(entries: AgentsContextEntry[]): string;
}

/**
 * §0.158: bounds for the recursive descent in `collectAllAgentsFiles`.
 *
 * The injector is invoked by `/init-deep` (services/agent-gateway/src/routes/commands.ts),
 * which calls `collectAllAgentsFiles(WORKSPACE_ROOT, WORKSPACE_ROOT)` and then
 *   1. `buildInjectionBlock(...)` — the result is injected into the LLM context, AND
 *   2. persists the same block + a file count into the session `metadata_json` row.
 *
 * Without bounds, a typical Node monorepo workspace (full `node_modules`,
 * `.git`, build outputs) would walk thousands of subdirectories and buffer
 * every AGENTS.md / CLAUDE.md / CRUSH.md / GEMINI.md it finds — including ones
 * vendored inside dependencies. That blows the LLM context window, bloats the
 * session row (megabytes of metadata-json), and risks an OOM on the gateway.
 * The four caps below collectively prevent that without changing behaviour for
 * real workspaces (their hand-written AGENTS files easily fit under each cap).
 */
const IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.shadow-git',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  'dist',
  'build',
  'out',
  'coverage',
  '.coverage',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  '.DS_Store',
]);
/** Per-file byte cap (mirrors team-init-runner's MAX_FILE_BYTES). */
const MAX_FILE_BYTES = 256 * 1024;
/** Hard cap on collected entries (sane workspaces are well under this). */
const MAX_FILES = 64;
/** Total byte cap for the aggregated injection (fits any LLM context). */
const MAX_TOTAL_BYTES = 1024 * 1024;

interface CollectionState {
  totalBytes: number;
  /** True once any cap is hit; descent and reads stop. */
  capped: boolean;
}

export class DirectoryAgentsInjectorImpl implements DirectoryAgentsInjector {
  private readonly agentsFileNames = ['AGENTS.md', 'CRUSH.md', 'CLAUDE.md', 'GEMINI.md'];

  async findNearestAgentsFile(
    filePath: string,
    stopAt?: string,
  ): Promise<AgentsContextEntry | null> {
    let currentDir = path.dirname(path.resolve(filePath));
    const stopDir = stopAt ? path.resolve(stopAt) : path.parse(currentDir).root;
    let depth = 0;

    while (true) {
      for (const fileName of this.agentsFileNames) {
        const candidate = path.join(currentDir, fileName);
        if (await this.fileExists(candidate)) {
          const content = await fs.readFile(candidate, 'utf8');
          return { filePath: candidate, content, depth };
        }
      }

      if (currentDir === stopDir) return null;
      const parent = path.dirname(currentDir);
      if (parent === currentDir) return null;
      currentDir = parent;
      depth += 1;
    }
  }

  async collectAllAgentsFiles(filePath: string, stopAt?: string): Promise<AgentsContextEntry[]> {
    const entries: AgentsContextEntry[] = [];
    const startDir = await this.resolveStartDirectory(filePath);
    const stopDir = stopAt ? path.resolve(stopAt) : startDir;

    const state: CollectionState = { totalBytes: 0, capped: false };
    await this.collectDescendantAgentsFiles(startDir, stopDir, 0, entries, state);

    return entries.sort((a, b) => a.depth - b.depth || a.filePath.localeCompare(b.filePath));
  }

  buildInjectionBlock(entries: AgentsContextEntry[]): string {
    if (entries.length === 0) return '';
    return entries
      .map((entry) => `Instructions from: ${entry.filePath}\n${entry.content}`)
      .join('\n\n');
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveStartDirectory(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath);
    try {
      const stat = await fs.stat(resolved);
      return stat.isDirectory() ? resolved : path.dirname(resolved);
    } catch {
      return path.dirname(resolved);
    }
  }

  private async collectDescendantAgentsFiles(
    currentDir: string,
    stopDir: string,
    depth: number,
    entries: AgentsContextEntry[],
    state: CollectionState,
  ): Promise<void> {
    if (state.capped) return;
    if (!this.isWithinBoundary(currentDir, stopDir)) {
      return;
    }

    for (const fileName of this.agentsFileNames) {
      if (state.capped) return;
      const candidate = path.join(currentDir, fileName);
      if (!(await this.fileExists(candidate))) continue;
      // §0.158: stat-before-read so a single oversized AGENTS.md can't OOM us
      // and never enters the buffer at all. Skip silently — safer than
      // truncating mid-instruction (would corrupt a partial fenced code block
      // / cut a sentence in half before the LLM sees it).
      let size = 0;
      try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) continue;
        size = stat.size;
      } catch {
        continue;
      }
      if (size > MAX_FILE_BYTES) continue;
      if (state.totalBytes + size > MAX_TOTAL_BYTES) {
        state.capped = true;
        return;
      }
      let content: string;
      try {
        content = await fs.readFile(candidate, 'utf8');
      } catch {
        continue;
      }
      entries.push({ filePath: candidate, content, depth });
      state.totalBytes += Buffer.byteLength(content, 'utf8');
      if (entries.length >= MAX_FILES) {
        state.capped = true;
        return;
      }
    }

    let children: string[] = [];
    try {
      children = await fs.readdir(currentDir, { withFileTypes: true }).then((dirents) =>
        dirents
          // §0.158: prune heavy / vendored / generated directories before
          // descending. AGENTS files vendored inside dependencies are not
          // the user's intent and routinely number in the thousands.
          .filter((dirent) => dirent.isDirectory() && !IGNORED_DIRS.has(dirent.name))
          .map((dirent) => path.join(currentDir, dirent.name)),
      );
    } catch {
      return;
    }

    for (const childDir of children) {
      if (state.capped) return;
      await this.collectDescendantAgentsFiles(childDir, stopDir, depth + 1, entries, state);
    }
  }

  private isWithinBoundary(candidatePath: string, stopDir: string): boolean {
    const relative = path.relative(stopDir, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
}
