import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as PlannerModule from '../../team/init/team-init-planner.js';
import type * as StoreModule from '../../team/init/team-init-store.js';
import type * as RunnerModule from '../../team/init/team-init-runner.js';
import type * as AutorunModule from '../../team/init/team-init-autorun.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

// 无 LLM：understand-architecture 走启发式兜底。
vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
  resolveAuxiliaryLlmConfigCandidates: async () => [],
}));

let dbModule: typeof DbModule;
let planner: typeof PlannerModule;
let store: typeof StoreModule;
let runner: typeof RunnerModule;
let autorun: typeof AutorunModule;

const USER_ID = 'u-team-init';
const TEAM_WORKSPACE_ID = 'tw-team-init';

let workspaceRoots: string[] = [];

interface MemoryKnowledgeRow {
  key: string;
  value: string;
  source: string;
  priority: number;
  workspace_root: string | null;
  team_workspace_id: string | null;
  role_layers_json: string | null;
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function seedSessionWithMetadata(sessionId: string, metadata: Record<string, unknown>): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
     VALUES (?, ?, 'team-session', ?, 'idle', 'reception')`,
    [sessionId, USER_ID, JSON.stringify(metadata)],
  );
}

function getTeamInitKnowledge(key: string): MemoryKnowledgeRow | undefined {
  return dbModule.sqliteGet<MemoryKnowledgeRow>(
    `SELECT key, value, source, priority, workspace_root, team_workspace_id, role_layers_json
       FROM memories
      WHERE user_id = ? AND type = 'project_context' AND key = ? AND enabled = 1
      LIMIT 1`,
    [USER_ID, key],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  // 测试环境未设置 WORKSPACE_ROOTS / WORKSPACE_ROOT，access 非受限，
  // validateWorkspacePath 直接返回 resolve 后路径，临时目录可直接使用。
  const root = mkdtempSync(join(tmpdir(), 'openawork-team-init-'));
  workspaceRoots = [root];

  planner = await import('../../team/init/team-init-planner.js');
  store = await import('../../team/init/team-init-store.js');
  runner = await import('../../team/init/team-init-runner.js');
  autorun = await import('../../team/init/team-init-autorun.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memories', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
  for (const root of workspaceRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('planTeamInit', () => {
  it('空目录且无目标时延迟工具绑定与项目记忆初始化', async () => {
    const emptyDir = join(workspaceRoots[0]!, 'empty-project');
    mkdirSync(emptyDir, { recursive: true });

    const state = await planner.planTeamInit({
      workingRoot: emptyDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });

    expect(state.projectKind).toBe('empty');
    expect(state.phase).toBe('completed');
    const scan = state.steps.find((s) => s.key === 'scan-shared-record');
    expect(scan?.status).toBe('done');
    expect(state.steps.find((s) => s.key === 'understand-architecture')?.status).toBe(
      'not_applicable',
    );
    expect(state.steps.find((s) => s.key === 'scaffold-memory')?.status).toBe('not_applicable');
    expect(state.steps.find((s) => s.key === 'bind-tools-per-layer')?.status).toBe(
      'not_applicable',
    );
    expect(state.steps.find((s) => s.key === 'scaffold-memory')?.description).toContain(
      '收到首个需求后',
    );
  });

  it('空目录带首个目标时才启用工具绑定与项目记忆骨架', async () => {
    const emptyDir = join(workspaceRoots[0]!, 'empty-project-with-goal');
    mkdirSync(emptyDir, { recursive: true });

    const state = await planner.planTeamInit({
      workingRoot: emptyDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
      initialGoal: '创建一个 React 看板应用',
    });

    expect(state.projectKind).toBe('empty');
    expect(state.phase).toBe('proposed');
    expect(state.steps.find((s) => s.key === 'bind-tools-per-layer')?.status).toBe('proposed');
    expect(state.steps.find((s) => s.key === 'scaffold-memory')?.status).toBe('proposed');
    expect(state.steps.find((s) => s.key === 'bind-tools-per-layer')?.title).toContain('首个目标');
  });

  it('无可用工作目录时判定 unknown，并且不触发项目化初始化步骤', async () => {
    const state = await planner.planTeamInit({
      workingRoot: null,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });

    expect(state.projectKind).toBe('unknown');
    expect(state.phase).toBe('completed');
    expect(state.steps.find((s) => s.key === 'read-project-level1')?.status).toBe('not_applicable');
    expect(state.steps.find((s) => s.key === 'bind-tools-per-layer')?.status).toBe(
      'not_applicable',
    );
    expect(state.steps.find((s) => s.key === 'scaffold-memory')?.status).toBe('not_applicable');
  });

  it('含 package.json 的目录判定为 existing，理解架构步骤可执行', async () => {
    const existingDir = join(workspaceRoots[0]!, 'existing-project');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'package.json'), '{"name":"demo"}', 'utf8');

    const state = await planner.planTeamInit({
      workingRoot: existingDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });

    expect(state.projectKind).toBe('existing');
    expect(state.steps.find((s) => s.key === 'understand-architecture')?.status).toBe('proposed');
    expect(state.steps.find((s) => s.key === 'scaffold-memory')?.status).toBe('not_applicable');
  });
});

describe('team-init-store + runner', () => {
  it('确认执行 read-project-level1 后回写 result 并推进 phase', async () => {
    const existingDir = join(workspaceRoots[0]!, 'proj-level1');
    mkdirSync(join(existingDir, 'src'), { recursive: true });
    writeFileSync(join(existingDir, 'package.json'), '{"name":"demo"}', 'utf8');

    const state = await planner.planTeamInit({
      workingRoot: existingDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-init-1', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: existingDir,
      teamInit: state,
    });

    const result = await runner.runTeamInitStep({
      sessionId: 's-init-1',
      userId: USER_ID,
      stepKey: 'read-project-level1',
    });

    expect(result.ok).toBe(true);
    const step = result.state?.steps.find((s) => s.key === 'read-project-level1');
    expect(step?.status).toBe('done');
    expect((step?.result?.['directories'] as string[]) ?? []).toContain('src');
  });

  it('understand-architecture 启发式摘要同步入工作区知识库', async () => {
    const existingDir = join(workspaceRoots[0]!, 'proj-architecture-knowledge');
    mkdirSync(join(existingDir, 'src'), { recursive: true });
    writeFileSync(join(existingDir, 'package.json'), '{"name":"demo"}', 'utf8');

    const state = await planner.planTeamInit({
      workingRoot: existingDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-init-architecture-knowledge', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: existingDir,
      teamInit: state,
    });

    const result = await runner.runTeamInitStep({
      sessionId: 's-init-architecture-knowledge',
      userId: USER_ID,
      stepKey: 'understand-architecture',
    });

    expect(result.ok).toBe(true);
    expect(result.state?.bindings.architectureSummary).toContain('项目顶层目录');
    const knowledge = getTeamInitKnowledge('team-init:architecture-summary');
    expect(knowledge?.value).toContain('项目顶层目录');
    expect(knowledge?.source).toBe('auto_extracted');
    expect(knowledge?.priority).toBe(80);
    expect(knowledge?.team_workspace_id).toBe(TEAM_WORKSPACE_ID);
    expect(knowledge?.workspace_root).toBe(existingDir);
    expect(knowledge?.role_layers_json).toBeNull();
  });

  it('并发确认同一步骤时只执行一次（in-flight 守卫，防重复 LLM / 写入）', async () => {
    const existingDir = join(workspaceRoots[0]!, 'proj-concurrent');
    mkdirSync(join(existingDir, 'src'), { recursive: true });
    writeFileSync(join(existingDir, 'package.json'), '{"name":"demo"}', 'utf8');

    const state = await planner.planTeamInit({
      workingRoot: existingDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-init-concurrent', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: existingDir,
      teamInit: state,
    });

    // Two confirms for the SAME step land before the first settles (double-click
    // / client retry). The in-flight guard must let exactly one execute and make
    // the other a no-op (`step-already-running`) instead of re-running the step.
    const [first, second] = await Promise.all([
      runner.runTeamInitStep({
        sessionId: 's-init-concurrent',
        userId: USER_ID,
        stepKey: 'read-project-level1',
      }),
      runner.runTeamInitStep({
        sessionId: 's-init-concurrent',
        userId: USER_ID,
        stepKey: 'read-project-level1',
      }),
    ]);

    const oks = [first, second].filter((r) => r.ok);
    const rejected = [first, second].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('step-already-running');

    // After the guard releases, a subsequent confirm short-circuits on `done`.
    const third = await runner.runTeamInitStep({
      sessionId: 's-init-concurrent',
      userId: USER_ID,
      stepKey: 'read-project-level1',
    });
    expect(third.ok).toBe(true);
    expect(third.state?.steps.find((s) => s.key === 'read-project-level1')?.status).toBe('done');
  });

  it('bind-tools-per-layer 把绑定同步进 teamDefinition.memberSlots', async () => {
    const existingDir = join(workspaceRoots[0]!, 'proj-bind');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'package.json'), '{"name":"demo"}', 'utf8');

    const state = await planner.planTeamInit({
      workingRoot: existingDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-init-bind', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: existingDir,
      teamInit: state,
      teamDefinition: {
        version: 2,
        source: { kind: 'blank' },
        requiredRoleBindings: [],
        memberSlots: [
          {
            id: 'exec-1',
            layer: 'executor',
            specialty: 'backend',
            displayName: '执行者',
            personaKey: 'default',
            toolsets: ['read'],
            required: true,
          },
        ],
      },
    });

    const result = await runner.runTeamInitStep({
      sessionId: 's-init-bind',
      userId: USER_ID,
      stepKey: 'bind-tools-per-layer',
    });
    expect(result.ok).toBe(true);
    expect(result.state?.bindings.perLayer.executor).toBeDefined();

    const ctx = store.loadTeamInitSessionContext('s-init-bind', USER_ID);
    expect(ctx).not.toBeNull();
  });

  it('旧空项目会话残留 proposed 绑定步骤时，无目标执行不会写入 perLayer 绑定', async () => {
    const emptyDir = join(workspaceRoots[0]!, 'legacy-empty-proposed-bind');
    mkdirSync(emptyDir, { recursive: true });

    const planned = await planner.planTeamInit({
      workingRoot: emptyDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    const legacyState = {
      ...planned,
      phase: 'proposed' as const,
      steps: planned.steps.map((step) =>
        step.key === 'bind-tools-per-layer'
          ? {
              ...step,
              status: 'proposed' as const,
              requiresConfirm: true,
              usesLlm: true,
            }
          : step,
      ),
    };
    seedSessionWithMetadata('s-init-legacy-empty-bind', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: emptyDir,
      teamInit: legacyState,
      teamDefinition: {
        version: 2,
        source: { kind: 'blank' },
        requiredRoleBindings: [],
        memberSlots: [{ id: 'exec-1', layer: 'executor' }],
      },
    });

    const result = await runner.runTeamInitStep({
      sessionId: 's-init-legacy-empty-bind',
      userId: USER_ID,
      stepKey: 'bind-tools-per-layer',
    });

    expect(result.ok).toBe(true);
    const step = result.state?.steps.find((s) => s.key === 'bind-tools-per-layer');
    expect(step?.status).toBe('done');
    expect(step?.result?.['mode']).toBe('waiting-for-goal');
    expect(result.state?.bindings.perLayer.executor).toBeUndefined();

    const row = dbModule.sqliteGet<{ metadata_json: string | null }>(
      `SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
      ['s-init-legacy-empty-bind', USER_ID],
    );
    const metadata = JSON.parse(row?.metadata_json ?? '{}') as Record<string, unknown>;
    const teamDefinition = metadata['teamDefinition'] as
      { memberSlots?: Array<{ skillIds?: string[]; mcpServerIds?: string[] }> } | undefined;
    expect(teamDefinition?.memberSlots?.[0]?.skillIds).toBeUndefined();
    expect(teamDefinition?.memberSlots?.[0]?.mcpServerIds).toBeUndefined();
  });

  it('markTeamInitSkipped 把整体 phase 置 skipped', async () => {
    const dir = join(workspaceRoots[0]!, 'proj-skip');
    mkdirSync(dir, { recursive: true });
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-init-skip', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: dir,
      teamInit: state,
    });

    const next = store.markTeamInitSkipped('s-init-skip', USER_ID);
    expect(next?.phase).toBe('skipped');
  });

  it('planTeamInit 产物通过 session metadata schema 校验', async () => {
    const dir = join(workspaceRoots[0]!, 'proj-schema');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    const { validateSessionMetadataPatch } =
      await import('../../session/session-workspace-metadata.js');
    const result = validateSessionMetadataPatch({ teamInit: state });
    expect(result.success).toBe(true);
  });
});

