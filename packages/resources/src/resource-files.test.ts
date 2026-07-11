import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resourcePath } from './node.js';

const originalResourcesDir = process.env['OPENAWORK_RESOURCES_DIR'];
const tempRoots: string[] = [];

afterEach(() => {
  if (typeof originalResourcesDir === 'string') {
    process.env['OPENAWORK_RESOURCES_DIR'] = originalResourcesDir;
  } else {
    delete process.env['OPENAWORK_RESOURCES_DIR'];
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('resourcePath', () => {
  it('prefers OPENAWORK_RESOURCES_DIR when the override contains builtin resources', () => {
    const root = mkdtempSync(join(tmpdir(), 'openawork-resources-'));
    tempRoots.push(root);
    mkdirSync(join(root, 'skills', 'builtin'), { recursive: true });
    writeFileSync(join(root, 'skills', 'builtin', 'git-master.md'), 'name: git-master\n');
    process.env['OPENAWORK_RESOURCES_DIR'] = root;

    expect(resourcePath('skills', 'builtin', 'git-master.md')).toBe(
      join(root, 'skills', 'builtin', 'git-master.md'),
    );
  });

  it('falls back to the package resources when OPENAWORK_RESOURCES_DIR is incomplete', () => {
    const root = mkdtempSync(join(tmpdir(), 'openawork-resources-invalid-'));
    tempRoots.push(root);
    process.env['OPENAWORK_RESOURCES_DIR'] = root;

    expect(resourcePath('skills', 'builtin', 'git-master.md')).not.toBe(
      join(root, 'skills', 'builtin', 'git-master.md'),
    );
  });
});
