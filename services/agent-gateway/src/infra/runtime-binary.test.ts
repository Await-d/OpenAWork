import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRuntimeBinary, runtimeBinaryUnavailableMessage } from './runtime-binary.js';

const createdDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-binary-test-'));
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
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('resolveRuntimeBinary', () => {
  it('env 命中时优先于 resource 与 bundled 返回', () => {
    const envBinary = createBinary(createTempDir(), 'ffmpeg');
    const resourceBinary = createBinary(createTempDir(), 'ffmpeg');
    const bundledBinary = createBinary(createTempDir(), 'ffmpeg');

    const result = resolveRuntimeBinary({
      envVar: 'FFMPEG_BIN',
      name: 'ffmpeg',
      resourcePath: resourceBinary,
      bundledPath: bundledBinary,
      env: { FFMPEG_BIN: envBinary, PATH: '' },
      platform: 'linux',
    });

    expect(result).toEqual({ path: envBinary, source: 'env' });
  });

  it('env 指向不存在的文件时回退到 resource', () => {
    const resourceBinary = createBinary(createTempDir(), 'ffmpeg');
    const missingEnvPath = join(createTempDir(), 'missing', 'ffmpeg');

    const result = resolveRuntimeBinary({
      envVar: 'FFMPEG_BIN',
      name: 'ffmpeg',
      resourcePath: resourceBinary,
      env: { FFMPEG_BIN: missingEnvPath, PATH: '' },
      platform: 'linux',
    });

    expect(result).toEqual({ path: resourceBinary, source: 'resource' });
  });

  it('resource 缺失且 bundled 为不存在的虚拟路径时跳过并继续 PATH 查找', () => {
    const pathDir = createTempDir();
    const pathBinary = createBinary(pathDir, 'ffmpeg');
    const virtualBundled = join(createTempDir(), 'virtual', 'ffmpeg');

    const result = resolveRuntimeBinary({
      envVar: 'FFMPEG_BIN',
      name: 'ffmpeg',
      resourcePath: join(createTempDir(), 'missing-resource', 'ffmpeg'),
      bundledPath: virtualBundled,
      env: { PATH: pathDir },
      platform: 'linux',
    });

    expect(result).toEqual({ path: pathBinary, source: 'path' });
  });

  it('bundled 为真实文件时在 resource 缺失后命中 bundled', () => {
    const bundledBinary = createBinary(createTempDir(), 'ffprobe');

    const result = resolveRuntimeBinary({
      envVar: 'FFPROBE_BIN',
      name: 'ffprobe',
      resourcePath: join(createTempDir(), 'missing', 'ffprobe'),
      bundledPath: bundledBinary,
      env: { PATH: '' },
      platform: 'linux',
    });

    expect(result).toEqual({ path: bundledBinary, source: 'bundled' });
  });

  it('bundled 为非字符串（如模块对象）时视为未提供', () => {
    const resourceBinary = createBinary(createTempDir(), 'ffprobe');

    const result = resolveRuntimeBinary({
      envVar: 'FFPROBE_BIN',
      name: 'ffprobe',
      resourcePath: resourceBinary,
      bundledPath: { path: join(createTempDir(), 'ffprobe') },
      env: { PATH: '' },
      platform: 'linux',
    });

    expect(result).toEqual({ path: resourceBinary, source: 'resource' });
  });

  it('PATH 命中时返回第一个存在的可执行文件，且不因不存在的目录抛错', () => {
    const emptyDir = join(createTempDir(), 'does-not-exist');
    const pathDir = createTempDir();
    const pathBinary = createBinary(pathDir, 'ffmpeg');

    const result = resolveRuntimeBinary({
      envVar: 'FFMPEG_BIN',
      name: 'ffmpeg',
      resourcePath: join(createTempDir(), 'missing', 'ffmpeg'),
      bundledPath: null,
      env: { PATH: `${emptyDir}${delimiter}${pathDir}` },
      platform: 'linux',
    });

    expect(result).toEqual({ path: pathBinary, source: 'path' });
  });

  it('win32 平台下在 PATH 中额外探测 .exe 后缀', () => {
    const pathDir = createTempDir();
    const exeBinary = createBinary(pathDir, 'ffmpeg.exe');

    const result = resolveRuntimeBinary({
      envVar: 'FFMPEG_BIN',
      name: 'ffmpeg',
      resourcePath: null,
      bundledPath: undefined,
      env: { PATH: pathDir },
      platform: 'win32',
    });

    expect(result).toEqual({ path: exeBinary, source: 'path' });
  });

  it('所有候选都未命中时返回 null', () => {
    const result = resolveRuntimeBinary({
      envVar: 'FFMPEG_BIN',
      name: 'ffmpeg',
      resourcePath: join(createTempDir(), 'missing-resource', 'ffmpeg'),
      bundledPath: join(createTempDir(), 'virtual', 'ffmpeg'),
      env: { PATH: join(createTempDir(), 'empty-path') },
      platform: 'linux',
    });

    expect(result).toBeNull();
  });

  it('环境变量为空白字符串时视为未设置', () => {
    const resourceBinary = createBinary(createTempDir(), 'ffprobe');

    const result = resolveRuntimeBinary({
      envVar: 'FFPROBE_BIN',
      name: 'ffprobe',
      resourcePath: resourceBinary,
      env: { FFPROBE_BIN: '   ', PATH: '' },
      platform: 'linux',
    });

    expect(result).toEqual({ path: resourceBinary, source: 'resource' });
  });
});

describe('runtimeBinaryUnavailableMessage', () => {
  it('给出安装到 PATH 或设置环境变量的可操作指引', () => {
    const message = runtimeBinaryUnavailableMessage({
      label: 'FFmpeg',
      binaryName: 'ffmpeg',
      envVar: 'FFMPEG_BIN',
    });

    expect(message).toContain('FFmpeg 不可用');
    expect(message).toContain('PATH');
    expect(message).toContain('FFMPEG_BIN');
    expect(message).not.toContain('ffmpeg-static');
  });
});
