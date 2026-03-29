import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
    const raw = readFileSync(this.indexFilePath, 'utf-8');
    const artifacts = JSON.parse(raw) as RunArtifact[];
    for (const artifact of artifacts) {
      this.store.set(artifact.id, artifact);
    }
  }

  private persistArtifacts(): void {
    if (!this.indexFilePath) {
      return;
    }
    writeFileSync(this.indexFilePath, JSON.stringify([...this.store.values()], null, 2), 'utf-8');
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
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec) as (
      cmd: string,
      opts?: { maxBuffer?: number },
    ) => Promise<{ stdout: string }>;
    const maxResults = options?.maxResults ?? 100;
    const cmd = `grep -rn --color=never -F ${JSON.stringify(query)} . 2>/dev/null | head -${maxResults} || true`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 4 * 1024 * 1024 });
    const results: FileSearchResult[] = [];
    for (const raw of stdout.split('\n')) {
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
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec) as (
      cmd: string,
      opts?: { maxBuffer?: number },
    ) => Promise<{ stdout: string }>;
    const cmd = `find . -type f -name ${JSON.stringify(pattern)} 2>/dev/null || true`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 2 * 1024 * 1024 });
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
