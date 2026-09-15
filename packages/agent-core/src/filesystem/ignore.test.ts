import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

function expectPaths(manager: AgentIgnoreManager, paths: string[][], expected: boolean): void {
  for (const segments of paths) {
    const target = join(root, ...segments);
    expect(manager.shouldIgnore(target), segments.join('/')).toBe(expected);
  }
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
    expect(manager.shouldIgnore(join(root, 'node_modules', 'a', 'b.js'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'sub', 'package-lock.lock'))).toBe(true);
    // `**/` 前缀现在同时覆盖根级路径（本轮修复的有意行为变化）；嵌套用例保留。
    expect(manager.shouldIgnore(join(root, 'foo.lock'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'package-lock.lock'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'sub', '.git', 'config'))).toBe(true);
    expect(manager.shouldIgnore(join(root, '.git', 'config'))).toBe(true);
  });
});

describe('忽略模式编译：尾部斜杠、globstar 与字符类', () => {
  it('尾部斜杠目录模式忽略目录本身、子文件与嵌套目录', async () => {
    const manager = await createManager({ gitignore: ['bin/', 'obj/', '.vs/'] });
    expectPaths(
      manager,
      [
        ['bin'],
        ['bin', 'x.dll'],
        ['obj'],
        ['obj', 'x.o'],
        ['.vs'],
        ['.vs', 'sln.suo'],
        ['src', 'bin', 'x.dll'],
      ],
      true,
    );
    expectPaths(
      manager,
      [['binary.txt'], ['binx', 'y.txt'], ['object.js'], ['.vsx'], ['src', 'object.js']],
      false,
    );
  });

  it('字符类目录模式 [Bb]in/、[Oo]bj/ 同时覆盖两种大小写', async () => {
    const manager = await createManager({ gitignore: ['[Bb]in/', '[Oo]bj/'] });
    expectPaths(
      manager,
      [
        ['bin'],
        ['bin', 'x.dll'],
        ['Bin'],
        ['Bin', 'x.dll'],
        ['obj'],
        ['obj', 'x.o'],
        ['Obj'],
        ['Obj', 'x.o'],
        ['src', 'Bin', 'x.dll'],
      ],
      true,
    );
    expectPaths(manager, [['zin', 'x.dll'], ['objx', 'y.o'], ['binx', 'y.dll'], ['OBJ']], false);
  });

  it('**/bin/ 忽略根级与任意深度目录（含目录本身）', async () => {
    const manager = await createManager({ gitignore: ['**/bin/'] });
    expectPaths(
      manager,
      [
        ['bin'],
        ['bin', 'x.dll'],
        ['src', 'bin'],
        ['src', 'bin', 'x.dll'],
        ['src', 'a', 'bin', 'x.dll'],
      ],
      true,
    );
    expectPaths(manager, [['binx', 'y.txt'], ['src', 'abin', 'x.dll'], ['combine']], false);
  });

  it('**/ 前缀内置规则覆盖根级私钥、凭据与数据库文件（嵌套形式保持忽略）', async () => {
    const manager = await createManager();
    expectPaths(
      manager,
      [
        ['cert.pem'],
        ['server.key'],
        ['id_rsa'],
        ['id_ed25519'],
        ['.aws', 'credentials'],
        ['app.sqlite'],
        ['app.sqlite3'],
        ['app.db'],
        ['.git', 'config'],
        ['sub', 'cert.pem'],
        ['sub', 'server.key'],
        ['sub', 'id_rsa'],
        ['sub', '.aws', 'credentials'],
        ['sub', 'app.sqlite'],
        ['sub', '.git', 'config'],
      ],
      true,
    );
    expectPaths(
      manager,
      [['cert.pem.bak'], ['id_rsa.pub'], ['app.sqlite.journal'], ['server.key.txt']],
      false,
    );
  });

  it('字符类支持 [!...] 否定写法，未闭合的 [ 按字面量处理', async () => {
    const manager = await createManager({ gitignore: ['[!a]x', 'foo[bar'] });
    expectPaths(manager, [['zx'], ['!x'], ['foo[bar']], true);
    expectPaths(manager, [['ax'], ['x'], ['foobar'], ['foo']], false);
  });

  it('listIgnored 与 shouldIgnore 对尾部斜杠目录规则一致，且忽略目录不再下钻', async () => {
    const manager = await createManager({ gitignore: ['bin/'] });
    await mkdir(join(root, 'bin'), { recursive: true });
    await writeFile(join(root, 'bin', 'x.dll'), 'x', 'utf8');
    await writeFile(join(root, 'keep.txt'), 'x', 'utf8');

    const ignored = await manager.listIgnored(root);
    expect(ignored).toContain(join(root, 'bin'));
    expect(ignored).not.toContain(join(root, 'bin', 'x.dll'));
    expect(ignored).not.toContain(join(root, 'keep.txt'));
    expect(manager.shouldIgnore(join(root, 'bin'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'bin', 'x.dll'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'keep.txt'))).toBe(false);
  });
});

