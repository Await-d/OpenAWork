import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArtifactManagerImpl } from './manager.js';

describe('ArtifactManagerImpl', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openawork-artifacts-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('opens a file artifact through the platform adapter', async () => {
    const openPath = vi.fn().mockResolvedValue(undefined);
    const manager = new ArtifactManagerImpl({
      platformAdapter: {
        openPath,
        shareArtifact: vi.fn(),
      },
    });

    const artifact = manager.add({
      sessionId: 'session-1',
      type: 'file_created',
      name: 'report.txt',
      path: '/tmp/report.txt',
    });

    await manager.open(artifact.id);
    expect(openPath).toHaveBeenCalledWith('/tmp/report.txt');
  });

  it('uses the platform adapter for share links when available', async () => {
    const shareArtifact = vi.fn().mockResolvedValue('https://example.com/share/abc');
    const manager = new ArtifactManagerImpl({
      platformAdapter: {
        openPath: vi.fn(),
        shareArtifact,
      },
    });

    const artifact = manager.add({
      sessionId: 'session-1',
      type: 'document',
      name: 'summary.md',
      path: '/tmp/summary.md',
    });

    await expect(manager.share(artifact.id)).resolves.toBe('https://example.com/share/abc');
  });

  it('persists artifacts to an index file and reloads them on a new manager', async () => {
    const indexFilePath = join(tempDir, 'artifacts-index.json');
    const manager = new ArtifactManagerImpl({ indexFilePath });

    const artifact = manager.add({
      sessionId: 'session-1',
      type: 'document',
      name: 'summary.md',
      path: '/tmp/summary.md',
    });

    const stored = JSON.parse(await readFile(indexFilePath, 'utf-8')) as Array<{ id: string }>;
    expect(stored.some((entry) => entry.id === artifact.id)).toBe(true);

    const reloaded = new ArtifactManagerImpl({ indexFilePath });
    await expect(reloaded.list('session-1')).resolves.toEqual([
      expect.objectContaining({ id: artifact.id, name: 'summary.md' }),
    ]);
  });

  it('downloads an artifact file to the target directory', async () => {
    const sourcePath = join(tempDir, 'notes.txt');
    const destDir = join(tempDir, 'downloads');
    await writeFile(sourcePath, 'artifact content', 'utf-8');

    const manager = new ArtifactManagerImpl();
    const artifact = manager.add({
      sessionId: 'session-1',
      type: 'file_modified',
      name: 'notes.txt',
      path: sourcePath,
    });

    await manager.download(artifact.id, destDir);
    await expect(readFile(join(destDir, 'notes.txt'), 'utf-8')).resolves.toBe('artifact content');
  });
});
