import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as PlannerModule from '../../team/init/team-init-planner.js';
import type * as RunnerModule from '../../team/init/team-init-runner.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

// 有 LLM：分析类步骤应走 AI 路径。
vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => ({
    apiBaseUrl: 'https://example.test/v1',
    apiKey: 'sk-test',
    model: 'gpt-test',
    providerType: 'openai',
  }),
}));

// 按 prompt 内容返回不同的 canned 输出（结构化步骤回 JSON，文本步骤回正文）。
const llmCompletion = vi.fn(async ({ prompt }: { prompt: string }) => {
  if (prompt.includes('团队工具配置专家')) {
    return JSON.stringify({
      executor: { skillIds: ['skill-a'], mcpServerIds: [], rationale: 'AI 选择执行层 skill-a' },
      pm1: { skillIds: [], mcpServerIds: [], rationale: 'AI: 规划层无需工具' },
      pm2: { skillIds: [], mcpServerIds: [], rationale: 'AI: 管控层无需工具' },
    });
  }
  // read-project-level1：结构化 JSON 解读。
  if (prompt.includes('keyDirectories')) {
    return JSON.stringify({
      projectType: 'Node.js 工具库',
      techStack: ['TypeScript', 'Node.js'],
      keyDirectories: [{ name: 'src', role: '源码' }],
      summary: 'AI 解读：这是一个 Node.js 工具库。',
    });
  }
  if (prompt.includes('记忆要点')) return '- AI 提炼：禁止使用 any';
  if (prompt.includes('架构师')) return 'AI 架构摘要：TS monorepo。';
  if (prompt.includes('初始项目记忆骨架')) return '# 项目记忆\n## 目标\n- AI 占位';
  return 'AI 通用输出';
});

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: (cfg: { prompt: string }) => llmCompletion(cfg),
}));

// skill / mcp 发现桩：提供一个候选 skill 供 AI 绑定步骤挑选。
vi.mock('../../skill/local-skills.js', () => ({
  discoverLocalSkills: async () => [
    {
      id: 'skill-a',
      name: 'skill-a',
      displayName: 'Skill A',
      version: '1.0.0',
      description: '测试用 skill',
      category: 'other',
      sourceId: 'local-workspace',
      tags: ['test'],
      verified: false,
      downloads: 0,
      dirPath: '/tmp/skill-a',
      manifestPath: '/tmp/skill-a/skill.yaml',
      workspaceRelativePath: 'skill-a',
      installed: false,
    },
  ],
}));

vi.mock('../../mcp/mcp-runtime.js', () => ({
  loadConfiguredMcpServersForUser: () => [],
}));

let dbModule: typeof DbModule;
let planner: typeof PlannerModule;
let runner: typeof RunnerModule;

