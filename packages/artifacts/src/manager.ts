import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type {
  RunArtifact,
  ArtifactManager,
  ArtifactPlatformAdapter,
  FileChange,
  FileBrowserAPI,
  FileSearchResult,
} from './types.js';

export interface ArtifactManagerOptions {
  indexFilePath?: string;
  platformAdapter?: ArtifactPlatformAdapter;
}

export class ArtifactManagerImpl implements ArtifactManager {
  private store = new Map<string, RunArtifact>();
  private readonly indexFilePath?: string;
  private readonly platformAdapter?: ArtifactPlatformAdapter;

  constructor(options: ArtifactManagerOptions = {}) {
    this.indexFilePath = options.indexFilePath;
    this.platformAdapter = options.platformAdapter;
    this.loadPersistedArtifacts();
  }

  list(sessionId: string): Promise<RunArtifact[]> {
    return Promise.resolve([...this.store.values()].filter((a) => a.sessionId === sessionId));
  }

  add(artifact: Omit<RunArtifact, 'id' | 'createdAt'>): RunArtifact {
    const full: RunArtifact = { ...artifact, id: randomUUID(), createdAt: Date.now() };
    this.store.set(full.id, full);
    this.persistArtifacts();
    return full;
  }

  async open(artifactId: string): Promise<void> {
    const artifact = this.store.get(artifactId);
    if (!artifact?.path) {
      throw new Error(`Artifact ${artifactId} has no file path`);
    }
    if (!this.platformAdapter) {
      throw new Error('open() requires platform integration (Tauri shell.open or Expo Sharing)');
    }
    await this.platformAdapter.openPath(artifact.path);
  }

  async download(artifactId: string, dest: string): Promise<void> {
    const artifact = this.store.get(artifactId);
    if (!artifact?.path) throw new Error(`Artifact ${artifactId} has no file path`);
    await fs.mkdir(dest, { recursive: true });
    const destPath = join(dest, basename(artifact.path));
    await fs.copyFile(artifact.path, destPath);
  }

  async share(artifactId: string): Promise<string> {
    const artifact = this.store.get(artifactId);
    if (!artifact) throw new Error(`Artifact ${artifactId} not found`);
    if (this.platformAdapter) {
      return this.platformAdapter.shareArtifact(artifact);
    }
    return `artifact://${artifactId}`;
  }

  async exportAll(sessionId: string): Promise<string> {
    const artifacts = await this.list(sessionId);
    return JSON.stringify(artifacts, null, 2);
  }

  captureFileWrite(sessionId: string, path: string, isNew: boolean): RunArtifact {
    return this.add({
      sessionId,
      type: isNew ? 'file_created' : 'file_modified',
      name: basename(path),
      path,
    });
  }

