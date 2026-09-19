import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMediaBinaryPath, resolveMediaResourcePath } from './media-binary-path.js';

const createdDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'media-binary-path-test-'));
  createdDirs.push(dir);
  return dir;
}

function createBinary(dir: string, fileName: string): string {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, fileName);
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return filePath;
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('resolveMediaBinaryPath', () => {
  it('Given a configured env path When resolving Then it prioritizes the env source', () => {
    const envBinary = createBinary(createTempDir(), 'ffprobe');
    const bundledBinary = createBinary(createTempDir(), 'ffprobe');

    const result = resolveMediaBinaryPath({
      envVar: 'FFPROBE_BIN',
      name: 'ffprobe',
      bundledPath: bundledBinary,
      env: { FFPROBE_BIN: envBinary, PATH: '' },
      platform: 'linux',
    });

    expect(result).toEqual({ path: envBinary, source: 'env' });
  });

  it('Given a real bundled fallback When resolving Then it falls back to the bundled source', () => {
    const bundledBinary = createBinary(createTempDir(), 'ffprobe');

    const result = resolveMediaBinaryPath({
      envVar: 'FFPROBE_BIN',
      name: 'ffprobe',
      resourcePath: join(createTempDir(), 'missing', 'ffprobe'),
      bundledPath: bundledBinary,
      env: { PATH: '' },
      platform: 'linux',
    });

    expect(result).toEqual({ path: bundledBinary, source: 'bundled' });
  });

  it('Given every candidate missing When resolving Then it returns null', () => {
    const result = resolveMediaBinaryPath({
      envVar: 'FFPROBE_BIN',
      name: 'ffprobe',
      resourcePath: join(createTempDir(), 'missing', 'ffprobe'),
      bundledPath: join(createTempDir(), 'virtual', 'ffprobe'),
      env: { PATH: join(createTempDir(), 'empty-path') },
      platform: 'linux',
    });

    expect(result).toBeNull();
  });
});

describe('resolveMediaResourcePath', () => {
  it('Given OPENAWORK_RESOURCES_DIR When resolving Then it points at media/<name>', () => {
    vi.stubEnv('OPENAWORK_RESOURCES_DIR', '/opt/openawork/resources');

    const expected = join(
      '/opt/openawork/resources',
      'media',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    );

    expect(resolveMediaResourcePath('ffmpeg')).toBe(expected);
  });

  it('Given no resources dir When resolving Then it returns null', () => {
    vi.stubEnv('OPENAWORK_RESOURCES_DIR', '');

    expect(resolveMediaResourcePath('ffmpeg')).toBeNull();
  });
});
