import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SkillManifest } from '@openAwork/skill-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let workspaceRoot = '';
let skillDirPath = '';
let discoverLocalSkills: ((installedSkillIds: ReadonlySet<string>) => Promise<unknown[]>) | null =
  null;
let installLocalSkillFromDir:
  | ((dirPath: string) => Promise<{ skillId: string; manifest: SkillManifest }>)
  | null = null;

describe('local skills helpers', () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-local-helper-'));
    skillDirPath = join(workspaceRoot, 'skills', 'helper-skill');
    await mkdir(skillDirPath, { recursive: true });
    await writeFile(
      join(skillDirPath, 'skill.yaml'),
      `apiVersion: 'agent-skill/v1'\nid: 'com.example.helper-skill'\nname: 'helper-skill'\ndisplayName: 'Helper Skill'\nversion: '1.0.0'\ndescription: 'helper test skill'\ndescriptionForModel: 'Use helper skill for tests.'\ncapabilities:\n  - helper\npermissions: []\nmcp:\n  id: helper-mcp\n  transport: sse\n  url: https://example.com/helper-mcp\n`,
      'utf8',
    );

    vi.resetModules();
    vi.doMock('../db.js', () => ({
      WORKSPACE_ROOTS: [workspaceRoot],
    }));
    vi.doMock('../workspace-paths.js', () => ({
      validateWorkspacePath: (path: string) => {
        const resolvedPath = resolve(path);
        const resolvedRoot = resolve(workspaceRoot);
        return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`)
          ? resolvedPath
          : null;
      },
    }));

    const localSkillsModule = await import('../local-skills.js');
    discoverLocalSkills = localSkillsModule.discoverLocalSkills;
    installLocalSkillFromDir = localSkillsModule.installLocalSkillFromDir;
  });

  afterEach(async () => {
    discoverLocalSkills = null;
    installLocalSkillFromDir = null;
    vi.doUnmock('../db.js');
    vi.doUnmock('../workspace-paths.js');
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('discovers local workspace skills and marks installed state', async () => {
    const results = await discoverLocalSkills?.(new Set(['com.example.helper-skill']));
    expect(results).toHaveLength(1);
    expect(results?.[0]).toMatchObject({
      id: 'com.example.helper-skill',
      displayName: 'Helper Skill',
      workspaceRelativePath: 'skills/helper-skill',
      installed: true,
    });
  });

  it('installs local skills from a validated workspace path', async () => {
    const record = await installLocalSkillFromDir?.(skillDirPath);
    expect(record?.skillId).toBe('com.example.helper-skill');
    expect(record?.manifest.displayName).toBe('Helper Skill');
    expect(record?.manifest.mcp).toMatchObject({
      id: 'helper-mcp',
      transport: 'sse',
      url: 'https://example.com/helper-mcp',
    });
  });
});