describe('非法与边界字符类不得抛错（用户可控 ignore 文件）', () => {
  it('非法范围 [z-a] 不抛错，同文件后续规则仍然生效', async () => {
    const manager = await createManager({ gitignore: ['[z-a]', 'secret.txt'] });
    expect(() => manager.shouldIgnore(join(root, 'secret.txt'))).not.toThrow();
    expect(manager.shouldIgnore(join(root, 'secret.txt'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'safe.txt'))).toBe(false);
  });

  it('非法否定模式 ![z-a] 不改变 last-match-wins 顺序', async () => {
    const noReinclude = await createManager({ gitignore: ['secret.txt', '![z-a]'] });
    expect(() => noReinclude.shouldIgnore(join(root, 'secret.txt'))).not.toThrow();
    expect(noReinclude.shouldIgnore(join(root, 'secret.txt'))).toBe(true);

    const reinclude = await createManager({ gitignore: ['[z-a]', '!secret.txt'] });
    expect(reinclude.shouldIgnore(join(root, 'secret.txt'))).toBe(false);
  });

  it('[]] 匹配文件名为 ] 的字面量且不抛错', async () => {
    const manager = await createManager({ gitignore: ['[]]'] });
    expect(() => manager.shouldIgnore(join(root, ']'))).not.toThrow();
    expect(manager.shouldIgnore(join(root, ']'))).toBe(true);
    expect(manager.shouldIgnore(join(root, 'x]'))).toBe(false);
  });

  it('[!] 不会退化成匹配一切的 [^] 且不抛错', async () => {
    const manager = await createManager({ gitignore: ['[!]'] });
    expect(() => manager.shouldIgnore(join(root, 'anything'))).not.toThrow();
    expect(manager.shouldIgnore(join(root, 'anything'))).toBe(false);
    expect(manager.shouldIgnore(join(root, '[!]'))).toBe(true);
  });

  it('[!]] 是“除 ] 外任一字符”的否定类且不抛错', async () => {
    const manager = await createManager({ gitignore: ['[!]]'] });
    expect(() => manager.shouldIgnore(join(root, 'a'))).not.toThrow();
    expect(manager.shouldIgnore(join(root, 'a'))).toBe(true);
    expect(manager.shouldIgnore(join(root, ']'))).toBe(false);
  });

  it('非法模式放入 .agentignore 与用户全局文件同样不抛错且后续规则生效', async () => {
    const agentManager = await createManager({ agentignore: ['[z-a]', 'agent-secret.txt'] });
    expect(() => agentManager.shouldIgnore(join(root, 'agent-secret.txt'))).not.toThrow();
    expect(agentManager.shouldIgnore(join(root, 'agent-secret.txt'))).toBe(true);

    const globalManager = await createManager({ userGlobal: ['[z-a]', 'global-secret.txt'] });
    expect(() => globalManager.shouldIgnore(join(root, 'global-secret.txt'))).not.toThrow();
    expect(globalManager.shouldIgnore(join(root, 'global-secret.txt'))).toBe(true);
  });

  it('合法字符类与含 ? 字面量保持既有匹配边界', async () => {
    const manager = await createManager({ gitignore: ['[*]', '[?]', '[ab?', '[!a]x'] });
    expectPaths(manager, [['*'], ['?'], ['[abX'], ['zx'], ['?x']], true);
    expectPaths(manager, [['a'], ['b'], ['x'], ['ax'], ['[ab'], ['[abXY']], false);
  });

  it('空模式 /、//、! 不匹配任何路径且不抛错', async () => {
    const manager = await createManager({ gitignore: ['/', '//', '!'] });
    expect(() => manager.shouldIgnore(join(root, 'x'))).not.toThrow();
    expect(manager.shouldIgnore(root)).toBe(false);
    expectPaths(manager, [['x'], ['a', 'b']], false);
  });
});
