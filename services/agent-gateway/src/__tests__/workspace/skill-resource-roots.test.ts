import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse as parsePath } from 'node:path';
import { resourcePath } from '@openAwork/resources/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SkillResourceRootsModule from '../../workspace/skill-resource-roots.js';

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/test-gateway-workspace',
  WORKSPACE_ROOTS: ['/test-gateway-workspace'],
}));

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function loadSkillResourceRoots(): Promise<typeof SkillResourceRootsModule> {
  vi.resetModules();
  return await import('../../workspace/skill-resource-roots.js');
}

describe('skill resource roots', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('CRUSH_SKILLS_DIR', undefined);
    vi.stubEnv('OPENAWORK_RESOURCES_DIR', undefined);
    vi.stubEnv('OPENAWORK_DATA_DIR', undefined);
    vi.stubEnv('OPENWORK_SKILLS_DIR', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('包含配置的技能根、随包资源技能根，并做懒加载记忆化', async () => {
    const skillRoot = makeTempDir('openawork-skill-root-');
    vi.stubEnv('OPENWORK_SKILLS_DIR', skillRoot);

    const { getSkillResourceRoots } = await loadSkillResourceRoots();
    const roots = getSkillResourceRoots();

    expect(roots).toContain(realpathSync(skillRoot));
    expect(roots).toContain(realpathSync(resourcePath('skills')));
    expect(new Set(roots).size).toBe(roots.length);
    expect(getSkillResourceRoots()).toBe(roots);
  });

  it('文件系统根永远不会成为技能根', async () => {
    vi.stubEnv('OPENWORK_SKILLS_DIR', parsePath('/').root);

    const { getSkillResourceRoots } = await loadSkillResourceRoots();
    const roots = getSkillResourceRoots();

    expect(roots).not.toContain(parsePath('/').root);
    expect(roots.every((root) => parsePath(root).root !== root)).toBe(true);
  });

  it('用户主目录永远不会成为技能根', async () => {
    vi.stubEnv('OPENWORK_SKILLS_DIR', homedir());

    const { getSkillResourceRoots } = await loadSkillResourceRoots();

    expect(getSkillResourceRoots()).not.toContain(realpathSync(homedir()));
  });

  it('网关数据目录及其祖先目录永远不会成为技能根', async () => {
    const dataParent = makeTempDir('openawork-skill-data-parent-');
    const dataDir = join(dataParent, 'agent-gateway');
    mkdirSync(dataDir, { recursive: true });

    vi.stubEnv('OPENAWORK_DATA_DIR', dataDir);
    vi.stubEnv('OPENWORK_SKILLS_DIR', dataDir);
    const equalModule = await loadSkillResourceRoots();
    expect(equalModule.getSkillResourceRoots()).not.toContain(realpathSync(dataDir));

    vi.stubEnv('OPENWORK_SKILLS_DIR', dataParent);
    const ancestorModule = await loadSkillResourceRoots();
    expect(ancestorModule.getSkillResourceRoots()).not.toContain(realpathSync(dataParent));
  });

  it('不存在的候选技能根会被 fail-closed 丢弃', async () => {
    const missing = join(tmpdir(), `openawork-missing-skill-root-${process.pid}-${Date.now()}`);
    vi.stubEnv('OPENWORK_SKILLS_DIR', missing);

    const { getSkillResourceRoots } = await loadSkillResourceRoots();

    expect(getSkillResourceRoots()).not.toContain(missing);
  });

  it('realpath 后按包含关系判定，符号链接逃逸与同名前缀兄弟目录都被拒绝', async () => {
    const parent = makeTempDir('openawork-skill-containment-');
    const skillRoot = join(parent, 'skills');
    const evilSibling = join(parent, 'skills-evil');
    const outsideRoot = join(parent, 'outside');
    for (const dir of [join(skillRoot, 'templates'), evilSibling, outsideRoot]) {
      mkdirSync(dir, { recursive: true });
    }
    const assetPath = join(skillRoot, 'templates', 'viewer.html');
    writeFileSync(assetPath, 'skill asset\n', 'utf8');
    const evilAssetPath = join(evilSibling, 'viewer.html');
    writeFileSync(evilAssetPath, 'evil asset\n', 'utf8');
    const outsideAssetPath = join(outsideRoot, 'viewer.html');
    writeFileSync(outsideAssetPath, 'outside asset\n', 'utf8');
    const symlinkPath = join(skillRoot, 'escape.html');
    symlinkSync(outsideAssetPath, symlinkPath);

    vi.stubEnv('OPENWORK_SKILLS_DIR', skillRoot);
    const { isPathWithinSkillResources } = await loadSkillResourceRoots();

    expect(isPathWithinSkillResources(assetPath)).toBe(true);
    expect(isPathWithinSkillResources(realpathSync(skillRoot))).toBe(true);
    expect(isPathWithinSkillResources(evilAssetPath)).toBe(false);
    expect(isPathWithinSkillResources(outsideAssetPath)).toBe(false);
    expect(isPathWithinSkillResources(symlinkPath)).toBe(false);
    expect(isPathWithinSkillResources(join(skillRoot, 'templates', 'missing.html'))).toBe(false);
    expect(isPathWithinSkillResources(join(outsideRoot, '..'))).toBe(false);
  });
});