describe('ensureTeamInitBeforeTask（任务前自动初始化）', () => {
  it('未完成清单 → 自动跑完所有 proposed 步骤并推进 phase', async () => {
    const dir = join(workspaceRoots[0]!, 'autorun-existing');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-autorun-1', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: dir,
      teamInit: state,
    });

    const result = await autorun.ensureTeamInitBeforeTask({
      sessionId: 's-autorun-1',
      userId: USER_ID,
    });

    expect(result.ran).toBe(true);
    expect(result.executedSteps.length > 0).toBe(true);
    // 跑完后不应再有 proposed 步骤，phase 推进到 completed。
    const after = store.loadTeamInitSessionContext('s-autorun-1', USER_ID);
    expect(after?.teamInit?.steps.some((s) => s.status === 'proposed')).toBe(false);
    expect(after?.teamInit?.phase).toBe('completed');
  });

  it('空项目无目标 → 不自动跑延迟初始化步骤', async () => {
    const dir = join(workspaceRoots[0]!, 'autorun-empty-no-goal');
    mkdirSync(dir, { recursive: true });
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-autorun-empty-no-goal', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: dir,
      teamInit: state,
    });

    const result = await autorun.ensureTeamInitBeforeTask({
      sessionId: 's-autorun-empty-no-goal',
      userId: USER_ID,
    });

    expect(result.ran).toBe(false);
    expect(result.reason).toBe('completed');
    const after = store.loadTeamInitSessionContext('s-autorun-empty-no-goal', USER_ID);
    expect(after?.teamInit?.steps.find((s) => s.key === 'bind-tools-per-layer')?.status).toBe(
      'not_applicable',
    );
    expect(after?.teamInit?.steps.find((s) => s.key === 'scaffold-memory')?.status).toBe(
      'not_applicable',
    );
  });

  it('空项目收到首个目标 → 自动激活并执行工具绑定与记忆骨架', async () => {
    const dir = join(workspaceRoots[0]!, 'autorun-empty-with-goal');
    mkdirSync(dir, { recursive: true });
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-autorun-empty-with-goal', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: dir,
      teamInit: state,
    });

    const result = await autorun.ensureTeamInitBeforeTask({
      sessionId: 's-autorun-empty-with-goal',
      userId: USER_ID,
      taskGoal: '创建一个 React 看板应用',
    });

    expect(result.ran).toBe(true);
    expect(result.executedSteps).toContain('bind-tools-per-layer');
    expect(result.executedSteps).toContain('scaffold-memory');
    expect(result.state?.phase).toBe('completed');
    const scaffold = result.state?.steps.find((s) => s.key === 'scaffold-memory');
    expect(scaffold?.status).toBe('done');
    expect(scaffold?.result?.['mode']).toBe('goal-driven');
    expect(scaffold?.result?.['scaffold']).toContain('创建一个 React 看板应用');

    const knowledge = getTeamInitKnowledge('team-init:scaffold-memory');
    expect(knowledge?.value).toContain('创建一个 React 看板应用');
    expect(knowledge?.source).toBe('auto_extracted');
    expect(knowledge?.priority).toBe(60);
    expect(knowledge?.team_workspace_id).toBe(TEAM_WORKSPACE_ID);
    expect(knowledge?.workspace_root).toBe(dir);
    expect(knowledge?.role_layers_json).toBeNull();
  });

  it('已 skipped 的清单 → 不自动跑（尊重用户选择）', async () => {
    const dir = join(workspaceRoots[0]!, 'autorun-skipped');
    mkdirSync(dir, { recursive: true });
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-autorun-skip', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: dir,
      teamInit: { ...state, phase: 'skipped' },
    });

    const result = await autorun.ensureTeamInitBeforeTask({
      sessionId: 's-autorun-skip',
      userId: USER_ID,
    });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('skipped');
  });

  it('无初始化清单的会话 → ran=false, reason=no-plan', async () => {
    seedSessionWithMetadata('s-autorun-noplan', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
    });
    const result = await autorun.ensureTeamInitBeforeTask({
      sessionId: 's-autorun-noplan',
      userId: USER_ID,
    });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('no-plan');
  });
});