const USER_ID = 'u-team-init-ai';
const TEAM_WORKSPACE_ID = 'tw-team-init-ai';
let workspaceRoots: string[] = [];

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function seedSession(sessionId: string, metadata: Record<string, unknown>): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
     VALUES (?, ?, 'team-session', ?, 'idle', 'reception')`,
    [sessionId, USER_ID, JSON.stringify(metadata)],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  workspaceRoots = [mkdtempSync(join(tmpdir(), 'openawork-team-init-ai-'))];
  planner = await import('../../team/init/team-init-planner.js');
  runner = await import('../../team/init/team-init-runner.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  llmCompletion.mockClear();
});

afterAll(async () => {
  await dbModule.closeDb();
  for (const root of workspaceRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function planAndSeed(sessionId: string, dir: string): Promise<void> {
  const state = await planner.planTeamInit({
    workingRoot: dir,
    teamWorkspaceId: TEAM_WORKSPACE_ID,
    userId: USER_ID,
  });
  seedSession(sessionId, {
    teamWorkspaceId: TEAM_WORKSPACE_ID,
    workingDirectory: dir,
    teamInit: state,
  });
}

describe('team-init AI 路径', () => {
  it('read-project-level1 用 AI 解读一级结构（结构化）', async () => {
    const dir = join(workspaceRoots[0]!, 'ai-level1');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    await planAndSeed('s-ai-level1', dir);

    const result = await runner.runTeamInitStep({
      sessionId: 's-ai-level1',
      userId: USER_ID,
      stepKey: 'read-project-level1',
    });
    const step = result.state?.steps.find((s) => s.key === 'read-project-level1');
    expect(step?.result?.['usedLlm']).toBe(true);
    expect(step?.result?.['projectType']).toBe('Node.js 工具库');
    expect(step?.result?.['techStack']).toEqual(['TypeScript', 'Node.js']);
    expect(step?.result?.['interpretation']).toContain('AI 解读');
  });

  it('extract-project-memory 用 AI 提炼 digest', async () => {
    const dir = join(workspaceRoots[0]!, 'ai-memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    writeFileSync(join(dir, 'AGENTS.md'), '# 约定\n禁止使用 any。', 'utf8');
    await planAndSeed('s-ai-memory', dir);

    const result = await runner.runTeamInitStep({
      sessionId: 's-ai-memory',
      userId: USER_ID,
      stepKey: 'extract-project-memory',
    });
    const step = result.state?.steps.find((s) => s.key === 'extract-project-memory');
    expect(step?.result?.['usedLlm']).toBe(true);
    expect(result.state?.bindings.projectMemoryDigest).toContain('AI 提炼');
  });

  it('understand-architecture 用 AI 生成摘要', async () => {
    const dir = join(workspaceRoots[0]!, 'ai-arch');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    await planAndSeed('s-ai-arch', dir);

    const result = await runner.runTeamInitStep({
      sessionId: 's-ai-arch',
      userId: USER_ID,
      stepKey: 'understand-architecture',
    });
    const step = result.state?.steps.find((s) => s.key === 'understand-architecture');
    expect(step?.result?.['usedLlm']).toBe(true);
    expect(result.state?.bindings.architectureSummary).toContain('AI 架构摘要');
  });

  it('bind-tools-per-layer 用 AI 按项目挑选工具', async () => {
    const dir = join(workspaceRoots[0]!, 'ai-bind');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    await planAndSeed('s-ai-bind', dir);

    const result = await runner.runTeamInitStep({
      sessionId: 's-ai-bind',
      userId: USER_ID,
      stepKey: 'bind-tools-per-layer',
    });
    const step = result.state?.steps.find((s) => s.key === 'bind-tools-per-layer');
    expect(step?.result?.['usedLlm']).toBe(true);
    expect(result.state?.bindings.perLayer.executor?.skillIds).toEqual(['skill-a']);
    expect(result.state?.bindings.perLayer.executor?.rationale).toContain('AI');
  });

  it('scaffold-memory 用 AI 生成定制骨架', async () => {
    const dir = join(workspaceRoots[0]!, 'ai-scaffold');
    mkdirSync(dir, { recursive: true });
    await planAndSeed('s-ai-scaffold', dir);

    const result = await runner.runTeamInitStep({
      sessionId: 's-ai-scaffold',
      userId: USER_ID,
      stepKey: 'scaffold-memory',
    });
    const step = result.state?.steps.find((s) => s.key === 'scaffold-memory');
    expect(step?.result?.['usedLlm']).toBe(true);
    expect(step?.result?.['scaffold']).toContain('AI 占位');
  });

  it('AI 返回非法 id 时被过滤（不污染绑定）', async () => {
    llmCompletion.mockImplementationOnce(async () =>
      JSON.stringify({
        executor: { skillIds: ['skill-does-not-exist'], mcpServerIds: ['mcp-x'], rationale: 'x' },
        pm1: { skillIds: [], mcpServerIds: [], rationale: 'x' },
        pm2: { skillIds: [], mcpServerIds: [], rationale: 'x' },
      }),
    );
    const dir = join(workspaceRoots[0]!, 'ai-bind-bad');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    await planAndSeed('s-ai-bind-bad', dir);

    const result = await runner.runTeamInitStep({
      sessionId: 's-ai-bind-bad',
      userId: USER_ID,
      stepKey: 'bind-tools-per-layer',
    });
    // 非法 id 被过滤后 executor 不绑定任何工具。
    expect(result.state?.bindings.perLayer.executor?.skillIds).toEqual([]);
    expect(result.state?.bindings.perLayer.executor?.mcpServerIds).toEqual([]);
  });

  it('结构化步骤首次输出不可解析时自动重试一次并恢复', async () => {
    // 第一次返回带寒暄的非 JSON，第二次（重试）返回合法 JSON。
    llmCompletion
      .mockImplementationOnce(async () => '好的，这是我的分析：（此处没有 JSON）')
      .mockImplementationOnce(async () =>
        JSON.stringify({
          executor: { skillIds: ['skill-a'], mcpServerIds: [], rationale: '重试后命中' },
          pm1: { skillIds: [], mcpServerIds: [], rationale: 'x' },
          pm2: { skillIds: [], mcpServerIds: [], rationale: 'x' },
        }),
      );
    const dir = join(workspaceRoots[0]!, 'ai-bind-retry');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    await planAndSeed('s-ai-bind-retry', dir);

    const result = await runner.runTeamInitStep({
      sessionId: 's-ai-bind-retry',
      userId: USER_ID,
      stepKey: 'bind-tools-per-layer',
    });
    const step = result.state?.steps.find((s) => s.key === 'bind-tools-per-layer');
    expect(step?.result?.['usedLlm']).toBe(true);
    expect(result.state?.bindings.perLayer.executor?.skillIds).toEqual(['skill-a']);
    expect(result.state?.bindings.perLayer.executor?.rationale).toContain('重试后命中');
  });

  it('深度证据：read-project-level1 落入语言直方图与二级子树', async () => {
    const dir = join(workspaceRoots[0]!, 'ai-evidence');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;', 'utf8');
    writeFileSync(join(dir, 'src', 'util.ts'), 'export const b = 2;', 'utf8');
    await planAndSeed('s-ai-evidence', dir);

    const result = await runner.runTeamInitStep({
      sessionId: 's-ai-evidence',
      userId: USER_ID,
      stepKey: 'read-project-level1',
    });
    const step = result.state?.steps.find((s) => s.key === 'read-project-level1');
    const histogram = (step?.result?.['languageHistogram'] as Array<{ ext: string }>) ?? [];
    expect(histogram.some((h) => h.ext === '.ts')).toBe(true);
    const subtree = (step?.result?.['subtree'] as Array<{ dir: string }>) ?? [];
    expect(subtree.some((s) => s.dir === 'src')).toBe(true);
    expect((step?.result?.['detectedManifests'] as string[]) ?? []).toContain('package.json');
  });
});