  private loadPersistedArtifacts(): void {
    if (!this.indexFilePath || !existsSync(this.indexFilePath)) {
      return;
    }
    // A corrupt index (half-written on crash, disk error, hand-edited)
    // must not blow up the constructor and take the whole artifacts
    // subsystem down. Degrade to an empty store and warn instead.
    let artifacts: unknown;
    try {
      const raw = readFileSync(this.indexFilePath, 'utf-8');
      artifacts = JSON.parse(raw);
    } catch (error) {
      console.warn(
        `[artifacts] 无法读取或解析索引文件，已忽略：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (!Array.isArray(artifacts)) {
      console.warn('[artifacts] 索引文件格式非法（期望数组），已忽略。');
      return;
    }
    for (const artifact of artifacts) {
      if (
        artifact &&
        typeof artifact === 'object' &&
        typeof (artifact as RunArtifact).id === 'string'
      ) {
        this.store.set((artifact as RunArtifact).id, artifact as RunArtifact);
      }
    }
  }

  private persistArtifacts(): void {
    if (!this.indexFilePath) {
      return;
    }
    // Atomic write: serialise to a temp file then rename, so a crash
    // mid-write can never leave a half-written (unparseable) index that
    // would then be silently dropped on next load.
    const payload = JSON.stringify([...this.store.values()], null, 2);
    const tempPath = `${this.indexFilePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      writeFileSync(tempPath, payload, 'utf-8');
      renameSync(tempPath, this.indexFilePath);
    } catch (error) {
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {
        // best-effort cleanup
      }
      throw error;
    }
  }
}

/**
 * Wall-clock ceiling for a single file-browser search subprocess. grep/find
 * over a huge or network-mounted tree can run unbounded; without a deadline
 * the returned promise never settles and the caller awaiting it hangs forever.
 */
const FILE_BROWSER_SEARCH_TIMEOUT_MS = 15_000;

/**
 * Run a search command via execFile (argv array, no shell) and return stdout.
 * Using execFile instead of a shell string means `query`/`pattern`/path args
 * can never be interpreted as shell metacharacters ($(...), backticks, quotes
 * — a command-injection vector under the previous `exec` + JSON.stringify
 * form). grep exits 1 on "no match" and find may exit non-zero on partial
 * errors; the old shell form swallowed those via `2>/dev/null || true`, so we
 * mirror that by returning whatever stdout was captured rather than throwing.
 */
async function runFileBrowserSearch(
  file: string,
  args: string[],
  maxBuffer: number,
): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile) as (
    file: string,
    args: string[],
    opts?: { maxBuffer?: number; timeout?: number },
  ) => Promise<{ stdout: string }>;
  try {
    const { stdout } = await execFileAsync(file, args, {
      maxBuffer,
      timeout: FILE_BROWSER_SEARCH_TIMEOUT_MS,
    });
    return stdout;
  } catch (error) {
    const stdout = (error as { stdout?: string | Buffer })?.stdout;
    if (typeof stdout === 'string') return stdout;
    if (stdout) return stdout.toString();
    return '';
  }
}

export class FileBrowserAPIImpl implements FileBrowserAPI {
  private changes = new Map<string, FileChange[]>();

  getChanges(sessionId: string): Promise<FileChange[]> {
    return Promise.resolve(this.changes.get(sessionId) ?? []);
  }

  recordChange(sessionId: string, change: FileChange): void {
    const existing = this.changes.get(sessionId) ?? [];
    const idx = existing.findIndex((c) => c.path === change.path);
    if (idx !== -1) {
      existing[idx] = change;
    } else {
      existing.push(change);
    }
    this.changes.set(sessionId, existing);
  }

  async searchText(query: string, options?: { maxResults?: number }): Promise<FileSearchResult[]> {
    const maxResults = options?.maxResults ?? 100;
    // execFile (argv array, no shell) so `query` can never be interpreted as
    // shell metacharacters — the previous `exec` form interpolated query via
    // JSON.stringify, which does NOT escape shell syntax ($(...), backticks).
    // The `| head -N` cap is applied in JS here instead of a shell pipe.
    const stdout = await runFileBrowserSearch(
      'grep',
      ['-rn', '--color=never', '-F', query, '.'],
      4 * 1024 * 1024,
    );
    const results: FileSearchResult[] = [];
    for (const raw of stdout.split('\n')) {
      if (results.length >= maxResults) break;
      const m =
        raw.match(/^([^:]+):([0-9]+):([0-9]+)?:?(.*)$/) ?? raw.match(/^([^:]+):([0-9]+):(.*)$/);
      if (!m) continue;
      const filePath = m[1];
      const line = m[2] ? parseInt(m[2], 10) : undefined;
      const snippet = (m[4] ?? m[3] ?? '').trim();
      if (!filePath) continue;
      results.push({ path: filePath, line, snippet });
    }
    return results;
  }

  async searchFiles(pattern: string): Promise<string[]> {
    const stdout = await runFileBrowserSearch(
      'find',
      ['.', '-type', 'f', '-name', pattern],
      2 * 1024 * 1024,
    );
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async read(path: string): Promise<{ content: string; encoding: string }> {
    const content = await fs.readFile(path, 'utf-8');
    return { content, encoding: 'utf-8' };
  }
}
