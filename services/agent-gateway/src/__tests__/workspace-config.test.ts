import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverWorkspaceRoot, parseWorkspaceAccessMode } from '../workspace-config.js';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('discoverWorkspaceRoot', () => {
  it('walks up to the monorepo root when pnpm-workspace.yaml exists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'openawork-workspace-config-'));
    cleanupPaths.push(rootDir);

    await writeFile(join(rootDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const nestedDir = join(rootDir, 'services', 'agent-gateway');
    await mkdir(nestedDir, { recursive: true });

    expect(discoverWorkspaceRoot(nestedDir)).toBe(rootDir);
  });

  it('falls back to the starting path when no workspace markers are found', async () => {
    const isolatedDir = await mkdtemp(join(tmpdir(), 'openawork-isolated-config-'));
    cleanupPaths.push(isolatedDir);

    expect(discoverWorkspaceRoot(isolatedDir)).toBe(isolatedDir);
  });
});

describe('parseWorkspaceAccessMode', () => {
  it('defaults to unrestricted when no explicit workspace roots are configured', () => {
    expect(parseWorkspaceAccessMode(undefined, false)).toBe('unrestricted');
  });

  it('defaults to restricted when workspace roots are explicitly configured', () => {
    expect(parseWorkspaceAccessMode(undefined, true)).toBe('restricted');
  });

  it('honors explicit mode overrides', () => {
    expect(parseWorkspaceAccessMode('restricted', false)).toBe('restricted');
    expect(parseWorkspaceAccessMode('unrestricted', true)).toBe('unrestricted');
  });
});
