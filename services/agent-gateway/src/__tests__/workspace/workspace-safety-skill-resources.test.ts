import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WorkspaceSafetyModule from '../../workspace/workspace-safety.js';

const state = vi.hoisted(() => ({
  restricted: false,
  workspaceRoots: [] as string[],
  workingDirectory: null as string | null,
}));

vi.mock('../../infra/db.js', () => ({
  get WORKSPACE_ACCESS_RESTRICTED() {
    return state.restricted;
  },
  get WORKSPACE_ROOT() {
    return state.workspaceRoots[0] ?? '/';
  },
  get WORKSPACE_ROOTS() {
    return state.workspaceRoots;
  },
  sqliteGet: (query: string) => {
    if (query.includes('metadata_json, user_id')) {
      return {
        metadata_json: state.workingDirectory
          ? JSON.stringify({ workingDirectory: state.workingDirectory })
          : '{}',
        user_id: 'user-1',
      };
    }
    return undefined;
  },
}));

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function loadSafetyModule(): Promise<typeof WorkspaceSafetyModule> {
  vi.resetModules();
  return await import('../../workspace/workspace-safety.js');
}

describe('session workspace skill resource allowance', () => {
  let workspaceRoot: string;
  let skillRoot: string;
  let skillAssetPath: string;
  let outsideFilePath: string;

  beforeEach(() => {
    workspaceRoot = makeTempDir('openawork-safety-workspace-');
    skillRoot = makeTempDir('openawork-safety-skills-');
    mkdirSync(join(skillRoot, 'templates'), { recursive: true });
    skillAssetPath = join(skillRoot, 'templates', 'viewer.html');
    writeFileSync(skillAssetPath, 'skill asset\n', 'utf8');
    outsideFilePath = join(makeTempDir('openawork-safety-outside-'), 'secret.txt');
    writeFileSync(outsideFilePath, 'outside\n', 'utf8');

    state.restricted = false;
    state.workspaceRoots = [workspaceRoot];
    state.workingDirectory = workspaceRoot;
    vi.stubEnv('OPENWORK_SKILLS_DIR', skillRoot);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allowSkillResourceRead 允许会话工作区外的技能资源，未开启时仍然拒绝', async () => {
    const { validateSessionWorkspacePath } = await loadSafetyModule();

    const allowed = validateSessionWorkspacePath({
      path: skillAssetPath,
      sessionId: 'session-1',
      allowSkillResourceRead: true,
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.ok && allowed.safePath).toBe(resolve(skillAssetPath));

    const denied = validateSessionWorkspacePath({
      path: skillAssetPath,
      sessionId: 'session-1',
    });
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.reason).toBe('outside-session-workspace');
  });

  it('会话外的普通路径即使开启 allowSkillResourceRead 也仍然拒绝', async () => {
    const { validateSessionWorkspacePath } = await loadSafetyModule();

    const result = validateSessionWorkspacePath({
      path: outsideFilePath,
      sessionId: 'session-1',
      allowSkillResourceRead: true,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('outside-session-workspace');
  });

  it('forbidden-path（全局根）失败永远不会被 allowSkillResourceRead 绕过', async () => {
    state.restricted = true;
    state.workspaceRoots = [workspaceRoot];
    const { validateSessionWorkspacePath } = await loadSafetyModule();

    const result = validateSessionWorkspacePath({
      path: skillAssetPath,
      sessionId: 'session-1',
      allowSkillResourceRead: true,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('forbidden-path');
  });

  it('assertSessionWorkspacePath 透传 allowSkillResourceRead 并返回技能资源真实路径', async () => {
    const { assertSessionWorkspacePath } = await loadSafetyModule();

    expect(
      assertSessionWorkspacePath({
        path: realpathSync(skillAssetPath),
        sessionId: 'session-1',
        allowSkillResourceRead: true,
      }),
    ).toBe(realpathSync(skillAssetPath));

    expect(() =>
      assertSessionWorkspacePath({ path: skillAssetPath, sessionId: 'session-1' }),
    ).toThrow(/outside current session workspace/);
  });
});
