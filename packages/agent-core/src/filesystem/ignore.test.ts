import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentIgnoreManager } from './ignore.js';
import { createAgentIgnoreManager } from './ignore.js';

const platform = vi.hoisted(() => ({ configDir: '' }));

vi.mock('@openAwork/platform-adapter', () => ({
  createPlatformAdapter: () => ({
    getPlatform: () => 'linux',
    getConfigDir: () => platform.configDir,
    getDataDir: () => platform.configDir,
    getTempDir: () => platform.configDir,
    getSkillsDir: () => platform.configDir,
  }),
}));

let root: string;
let configDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-ignore-root-'));
  configDir = await mkdtemp(join(tmpdir(), 'agent-ignore-config-'));
  platform.configDir = configDir;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
});

interface RuleFixtures {
  gitignore?: string[];
  agentignore?: string[];
  userGlobal?: string[];
}

async function createManager(fixtures: RuleFixtures = {}): Promise<AgentIgnoreManager> {
  const writeRules = async (dir: string, name: string, lines: string[]): Promise<void> => {
    await writeFile(join(dir, name), `${lines.join('\n')}\n`, 'utf8');
  };
  if (fixtures.gitignore) await writeRules(root, '.gitignore', fixtures.gitignore);
  if (fixtures.agentignore) await writeRules(root, '.agentignore', fixtures.agentignore);
  if (fixtures.userGlobal) await writeRules(configDir, '.agentignore', fixtures.userGlobal);

  const manager = createAgentIgnoreManager();
  await manager.loadRules(root);
  return manager;
}

describe('AgentIgnoreManager 安全模板与否定规则', () => {
  it('精确匹配的安全 env 模板不被忽略（含嵌套 basename）', async () => {
    const manager = await createManager();
    const templates = [
      '.env.example',
      '.env.sample',
      '.env.template',
      '.env.dist',
      '.env.defaults',
    ];
    for (const name of templates) {
      expect(manager.shouldIgnore(join(root, name)), name).toBe(false);
      expect(manager.shouldIgnore(join(root, 'secrets', name)), `secrets/${name}`).toBe(false);
    }
  });

  it('真实 env 文件默认仍被忽略', async () => {
    const manager = await createManager();
    for (const name of ['.env', '.env.local', '.env.production', '.env.development']) {
      expect(manager.shouldIgnore(join(root, name)), name).toBe(true);
    }
  });

  it('与前缀相近但非精确模板名的文件仍被忽略', async () => {
    const manager = await createManager();
    expect(manager.shouldIgnore(join(root, '.env.example.bak'))).toBe(true);
    expect(manager.shouldIgnore(join(root, '.env.examplex'))).toBe(true);
  });

  it('.agentignore 的 !.env 无法解除内置硬拒绝', async () => {
    const manager = await createManager({ agentignore: ['!.env'] });
    expect(manager.shouldIgnore(join(root, '.env'))).toBe(true);
  });

  it('.gitignore 的否定无法放行内置 .env.* 基线拒绝', async () => {
    const manager = await createManager({
      gitignore: ['!.env.production', '!.env.local'],
    });
    expect(manager.shouldIgnore(join(root, '.env.production'))).toBe(true);
    expect(manager.shouldIgnore(join(root, '.env.local'))).toBe(true);
  });

  it('.agentignore 的 !.env.production 可以放行（仅显式 agent 策略可解除基线）', async () => {
    const manager = await createManager({ agentignore: ['!.env.production'] });
    expect(manager.shouldIgnore(join(root, '.env.production'))).toBe(false);
    expect(manager.shouldIgnore(join(root, '.env.local'))).toBe(true);
  });

  it('user-global 与 runtime 规则同样可以解除 .env.* 基线拒绝', async () => {
    const manager = await createManager({ userGlobal: ['!.env.staging'] });
    expect(manager.shouldIgnore(join(root, '.env.staging'))).toBe(false);
    expect(manager.shouldIgnore(join(root, '.env.production'))).toBe(true);

    manager.addRuntimeRule('!.env.ci');
    expect(manager.shouldIgnore(join(root, '.env.ci'))).toBe(false);
    expect(manager.shouldIgnore(join(root, '.env.staging'))).toBe(false);
  });

  it('基线之外的 .gitignore 忽略与否定仍然生效', async () => {
    const manager = await createManager({ gitignore: ['dist', '!dist/keep.js'] });
    expect(manager.shouldIgnore(join(root, 'dist', 'x.js'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'dist', 'keep.js'))).toBe(false);
  });

  it('.agentignore 的 !.env.development 可以重新放行（.env.* 非硬拒绝）', async () => {
    const manager = await createManager({ agentignore: ['!.env.development'] });
    expect(manager.shouldIgnore(join(root, '.env.development'))).toBe(false);
    expect(manager.shouldIgnore(join(root, '.env.production'))).toBe(true);
  });

  it('同一层内遵循最后匹配生效', async () => {
    const reinclude = await createManager({ agentignore: ['foo', '!foo'] });
    expect(reinclude.shouldIgnore(join(root, 'foo'))).toBe(false);

    const exclude = await createManager({ agentignore: ['!foo', 'foo'] });
    expect(exclude.shouldIgnore(join(root, 'foo'))).toBe(true);
  });

  it('否定规则在所有用户层生效，跨层按 [gitignore, agentignore, userGlobal, runtime] 排序', async () => {
    const manager = await createManager({
      gitignore: ['generated', '!git-kept.ts'],
      agentignore: ['!agent-kept.ts'],
      userGlobal: ['!global-kept.ts'],
    });

    expect(manager.shouldIgnore(join(root, 'generated', 'plain.ts'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'generated', 'git-kept.ts'))).toBe(false);
    expect(manager.shouldIgnore(join(root, 'generated', 'agent-kept.ts'))).toBe(false);
    expect(manager.shouldIgnore(join(root, 'generated', 'global-kept.ts'))).toBe(false);

    manager.addRuntimeRule('runtime-ignored.ts');
    expect(manager.shouldIgnore(join(root, 'generated', 'runtime-ignored.ts'))).toBe(true);
  });

  it('listIgnored 与 shouldIgnore 对否定规则保持一致', async () => {
    const manager = await createManager({ agentignore: ['drop-me', '!drop-me', 'also-drop'] });
    const candidates = ['drop-me', 'also-drop', 'keep-me'];
    for (const name of candidates) {
      await writeFile(join(root, name), 'x', 'utf8');
    }

    const ignored = await manager.listIgnored(root);
    for (const name of candidates) {
      const full = join(root, name);
      expect(manager.shouldIgnore(full), name).toBe(ignored.includes(full));
    }
    expect(ignored).toContain(join(root, 'also-drop'));
    expect(ignored).not.toContain(join(root, 'drop-me'));
  });

  it('空行、# 注释与 \\! 字面量规则按规范处理', async () => {
    const manager = await createManager({ agentignore: ['', '# 注释', '\\!literal'] });
    expect(manager.shouldIgnore(join(root, '!literal'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'literal'))).toBe(false);

    manager.addRuntimeRule('');
    manager.addRuntimeRule('# runtime 注释');
    expect(manager.shouldIgnore(join(root, 'untouched'))).toBe(false);
  });

  it('内置 node_modules/**、**/*.lock、**/.git/** 保持忽略且不可被否定', async () => {
    const manager = await createManager({
      agentignore: ['!node_modules', '!package-lock.lock', '!.git'],
    });
    expect(manager.shouldIgnore(join(root, 'node_modules', 'pkg', 'index.js'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'sub', 'package-lock.lock'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'sub', '.git', 'config'))).toBe(true);
  });
});
